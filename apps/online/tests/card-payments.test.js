import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../src/worker.js";
import { hash, timestamp } from "../src/auth.js";
test("cashier card history: narrow roles, pagination, card portion only, persistent hide without changing financial records", async () => {
  const sql = new DatabaseSync(":memory:");
  for (const f of readdirSync(new URL("../migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(
      readFileSync(new URL("../migrations/" + f, import.meta.url), "utf8"),
    );
  sql.exec("UPDATE products SET data=json_remove(data,'$.image_asset')");
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
          return {
            results: sql.prepare(q).all(...args),
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
  const env = { DB: db, ADMIN_TELEGRAM_IDS: "1" };
  for (const [id, role] of [
    ["1", "admin"],
    ["2", "cash"],
    ["3", "service"],
    ["4", "bar"],
    ["5", "delivery"],
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
  const origin = "https://cafe.test";
  const call = async (path, id = "1", body, extra = {}) =>
    worker.fetch(
      new Request(origin + "/api/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          Cookie: "__Host-minicafe_session=" + id.repeat(64),
          "Content-Type": "application/json",
          "X-CSRF-Token": "c".repeat(64),
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      {},
    );
  const order = async (request, card, cash, gift = false) => {
    const r = await call("order", "1", {
      request,
      items: [{ id: 1, qty: 1 }],
      card_amount: card,
      cash_given: cash,
      gift,
    });
    assert.equal(r.status, 200);
    return (await r.json()).id;
  };
  const cashId = await order("cash-only", 0, 5000),
    giftId = await order("gift", 0, 0, true);
  for (let n = 0; n < 55; n++) await order("mixed-" + n, 2000, 3000);
  const first = await (await call("card-payments", "2")).json();
  assert.equal(first.payments.length, 50);
  assert.equal(first.next_before, first.payments.at(-1).id);
  for (const row of first.payments) {
    assert.deepEqual(Object.keys(row).sort(), ["amount", "id"]);
    assert.equal(row.amount, 2000);
    assert.notEqual(row.id, cashId);
    assert.notEqual(row.id, giftId);
  }
  const second = await (
    await call("card-payments?before=" + first.next_before, "3")
  ).json();
  assert.equal(second.payments.length, 5);
  assert.equal(second.next_before, null);
  assert.ok(second.payments.every((r) => r.id < first.next_before));
  for (const id of ["4", "5"]) {
    assert.equal((await call("card-payments", id)).status, 403);
    assert.equal(
      (await call("card-payment/hide", id, { id: first.payments[0].id }))
        .status,
      403,
    );
  }
  const hideId = first.payments[0].id;
  const before = JSON.parse(
    sql.prepare("SELECT data FROM orders WHERE id=?").get(hideId).data,
  );
  const statsBefore = await (await call("stats?session=1")).json();
  assert.equal(
    (
      await call(
        "card-payment/hide",
        "2",
        { id: hideId },
        { "X-CSRF-Token": "wrong" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "card-payment/hide",
        "2",
        { id: hideId },
        { Origin: "https://other.test" },
      )
    ).status,
    403,
  );
  for (let n = 0; n < 2; n++)
    assert.equal(
      (await call("card-payment/hide", "2", { id: hideId })).status,
      200,
    );
  const after = JSON.parse(
    sql.prepare("SELECT data FROM orders WHERE id=?").get(hideId).data,
  );
  assert.equal(after.card_history_hidden, true);
  delete after.card_history_hidden;
  assert.deepEqual(after, before);
  assert.deepEqual(await (await call("stats?session=1")).json(), statsBefore);
  const hidden = await (await call("card-payments", "3")).json();
  assert.ok(hidden.payments.every((r) => r.id !== hideId));
  assert.equal(hidden.payments.length, 50);
  assert.equal(
    (await call("card-payment/hide", "3", { id: cashId })).status,
    400,
  );
  assert.equal((await call("card-payment/hide", "3", { id: 1.5 })).status, 400);
  assert.equal((await call("card-payments?before=0", "2")).status, 400);
  const backup = await (await call("backup")).json();
  assert.ok(backup.orders.find((o) => o.id === hideId).card_history_hidden);
  assert.equal((await call("restore", "1", backup)).status, 200);
  assert.ok(
    (await (await call("card-payments", "2")).json()).payments.every(
      (r) => r.id !== hideId,
    ),
  );
  sql.close();
});
