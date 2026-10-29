import assert from "node:assert/strict";
const base = process.env.CAFE_CLOUD_TEST_URL || "http://127.0.0.1:8791";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Local test URL required");
const headers = (digit = "1") => ({
  Cookie: "__Host-minicafe_session=" + digit.repeat(64),
  "X-CSRF-Token": "2".repeat(64),
  Origin: base,
  "Content-Type": "application/json",
});
const req = (path, options = {}) =>
  fetch(base + path, { redirect: "manual", ...options });
for (const path of ["state", "stats", "history", "backup", "staff", "image/1"])
  assert.equal((await req("/api/" + path)).status, 401, path);
for (const path of [
  "order",
  "product",
  "restore",
  "expenses",
  "issue",
  "staff",
])
  assert.equal(
    (await req("/api/" + path, { method: "POST", body: "{}" })).status,
    401,
    path,
  );
assert.equal(
  (
    await req("/api/state?key=public-test", {
      headers: { "X-Cafe-Key": "public-test", "X-Telegram-ID": "600810855" },
    })
  ).status,
  401,
);
assert.equal((await req("/api/state", { headers: headers("9") })).status, 401);
assert.equal((await req("/private/admin.html")).status, 404);
assert.equal((await req("/admin")).status, 302);
assert.match(await (await req("/")).text(), /Меню формується/);
assert.equal((await req("/auth/callback?state=bad&code=bad")).status, 400);
const state = await req("/api/state", { headers: headers() });
assert.equal(state.status, 200);
const tag = state.headers.get("etag");
for (const digit of ["3", "4", "5", "6"]) {
  for (const path of ["stats", "history", "backup", "staff"])
    assert.equal(
      (await req("/api/" + path, { headers: headers(digit) })).status,
      403,
      digit + path,
    );
  const r = await req("/api/state", {
    headers: { ...headers(digit), "If-None-Match": tag },
  });
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.equal(s.sessions, undefined);
  assert.equal(s.additional_expenses, undefined);
  if (["4", "5"].includes(digit)) {
    const route = digit === "4" ? "bar" : "instant";
    assert.ok(s.products.every((p) => p.route === route));
    assert.ok(
      s.orders.every(
        (o) =>
          !("card_amount" in o) &&
          o.items.every((i) => i.route === route && !("price" in i)),
      ),
    );
  }
  assert.equal(
    (
      await req("/api/product", {
        method: "POST",
        headers: headers(digit),
        body: "{}",
      })
    ).status,
    403,
  );
}
for (const h of [
  { ...headers(), "X-CSRF-Token": "wrong" },
  { ...headers(), Origin: "https://evil.example" },
])
  assert.equal(
    (await req("/api/product", { method: "POST", headers: h, body: "{}" }))
      .status,
    403,
  );
assert.equal(
  (
    await req("/api/staff", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        telegram_id: "990000099",
        role: "admin",
        enabled: true,
      }),
    })
  ).status,
  400,
);
assert.equal(
  (
    await req("/api/staff", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        telegram_id: "600810855",
        role: "cash",
        enabled: false,
      }),
    })
  ).status,
  400,
);
// Revocation must invalidate an already authenticated browser, not only hide UI.
const revoke = await req("/api/staff", {
  method: "POST",
  headers: headers(),
  body: JSON.stringify({
    telegram_id: "990000001",
    role: "cash",
    enabled: false,
  }),
});
assert.equal(revoke.status, 200);
assert.equal((await req("/api/state", { headers: headers("3") })).status, 401);
const restore = await req("/api/staff", {
  method: "POST",
  headers: headers(),
  body: JSON.stringify({
    telegram_id: "990000001",
    role: "cash",
    enabled: true,
  }),
});
assert.equal(restore.status, 200);
// Re-enabling does not resurrect the revoked session. Reseed locally for future runs.
assert.equal((await req("/api/state", { headers: headers("3") })).status, 401);
console.log(
  "PASS anonymous isolation, forged identity, CSRF, role filters and admin escalation",
);
