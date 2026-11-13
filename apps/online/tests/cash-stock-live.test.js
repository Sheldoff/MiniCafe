import { filterState } from "../src/auth.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mutate, report } from "../src/domain.js";
import { validateCashStock, stockForCash } from "../src/cash-stock.js";
import { inLocation, hasFulfillment } from "../src/locations.js";
import { publicProducts } from "../src/guest-orders.js";
import { restoreData } from "../src/restore.js";
const two = "loc-" + "a".repeat(32),
  three = "loc-" + "b".repeat(32),
  secondBar = "loc-" + "c".repeat(32);
const initial = () => ({
  format: "minicafe-android-1",
  nextProduct: 3,
  nextOrder: 1,
  nextItem: 1,
  nextSession: 1,
  active_session: 0,
  expenses_version: 0,
  issue_undo: {},
  versions: { products: 0, orders: 0, sessions: 0, expenses: 0, locations: 0 },
  revision: 0,
  products: [
    {
      id: 1,
      name: "Кава",
      category: "Напої",
      route: "bar",
      active: 1,
      price: 5000,
      stock: 20,
    },
    {
      id: 2,
      name: "Їжа",
      category: "Їжа",
      route: "instant",
      active: 1,
      price: 2000,
    },
  ],
  orders: [],
  sessions: [],
  calculator_expenses: [],
  locations: [
    {
      id: two,
      name: "Каса 2",
      kind: "cash",
      color: "#334455",
      targets: ["bar", "delivery"],
    },
    {
      id: three,
      name: "Каса 3",
      kind: "cash",
      color: "#334455",
      targets: ["bar", "delivery"],
    },
    { id: secondBar, name: "Бариста 2", kind: "bar", color: "#334455" },
  ],
});
const act = (d, path, input) => {
  const next = structuredClone(d);
  mutate(next, path, input);
  return next;
};
const save = (d, map) =>
  act(d, "product", { ...d.products[0], stock_by_cash: map });
const order = (request, location = two, qty = 2) => ({
  request,
  location_id: location,
  items: [{ id: 1, qty }],
  cash_given: 100000,
  card_amount: 0,
});
test("cash partitions are conserved, strict/atomic, idempotent, refunded to their source and persisted", () => {
  let d = save(initial(), { cash: 7, [two]: 5, [three]: 8 });
  const before = JSON.stringify(d);
  for (const map of [
    { cash: 1 },
    { cash: -1, [two]: 21 },
    { cash: 20, unknown: 0 },
    { [secondBar]: 20 },
    { cash: 0.5, [two]: 19.5 },
  ])
    assert.throws(() => save(d, map));
  assert.equal(JSON.stringify(d), before);
  assert.throws(() => act(d, "order", order("over", two, 6)));
  d = act(d, "order", order("sale"));
  assert.equal(d.products[0].stock, 18);
  assert.equal(stockForCash(d.products[0], two), 3);
  assert.equal(stockForCash(d.products[0], "cash"), 7);
  const once = JSON.stringify(d);
  d = act(d, "order", order("sale"));
  assert.equal(JSON.stringify(d), once);
  const item = d.orders[0].items[0];
  d = act(d, "status", { id: item.id, status: "cancelled" });
  assert.equal(d.products[0].stock, 20);
  assert.equal(stockForCash(d.products[0], two), 5);
  d = act(d, "status", { id: item.id, status: "new" });
  assert.equal(d.products[0].stock, 18);
  assert.equal(stockForCash(d.products[0], two), 3);
  const basis = { stock: 20, stock_by_cash: { cash: 7, [two]: 5, [three]: 8 } };
  assert.throws(() =>
    act(d, "product", { ...d.products[0], stock_basis: basis }),
  );
  const restored = restoreData(d, {
    ...structuredClone(d),
    format: "minicafe-android-1",
  });
  assert.deepEqual(
    restored.products[0].stock_by_cash,
    d.products[0].stock_by_cash,
  );
  d.products[0].route = "instant";
  d.products[0].name = "Пиріг";
  d = act(d, "calculate-menu", {
    confirm: true,
    items: [{ id: 1, name: "Пиріг", stock: 30, price: 5000 }],
  });
  validateCashStock(d.products[0], d.locations);
  assert.equal(d.products[0].stock, 30);
  assert.equal(stockForCash(d.products[0], three), 20);
  let zero = save(initial(), { cash: 0, [two]: 20, [three]: 0 });
  assert.throws(() => act(zero, "order", order("hidden", "cash", 1)));
  assert.equal(
    publicProducts(
      zero.products.map((p) => ({ data: JSON.stringify(p) })),
    ).some((p) => p.id === 1),
    false,
  );
  zero = act(zero, "location/delete", { id: two });
  validateCashStock(zero.products[0], zero.locations);
  assert.equal(stockForCash(zero.products[0], three), 20);
});
test("type-safe routing including legacy snapshots, shared same-type issue and live session totals", () => {
  let d = initial();
  const food2 = "loc-" + "d".repeat(32);
  d = act(d, "location/save", {
    id: food2,
    kind: "delivery",
    name: "Видача 2",
    color: "#456789",
  });
  d = act(d, "location/save", {
    ...d.locations[0],
    targets: ["bar", secondBar, "delivery", food2],
  });
  d = act(d, "order", {
    ...order("mixed"),
    items: [
      { id: 1, qty: 2 },
      { id: 2, qty: 1 },
    ],
    card_amount: 7000,
    cash_given: 5000,
  });
  const o = d.orders[0],
    [drink, food] = o.items;
  assert.equal(drink.destinations.length, 2);
  assert.equal(food.destinations.length, 2);
  assert(!inLocation(drink, "instant", "delivery"));
  assert(!hasFulfillment(food, "bar"));
  const legacy = {
    ...drink,
    destinations: [
      { id: "bar", route: "bar" },
      { id: "delivery", route: "instant" },
    ],
  };
  assert(!inLocation(legacy, "instant", "delivery"));
  assert(
    inLocation(
      { ...drink, destinations: [{ id: "delivery", route: "instant" }] },
      "bar",
      "bar",
    ),
  );
  assert.throws(() =>
    act(d, "issue-unit", {
      order: o.id,
      id: drink.id,
      route: "instant",
      location_id: "delivery",
      unit: 0,
      delivered: true,
    }),
  );
  d = act(d, "issue-unit", {
    order: o.id,
    id: drink.id,
    route: "bar",
    location_id: secondBar,
    unit: 0,
    delivered: true,
  });
  const r = report(
    d,
    new URLSearchParams({ session: String(d.active_session), live: "1" }),
  );
  assert.equal(r.live.pending_units, 2);
  assert.equal(r.live.pending_orders, 1);
  assert.equal(
    r.live.timeline.reduce((s, b) => s + b.revenue, 0),
    r.revenue,
  );
  assert.equal(
    r.live.timeline.reduce((s, b) => s + b.orders, 0),
    r.order_count,
  );
  assert.equal(r.live.cashiers[0].id, two);
  assert.equal(r.live.cashiers[0].revenue, 12000);
  assert(r.live.timeline.length <= 50);
  d = act(d, "issue", { id: o.id, route: "bar", location_id: "bar" });
  assert.equal(d.orders[0].items[0].status, "delivered");
  assert.equal(d.orders[0].items[1].status, "new");
  assert.deepEqual(d.orders[0].payment, o.payment);
});

test("scoped staff see only their cashier allocation and no global partition", () => {
  const d = save(initial(), { cash: 7, [two]: 5, [three]: 8 });
  d.can_undo_issue = {};
  d.locations.find((l) => l.id === secondBar).linked_cash = two;
  for (const user of [
    { role: "cash", location: two },
    { role: "bar", location: secondBar },
  ]) {
    const state = filterState(structuredClone(d), user),
      p = state.products.find((p) => p.id === 1);
    assert.deepEqual(p.stock_by_cash, { [two]: 5 });
    assert.equal(p.stock, 5);
    assert(!("sessions" in state));
  }
});
