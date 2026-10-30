import test from "node:test";
import assert from "node:assert/strict";
import { restoreData } from "../src/restore.js";
test("portable restores preserve deleted IDs and accept historical Android request strings", () => {
  const before = {
    nextProduct: 1,
    nextOrder: 1,
    nextItem: 1,
    nextSession: 1,
    versions: { products: 0, orders: 0, sessions: 0, expenses: 0 },
    expenses_version: 0,
    revision: 1,
  };
  const source = {
    format: "minicafe-android-1",
    products: [],
    orders: [],
    sessions: [],
    calculator_expenses: [],
    nextProduct: 123,
    nextOrder: 234,
    nextItem: 345,
    nextSession: 456,
  };
  const restored = restoreData(before, source);
  for (const k of ["nextProduct", "nextOrder", "nextItem", "nextSession"])
    assert.equal(restored[k], source[k]);
  assert.throws(() => restoreData(before, { ...source, nextProduct: -1 }));
});
