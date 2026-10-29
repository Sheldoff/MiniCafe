// Read-only smoke of the published login flow. Does not authenticate a person.
const assert = require("node:assert/strict");
const {
  chromium,
  webkit,
  chromeOptions,
} = require("../../../work/tests/ui/helpers.cjs");
(async () => {
  for (const [name, engine, options, ua] of [
    [
      "Android Chrome",
      chromium,
      chromeOptions,
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    ],
    [
      "iPhone WebKit",
      webkit,
      {},
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    ],
  ]) {
    const browser = await engine.launch({ headless: true, ...options });
    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        userAgent: ua,
      });
      const page = await context.newPage();
      let popups = 0;
      page.on("popup", () => popups++);
      await page.goto("https://minicafe.minicafe.workers.dev/auth/login");
      await page.locator("details summary").click();
      assert.ok(await page.locator("details[open]").count());
      assert.equal(await page.locator(".primary").getAttribute("target"), null);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.locator(".primary").click();
      await page.waitForURL("https://oauth.telegram.org/**");
      await page.locator(".sub-button-text a").waitFor();
      assert.equal(popups, 0);
      assert.equal(
        (await context.cookies("https://minicafe.minicafe.workers.dev")).some(
          (c) => c.name === "__Host-minicafe_oauth" && c.secure && c.httpOnly,
        ),
        true,
      );
      console.log(
        "PASS " +
          name +
          ": same-tab navigation, OAuth cookie and Telegram phone fallback visible",
      );
    } finally {
      await browser.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
