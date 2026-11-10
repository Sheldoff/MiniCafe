import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  chromium,
  webkit,
  chromeOptions,
} = require("../../../work/tests/ui/helpers.cjs");
const base = process.env.CAFE_CLOUD_TEST_URL || "https://127.0.0.1:8791";
if (!/^https?:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Local server only");
for (const [name, engine, options] of [
  ["Chrome", chromium, chromeOptions],
  ["WebKit", webkit, {}],
]) {
  const b = await engine.launch({ headless: true, ...options });
  try {
    const phone = await b.newContext({ ignoreHTTPSErrors: true });
    const laptop = await b.newContext({ ignoreHTTPSErrors: true });
    const p = await laptop.newPage();
    await p.goto(base + "/auth/login");
    await p
      .getByRole("link", { name: "Отримати код у боті на телефоні" })
      .click();
    await p.locator("#code").waitFor();
    const reply = await phone.request.post(base + "/api/telegram/webhook", {
      headers: { "X-Telegram-Bot-Api-Secret-Token": "local-test-secret" },
      data: {
        update_id: Date.now(),
        message: {
          chat: { id: 600810855, type: "private" },
          from: { id: 600810855, first_name: "Local Owner" },
          text: "/start login",
        },
      },
    });
    assert.equal(reply.status(), 200);
    const message = await reply.json(),
      code = message.text.match(/\d{5} \d{5}/)?.[0];
    assert.ok(code, "Bot must return a MiniCafe code for authorized account");
    await p.locator("#code").fill(code);
    const posted = p.waitForResponse(
      (r) => r.url() === base + "/auth/code" && r.request().method() === "POST",
    );
    await p.getByRole("button", { name: "Увійти", exact: true }).click();
    assert.equal(
      (await posted).status(),
      303,
      "Use local HTTPS: WebKit correctly rejects Secure cookies over plain HTTP",
    );
    await p.waitForURL(base + "/admin");
    await p.waitForFunction(() => hasServerState);
    assert.equal(await p.evaluate(() => data.access_role), "admin");
    await p.evaluate(() =>
      fetch("/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": window.CafeCloud.csrf },
      }),
    );
    // The same code method also completes the existing browser-to-APK proof.
    const apk = await b.newContext({ ignoreHTTPSErrors: true }),
      browser = await b.newContext({ ignoreHTTPSErrors: true });
    const tab = await browser.newPage(),
      secret = randomBytes(32).toString("hex"),
      challenge = createHash("sha256").update(secret).digest("hex");
    await tab.goto(base + "/auth/app/start?challenge=" + challenge);
    await tab
      .getByRole("link", { name: "Отримати код у боті на телефоні" })
      .click();
    const second = await phone.request.post(base + "/api/telegram/webhook", {
      headers: { "X-Telegram-Bot-Api-Secret-Token": "local-test-secret" },
      data: {
        update_id: Date.now(),
        message: {
          chat: { id: 990000002, type: "private" },
          from: { id: 990000002, first_name: "Local Bar" },
          text: "/login",
        },
      },
    });
    const secondMessage = await second.json(),
      secondCode = secondMessage.text.match(/\d{5} \d{5}/)?.[0];
    assert.ok(secondCode);
    await tab.locator("#code").fill(secondCode);
    await tab.getByRole("button", { name: "Увійти", exact: true }).click();
    await tab.waitForURL(base + "/auth/app/confirm");
    await tab
      .getByRole("button", { name: "Увійти в застосунок", exact: true })
      .click();
    await tab.getByRole("link", { name: "Повернутися в МініКафе" }).waitFor();
    const poll = await apk.request.post(base + "/api/app/poll", {
      data: { secret },
    });
    assert.equal(poll.status(), 200);
    const session = (await poll.json()).session;
    const me = await apk.request.get(base + "/api/me", {
      headers: { Cookie: "__Host-minicafe_session=" + session },
    });
    assert.equal((await me.json()).user.role, "bar");
    assert.equal(
      (
        await apk.request.get(base + "/api/backup", {
          headers: { Cookie: "__Host-minicafe_session=" + session },
        })
      ).status(),
      403,
    );
    await apk.close();
    await browser.close();
    await phone.close();
    await laptop.close();
    console.log(
      "PASS " +
        name +
        ": separate phone/laptop contexts, real code form, secure session and staff permissions",
    );
  } finally {
    await b.close();
  }
}
