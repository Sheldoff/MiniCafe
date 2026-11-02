import {
  hash,
  timestamp,
  secureJson as json,
  identity,
  csrfAllowed,
  rateLimit,
} from "./auth.js";
import { fail, mutate } from "./domain.js";
import { load, commit } from "./storage.js";

export const monoEnabled = (env) =>
  !!(env.MONO_TOKEN && env.MONO_JAR_ID && env.MONO_JAR_URL);
const validToken = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export async function createPayment(env, input, guest, items) {
  if (!validToken(input.payment_request))
    fail("Оновіть сторінку та повторіть оформлення");
  const id = await hash(input.payment_request);
  const data = JSON.stringify({ guest, items });
  const total = items.reduce((s, p) => s + p.qty * p.price, 0);
  if (!Number.isSafeInteger(total) || total <= 0)
    fail("Некоректна сума оплати");
  const old = await env.DB.prepare("SELECT * FROM mono_payments WHERE id=?")
    .bind(id)
    .first();
  if (old && old.data !== data)
    fail("Цей запит уже використано. Почніть нове замовлення.");
  if (!old) {
    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM mono_payments WHERE status='waiting' AND expires>?",
    )
      .bind(timestamp())
      .first();
    if (count.n >= 2000) fail("Тимчасово забагато замовлень");
    const reference =
      "MC-" +
      crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO mono_payments(id,reference,data,total,created,expires) SELECT ?,?,?,?,?,? WHERE coalesce((SELECT json_extract(data,'$.online_payment_enabled') FROM metadata WHERE id=1),1)!=0",
    )
      .bind(id, reference, data, total, timestamp(), timestamp() + 1800)
      .run();
  }
  const row = await env.DB.prepare("SELECT * FROM mono_payments WHERE id=?")
    .bind(id)
    .first();
  if (!row) fail("Онлайн-оплату вимкнено. Створіть код для каси.");
  if (row.data !== data) fail("Запит уже використано");
  return json({
    payment: true,
    token: input.payment_request,
    reference: row.reference,
    total: row.total,
    expires: row.expires,
    jar_url: env.MONO_JAR_URL,
  });
}
// Never infer payment from amount alone or trust a browser/webhook claim.
export function matchesPayment(row, tx) {
  return (
    typeof tx.id === "string" &&
    tx.id.length > 0 &&
    tx.hold === false &&
    tx.amount === row.total &&
    tx.operationAmount === row.total &&
    tx.currencyCode === 980 &&
    Number.isSafeInteger(tx.time) &&
    tx.time >= row.created &&
    typeof tx.comment === "string" &&
    tx.comment.trim().toUpperCase() === row.reference
  );
}
export async function fulfillPayment(env, row) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = await load(
      env.DB,
      "SELECT data FROM orders WHERE request=?",
      ["mono-" + row.id],
    );
    const after = structuredClone(before),
      data = JSON.parse(row.data);
    let result;
    try {
      result = mutate(after, "order", {
        request: "mono-" + row.id,
        guest: data.guest,
        items: data.items.map((p) => ({
          id: p.id,
          qty: p.qty,
          unit_price: p.price,
        })),
        cash_given: 0,
        card_amount: row.total,
        comment: "Банка monobank · " + row.reference,
      }).result;
    } catch {
      await env.DB.prepare(
        "UPDATE mono_payments SET status='review' WHERE id=? AND status='paid'",
      )
        .bind(row.id)
        .run();
      return;
    }
    try {
      await commit(
        env.DB,
        before,
        after,
        [],
        [
          env.DB.prepare(
            "INSERT INTO mutation_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM mono_payments WHERE id=? AND status='paid' AND transaction_id IS NOT NULL) THEN 1 ELSE 0 END",
          ).bind(row.id),
          env.DB.prepare(
            "UPDATE mono_payments SET status='fulfilled',order_id=? WHERE id=? AND status='paid'",
          ).bind(result.id, row.id),
        ],
      );
      return;
    } catch (error) {
      if (!/CHECK constraint failed/.test(String(error))) throw error;
      const current = await env.DB.prepare(
        "SELECT status FROM mono_payments WHERE id=?",
      )
        .bind(row.id)
        .first();
      if (current?.status === "fulfilled") return;
      if (attempt === 3) throw Error("Payment commit retry required");
    }
  }
}
export async function syncMono(env, bankFetch = fetch) {
  if (!monoEnabled(env)) return;
  const now = timestamp();
  const lock = await env.DB.prepare(
    "UPDATE mono_sync SET next_poll=? WHERE id=1 AND next_poll<=? RETURNING id",
  )
    .bind(now + 65, now)
    .first();
  if (!lock) return;
  await env.DB.prepare("DELETE FROM rate_limits WHERE expires<=?")
    .bind(now)
    .run();
  const rows = (
    await env.DB.prepare(
      "SELECT * FROM mono_payments WHERE (status='waiting' AND created>?) OR status='paid'",
    )
      .bind(now - 86400)
      .all()
  ).results;
  if (!rows.length) return;
  if (rows.some((r) => r.status === "waiting")) {
    let response;
    try {
      response = await bankFetch(
        "https://api.monobank.ua/personal/statement/" +
          encodeURIComponent(env.MONO_JAR_ID) +
          "/" +
          (now - 86400) +
          "/" +
          now,
        {
          headers: { "X-Token": env.MONO_TOKEN },
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch {
      throw Error("Monobank connection unavailable");
    }
    if (!response.ok) throw Error("Monobank statement unavailable");
    let transactions;
    try {
      transactions = await response.json();
    } catch {
      throw Error("Monobank response invalid");
    }
    if (!Array.isArray(transactions)) throw Error("Monobank response invalid");
    for (const row of rows.filter((r) => r.status === "waiting")) {
      const matches = transactions.filter((tx) => matchesPayment(row, tx));
      if (matches.length !== 1) continue;
      const tx = matches[0];
      // Late payments need staff review; do not silently put old orders in the queue.
      await env.DB.prepare(
        "UPDATE OR IGNORE mono_payments SET transaction_id=?,status=? WHERE id=? AND status='waiting'",
      )
        .bind(tx.id, tx.time <= row.expires ? "paid" : "review", row.id)
        .run();
    }
    await env.DB.prepare("UPDATE mono_sync SET checked=? WHERE id=1")
      .bind(now)
      .run();
  }
  const paid = (
    await env.DB.prepare(
      "SELECT * FROM mono_payments WHERE status='paid'",
    ).all()
  ).results;
  for (const row of paid) await fulfillPayment(env, row);
}
export async function paymentRoutes(request, env) {
  const path = new URL(request.url).pathname;
  if (path === "/api/payments" && request.method === "GET") {
    const user = await identity(request, env);
    if (!user || !["admin", "cash", "service"].includes(user.role))
      return json({ error: "Недостатньо прав" }, 403);
    const rows = (
      await env.DB.prepare(
        "SELECT reference,total,status,order_id,created,data FROM mono_payments WHERE status='review' OR (status='waiting' AND expires>?) ORDER BY created DESC LIMIT 100",
      )
        .bind(timestamp())
        .all()
    ).results;
    return json({
      payments: rows.map((r) => ({ ...r, data: JSON.parse(r.data) })),
    });
  }
  if (!["/api/public/payment-status", "/api/payments/retry"].includes(path))
    return null;
  if (request.method !== "POST")
    return json({ error: "Метод не підтримується" }, 405);
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    return json({ error: "Інший сайт" }, 403);
  // Small fixed request: never parse an unbounded body containing bank data.
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Порожній запит" }, 400);
  let text = "",
    size = 0;
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 256) {
      await reader.cancel();
      return json({ error: "Запит завеликий" }, 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    return json({ error: "Некоректний запит" }, 400);
  }
  if (path === "/api/payments/retry") {
    const user = await identity(request, env);
    if (
      !user ||
      !["admin", "cash", "service"].includes(user.role) ||
      !csrfAllowed(request, user)
    )
      return json({ error: "Недостатньо прав" }, 403);
    if (
      typeof input?.reference !== "string" ||
      !/^MC-[A-F0-9]{16}$/.test(input.reference)
    )
      return json({ error: "Некоректний код" }, 400);
    const row = await env.DB.prepare(
      "SELECT * FROM mono_payments WHERE reference=? AND status='review' AND transaction_id IS NOT NULL",
    )
      .bind(input.reference)
      .first();
    if (!row) return json({ error: "Платіж не потребує перевірки" }, 409);
    await env.DB.prepare(
      "UPDATE mono_payments SET status='paid' WHERE id=? AND status='review'",
    )
      .bind(row.id)
      .run();
    await fulfillPayment(env, row);
    const current = await env.DB.prepare(
      "SELECT status,order_id FROM mono_payments WHERE id=?",
    )
      .bind(row.id)
      .first();
    return json(current);
  }
  if (!(await rateLimit(env, request, "payment-status", 120, 60)))
    return json({ error: "Забагато запитів" }, 429);
  if (!validToken(input?.token))
    return json({ error: "Невідоме замовлення" }, 404);
  const row = await env.DB.prepare(
    "SELECT status,expires,order_id FROM mono_payments WHERE id=?",
  )
    .bind(await hash(input.token))
    .first();
  if (!row) return json({ error: "Невідоме замовлення" }, 404);
  return json({
    status:
      row.status === "waiting" && row.expires < timestamp()
        ? "expired"
        : row.status,
    order_id: row.order_id,
  });
}
