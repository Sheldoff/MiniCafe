import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { issueBotCode, botLogin } from "../src/bot-login.js";
import { accessRequests } from "../src/access-requests.js";
import { hash, identity, timestamp } from "../src/auth.js";
test("cross-device bot codes: private webhook, one-use, expiry, CSRF, roles, revocation and throttling", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of [
    "0003_auth.sql",
    "0015_staff_details.sql",
    "0004_phone_access.sql",
    "0006_access_requests.sql",
    "0013_bot_login.sql",
  ])
    sqlite.exec(
      readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
    );
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        first: async () => sqlite.prepare(sql).get(...args) || null,
        run: async () => sqlite.prepare(sql).run(...args),
        all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        execute: () => ({ results: sqlite.prepare(sql).all(...args) }),
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const rows = statements.map((s) => s.execute());
        sqlite.exec("COMMIT");
        return rows;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const env = {
    DB: db,
    ADMIN_TELEGRAM_IDS: "600810855,1402380598",
    TELEGRAM_WEBHOOK_SECRET: "test-hook-secret",
    TELEGRAM_BOT_TOKEN: "fake-unit-only",
    TELEGRAM_BOT_USERNAME: "minicafe_loginbot",
  };

  const origin = "https://minicafe.example";
  const ip = () => String(++counter);
  let counter = 0;
  const form = async () => {
    const r = await botLogin(new Request(origin + "/auth/code"), env);
    assert.equal(r.status, 200);
    assert.match(
      r.headers.get("Content-Security-Policy"),
      /form-action 'self'/,
    );
    const cookie = r.headers.get("Set-Cookie").split(";")[0];
    const csrf = cookie.split("=")[1];
    assert.match(await r.text(), /Код МініКафе з бота/);
    return { cookie, csrf };
  };
  const submit = (f, code, extra = {}) =>
    botLogin(
      new Request(origin + "/auth/code", {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: f.cookie,
          "Content-Type": "application/x-www-form-urlencoded",
          "CF-Connecting-IP": ip(),
          ...extra,
        },
        body: new URLSearchParams({ csrf: f.csrf, code }),
      }),
      env,
    );
  const f = await form();
  assert.equal(await issueBotCode(env, "100"), null);
  sqlite
    .prepare("INSERT INTO staff_access VALUES(?,?,1,'test')")
    .run("100", "bar");
  const code = await issueBotCode(env, "100");
  assert.match(code, /^\d{5} \d{5}$/);
  assert.equal(
    sqlite.prepare("SELECT code_hash FROM bot_login_codes").get().code_hash,
    await hash(code.replace(/ /g, "")),
  );
  assert.equal(
    (await submit(f, code, { Origin: "https://evil.example" })).status,
    403,
  );
  assert.equal((await submit({ ...f, csrf: "wrong" }, code)).status, 403);
  assert.equal((await submit(f, "00000")).status, 400);
  const r = await submit(f, code);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("Location"), "/admin");
  const cookie = r.headers
    .get("Set-Cookie")
    .match(/__Host-minicafe_session=[a-f0-9]{64}/)[0];
  const user = await identity(
    new Request(origin, { headers: { Cookie: cookie } }),
    env,
  );
  assert.equal(user.role, "bar");
  assert.equal((await submit(f, code)).status, 400);
  const old = await issueBotCode(env, "100"),
    next = await issueBotCode(env, "100");
  assert.notEqual(old, next);
  assert.equal((await submit(f, old)).status, 400);
  sqlite.exec("UPDATE bot_login_codes SET expires=0");
  assert.equal((await submit(f, next)).status, 400);
  const revoked = await issueBotCode(env, "100");
  sqlite.exec("UPDATE staff_access SET enabled=0 WHERE telegram_id='100'");
  assert.equal((await submit(f, revoked)).status, 400);
  assert.equal(
    await identity(new Request(origin, { headers: { Cookie: cookie } }), env),
    null,
  );
  assert.equal(await issueBotCode(env, "100"), null);
  const admin = await issueBotCode(env, "600810855");
  const approved = await submit(f, admin, {
    Cookie: f.cookie + "; __Host-minicafe_app=" + "a".repeat(64),
  });
  assert.equal(approved.headers.get("Location"), "/auth/app/confirm");
  // Phone grants must already be bound through verified OIDC. No contact/ID spoofing.
  sqlite
    .prepare("INSERT INTO staff_phone VALUES(?,?,1,?,?)")
    .run("+12025550101", "cash", "200", "test");
  const phoneCode = await issueBotCode(env, "200");
  const phoneResult = await submit(f, phoneCode);
  const phoneCookie = phoneResult.headers
    .get("Set-Cookie")
    .match(/__Host-minicafe_session=[a-f0-9]{64}/)[0];
  assert.equal(
    (
      await identity(
        new Request(origin, { headers: { Cookie: phoneCookie } }),
        env,
      )
    ).role,
    "cash",
  );
  sqlite
    .prepare("INSERT INTO staff_access VALUES(?,?,0,'test')")
    .run("200", "cash");
  assert.equal(await issueBotCode(env, "200"), null);
  sqlite
    .prepare("INSERT INTO staff_phone VALUES(?,?,1,NULL,?)")
    .run("+12025550102", "cash", "test");
  assert.equal(await issueBotCode(env, "300"), null);
  for (let i = 0; i < 8; i++)
    assert.equal(
      (await submit(f, "9999999999", { "CF-Connecting-IP": "limited" })).status,
      400,
    );
  assert.equal(
    (await submit(f, "9999999999", { "CF-Connecting-IP": "limited" })).status,
    429,
  );
  // Authenticated Telegram webhook is the only public way to issue codes.
  const hook = (secret, updateId) =>
    new Request(origin + "/api/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify({
        update_id: updateId,
        message: {
          chat: { id: 600810855, type: "private" },
          from: { id: 600810855, first_name: "Owner" },
          text: "/login",
        },
      }),
    });
  assert.equal((await accessRequests(hook("forged", 1), env)).status, 401);
  const message = await (
    await accessRequests(hook(env.TELEGRAM_WEBHOOK_SECRET, 2), env)
  ).json();
  assert.match(message.text, /Код входу в МініКафе: \d{5} \d{5}/);
  assert.deepEqual(
    await (
      await accessRequests(hook(env.TELEGRAM_WEBHOOK_SECRET, 2), env)
    ).json(),
    { ok: true },
  );
  sqlite.close();
});
