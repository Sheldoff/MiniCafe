import test from "node:test";
import assert from "node:assert/strict";
import { mutate } from "../src/domain.js";
import { validateLocation } from "../src/locations.js";
import { restoreData } from "../src/restore.js";
const initial = () => ({
  format: "minicafe-android-1",
  nextProduct: 2,
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
    },
  ],
  orders: [],
  sessions: [],
  calculator_expenses: [],
  locations: [],
});
const sale = (request, guest = "") => ({
  request,
  guest,
  items: [{ id: 1, qty: 1 }],
  cash_given: 0,
  card_amount: 5000,
});
// The production writer uses this same private-snapshot + atomic-commit boundary.
function write(d, path, input) {
  const copy = structuredClone(d);
  mutate(copy, path, input);
  return copy;
}
test("anonymous sequence survives retries, named sales, failed payments, backups and sessions; required per cash", () => {
  let d = initial();
  d = write(d, "order", sale("one"));
  assert.equal(d.orders[0].guest, "Гість №1");
  assert.equal(d.next_guest_number, 2);
  d = write(d, "order", sale("one"));
  assert.equal(d.next_guest_number, 2);
  d = write(d, "order", sale("named", "Олена"));
  assert.equal(d.next_guest_number, 2);
  assert.throws(() => write(d, "order", { ...sale("unpaid"), card_amount: 0 }));
  assert.equal(d.next_guest_number, 2);
  d = write(d, "order", sale("two", "  "));
  assert.equal(d.orders.at(-1).guest, "Гість №2");
  d = restoreData(d, structuredClone(d));
  assert.equal(d.next_guest_number, 3);
  d = write(d, "session/end", {});
  d = write(d, "order", sale("three"));
  assert.equal(d.orders.at(-1).guest, "Гість №3");
  const location = {
    id: "cash",
    name: "Каса",
    kind: "cash",
    color: "#333333",
    targets: ["bar", "delivery"],
    guest_name_required: true,
  };
  d = write(d, "location/save", location);
  assert.throws(() => write(d, "order", sale("required")), /ім’я/);
  assert.equal(d.next_guest_number, 4);
  d = write(d, "order", sale("required", "Іван"));
  assert.equal(d.next_guest_number, 4);
  const other = "loc-" + "a".repeat(32);
  d = write(d, "location/save", {
    ...location,
    id: other,
    name: "Каса 2",
    guest_name_required: false,
  });
  d = write(d, "order", { ...sale("other"), location_id: other });
  assert.equal(d.orders.at(-1).guest, "Гість №1");
  assert.throws(() =>
    validateLocation({ ...location, guest_name_required: "true" }),
  );
  assert.throws(() =>
    restoreData(d, { ...structuredClone(d), next_guest_number: -1 }),
  );
});
