import {
  identity,
  csrfAllowed,
  rateLimit,
  secureJson as json,
  hash,
  timestamp,
} from "./auth.js";
import { fail } from "./domain.js";

async function body(request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    fail("Потрібен JSON");
  const reader = request.body?.getReader();
  if (!reader) fail("Порожній запит");
  let size = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8192) {
      await reader.cancel();
      fail("Запит завеликий");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const value of chunks) {
    bytes.set(value, offset);
    offset += value.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail("Некоректний JSON");
  }
}
const available = (p) =>
  !!p.active &&
  !p.sold_out &&
  (p.stock == null || p.stock_estimated || p.stock > 0);
export function publicProducts(rows) {
  return rows
    .map((r) => JSON.parse(r.data))
    .filter((p) => p.active)
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      route: p.route,
      price: p.price,
      available: available(p),
      limit:
        p.stock != null && !p.stock_estimated
          ? Math.max(0, Math.min(99, p.stock))
          : 99,
    }));
}
export function validateSelection(items, products) {
  if (!Array.isArray(items) || !items.length || items.length > 100)
    fail("Оберіть від 1 до 100 позицій");
  const quantities = new Map();
  for (const item of items) {
    if (
      !item ||
      !Number.isSafeInteger(item.id) ||
      !Number.isSafeInteger(item.qty) ||
      item.qty < 1 ||
      item.qty > 99
    )
      fail("Некоректна кількість");
    quantities.set(item.id, (quantities.get(item.id) || 0) + item.qty);
  }
  return [...quantities].map(([id, qty]) => {
    const p = products.find((p) => p.id === id);
    if (!p || !p.available || qty > p.limit || qty > 99)
      fail("Позиція закінчилась або кількість змінилася. Оновіть меню.");
    return { id, qty, name: p.name, price: p.price, route: p.route };
  });
}
export async function codeForOrder(db, code, request) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code))
    fail("Некоректний код");
  const digest = await hash(code),
    now = timestamp();
  const row = await db
    .prepare(
      "SELECT data,expires,used_request FROM guest_codes WHERE code_hash=?",
    )
    .bind(digest)
    .first();
  if (
    !row ||
    row.expires <= now ||
    (row.used_request && row.used_request !== request)
  )
    fail("Код прострочений, уже використаний або не знайдений");
  return { digest, row };
}
export async function guestOrders(request, env) {
  const url = new URL(request.url),
    path = url.pathname;
  if (
    ![
      "/api/public/menu",
      "/api/public/code",
      "/api/guest-code",
      "/api/public-settings",
    ].includes(path)
  )
    return null;
  const publicRoute = path.startsWith("/api/public/");
  let user;
  if (!publicRoute) {
    user = await identity(request, env);
    if (!user) return json({ error: "Потрібен вхід працівника" }, 401);
    if (
      path === "/api/public-settings"
        ? user.role !== "admin"
        : !["admin", "cash", "service"].includes(user.role)
    )
      return json({ error: "Недостатньо прав" }, 403);
  }
  if (path === "/api/public/menu" && request.method === "GET") {
    const result = await env.DB.batch([
      env.DB.prepare(
        "SELECT (published AND accepting) AS enabled FROM public_settings WHERE id=1",
      ),
      env.DB.prepare("SELECT data FROM products ORDER BY id"),
    ]);
    const enabled = !!result[0].results[0]?.enabled;
    return json(
      {
        published: enabled,
        accepting: enabled,
        products: enabled ? publicProducts(result[1].results) : [],
      },
      200,
      { "Cache-Control": "public,max-age=15" },
    );
  }
  if (path === "/api/public-settings" && request.method === "GET")
    return json(
      await env.DB.prepare(
        "SELECT (published AND accepting) AS enabled FROM public_settings WHERE id=1",
      ).first(),
    );
  if (request.method !== "POST")
    return json({ error: "Метод не підтримується" }, 405);
  if (publicRoute) {
    if (
      request.headers.get("Origin") !== url.origin ||
      request.headers.get("Sec-Fetch-Site") === "cross-site"
    )
      return json({ error: "Запит з іншого сайту заборонено" }, 403);
  } else if (!csrfAllowed(request, user))
    return json({ error: "Сесію не підтверджено" }, 403);
  if (
    !(await rateLimit(
      env,
      request,
      publicRoute ? "guest-create" : "guest-" + user.id,
      publicRoute ? 30 : 20,
      60,
    ))
  )
    return json({ error: "Забагато запитів. Спробуйте пізніше." }, 429);
  const input = await body(request);
  if (path === "/api/public-settings") {
    if (typeof input?.enabled !== "boolean") fail("Некоректне налаштування");
    await env.DB.prepare(
      "UPDATE public_settings SET published=?1,accepting=?1,revision=revision+1 WHERE id=1",
    )
      .bind(input.enabled ? 1 : 0)
      .run();
    return json({ enabled: input.enabled });
  }
  if (path === "/api/guest-code") {
    const { row } = await codeForOrder(env.DB, input?.code, null);
    const products = publicProducts(
      (await env.DB.prepare("SELECT data FROM products ORDER BY id").all())
        .results,
    );
    const items = validateSelection(JSON.parse(row.data).items, products);
    return json({
      items,
      total: items.reduce((sum, p) => sum + p.price * p.qty, 0),
    });
  }
  if (
    !(
      await env.DB.prepare(
        "SELECT (published AND accepting) AS enabled FROM public_settings WHERE id=1",
      ).first()
    )?.enabled
  )
    return json({ error: "Онлайн-меню тимчасово закрите" }, 403);
  const products = publicProducts(
    (await env.DB.prepare("SELECT data FROM products ORDER BY id").all())
      .results,
  );
  const items = validateSelection(input?.items, products),
    now = timestamp();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM guest_codes WHERE expires<=?").bind(now),
    env.DB.prepare("DELETE FROM rate_limits WHERE expires<=?").bind(now),
  ]);
  if (
    (await env.DB.prepare("SELECT count(*) AS n FROM guest_codes").first()).n >=
    5000
  )
    return json({ error: "Тимчасово забагато замовлень" }, 429);
  for (let i = 0; i < 5; i++) {
    const code = String(
      100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000),
    );
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO guest_codes(code_hash,data,expires) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM public_settings WHERE id=1 AND published=1 AND accepting=1)",
    )
      .bind(
        await hash(code),
        JSON.stringify({ items: items.map(({ id, qty }) => ({ id, qty })) }),
        now + 1800,
      )
      .run();
    if (result.meta.changes)
      return json({
        code,
        expires_in: 1800,
        total: items.reduce((sum, p) => sum + p.price * p.qty, 0),
      });
  }
  return json({ error: "Не вдалося створити код. Повторіть." }, 409);
}
