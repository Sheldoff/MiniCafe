import assert from "node:assert/strict";
const base = process.env.CAFE_CLOUD_TEST_URL || "http://127.0.0.1:8791";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Local disposable server required");
const headers = (digit) => ({
  "Content-Type": "application/json",
  Origin: base,
  ...(digit
    ? {
        Cookie: "__Host-minicafe_session=" + digit.repeat(64),
        "X-CSRF-Token": "2".repeat(64),
      }
    : {}),
});
async function call(path, input, digit, status = 200) {
  if (path === "public/code") input = { guest: "Іван Петренко", ...input };
  const r = await fetch(base + "/api/" + path, {
    method: input === undefined ? "GET" : "POST",
    headers: headers(digit),
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
  });
  const j = await r.json();
  assert.equal(r.status, status, JSON.stringify(j));
  return j;
}
const original = await call("backup", undefined, "1"),
  settings = await call("public-settings", undefined, "1");
try {
  await call("public-settings", { enabled: true }, "1");
  const menu = await call("public/menu");
  assert.ok(menu.products.length);
  assert.equal(menu.orders, undefined);
  assert.equal(menu.sessions, undefined);
  const p = menu.products.find((p) => p.available && p.limit >= 2);
  assert.ok(p);
  const before = await call("state", undefined, "1");
  const code = await call("public/code", {
    items: [{ id: p.id, qty: 2, price: 1 }],
  });
  assert.match(code.code, /^\d{6}$/);
  assert.equal(code.total, p.price * 2);
  const after = await call("state", undefined, "1");
  assert.equal(after.orders.length, before.orders.length);
  assert.equal(after.revision, before.revision);
  await call("guest-code", { code: code.code }, undefined, 401);
  await call("guest-code", { code: code.code }, "4", 403);
  await call("public-settings", { enabled: false }, "3", 403);
  const lookup = await call("guest-code", { code: code.code }, "3");
  assert.equal(lookup.items[0].qty, 2);
  assert.equal(lookup.guest, "Іван Петренко");
  for (const guest of [undefined, "", "Іван", "   ", "123 456"])
    await call(
      "public/code",
      { guest, items: [{ id: p.id, qty: 1 }] },
      undefined,
      400,
    );
  const badOrigin = await fetch(base + "/api/public/code", {
    method: "POST",
    headers: { ...headers(), Origin: "https://other.invalid" },
    body: JSON.stringify({ items: [{ id: p.id, qty: 1 }] }),
  });
  assert.equal(badOrigin.status, 403);
  await call(
    "public/code",
    { items: [{ id: p.id, qty: 100 }] },
    undefined,
    400,
  );
  await call("public/code", { items: [{ id: -1, qty: 1 }] }, undefined, 400);
  const payload = {
    request: crypto.randomUUID(),
    guest: "Гість з кодом",
    public_code: code.code,
    cash_given: 0,
    card_amount: p.price * 2,
    items: [{ id: p.id, qty: 2 }],
  };
  const order = await call("order", payload, "3");
  assert.equal(
    (await call("order", payload, "3")).id,
    order.id,
    "payment retry is idempotent",
  );
  await call("guest-code", { code: code.code }, "1", 400);
  await call("order", { ...payload, request: crypto.randomUUID() }, "3", 400);
  const race = await call("public/code", { items: [{ id: p.id, qty: 1 }] });
  const attempts = await Promise.all(
    [1, 2].map(() =>
      fetch(base + "/api/order", {
        method: "POST",
        headers: headers("1"),
        body: JSON.stringify({
          ...payload,
          request: crypto.randomUUID(),
          public_code: race.code,
          items: [{ id: p.id, qty: 1 }],
          card_amount: p.price,
        }),
      }),
    ),
  );
  assert.equal(
    attempts.filter((r) => r.status === 200).length,
    1,
    "one use under concurrent cashiers",
  );
  await call("public-settings", { enabled: false }, "1");
  assert.equal((await call("public/menu")).products.length, 0);
  await call("public/code", { items: [{ id: p.id, qty: 1 }] }, undefined, 403);
  console.log(
    "PASS guest public projection, draft isolation, permissions, origin, quantity, one-use/idempotent/concurrent redemption, admin disable",
  );
} finally {
  await call("restore", original, "1");
  await call("public-settings", { enabled: !!settings.enabled }, "1");
}
