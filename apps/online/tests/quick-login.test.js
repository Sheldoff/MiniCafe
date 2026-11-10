import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  quickLogin,
  quickLoginMessage,
  quickLoginCallback,
} from "../src/quick-login.js";
import { accessRequests } from "../src/access-requests.js";
import { hash, identity } from "../src/auth.js";
test("QR approval: independent browser proof, authenticated callbacks, roles, expiry, rejection, revocation and atomic one-use session", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of [
    "0003_auth.sql",
    "0004_phone_access.sql",
    "0006_access_requests.sql",
    "0013_bot_login.sql",
    "0014_telegram_quick_login.sql",
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
  let n = 0;
  const prepare = async () => {
    const page = await quickLogin(new Request(origin + "/auth/quick"), env);
    const cookie = page.headers.get("Set-Cookie").split(";")[0],
      proof = cookie.split("=")[1];
    assert.ok(!(await page.text()).includes("q_"));
    return { cookie, proof };
  };
  const post = (p, action, extra = {}) =>
    quickLogin(
      new Request(origin + "/auth/quick/" + action, {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: p.cookie,
          "X-CSRF-Token": p.proof,
          "CF-Connecting-IP": String(n),
          ...extra,
        },
      }),
      env,
    );
  const start = async (p) => {
    n++;
    const r = await post(p, "start");
    assert.equal(r.status, 200);
    return r.json();
  };
  const poll = (p, extra = {}) => post(p, "poll", extra);
  const p = await prepare(),
    other = await prepare();
  assert.equal(
    (await post(p, "start", { Origin: "https://evil.example" })).status,
    403,
  );
  const request = await start(p),
    ticket = request.link.split("q_")[1];
  assert.match(request.qr, /<svg/);
  assert.match(request.match, /^\d{6}$/);
  assert.equal(request.expires_in, 300);
  assert.ok(!request.link.includes(p.proof));
  assert.equal((await poll(p)).status, 202);
  assert.equal((await poll(other)).status, 410);
  assert.equal((await poll(p, { "X-CSRF-Token": "wrong" })).status, 403);
  assert.match(
    (await quickLoginMessage(env, "100", "/start q_" + ticket)).text,
    /не надано/,
  );
  sqlite
    .prepare("INSERT INTO staff_access VALUES(?,?,1,'test')")
    .run("100", "bar");
  const message = await quickLoginMessage(env, "100", "/start q_" + ticket);
  assert.ok(message.text.includes(request.match));
  assert.equal(
    message.reply_markup.inline_keyboard[0][0].callback_data,
    "qa_" + ticket,
  );
  // Private authenticated callback updates, not public browser payloads, approve.
  const hook = (secret, update, chat = 100, from = 100) =>
    new Request(origin + "/api/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify({
        update_id: update,
        callback_query: {
          id: "test-callback",
          from: { id: from, first_name: "Local Bar" },
          message: { message_id: 4, chat: { id: chat, type: "private" } },
          data: "qa_" + ticket,
        },
      }),
    });
  assert.equal((await accessRequests(hook("bad", 1), env)).status, 401);
  await accessRequests(hook(env.TELEGRAM_WEBHOOK_SECRET, 2, 999, 100), env);
  assert.equal((await poll(p)).status, 202);
  const confirmed = await (
    await accessRequests(hook(env.TELEGRAM_WEBHOOK_SECRET, 3), env)
  ).json();
  assert.equal(confirmed.method, "answerCallbackQuery");
  assert.match(confirmed.text, /підтверджено/);
  assert.deepEqual(
    await (
      await accessRequests(hook(env.TELEGRAM_WEBHOOK_SECRET, 3), env)
    ).json(),
    { ok: true },
  );
  assert.equal((await poll(other)).status, 410);
  const race = await Promise.all([poll(p), poll(p)]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 410]);
  const result = race.find((r) => r.status === 200),
    cookie = result.headers
      .get("Set-Cookie")
      .match(/__Host-minicafe_session=[a-f0-9]{64}/)[0];
  assert.equal((await result.json()).redirect, "/admin");
  assert.equal(
    (await identity(new Request(origin, { headers: { Cookie: cookie } }), env))
      .role,
    "bar",
  );
  assert.equal((await poll(p)).status, 410);
  const exp = await prepare(),
    expired = await start(exp);
  sqlite.exec("UPDATE telegram_login_links SET expires=0");
  assert.equal((await poll(exp)).status, 410);
  assert.match(
    await quickLoginCallback(env, "100", "qa_" + expired.link.split("q_")[1]),
    /час минув/,
  );
  const deny = await prepare(),
    denied = await start(deny);
  await quickLoginCallback(env, "100", "qx_" + denied.link.split("q_")[1]);
  assert.equal((await poll(deny)).status, 403);
  const revoke = await prepare(),
    revoked = await start(revoke),
    revTicket = revoked.link.split("q_")[1];
  await quickLoginCallback(env, "100", "qa_" + revTicket);
  sqlite.exec("UPDATE staff_access SET enabled=0 WHERE telegram_id='100'");
  assert.equal((await poll(revoke)).status, 403);
  const replace = await prepare(),
    old = await start(replace),
    current = await start(replace);
  assert.notEqual(old.link, current.link);
  assert.match(
    (
      await quickLoginMessage(
        env,
        "600810855",
        "/start q_" + old.link.split("q_")[1],
      )
    ).text,
    /використаний/,
  );
  // Public ticket knowledge cannot replace cookie-bound proof.
  assert.equal(
    (
      await post(other, "poll", {
        Cookie: "__Host-minicafe_quick=" + "a".repeat(64),
        "X-CSRF-Token": "a".repeat(64),
      })
    ).status,
    410,
  );
  sqlite.close();
});
