import test from "node:test";
import assert from "node:assert/strict";
import { mutate } from "../src/domain.js";
import { replaceMenu } from "../src/menu-transfer.js";
const initial = () => ({
  nextOrder: 1,
  nextItem: 1,
  nextSession: 1,
  nextProduct: 2,
  active_session: 0,
  expenses_version: 0,
  issue_undo: {},
  versions: { products: 0, orders: 0, sessions: 0, expenses: 0 },
  products: [
    {
      id: 1,
      name: "Тест",
      category: "Їжа",
      route: "instant",
      active: 1,
      price: 5000,
      stock: 1,
    },
  ],
  orders: [],
  sessions: [],
  calculator_expenses: [],
});
const order = (request, qty = 1) => ({
  request,
  items: [{ id: 1, qty }],
  cash_given: 0,
  card_amount: 5000 * qty,
});
test("strict stock blocks excess including repeated rows; estimates may go negative", () => {
  const d = initial();
  assert.throws(
    () => mutate(structuredClone(d), "order", order("too-many", 2)),
    /залишок/,
  );
  assert.throws(
    () =>
      mutate(structuredClone(d), "order", {
        ...order("duplicate"),
        items: [
          { id: 1, qty: 1 },
          { id: 1, qty: 1 },
        ],
      }),
    /залишок/,
  );
  mutate(d, "order", order("one"));
  assert.equal(d.products[0].stock, 0);
  mutate(d, "order", order("one"));
  assert.equal(d.orders.length, 1);
  assert.throws(
    () => mutate(structuredClone(d), "order", order("empty")),
    /залишок/,
  );
  mutate(d, "product", { ...d.products[0], stock_estimated: true });
  mutate(d, "order", order("estimate"));
  assert.equal(d.products[0].stock, -1);
  mutate(d, "status", { id: d.orders[1].items[0].id, status: "cancelled" });
  assert.equal(d.products[0].stock, 0);
  const source = {
    ...d.products[0],
    id: 999,
    image_asset: "https://evil.example/",
  };
  const history = JSON.stringify(d.orders);
  replaceMenu(d, [source]);
  assert.equal(d.products[0].id, 2);
  assert.equal(d.products[0].stock_estimated, true);
  assert.equal(d.products[0].image_asset, undefined);
  assert.equal(JSON.stringify(d.orders), history);
});
