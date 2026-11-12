import test from "node:test";
import assert from "node:assert/strict";
import {
  validateLocation,
  applyRouting,
  inLocation,
  undoKey,
} from "../src/locations.js";
test("split location routing preserves catalog types, snapshots destinations and rejects invalid targets", () => {
  const bar = {
      id: "loc-" + "a".repeat(32),
      kind: "bar",
      name: "Бариста низ",
      color: "#334455",
    },
    delivery = {
      id: "loc-" + "b".repeat(32),
      kind: "delivery",
      name: "Видача низ",
      color: "#556677",
    };
  const cash = validateLocation(
    {
      id: "loc-" + "c".repeat(32),
      kind: "cash",
      name: "Каса низ",
      color: "#112233",
      mode: "split",
      bar_target: bar.id,
      delivery_target: delivery.id,
    },
    [bar, delivery],
  );
  const locations = [bar, delivery, cash],
    order = { items: [{ route: "bar" }, { route: "instant" }] };
  applyRouting(order, { location_id: cash.id }, locations);
  assert.equal(order.items[0].location_id, bar.id);
  assert.equal(order.items[1].location_id, delivery.id);
  assert.equal(order.items[0].route, "bar");
  assert.equal(order.items[1].route, "instant");
  assert.ok(inLocation(order.items[0], "bar", bar.id));
  assert.ok(!inLocation(order.items[0], "bar", "bar"));
  assert.equal(undoKey("bar", bar.id), "bar@" + bar.id);
  assert.equal(undoKey("bar", "bar"), "bar");
  cash.mode = "single";
  cash.single_target = delivery.id;
  const second = { items: [{ route: "bar" }, { route: "instant" }] };
  applyRouting(second, { location_id: cash.id }, locations);
  assert.ok(
    second.items.every(
      (i) => i.location_id === delivery.id && i.fulfillment_route === "instant",
    ),
  );
  assert.equal(order.items[0].location_id, bar.id);
  for (const extra of [
    { color: "red" },
    { name: "" },
    { bar_target: "missing", mode: "split" },
    { single_target: cash.id },
  ])
    assert.throws(() => validateLocation({ ...cash, ...extra }, locations));
  assert.throws(() =>
    applyRouting(
      { items: [{ route: "bar" }] },
      { location_id: bar.id },
      locations,
    ),
  );
});
