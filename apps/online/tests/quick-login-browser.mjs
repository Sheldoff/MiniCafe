import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes, createHash } from "node:crypto";
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
for (const [name, engine, options] of [
  ["Chrome", chromium, chromeOptions],
  ["WebKit", webkit, {}],
]) {
  const b = await engine.launch({ headless: true, ...options });
  try {
    const phone = await b.newContext({ ignoreHTTPSErrors: true });
    const hook = (data) =>
      phone.request.post(base + "/api/telegram/webhook", {
        headers: { "X-Telegram-Bot-Api-Secret-Token": "local-test-secret" },
        data: { update_id: ++update, ...data },
      });
    for (const native of [false, true]) {
      const laptop = await b.newContext({
          ignoreHTTPSErrors: true,
          viewport: { width: native ? 390 : 980, height: 850 },
        }),
        p = await laptop.newPage(),
        errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      let secret;
      if (native) {
        secret = randomBytes(32).toString("hex");
        const challenge = createHash("sha256").update(secret).digest("hex");
        await p.goto(base + "/auth/app/start?challenge=" + challenge);
      } else await p.goto(base + "/auth/login");
      await p
        .getByRole("link", {
          name: "Вхід без коду · Telegram / QR",
          exact: true,
        })
        .click();
      await p.locator("#openLoginBot[href]").waitFor();
      const link = await p.locator("#openLoginBot").getAttribute("href"),
        ticket = link.split("q_")[1],
        match = await p.locator("#loginMatch").textContent();
      assert.match(match, /^\d{6}$/);
      assert.equal(await p.locator("#loginQr svg").count(), 1);
      assert.ok(
        (await p.locator("#manualLogin").getAttribute("href")).endsWith(
          "/auth/code",
        ),
      );
      await p.screenshot({
        path: `../../work/quick-login-${name}-${native ? "apk" : "desktop"}.png`,
      });
      const id = native ? 990000002 : 600810855;
      const message = await (
        await hook({
          message: {
            chat: { id, type: "private" },
            from: { id, first_name: "Local" },
            text: "/start q_" + ticket,
          },
        })
      ).json();
      assert.ok(message.text.includes(match));
      assert.equal((await p.request.get(base + "/api/state")).status(), 401);
      const callback = message.reply_markup.inline_keyboard[0][0].callback_data;
      const approved = await (
        await hook({
          callback_query: {
            id: "local-test-callback",
            from: { id, first_name: "Local" },
            message: { message_id: 1, chat: { id, type: "private" } },
            data: callback,
          },
        })
      ).json();
      assert.match(approved.text, /підтверджено/);
      await p.waitForURL(base + (native ? "/auth/app/confirm" : "/admin"));
      if (native) {
        await p.getByRole("button", { name: "Увійти в застосунок" }).click();
        await p.getByRole("link", { name: "Повернутися в МініКафе" }).waitFor();
        const apk = await b.newContext({ ignoreHTTPSErrors: true }),
          r = await apk.request.post(base + "/api/app/poll", {
            data: { secret },
          });
        assert.equal(r.status(), 200);
        const session = (await r.json()).session;
        assert.equal(
          (
            await (
              await apk.request.get(base + "/api/me", {
                headers: { Cookie: "__Host-minicafe_session=" + session },
              })
            ).json()
          ).user.role,
          "bar",
        );
        assert.equal(
          (
            await apk.request.post(base + "/api/app/poll", { data: { secret } })
          ).status(),
          202,
        );
        await apk.close();
      } else {
        await p.waitForFunction(() => hasServerState);
        assert.equal(await p.evaluate(() => data.access_role), "admin");
      }
      assert.deepEqual(errors, []);
      await laptop.close();
    }
    await phone.close();
    console.log(
      "PASS " +
        name +
        ": QR/link, phone button confirmation, automatic desktop login without typing and original APK proof with bar role",
    );
  } finally {
    await b.close();
  }
}
