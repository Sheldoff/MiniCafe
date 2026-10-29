// Run only against disposable local wrangler D1, never against the public deployment.
import assert from "node:assert/strict";
const base = process.env.CAFE_CLOUD_TEST_URL || "http://127.0.0.1:8791";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Local test URL required");
const nativeFetch = globalThis.fetch;
const fetch = (url, options = {}) =>
  nativeFetch(url, {
    ...options,
    headers: {
      Cookie: "__Host-minicafe_session=" + "1".repeat(64),
      "X-CSRF-Token": "2".repeat(64),
      Origin: base,
      ...options.headers,
    },
  });
const get = async (path) => {
  const r = await fetch(base + "/api/" + path);
  assert.equal(r.status, 200, await r.clone().text());
  return r.json();
};
const post = async (path, d, status = 200) => {
  const r = await fetch(base + "/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d),
  });
  const j = await r.json();
  assert.equal(r.status, status, JSON.stringify(j));
  return j;
};
const original = await get("backup");
try {
  let state = await get("state");
  assert.ok(state.products.length >= 8);
  const r = await fetch(base + "/api/state");
  const etag = r.headers.get("etag");
  await r.arrayBuffer();
  assert.equal(
    (await fetch(base + "/api/state", { headers: { "If-None-Match": etag } }))
      .status,
    304,
  );
  assert.equal(
    (
      await fetch(base + "/api/state", {
        headers: { "If-None-Match": '"other", W/' + etag.replace(/^W\//, "") },
      })
    ).status,
    304,
  );
  const p = state.products[0],
    request = "integration-" + Date.now();
  const order = {
    request,
    guest: "Тест API",
    items: [{ id: p.id, qty: 2 }],
    cash_given: 0,
    card_amount: p.price * 2,
  };
  await post("order", { ...order, card_amount: 1 }, 400);
  const result = await post("order", order);
  assert.equal((await post("order", order)).id, result.id);
  state = await get("state");
  const o = state.orders.find((o) => o.id === result.id),
    item = o.items[0];
  await post("issue-unit", {
    order: o.id,
    id: item.id,
    unit: 0,
    route: item.route,
    delivered: true,
  });
  state = await get("state");
  assert.deepEqual(
    state.orders.find((x) => x.id === o.id).items[0].unit_issued,
    [true, false],
  );
  await post("issue", { id: o.id, route: item.route });
  await post("undo-issue", { route: item.route });
  await post("expenses", { request: request + "e", cost: 100, note: "Тест" });
  const stats = await get("stats?session=" + o.session_id);
  assert.ok(stats.order_count >= 1);
  const concurrent = Array.from({ length: 8 }, (_, n) => ({
    ...order,
    request: request + "-" + n,
  }));
  await Promise.all(
    concurrent.map(async (input) => {
      for (let retry = 0; retry < 8; retry++) {
        const r = await fetch(base + "/api/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (r.status === 409) {
          await new Promise((r) => setTimeout(r, 20 * (retry + 1)));
          continue;
        }
        assert.equal(r.status, 200, await r.text());
        return;
      }
      throw Error("Concurrent write retry failed");
    }),
  );
  state = await get("state");
  for (const input of concurrent)
    assert.equal(
      state.orders.filter((o) => o.request === input.request).length,
      1,
    );
  const forbidden = await fetch(base + "/api/order", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://evil.example",
    },
    body: JSON.stringify(order),
  });
  assert.equal(forbidden.status, 403);
  const backup = await get("backup");
  assert.ok(backup.products[0].image);
  await post(
    "restore",
    { ...backup, orders: [{ ...backup.orders[0], items: [] }] },
    400,
  );
  const prior = (await get("state")).orders.length;
  assert.equal((await get("state")).orders.length, prior);
  await post("restore", backup);
  const remapped = structuredClone(backup);
  const restoredOrder = remapped.orders.find((x) => x.id === result.id);
  restoredOrder.request += "-restored";
  for (const item of restoredOrder.items) item.id += 10000000;
  await post("restore", remapped);
  await post("status", { id: restoredOrder.items[0].id, status: "cancelled" });
  assert.equal(
    (await get("state")).orders.find((x) => x.id === result.id).items[0].status,
    "cancelled",
  );
  console.log(
    "PASS D1/API: persistence, ETag, payment rollback, idempotency, units/undo, stats, concurrent CAS, CSRF, portable backup/restore",
  );
} finally {
  await post("restore", original);
}
