const assert = require("node:assert/strict");
const { chromium, webkit, chromeOptions, base, key } = require("./helpers.cjs");
const { contrast } = require("./contrast.cjs");
const online = process.env.CAFE_STATS_ONLINE === "1";
const url = online
  ? process.env.CAFE_CLOUD_TEST_URL || "http://127.0.0.1:8791"
  : base;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url))
  throw Error("Disposable local server required");
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const browser = await engine.launch({ headless: true, ...options });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      if (online)
        await page.setExtraHTTPHeaders({
          Cookie: "__Host-minicafe_session=" + "1".repeat(64),
        });
      await page.goto(
        url + (online ? "/admin#history" : "/?key=" + key + "#history"),
      );
      await page.waitForFunction(
        () => typeof hasServerState !== "undefined" && hasServerState,
      );
      await page.locator(".stats-tabs button").nth(1).click();
      await page.locator("#reportDocument").waitFor();
      await page.waitForFunction(
        () => !document.querySelector(".stats-content-ghost"),
      );
      await page.locator(".stats-maintenance summary").click();
      const original = await page.evaluate(() => JSON.stringify(statsCurrent));
      for (const palette of ["coffee", "standard"])
        for (const mode of ["light", "dark"]) {
          await page.evaluate(
            ({ palette, mode }) => {
              setCafePalette(palette, false);
              setCafeTheme(mode, false, false);
            },
            { palette, mode },
          );
          for (const width of [1440, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.waitForTimeout(200);
            assert(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
              name + " " + palette + "/" + mode + "/" + width + " overflow",
            );
            const failures = await contrast(page, "#main");
            assert.deepEqual(
              failures.problems,
              [],
              name + " " + palette + "/" + mode + "/" + width + " contrast",
            );
            for (const selector of [
              ".stats-tabs button",
              ".report-actions button",
              ".expense-add",
              ".stats-end-session",
            ]) {
              for (const button of await page.locator(selector).all())
                assert(
                  (await button.boundingBox()).height >= 44,
                  selector + " touch target",
                );
            }
            assert.equal(
              await page
                .locator(".stats-tabs button")
                .nth(1)
                .getAttribute("aria-pressed"),
              "true",
            );
            if (palette === "coffee" && [1440, 390].includes(width)) {
              await page.evaluate(() => {
                document.querySelector("#main").scrollTop = 0;
              });
              await page.screenshot({
                path: `work/stats-${online ? "online" : "android"}-${name}-${mode}-${width}.png`,
                fullPage: true,
              });
            }
          }
        }
      assert.equal(
        await page.evaluate(() => JSON.stringify(statsCurrent)),
        original,
        "layout must not alter report data",
      );

      await page
        .getByRole("button", {
          name: "Повністю очистити статистику",
          exact: true,
        })
        .waitFor({ state: "visible" });
      await page.locator(".stats-tabs button").nth(0).click();
      await page.locator(".page-controls").waitFor();
      await page.waitForFunction(
        () => !document.querySelector(".stats-content-ghost"),
      );
      assert.equal(
        await page
          .locator(".stats-tabs button")
          .nth(0)
          .getAttribute("aria-pressed"),
        "true",
      );
      for (const palette of ["coffee", "standard"])
        for (const mode of ["light", "dark"]) {
          await page.evaluate(
            ({ palette, mode }) => {
              setCafePalette(palette, false);
              setCafeTheme(mode, false, false);
            },
            { palette, mode },
          );
          await page.waitForTimeout(260);
          assert.deepEqual(
            (await contrast(page, "#main")).problems,
            [],
            name + " history " + palette + "/" + mode,
          );
        }
      if (await page.locator(".history-record").count()) {
        await page.locator(".history-record summary").first().click();
        await page.waitForFunction(
          () => document.querySelector(".history-record").open,
        );
        const id = await page
          .locator(".history-record")
          .first()
          .getAttribute("data-history-order");
        await page.evaluate(() => historyCompact());
        await page.waitForFunction(
          (id) => document.querySelector(`[data-history-order="${id}"]`).open,
          id,
        );
      }
      assert.deepEqual(errors, []);
      console.log(
        "PASS statistics layout, touch targets, accessible tabs, responsive themes and preserved data: " +
          name +
          (online ? " online" : " Android"),
      );
    } finally {
      await browser.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
