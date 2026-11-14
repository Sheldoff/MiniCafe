import test from "node:test";
import assert from "node:assert/strict";
import { mutate, report } from "../src/domain.js";
import { restoreData } from "../src/restore.js";
const two = "loc-" + "ab".repeat(16);
const state = () => ({
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
const sale = (request, cash = "cash", guest = "") => ({
  request,
  location_id: cash,
  guest,
  items: [{ id: 1, qty: 1 }],
  cash_given: 0,
  card_amount: 5000,
});
const loc = (id, prefix) => ({
  id,
  kind: "cash",
  name: id,
  color: "#456789",
  targets: ["bar", "delivery"],
  guest_prefix: prefix,
});
test("independent cash numbering preserves exact prefixes, names/retries/backup; rename and log clear preserve finance", () => {
  let d = state();
  mutate(d, "location/save", loc(two, "низ "));
  mutate(d, "order", sale("one"));
  mutate(d, "order", sale("other", two));
  mutate(d, "order", sale("name", two, "Олена"));
  mutate(d, "order", sale("other", two));
  mutate(d, "order", sale("two"));
  mutate(d, "order", sale("other-two", two));
  assert.deepEqual(
    d.orders.map((o) => o.guest),
    ["Гість №1", "низ 1", "Олена", "Гість №2", "низ 2"],
  );
  assert.equal(d.next_guest_numbers.cash, 3);
  assert.equal(d.next_guest_numbers[two], 3);
  mutate(d, "location/save", loc(two, "Н"));
  d = restoreData(d, structuredClone(d));
  mutate(d, "order", sale("other-three", two));
  assert.equal(d.orders.at(-1).guest, "Н3");
  assert.throws(() =>
    mutate(structuredClone(d), "location/save", loc(two, "bad\n")),
  );
  const sid = d.active_session;
  assert.match(d.sessions[0].name, /^Сесія \d{2}\.\d{2}\.\d{4}$/);
  const before = report(d, new URLSearchParams({ session: String(sid) }));
  mutate(d, "session/rename", { id: sid, name: "Ранкова зміна" });
  assert.equal(
    report(d, new URLSearchParams({ session: String(sid) })).title,
    "Ранкова зміна",
  );
  mutate(d, "transaction/clear", {});
  assert(d.orders.every((o) => o.transaction_history_hidden));
  assert.equal(
    report(d, new URLSearchParams({ session: String(sid) })).revenue,
    before.revenue,
  );
  assert(!d.orders.some((o) => o.card_history_hidden));
  const live = report(
    d,
    new URLSearchParams({ session: String(sid), live: "1" }),
  ).live;
  assert.equal(live.events.length, 6);
  assert(
    live.events.some(
      (e) => e.cash_location === two && e.items[0].name === "Кава",
    ),
  );
  assert.throws(() =>
    restoreData(d, { ...structuredClone(d), next_guest_numbers: { cash: -1 } }),
  );
});
