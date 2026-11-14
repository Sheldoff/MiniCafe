import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const base = process.env.CAFE_CLOUD_TEST_URL || "http://127.0.0.1:8791";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Disposable local D1 required");
// Earlier access-control scenarios deliberately revoke these local sessions.
const seed = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./seed-auth.mjs", import.meta.url))],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: "pipe",
  },
);
assert.equal(seed.status, 0, "Local auth fixture setup failed");
const owner = {
  "Content-Type": "application/json",
  Origin: base,
  Cookie: "__Host-minicafe_session=" + "1".repeat(64),
  "X-CSRF-Token": "2".repeat(64),
};
const read = async (path, headers = owner) => {
  const r = await fetch(base + "/api/" + path, { headers });
  assert.equal(r.status, 200, path);
  return r.json();
};
const post = async (path, data, status = 200, headers = owner) => {
  const r = await fetch(base + "/api/" + path, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    }),
    j = await r.json();
  assert.equal(r.status, status, path + ": " + JSON.stringify(j));
  return j;
};
const original = await read("backup");
try {
  const fixture = structuredClone(original);
  Object.assign(fixture, {
    orders: [],
    sessions: [],
    calculator_expenses: [],
    locations: [],
    active_session: 0,
    issue_undo: {},
    next_guest_number: 1,
    next_guest_numbers: {},
  });
  for (const p of fixture.products) {
    delete p.stock;
    delete p.stock_by_cash;
    delete p.unavailable_at;
    p.sold_out = false;
    p.active = 1;
  }
  await post("restore", fixture);
  const product = fixture.products[0];
  const sale = (request, guest = "") => ({
    request,
    guest,
    items: [{ id: product.id, qty: 1 }],
    cash_given: 0,
    card_amount: product.price,
  });
  const duplicate = await Promise.all([
    post("order", sale("anonymous-once")),
    post("order", sale("anonymous-once")),
  ]);
  assert.equal(duplicate[0].id, duplicate[1].id);
  await Promise.all(
    Array.from({ length: 5 }, (_, n) =>
      post("order", sale("anonymous-parallel-" + n)),
    ),
  );
  let backup = await read("backup");
  assert.deepEqual(
    backup.orders.map((o) => o.guest).sort(),
    Array.from({ length: 6 }, (_, n) => "Гість №" + (n + 1)).sort(),
  );
  assert.equal(backup.next_guest_number, 7);
  await post("order", sale("named", "Олена"));
  await post("order", { ...sale("unpaid"), card_amount: 0 }, 400);
  assert.equal((await read("state")).next_guest_number, 7);
  const loc = {
    id: "cash",
    name: "Каса",
    kind: "cash",
    color: "#333333",
    targets: ["bar", "delivery"],
    guest_name_required: true,
  };
  await post("location/save", loc);
  await post("order", sale("required"), 400);
  await post("order", sale("required", "Іван"));
  assert.equal((await read("state")).next_guest_number, 7);
  await post("location/save", { ...loc, guest_name_required: false });
  backup = await read("backup");
  await post("restore", backup);
  await post("order", sale("after-restore"));
  assert.equal((await read("backup")).orders.at(-1).guest, "Гість №7");
  await post("location/save", { ...loc, guest_name_required: "false" }, 400);
  const extraCash = "loc-" + "ce".repeat(16);
  await post("location/save", {
    ...loc,
    id: extraCash,
    name: "Низ",
    guest_prefix: "низ ",
    guest_name_required: false,
  });
  const makeExtra = (request, guest = "") =>
    post("order", { ...sale(request, guest), location_id: extraCash });
  await Promise.all([makeExtra("own-one"), makeExtra("own-two")]);
  await makeExtra("own-name", "Олена");
  await makeExtra("own-one");
  const own = await read("card-payments?location_id=" + extraCash);
  assert.deepEqual(
    own.payments.map((p) => p.guest).sort(),
    ["низ 1", "низ 2", "Олена"].sort(),
  );
  assert(
    !(await read("card-payments?location_id=cash")).payments.some((p) =>
      p.guest.startsWith("низ "),
    ),
  );
  const scoped = {
    ...owner,
    Cookie: "__Host-minicafe_session=" + "3".repeat(64),
    "X-CSRF-Token": "4".repeat(64),
  };
  await post(
    "session/rename",
    { id: (await read("state")).active_session, name: "Нова назва" },
    403,
    scoped,
  );
  const sid = (await read("state")).active_session;
  await post("session/rename", { id: sid, name: "Ранкова зміна" });
  const stats = await read("stats?session=" + sid + "&live=1");
  assert.equal(stats.title, "Ранкова зміна");
  assert(stats.live.events.some((e) => e.cash_location === extraCash));
  await post("transaction/clear", {});
  assert.equal((await read("transactions")).payments.length, 0);
  assert.equal((await read("stats?session=" + sid)).revenue, stats.revenue);
  assert.equal(
    (await read("card-payments?location_id=" + extraCash)).payments.length,
    3,
  );
  console.log(
    "PASS local D1 anonymous numbering: concurrent/retried requests, names, failures, required setting, state and backup",
  );
} finally {
  await post("restore", original);
}
