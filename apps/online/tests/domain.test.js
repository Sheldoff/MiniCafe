import test from "node:test";
import assert from "node:assert/strict";
import { mutate, flags, report } from "../src/domain.js";
import { restoreData } from "../src/restore.js";

const initial = () => ({
  nextProduct: 2,
  nextOrder: 1,
  nextItem: 1,
  nextSession: 1,
  active_session: 0,
  expenses_version: 0,
  issue_undo: {},
  versions: { products: 0, orders: 0, sessions: 0, expenses: 0 },
  revision: 0,
  products: [
    {
      id: 1,
      name: "Кава",
      category: "Напої",
      route: "bar",
      active: 1,
      price: 5000,
      stock: 10,
    },
  ],
  orders: [],
  sessions: [],
  calculator_expenses: [],
});
const order = (request, extra = {}) => ({
  request,
  guest: "Тест",
  items: [{ id: 1, qty: 2 }],
  cash_given: 0,
  card_amount: 10000,
  ...extra,
});
test("payments, gift checks, snapshots, precise units and undo", () => {
  const d = initial();
  mutate(d, "order", order("normal"));
  assert.equal(d.products[0].stock, 8);
  mutate(d, "order", order("normal"));
  assert.equal(d.orders.length, 1);
  mutate(d, "issue-unit", {
    order: 1,
    id: 1,
    unit: 0,
    route: "bar",
    delivered: true,
  });
  assert.deepEqual(flags(d.orders[0].items[0]), [true, false]);
  mutate(d, "issue", { id: 1, route: "bar" });
  mutate(d, "undo-issue", { route: "bar" });
  assert.deepEqual(flags(d.orders[0].items[0]), [true, false]);
  mutate(d, "order", order("gift", { gift: true, card_amount: 0 }));
  const r = report(d, new URLSearchParams({ session: 1 }));
  assert.equal(r.gift_count, 1);
  assert.equal(r.avg_check, 10000);
  assert.equal(r.min_check, 10000);
  assert.equal(r.drinks[0].qty, 4);
  assert.equal(r.revenue, 10000);
});
test("mixed overpayment, additional costs grouping and pending session transfer", () => {
  const d = initial();
  mutate(d, "expenses", { request: "e1", note: " Кава ", cost: 200 });
  mutate(d, "expenses", { request: "e2", note: "кава", cost: 300 });
  mutate(d, "order", order("mixed", { cash_given: 6000, card_amount: 5000 }));
  const r = report(d, new URLSearchParams({ session: 1 }));
  assert.equal(r.cash, 5000);
  assert.equal(r.cash_count, 1);
  assert.equal(r.card_count, 1);
  assert.equal(r.expense_groups.length, 1);
  assert.equal(r.expenses, 500);
  assert.equal(r.net_revenue, 9500);
  const restored = restoreData(d, {
    ...structuredClone(d),
    format: "minicafe-android-1",
  });
  assert.equal(restored.orders.length, 1);
  const bad = structuredClone(d);
  bad.orders[0].payment.total++;
  assert.throws(
    () => restoreData(d, { ...bad, format: "minicafe-android-1" }),
    /оплата/,
  );
});
test("invalid inputs and calculator preservation", () => {
  const d = initial();
  assert.throws(
    () =>
      mutate(structuredClone(d), "order", order("under", { card_amount: 1 })),
    (e) => e.missing === 9999,
  );
  assert.throws(() =>
    mutate(
      structuredClone(d),
      "order",
      order("decimal", { items: [{ id: 1, qty: 1.5 }] }),
    ),
  );
  mutate(d, "calculate-menu", {
    confirm: true,
    items: [{ name: "Кекс", price: 5000, stock: 5 }],
    cost: 10000,
    calculation_id: "calc1",
  });
  assert.equal(d.products[1].route, "instant");
  mutate(d, "order", order("paid"));
  mutate(d, "session/end", {});
  assert.equal(d.active_session, 0);
  mutate(d, "order", order("paid2"));
  assert.equal(d.active_session, 2);
  mutate(d, "stats/clear", { confirm: true });
  assert.equal(d.sessions.length, 0);
  assert.equal(d.orders.length, 2);
  assert.ok(d.orders.every((o) => o.stats_cleared));
});
