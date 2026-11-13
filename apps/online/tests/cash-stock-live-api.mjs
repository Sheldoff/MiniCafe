import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const base = process.env.CAFE_CLOUD_TEST_URL || "http://127.0.0.1:8791";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Disposable local D1 required");
// Earlier access-control scenarios deliberately revoke these local sessions.
const seed = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./seed-auth.mjs", import.meta.url))],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: "pipe",
  },
);
assert.equal(seed.status, 0, "Local auth fixture setup failed");
const owner = {
  "Content-Type": "application/json",
  Origin: base,
  Cookie: "__Host-minicafe_session=" + "1".repeat(64),
  "X-CSRF-Token": "2".repeat(64),
};
const read = async (path, headers = owner) => {
  const r = await fetch(base + "/api/" + path, { headers });
  assert.equal(r.status, 200, path);
  return r.json();
};
const post = async (path, data, status = 200, headers = owner) => {
  const r = await fetch(base + "/api/" + path, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    }),
    j = await r.json();
  assert.equal(r.status, status, path + ": " + JSON.stringify(j));
  return j;
};
const original = await read("backup");
try {
  const fixture = structuredClone(original);
  Object.assign(fixture, {
    orders: [],
    sessions: [],
    calculator_expenses: [],
    locations: [],
    active_session: 0,
    issue_undo: {},
  });
  for (const p of fixture.products) {
    delete p.stock_by_cash;
    delete p.stock;
    delete p.unavailable_at;
    p.sold_out = false;
  }
  await post("restore", fixture);
  const cash = "loc-" + "1a".repeat(16),
    second = "loc-" + "2b".repeat(16),
    bar = "loc-" + "3c".repeat(16);
  for (const [id, kind, targets] of [
    [bar, "bar"],
    [cash, "cash", ["bar", bar, "delivery"]],
    [second, "cash", ["bar", "delivery"]],
  ])
    await post("location/save", {
      id,
      kind,
      name: kind,
      color: "#79543c",
      ...(targets ? { targets } : {}),
    });
  const f = fixture.products.find((p) => p.route === "instant"),
    drink = fixture.products.find((p) => p.route === "bar");
  const input = {
    id: f.id,
    name: f.name,
    category: f.category,
    route: f.route,
    price: f.price,
    active: true,
    stock: 20,
    stock_estimated: false,
    stock_by_cash: { cash: 0, [cash]: 7, [second]: 13 },
  };
  await post("product", input);
  await post(
    "product",
    { ...input, stock_by_cash: { cash: 1, [cash]: 7, [second]: 13 } },
    400,
  );
  await post("product", input, 403, {
    ...owner,
    Cookie: "__Host-minicafe_session=" + "3".repeat(64),
  });
  const sale = {
    request: "cash-stock-atomic",
    location_id: cash,
    guest: "Тест Розподілу",
    cash_given: 100000,
    card_amount: 0,
    items: [{ id: f.id, qty: 2 }],
  };
  await post("order", { ...sale, request: "zero", location_id: "cash" }, 400);
  await post(
    "order",
    { ...sale, request: "over", items: [{ id: f.id, qty: 8 }] },
    400,
  );
  const both = await Promise.all([post("order", sale), post("order", sale)]);
  assert.equal(both[0].id, both[1].id);
  let state = await read("state"),
    p = state.products.find((p) => p.id === f.id);
  assert.equal(p.stock, 18);
  assert.equal(p.stock_by_cash[cash], 5);
  assert.equal(p.stock_by_cash[second], 13);
  await post(
    "product",
    {
      ...input,
      stock_basis: { stock: 20, stock_by_cash: input.stock_by_cash },
    },
    400,
  );
  const item = state.orders.find((o) => o.id === both[0].id).items[0];
  await post("status", { id: item.id, status: "cancelled" });
  p = (await read("state")).products.find((p) => p.id === f.id);
  assert.equal(p.stock, 20);
  assert.equal(p.stock_by_cash[cash], 7);
  const mixed = await post("order", {
    ...sale,
    request: "type-safe",
    items: [
      { id: drink.id, qty: 2 },
      { id: f.id, qty: 1 },
    ],
  });
  state = await read("state");
  const o = state.orders.find((o) => o.id === mixed.id);
  assert.equal(o.items[0].destinations.length, 2);
  assert.equal(o.items[1].destinations.length, 1);
  const barState = await read("state", {
      ...owner,
      Cookie: "__Host-minicafe_session=" + "4".repeat(64),
    }),
    foodState = await read("state", {
      ...owner,
      Cookie: "__Host-minicafe_session=" + "5".repeat(64),
    });
  assert.equal(barState.orders.find((x) => x.id === o.id).items.length, 1);
  assert.equal(
    barState.orders.find((x) => x.id === o.id).items[0].route,
    "bar",
  );
  assert.equal(
    foodState.orders.find((x) => x.id === o.id).items[0].route,
    "instant",
  );
  await post(
    "issue-unit",
    {
      order: o.id,
      id: o.items[0].id,
      unit: 0,
      delivered: true,
      route: "instant",
      location_id: "delivery",
    },
    400,
  );
  const r = await read("stats?session=" + state.active_session + "&live=1");
  assert.equal(
    r.live.timeline.reduce((s, b) => s + b.revenue, 0),
    r.revenue,
  );
  assert.equal(
    r.live.timeline.reduce((s, b) => s + b.orders, 0),
    r.order_count,
  );
  const denied = await fetch(
    base + "/api/stats?session=" + state.active_session + "&live=1",
    {
      headers: {
        ...owner,
        Cookie: "__Host-minicafe_session=" + "4".repeat(64),
      },
    },
  );
  assert.equal(denied.status, 403);
  const catalog = await (await fetch(base + "/api/public/menu")).json();
  const entries = catalog.products || catalog;
  assert(!JSON.stringify(entries).includes("stock_by_cash"));
  const backup = await read("backup");
  await post("restore", backup);
  p = (await read("state")).products.find((p) => p.id === f.id);
  assert.equal(p.stock_by_cash[cash], 6);
  console.log(
    "PASS disposable D1 cash partition validation, atomic concurrent idempotency/source refund, stale editing, route/privacy isolation, live ledger totals and backup persistence",
  );
} finally {
  await post("restore", original);
}
