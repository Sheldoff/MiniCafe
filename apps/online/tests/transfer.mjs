import assert from "node:assert/strict";
const base = "http://127.0.0.1:8791";
const h = {
  Cookie: "__Host-minicafe_session=" + "1".repeat(64),
  "X-CSRF-Token": "2".repeat(64),
  Origin: base,
  "Content-Type": "application/json",
};
const get = async (path) => {
  const r = await fetch(base + "/api/" + path, { headers: h });
  assert.equal(r.status, 200);
  return r.json();
};
const post = (path, body, headers = h) =>
  fetch(base + "/api/" + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
const original = await get("backup");
const mint = async (direction) => {
  const r = await post("menu-transfer", { direction, confirm: true });
  assert.equal(r.status, 200);
  return (await r.json()).code;
};
try {
  assert.equal(
    (
      await post(
        "menu-transfer",
        { direction: "upload", confirm: true },
        { "Content-Type": "application/json" },
      )
    ).status,
    401,
  );
  const code = await mint("download");
  const th = { "X-Menu-Transfer": code, "Content-Type": "application/json" };
  assert.equal((await post("menu-transfer/upload", {}, th)).status, 401);
  const r = await post("menu-transfer/download", {}, th);
  assert.equal(r.status, 200);
  const menu = await r.json();
  assert.equal(menu.format, "minicafe-menu-1");
  assert.ok(menu.products[0].image);
  assert.equal((await post("menu-transfer/download", {}, th)).status, 401);
  const up = await mint("upload");
  const invalid = await post(
    "menu-transfer/upload",
    { ...menu, confirm: true, products: [{ ...menu.products[0], price: -1 }] },
    { ...th, "X-Menu-Transfer": up },
  );
  assert.equal(invalid.status, 400);
  const before = await get("backup");
  const success = await post(
    "menu-transfer/upload",
    { ...menu, confirm: true },
    { ...th, "X-Menu-Transfer": up },
  );
  assert.equal(success.status, 200, await success.text());
  const after = await get("backup");
  assert.equal(after.products.length, menu.products.length);
  assert.deepEqual(after.orders, before.orders);
  assert.deepEqual(after.sessions, before.sessions);
  assert.deepEqual(after.calculator_expenses, before.calculator_expenses);
  assert.ok(after.products.every((p) => p.id >= before.nextProduct));
  assert.equal(
    (
      await post(
        "menu-transfer/upload",
        { ...menu, confirm: true },
        { ...th, "X-Menu-Transfer": up },
      )
    ).status,
    401,
  );
  const old = await mint("upload");
  const fresh = await mint("download");
  assert.equal(
    (
      await post(
        "menu-transfer/upload",
        { ...menu, confirm: true },
        { ...th, "X-Menu-Transfer": old },
      )
    ).status,
    401,
  );
  const f = { "X-Menu-Transfer": fresh, "Content-Type": "application/json" };
  const attempts = await Promise.all([
    post("menu-transfer/download", {}, f),
    post("menu-transfer/download", {}, f),
  ]);
  assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 401]);
  console.log(
    "PASS menu-only transfer, photos, ID remapping, preserved history, validation rollback, direction and one-use race",
  );
} finally {
  const r = await post("restore", original);
  assert.equal(r.status, 200);
}
