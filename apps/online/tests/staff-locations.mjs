import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const base = process.env.CAFE_CLOUD_TEST_URL || "http://127.0.0.1:8791";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Local D1 only");
const owner = {
  Cookie: "__Host-minicafe_session=" + "1".repeat(64),
  "X-CSRF-Token": "2".repeat(64),
  Origin: base,
  "Content-Type": "application/json",
};
async function post(path, data, headers = owner, status = 200) {
  const r = await fetch(base + "/api/" + path, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  const j = await r.json();
  assert.equal(r.status, status, JSON.stringify(j));
  return j;
}
const scope = "loc-" + "9".repeat(32),
  other = "loc-" + "8".repeat(32);
await post("location/save", {
  id: scope,
  kind: "bar",
  name: "Бариста тест низ",
  color: "#345678",
  linked_cash: "",
});
await post("location/save", {
  id: other,
  kind: "bar",
  name: "Бариста тест інший",
  color: "#456789",
  linked_cash: "",
});
const id = "990000099";
await post("staff", {
  telegram_id: id,
  role: "bar",
  enabled: true,
  location: scope,
});
await post(
  "staff",
  { telegram_id: id, role: "cash", enabled: true, location: scope },
  owner,
  400,
);
const token = "7".repeat(64),
  digest = createHash("sha256").update(token).digest("hex");
const r = spawnSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "execute",
    "DB",
    "--local",
    "--command",
    `INSERT OR REPLACE INTO auth_sessions VALUES('${digest}','${id}','Test','${"2".repeat(64)}',${Math.floor(Date.now() / 1000) + 3600});`,
  ],
  { encoding: "utf8" },
);
assert.equal(r.status, 0);
const staff = { ...owner, Cookie: "__Host-minicafe_session=" + token };
let response = await fetch(base + "/api/state", { headers: staff });
let state = await response.json();
assert.equal(response.status, 200);
assert.equal(state.access_location, scope);
assert.deepEqual(
  state.locations.map((l) => l.id),
  [scope],
);
await post("issue", { id: 1, route: "bar", location_id: other }, staff, 403);
await post(
  "staff",
  {
    telegram_id: id,
    role: "bar",
    enabled: true,
    action: "label",
    label: "Оля тест",
  },
  owner,
);
response = await fetch(base + "/api/state", { headers: staff });
assert.equal(response.status, 200, "rename must preserve session");
const list = await (
  await fetch(base + "/api/staff", { headers: owner })
).json();
const person = list.staff.find((s) => s.telegram_id === id);
assert.equal(person.label, "Оля тест");
assert.equal(person.role, "bar");
assert.equal(person.location, scope);

const cashA = "loc-" + "5".repeat(32),
  cashB = "loc-" + "4".repeat(32);
for (const [cash, target] of [
  [cashA, scope],
  [cashB, other],
])
  await post("location/save", {
    id: cash,
    kind: "cash",
    name: "Каса тест " + cash.slice(-1),
    color: "#345678",
    targets: [target],
  });
const product = await post("product", {
  name: "Тест дозволів",
  category: "Напої",
  route: "bar",
  price: 5000,
  active: 1,
});
const orderA = await post("order", {
  request: "scope-a-" + Date.now(),
  guest: "Свій гість",
  location_id: cashA,
  items: [{ id: product.id, qty: 1 }],
  cash_given: 0,
  card_amount: 5000,
});
const orderB = await post("order", {
  request: "scope-b-" + Date.now(),
  guest: "Інший гість",
  location_id: cashB,
  items: [{ id: product.id, qty: 1 }],
  cash_given: 0,
  card_amount: 5000,
});
state = await (await fetch(base + "/api/state", { headers: staff })).json();
assert.ok(state.orders.some((o) => o.id === orderA.id));
assert.ok(!state.orders.some((o) => o.id === orderB.id));
await post(
  "issue",
  { id: orderB.id, route: "bar", location_id: scope },
  staff,
  403,
);
await post("staff", {
  telegram_id: id,
  role: "cash",
  enabled: true,
  location: cashA,
});
const reseed = spawnSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "execute",
    "DB",
    "--local",
    "--command",
    `INSERT OR REPLACE INTO auth_sessions VALUES('${digest}','${id}','Test','${"2".repeat(64)}',${Math.floor(Date.now() / 1000) + 3600});`,
  ],
  { encoding: "utf8" },
);
assert.equal(reseed.status, 0);
const ledger = await (
  await fetch(base + "/api/card-payments", { headers: staff })
).json();
assert.ok(ledger.payments.some((p) => p.id === orderA.id));
assert.ok(!ledger.payments.some((p) => p.id === orderB.id));
await post(
  "card-payment/hide",
  { id: orderB.id, location_id: cashA },
  staff,
  403,
);
await post(
  "order",
  {
    request: "denied-" + Date.now(),
    location_id: cashB,
    items: [{ id: product.id, qty: 1 }],
    cash_given: 0,
    card_amount: 5000,
  },
  staff,
  403,
);
await post(
  "staff",
  { telegram_id: id, role: "bar", enabled: false, action: "delete" },
  owner,
);
assert.equal(
  (await fetch(base + "/api/state", { headers: staff })).status,
  401,
);
console.log(
  "PASS staff location scopes, wrong-kind rejection, cross-location write denial, cosmetic rename without session change, delete/revoke",
);
