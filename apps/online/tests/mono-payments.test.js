import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import {
  createPayment,
  syncMono,
  paymentRoutes,
  matchesPayment,
} from "../src/mono-payments.js";
import { hash, timestamp } from "../src/auth.js";
function fixture() {
  const sql = new DatabaseSync(":memory:");
  for (const f of readdirSync(new URL("../migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(
      readFileSync(new URL("../migrations/" + f, import.meta.url), "utf8"),
    );
  const db = {
    prepare(q) {
      let args = [];
      return {
        bind(...a) {
          args = a;
          return this;
        },
        async first() {
          return sql.prepare(q).get(...args) || null;
        },
        async all() {
          return { results: sql.prepare(q).all(...args) };
        },
        execute() {
          const r = sql.prepare(q).all(...args);
          return {
            results: r,
            meta: {
              changes: Number(sql.prepare("SELECT changes() AS n").get().n),
            },
          };
        },
        async run() {
          return this.execute();
        },
      };
    },
    async batch(ss) {
      sql.exec("BEGIN");
      try {
        const r = ss.map((s) => s.execute());
        sql.exec("COMMIT");
        return r;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return {
    sql,
    env: {
      DB: db,
      MONO_TOKEN: "test",
      MONO_JAR_ID: "test-jar",
      MONO_JAR_URL: "https://send.monobank.ua/jar/test",
    },
  };
}
const items = [{ id: 1, qty: 1, name: "Кава", price: 5000, route: "bar" }];
const txFor = (row, extra = {}) => ({
  id: "bank-" + row.reference,
  hold: false,
  amount: row.total,
  operationAmount: row.total,
  currencyCode: 980,
  time: row.created + 1,
  comment: row.reference,
  ...extra,
});
test("bank matching rejects unconfirmed, wrong currency, wrong amount, absent reference and old transactions", () => {
  const row = { total: 5000, created: 100, reference: "MC-1234567890ABCDEF" },
    tx = txFor(row);
  assert.ok(matchesPayment(row, tx));
  for (const extra of [
    { hold: true },
    { amount: 4999 },
    { operationAmount: 4000 },
    { currencyCode: 840 },
    { time: 99 },
    { comment: "" },
    { comment: row.reference + " extra" },
    { id: "" },
  ])
    assert.equal(matchesPayment(row, { ...tx, ...extra }), false);
});
test("local disposable DB: payment idempotency, fail closed, atomic queue, replay, late/stock review and private status", async () => {
  const { sql, env } = fixture();
  const create = async (token) =>
    (
      await createPayment(
        env,
        { payment_request: token },
        "Іван Петренко",
        items,
      )
    ).json();
  const token = "a".repeat(64),
    first = await create(token),
    again = await create(token);
  assert.equal(first.reference, again.reference);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM orders").get().n, 0);
  await assert.rejects(
    createPayment(env, { payment_request: token }, "Інший Гість", items),
  );
  sql.exec("UPDATE mono_payments SET data=json_set(data,'$.history_hidden',1)");
  assert.equal((await create(token)).reference, first.reference);
  const row = sql.prepare("SELECT * FROM mono_payments").get();
  const poll = async (tx) => {
    sql.exec("UPDATE mono_sync SET next_poll=0");
    await syncMono(env, async () => Response.json(tx));
  };
  await poll([txFor(row, { comment: "" })]);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM orders").get().n, 0);
  sql.exec("UPDATE mono_sync SET next_poll=0");
  await assert.rejects(
    syncMono(env, async () => new Response("", { status: 401 })),
  );
  assert.equal(sql.prepare("SELECT count(*) AS n FROM orders").get().n, 0);
  await poll([txFor(row)]);
  const order = JSON.parse(sql.prepare("SELECT data FROM orders").get().data);
  assert.equal(order.payment.card_amount, 5000);
  assert.equal(order.payment.cash_amount, 0);
  assert.equal(order.items[0].price, 5000);
  assert.equal(
    sql.prepare("SELECT status FROM mono_payments").get().status,
    "fulfilled",
  );
  await poll([txFor(row)]);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM orders").get().n, 1);
  // The same bank transaction cannot be allocated to a second intent.
  const second = await create("b".repeat(64));
  const row2 = sql
    .prepare("SELECT * FROM mono_payments WHERE reference=?")
    .get(second.reference);
  await poll([txFor(row2, { id: txFor(row).id })]);
  assert.equal(
    sql.prepare("SELECT status FROM mono_payments WHERE id=?").get(row2.id)
      .status,
    "waiting",
  );
  await poll([txFor(row2, { time: row2.expires + 1 })]);
  assert.equal(
    sql.prepare("SELECT status FROM mono_payments WHERE id=?").get(row2.id)
      .status,
    "review",
  );
  const third = await create("c".repeat(64));
  const row3 = sql
    .prepare("SELECT * FROM mono_payments WHERE reference=?")
    .get(third.reference);
  sql.exec(
    "UPDATE products SET data=json_set(data,'$.sold_out',json('true')) WHERE id=1",
  );
  await poll([txFor(row3)]);
  assert.equal(
    sql.prepare("SELECT status FROM mono_payments WHERE id=?").get(row3.id)
      .status,
    "review",
  );
  assert.equal(sql.prepare("SELECT count(*) AS n FROM orders").get().n, 1);
  const status = async (tok) =>
    paymentRoutes(
      new Request("https://cafe.test/api/public/payment-status", {
        method: "POST",
        headers: { Origin: "https://cafe.test" },
        body: JSON.stringify({ token: tok }),
      }),
      env,
    );
  assert.equal((await status("d".repeat(64))).status, 404);
  const result = await (await status(token)).json();
  assert.deepEqual(result, { status: "fulfilled", order_id: order.id });
  assert.equal(
    (await paymentRoutes(new Request("https://cafe.test/api/payments"), env))
      .status,
    403,
  );
  // A failed atomic metadata guard must roll back the payment marker too.
  const fourth = await create("e".repeat(64));
  const row4 = sql
    .prepare("SELECT * FROM mono_payments WHERE reference=?")
    .get(fourth.reference);
  await assert.rejects(
    env.DB.batch([
      env.DB.prepare(
        "UPDATE mono_payments SET status='fulfilled' WHERE id=?",
      ).bind(row4.id),
      env.DB.prepare("INSERT INTO mutation_guard(ok) VALUES(0)"),
    ]),
  );
  assert.equal(
    sql.prepare("SELECT status FROM mono_payments WHERE id=?").get(row4.id)
      .status,
    "waiting",
  );
  assert.equal(await hash(token), row.id);
  env.ADMIN_TELEGRAM_IDS = "1";
  const staffToken = "1".repeat(64),
    csrf = "2".repeat(64);
  sql
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?,?,?)")
    .run(await hash(staffToken), "1", "Admin", csrf, timestamp() + 3600);
  const retry = (headers = {}) =>
    paymentRoutes(
      new Request("https://cafe.test/api/payments/retry", {
        method: "POST",
        headers: { Origin: "https://cafe.test", ...headers },
        body: JSON.stringify({ reference: row3.reference }),
      }),
      env,
    );
  assert.equal((await retry()).status, 403);
  assert.equal(
    (await retry({ Cookie: "__Host-minicafe_session=" + staffToken })).status,
    403,
  );
  sql.exec(
    "UPDATE products SET data=json_set(data,'$.sold_out',json('false')) WHERE id=1",
  );
  const accepted = await (
    await retry({
      Cookie: "__Host-minicafe_session=" + staffToken,
      "X-CSRF-Token": csrf,
    })
  ).json();
  assert.equal(accepted.status, "fulfilled");
  assert.equal(sql.prepare("SELECT count(*) AS n FROM orders").get().n, 2);
  assert.equal(
    (
      await retry({
        Cookie: "__Host-minicafe_session=" + staffToken,
        "X-CSRF-Token": csrf,
      })
    ).status,
    409,
  );
  sql.close();
});

test("admin bank history includes completed and expired requests, stable pages, no private bank identifiers or state writes", async () => {
  const { sql, env } = fixture();
  env.ADMIN_TELEGRAM_IDS = "1";
  for (const [id, role] of [
    ["1", "admin"],
    ["2", "cash"],
  ]) {
    sql
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?,?,?)")
      .run(
        await hash(id.repeat(64)),
        id,
        "Test",
        "c".repeat(64),
        timestamp() + 3600,
      );
    if (role !== "admin")
      sql
        .prepare("INSERT INTO staff_access VALUES(?,?,?,?)")
        .run(id, role, 1, "test");
  }
  for (let i = 0; i < 52; i++)
    sql
      .prepare(
        "INSERT INTO mono_payments(id,reference,data,total,created,expires,status,transaction_id) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        "private-id-" + i,
        "MC-" + i.toString(16).padStart(16, "0").toUpperCase(),
        JSON.stringify({ guest: "Гість " + i, items: [] }),
        5000,
        1000,
        timestamp() - 1,
        ["fulfilled", "review", "waiting", "paid"][i % 4],
        "private-bank-id-" + i,
      );
  const request = (suffix = "", id = "1") =>
    paymentRoutes(
      new Request("https://cafe.test/api/payments/history" + suffix, {
        headers: id
          ? { Cookie: "__Host-minicafe_session=" + id.repeat(64) }
          : {},
      }),
      env,
    );
  assert.equal((await request("", null)).status, 403);
  assert.equal((await request("", "2")).status, 403);
  const before = sql.prepare("SELECT * FROM mono_payments ORDER BY id").all();
  const first = await (await request()).json();
  assert.equal(first.payments.length, 50);
  assert.ok(first.payments.some((p) => p.status === "fulfilled"));
  assert.ok(first.payments.some((p) => p.status === "expired"));
  assert.ok(
    first.payments.every(
      (p) => !("id" in p) && !("transaction_id" in p) && !("data" in p),
    ),
  );
  const second = await (await request("?before=" + first.next_before)).json();
  assert.equal(second.payments.length, 2);
  assert.equal(second.next_before, null);
  assert.equal(
    new Set([...first.payments, ...second.payments].map((p) => p.reference))
      .size,
    52,
  );
  assert.equal((await request("?before=bad")).status, 400);
  assert.deepEqual(
    sql.prepare("SELECT * FROM mono_payments ORDER BY id").all(),
    before,
  );
  const writeHistory = (action, input = {}, id = "1", csrf = "c".repeat(64)) =>
    paymentRoutes(
      new Request("https://cafe.test/api/payments/history/" + action, {
        method: "POST",
        headers: {
          Origin: "https://cafe.test",
          Cookie: "__Host-minicafe_session=" + id.repeat(64),
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
        },
        body: JSON.stringify(input),
      }),
      env,
    );
  assert.equal((await writeHistory("hide", null)).status, 400);
  assert.equal((await writeHistory("clear", {}, "2")).status, 403);
  assert.equal((await writeHistory("clear", {}, "1", "wrong")).status, 403);
  assert.equal(
    (await writeHistory("hide", { reference: first.payments[0].reference }))
      .status,
    200,
  );
  assert.equal((await (await request()).json()).payments.length, 50);
  assert.equal((await writeHistory("clear")).status, 200);
  assert.equal((await (await request()).json()).payments.length, 0);
  const hidden = sql.prepare("SELECT * FROM mono_payments ORDER BY id").all();
  assert.equal(hidden.length, before.length);
  for (let n = 0; n < hidden.length; n++) {
    const data = JSON.parse(hidden[n].data);
    delete data.history_hidden;
    assert.deepEqual(
      { ...hidden[n], data: JSON.stringify(data) },
      { ...before[n] },
    );
  }
  sql.close();
});
