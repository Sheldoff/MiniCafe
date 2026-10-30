import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { accessRequests } from "../src/access-requests.js";
import { hash } from "../src/auth.js";
test("bot requests are authenticated, deduplicated, private, consent-based and atomically reviewed", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of [
    "0003_auth.sql",
    "0004_phone_access.sql",
    "0006_access_requests.sql",
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
  let update = 1,
    calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return Response.json({
      ok: true,
      result: String(url).endsWith("/getChat")
        ? {
            id: 12345,
            type: "private",
            bio: "Тестове біо",
            pinned_message: { text: "Must not be stored" },
          }
        : true,
    });
  };
  const user = {
    id: 12345,
    is_bot: false,
    first_name: "Тест",
    last_name: "Гість",
    username: "test_user",
    language_code: "uk",
    is_premium: true,
  };
  const hook = (message, secret = env.TELEGRAM_WEBHOOK_SECRET, id = update++) =>
    new Request(origin + "/api/telegram/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": secret,
      },
      body: JSON.stringify({
        update_id: id,
        message: {
          chat: { id: user.id, type: "private" },
          from: user,
          ...message,
        },
      }),
    });
  const adminCookie = "1".repeat(64);
  sqlite
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?,?,?)")
    .run(
      await hash(adminCookie),
      "600810855",
      "Admin",
      "csrf",
      Math.floor(Date.now() / 1000) + 3600,
    );
  const adminHeaders = {
    Cookie: "__Host-minicafe_session=" + adminCookie,
    Origin: origin,
    "X-CSRF-Token": "csrf",
    "Content-Type": "application/json",
  };
  const decision = (body, headers = adminHeaders) =>
    accessRequests(
      new Request(origin + "/api/staff-requests/decision", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
      env,
    );
  try {
    assert.equal(
      (await accessRequests(hook({ text: "/apply" }, "wrong"), env)).status,
      401,
    );
    assert.equal(
      sqlite.prepare("SELECT count(*) n FROM access_requests").get().n,
      0,
    );
    const first = hook({ text: "/apply" });
    assert.match(
      (await (await accessRequests(first.clone(), env)).json()).text,
      /надіслано/,
    );
    assert.deepEqual(await (await accessRequests(first.clone(), env)).json(), {
      ok: true,
    });
    assert.equal(
      sqlite.prepare("SELECT count(*) n FROM access_requests").get().n,
      1,
    );
    assert.equal(
      sqlite.prepare("SELECT count(*) n FROM staff_access").get().n,
      0,
    );
    await accessRequests(
      hook({ contact: { user_id: 777, phone_number: "+12025550199" } }),
      env,
    );
    assert.equal(
      sqlite.prepare("SELECT phone FROM access_requests").get().phone,
      null,
    );
    await accessRequests(
      hook({
        contact: {
          user_id: user.id,
          phone_number: "+12025550199",
          first_name: "Тест",
        },
      }),
      env,
    );
    const pending = sqlite.prepare("SELECT * FROM access_requests").get();
    assert.equal(pending.phone, "+12025550199");
    const profile = JSON.parse(pending.profile);
    assert.equal(profile.chat.bio, "Тестове біо");
    assert.equal(profile.chat.pinned_message, undefined);
    assert.equal(
      (await accessRequests(new Request(origin + "/api/staff-requests"), env))
        .status,
      401,
    );
    assert.equal(
      (
        await decision({
          telegram_id: "12345",
          version: 1,
          action: "approve",
          role: "admin",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await decision(
          { telegram_id: "12345", version: 1, action: "approve", role: "bar" },
          { ...adminHeaders, Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await decision({ telegram_id: "12345", version: 1, action: "reject" }))
        .status,
      200,
    );
    assert.equal(
      sqlite.prepare("SELECT count(*) n FROM staff_access").get().n,
      0,
    );
    await accessRequests(hook({ text: "/apply" }), env);
    const renewed = sqlite
      .prepare("SELECT status,version FROM access_requests")
      .get();
    assert.deepEqual({ ...renewed }, { status: "pending", version: 2 });
    assert.equal(
      (
        await decision({
          telegram_id: "12345",
          version: 1,
          action: "approve",
          role: "cash",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await decision({
          telegram_id: "12345",
          version: 2,
          action: "approve",
          role: "bar",
        })
      ).status,
      200,
    );
    assert.equal(
      sqlite
        .prepare(
          "SELECT role,enabled FROM staff_access WHERE telegram_id='12345'",
        )
        .get().role,
      "bar",
    );
    assert.equal(
      (await decision({ telegram_id: "12345", version: 2, action: "reject" }))
        .status,
      409,
    );
    assert.equal(
      (
        await (
          await accessRequests(
            new Request(origin + "/api/staff-requests", {
              headers: adminHeaders,
            }),
            env,
          )
        ).json()
      ).requests.length,
      0,
    );
    assert.ok(calls.some((c) => c.url.endsWith("/sendMessage")));
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
