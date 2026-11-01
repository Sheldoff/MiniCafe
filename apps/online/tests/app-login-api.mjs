import assert from "node:assert/strict";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
const base = process.env.CAFE_CLOUD_TEST_URL || "http://127.0.0.1:8791";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Local server required");
for (const [digit, role] of [
  ["1", "admin"],
  ["4", "bar"],
]) {
  const secret = randomBytes(32).toString("hex"),
    challenge = createHash("sha256").update(secret).digest("hex");
  const browserCookie =
    "__Host-minicafe_session=" +
    digit.repeat(64) +
    "; __Host-minicafe_app=" +
    challenge;
  const start = await new Promise((resolve, reject) => {
    http
      .get(
        base + "/auth/app/start?challenge=" + challenge,
        {
          headers: {
            Cookie: browserCookie,
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
          },
        },
        (r) => {
          let text = "";
          r.on("data", (c) => (text += c));
          r.on("end", () =>
            resolve(
              new Response(text, { status: r.statusCode, headers: r.headers }),
            ),
          );
        },
      )
      .on("error", reject);
  });
  assert.equal(start.status, 200);
  assert.match(await start.text(), /href="\/auth\/app\/confirm"/);
  const poll = () =>
    fetch(base + "/api/app/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
  assert.equal((await poll()).status, 202);
  const bad = await fetch(base + "/auth/app/confirm", {
    method: "POST",
    headers: {
      Cookie: browserCookie,
      Origin: base,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "csrf=wrong",
  });
  assert.equal(bad.status, 403);
  const approved = await fetch(base + "/auth/app/confirm", {
    method: "POST",
    headers: {
      Cookie: browserCookie,
      Origin: base,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ csrf: "2".repeat(64) }),
  });
  assert.equal(approved.status, 200);
  assert.match(await approved.text(), /minicafe:\/\/online-complete/);
  const result = await poll();
  assert.equal(result.status, 200);
  const { session } = await result.json();
  assert.match(session, /^[a-f0-9]{64}$/);
  assert.notEqual(session, digit.repeat(64));
  const headers = { Cookie: "__Host-minicafe_session=" + session };
  const me = await (await fetch(base + "/api/me", { headers })).json();
  assert.equal(me.user.role, role);
  assert.equal((await fetch(base + "/api/state", { headers })).status, 200);
  if (role === "bar")
    assert.equal((await fetch(base + "/api/backup", { headers })).status, 403);
  assert.equal((await poll()).status, 202);
  assert.equal(
    (
      await fetch(base + "/auth/logout", {
        method: "POST",
        headers: { ...headers, Origin: base, "X-CSRF-Token": me.user.csrf },
      })
    ).status,
    200,
  );
  assert.equal((await fetch(base + "/api/state", { headers })).status, 401);
}
console.log(
  "PASS local app handoff: explicit CSRF approval, private proof, one-use new sessions, admin/bar rights and logout",
);
