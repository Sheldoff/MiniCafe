import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { appLogin } from "../src/app-login.js";
import { hash, identity, timestamp } from "../src/auth.js";
test("APK handoff requires browser CSRF approval, device proof, live rights and one-use redemption", async () => {
  const sql = new DatabaseSync(":memory:");
  for (const name of [
    "0003_auth.sql",
    "0004_phone_access.sql",
    "0006_access_requests.sql",
    "0008_app_login.sql",
  ])
    sql.exec(
      readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
    );
  const db = {
    prepare(query) {
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first() {
          return sql.prepare(query).get(...args) || null;
        },
        execute() {
          return { results: sql.prepare(query).all(...args) };
        },
        async run() {
          return sql.prepare(query).run(...args);
        },
      };
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const rows = statements.map((s) => s.execute());
        sql.exec("COMMIT");
        return rows;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const env = { DB: db, ADMIN_TELEGRAM_IDS: "1" },
    origin = "https://minicafe.example",
    browser = "a".repeat(64),
    csrf = "b".repeat(64),
    secret = "c".repeat(64),
    challenge = await hash(secret);
  sql
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?,?,?)")
    .run(await hash(browser), "1", "<Admin>", csrf, timestamp() + 3600);
  const cookie = `__Host-minicafe_session=${browser}; __Host-minicafe_app=${challenge}`;
  const start = await appLogin(
    new Request(origin + "/auth/app/start?challenge=" + challenge, {
      headers: { Cookie: cookie },
    }),
    env,
  );
  assert.equal(start.status, 200);
  assert.equal(
    (
      await appLogin(
        new Request(origin + "/auth/app/start?challenge=" + challenge, {
          headers: {
            Cookie: cookie,
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-Dest": "iframe",
            "Sec-Fetch-Mode": "navigate",
          },
        }),
        env,
      )
    ).status,
    403,
  );
  assert.match(await start.text(), /href="\/auth\/app\/confirm"/);
  assert.equal(
    (
      await appLogin(
        new Request(origin + "/auth/app/start?challenge=" + challenge, {
          headers: {
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
          },
        }),
        env,
      )
    ).status,
    200,
  );
  assert.ok(!start.headers.get("set-cookie").includes(secret));
  const form = await appLogin(
    new Request(origin + "/auth/app/confirm", { headers: { Cookie: cookie } }),
    env,
  );
  assert.match(await form.text(), /&lt;Admin&gt;/);
  const approve = (headers = {}, value = csrf) =>
    appLogin(
      new Request(origin + "/auth/app/confirm", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "Content-Type": "application/x-www-form-urlencoded",
          ...headers,
        },
        body: new URLSearchParams({ csrf: value }),
      }),
      env,
    );
  assert.equal((await approve({ Origin: "https://evil.example" })).status, 403);
  assert.equal((await approve({}, "bad")).status, 403);
  const poll = (proof = secret, extra = {}) =>
    appLogin(
      new Request(origin + "/api/app/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extra },
        body: JSON.stringify({ secret: proof }),
      }),
      env,
    );
  assert.equal((await poll()).status, 202);
  assert.equal((await poll("bad")).status, 400);
  assert.equal((await approve()).status, 200);
  assert.equal((await poll(secret, { Origin: origin })).status, 403);
  const result = await poll();
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.match(data.session, /^[a-f0-9]{64}$/);
  assert.notEqual(data.session, browser);
  assert.equal(
    (
      await identity(
        new Request(origin + "/admin", {
          headers: { Cookie: "__Host-minicafe_session=" + data.session },
        }),
        env,
      )
    ).role,
    "admin",
  );
  assert.equal((await poll()).status, 202);
  assert.ok(
    await identity(
      new Request(origin + "/admin", { headers: { Cookie: cookie } }),
      env,
    ),
  );
  sql
    .prepare("INSERT INTO staff_access VALUES(?,?,?,?)")
    .run("2", "bar", 1, "test");
  sql
    .prepare("UPDATE auth_sessions SET telegram_id=? WHERE token_hash=?")
    .run("2", await hash(browser));
  await approve();
  sql.prepare("UPDATE staff_access SET enabled=0 WHERE telegram_id=?").run("2");
  assert.equal((await poll()).status, 403);
  sql.prepare("UPDATE staff_access SET enabled=1 WHERE telegram_id=?").run("2");
  await approve();
  sql.prepare("UPDATE app_links SET expires=0").run();
  assert.equal((await poll()).status, 202);
  sql.prepare("DELETE FROM staff_access WHERE telegram_id='2'").run();
  sql
    .prepare("INSERT INTO staff_phone VALUES(?,?,?,?,?)")
    .run("+380501234567", "cash", 1, "2", "test");
  sql
    .prepare("INSERT INTO session_phone VALUES(?,?)")
    .run(await hash(browser), "+380501234567");
  await approve();
  const phoneSession = (await (await poll()).json()).session;
  const phoneRequest = new Request(origin + "/admin", {
    headers: { Cookie: "__Host-minicafe_session=" + phoneSession },
  });
  assert.equal((await identity(phoneRequest, env)).role, "cash");
  sql.prepare("UPDATE staff_phone SET enabled=0").run();
  assert.equal(await identity(phoneRequest, env), null);
  sql.close();
});
