import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  chromium,
  webkit,
  chromeOptions,
} = require("../../../work/tests/ui/helpers.cjs");
const base = process.env.CAFE_CLOUD_TEST_URL || "https://127.0.0.1:8791";
if (!/^https:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Local HTTPS required");
let update = Date.now();
for (const [name, engine, options, id] of [
  ["Chrome", chromium, chromeOptions, 600810855],
  ["WebKit", webkit, {}, 1402380598],
]) {
  const b = await engine.launch({ headless: true, ...options });
  try {
    const context = await b.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 980, height: 900 },
      }),
      phone = await b.newContext({ ignoreHTTPSErrors: true }),
      p = await context.newPage(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    const hook = (data) =>
      phone.request.post(base + "/api/telegram/webhook", {
        headers: { "X-Telegram-Bot-Api-Secret-Token": "local-test-secret" },
        data: { update_id: ++update, ...data },
      });
    const ticket = async () => {
      await p.locator("#openLoginBot[href]").waitFor();
      return (await p.locator("#openLoginBot").getAttribute("href")).split(
        "q_",
      )[1];
    };
    const message = (t) =>
      hook({
        message: {
          chat: { id, type: "private" },
          from: { id, first_name: "Local" },
          text: "/start q_" + t,
        },
      });
    const approve = async (t) => {
      const msg = await (await message(t)).json();
      assert.ok(msg.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data);
      const response = await (
        await hook({
          callback_query: {
            id: "test-retry",
            from: { id, first_name: "Local" },
            message: { message_id: 1, chat: { id, type: "private" } },
            data: msg.reply_markup.inline_keyboard[0][0].callback_data,
          },
        })
      ).json();
      assert.match(response.text, /підтверджено/);
      await p.waitForURL(base + "/admin");
      await p.waitForFunction(() => hasServerState);
    };
    await p.goto(base + "/auth/login");
    assert.equal(
      await p.evaluate(() => document.documentElement.dataset.palette),
      "coffee",
    );
    await p
      .getByRole("link", { name: "Вхід без коду · Telegram / QR", exact: true })
      .click();
    const first = await ticket();
    await approve(first);
    // Logout must remove old auth flow cookies as well as the current session.
    await context.addCookies(
      ["app", "quick", "code", "oauth"].map((k) => ({
        name: "__Host-minicafe_" + k,
        value: "a".repeat(64),
        url: base,
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      })),
    );
    await p.evaluate(() => cloudLogout());
    await p.waitForURL(base + "/auth/login");
    assert.deepEqual(
      (await context.cookies()).filter((c) =>
        c.name.startsWith("__Host-minicafe_"),
      ),
      [],
    );
    await p.goBack();
    assert.notEqual(
      new URL(p.url()).pathname,
      "/auth/quick",
      "Spent QR must not remain behind logout in history",
    );
    await p.goto(base + "/auth/login");
    await p
      .getByRole("link", { name: "Вхід без коду · Telegram / QR", exact: true })
      .click();
    const second = await ticket();
    assert.notEqual(second, first);
    const old = await (await message(first)).json();
    assert.match(old.text, /попереднього входу/);
    assert.equal(
      old.reply_markup.inline_keyboard[0][0].url,
      "https://minicafe.minicafe.workers.dev/auth/quick",
    );
    // Browser-back cache restoration must fetch a fresh page/proof and QR.
    await p.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      ),
    );
    await p.waitForFunction(
      (old) =>
        document.querySelector("#openLoginBot")?.href.includes("q_") &&
        !document.querySelector("#openLoginBot").href.endsWith(old),
      second,
    );
    const third = await ticket();
    assert.notEqual(third, second);
    await approve(third);
    // A later explicit classic choice survives reload, after the default migration.
    await p.evaluate(() => setCafePalette("standard", false));
    await p.reload();
    await p.waitForFunction(() => hasServerState);
    assert.equal(
      await p.evaluate(() => document.documentElement.dataset.palette),
      undefined,
    );
    await p.evaluate(() => setCafePalette("coffee", false));
    assert.deepEqual(errors, []);
    await p.screenshot({ path: `../../work/login-retry-${name}.png` });
    await context.close();
    await phone.close();
    console.log(
      "PASS " +
        name +
        ": login/logout/re-login, no spent history, cleared proof cookies, fresh QR on bfcache and coffee default with preserved later choice",
    );
  } finally {
    await b.close();
  }
}
