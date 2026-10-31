import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publicProducts,
  validateSelection,
  codeForOrder,
  validateGuestName,
} from "../src/guest-orders.js";
test("guest full name is required, normalized and bounded", () => {
  assert.equal(validateGuestName("  Іван   Петренко "), "Іван Петренко");
  assert.equal(validateGuestName("Марія-Анна О’Ніл"), "Марія-Анна О’Ніл");
  for (const value of [
    null,
    "",
    "Іван",
    "123 456",
    "<script> x",
    "а".repeat(101) + " б",
  ])
    assert.throws(() => validateGuestName(value));
});
test("public menu exposes only active catalog fields and validates quantities without trusting prices", () => {
  const products = publicProducts([
    {
      data: JSON.stringify({
        id: 1,
        name: "Чай",
        price: 5000,
        route: "bar",
        active: 1,
        stock: 2,
        private_note: "secret",
        image: "base64",
      }),
    },
    {
      data: JSON.stringify({
        id: 2,
        name: "Прихований",
        price: 100,
        route: "instant",
        active: 0,
      }),
    },
    {
      data: JSON.stringify({
        id: 3,
        name: "Орієнтовний",
        price: 3000,
        route: "instant",
        active: 1,
        stock: -3,
        stock_estimated: true,
      }),
    },
  ]);
  assert.equal(products.length, 2);
  assert.equal(products[0].private_note, undefined);
  assert.equal(products[0].image, undefined);
  assert.equal(
    validateSelection([{ id: 1, qty: 2, price: 1 }], products)[0].price,
    5000,
  );
  assert.throws(() =>
    validateSelection(
      [
        { id: 1, qty: 2 },
        { id: 1, qty: 1 },
      ],
      products,
    ),
  );
  assert.throws(() => validateSelection([{ id: 2, qty: 1 }], products));
  assert.throws(() => validateSelection([{ id: 1, qty: 0.5 }], products));
  assert.equal(validateSelection([{ id: 3, qty: 5 }], products)[0].qty, 5);
});
test("short codes expire and are single-use, with same-request payment retries allowed", async () => {
  let row = {
    data: "{}",
    expires: Math.floor(Date.now() / 1000) + 60,
    used_request: null,
  };
  const db = {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return row;
            },
          };
        },
      };
    },
  };
  await codeForOrder(db, "123456", "request1");
  row.used_request = "request1";
  await codeForOrder(db, "123456", "request1");
  await assert.rejects(codeForOrder(db, "123456", "request2"));
  row.expires = 0;
  await assert.rejects(codeForOrder(db, "123456", "request1"));
  row = null;
  await assert.rejects(codeForOrder(db, "123456", "request1"));
  await assert.rejects(codeForOrder(db, "12", "request1"));
});
