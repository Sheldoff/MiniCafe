const assert = require("node:assert/strict");
const path = require("node:path");
const {
  chromium,
  webkit,
  chromeOptions,
} = require("../../../work/tests/ui/helpers.cjs");
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const browser = await engine.launch({ headless: true, ...options });
    try {
      const page = await browser.newPage({ reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setExtraHTTPHeaders({
        Cookie: "__Host-minicafe_session=" + "1".repeat(64),
      });
      await page.goto(
        (process.env.CAFE_CLOUD_TEST_URL || "http://127.0.0.1:8791") + "/admin",
      );
      await page.locator('[data-product="1"]').waitFor();
      for (const width of [390, 820, 1280])
        for (const theme of ["light", "dark"])
          for (const view of [
            "cash",
            "menu",
            "calculator",
            "history",
            "server",
            "staff",
            "menu-transfer",
          ]) {
            await page.setViewportSize({ width, height: 900 });
            await page.evaluate(
              ({ theme, view }) => {
                setCafeTheme(theme, false);
                change(view);
                if (view === "cash") showCashPanel(true);
                if (view === "menu") toggleProductEditor();
              },
              { theme, view },
            );
            if (view === "staff") await page.locator("#staffForm").waitFor();
            const overflow = await page.evaluate(() =>
              [
                ...document.querySelectorAll(
                  "#main input,#main select,#main textarea,#main button",
                ),
              ]
                .filter(
                  (e) =>
                    e.getClientRects().length &&
                    getComputedStyle(e).visibility !== "hidden",
                )
                .filter((e) => {
                  const r = e.getBoundingClientRect();
                  return r.left < -1 || r.right > innerWidth + 1;
                })
                .map((e) => e.id || e.name || e.textContent.slice(0, 20)),
            );
            assert.deepEqual(overflow, [], `${name} ${width} ${theme} ${view}`);
            assert.equal(
              await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
              ),
              false,
              `${view} page overflow`,
            );
            if (
              name === "Chrome" &&
              width === 390 &&
              ["staff", "menu", "server", "cash"].includes(view)
            )
              await page.screenshot({
                path: path.resolve(
                  __dirname,
                  `../../../outputs/online-${view}-${theme}.png`,
                ),
                fullPage: true,
              });
          }
      assert.deepEqual(errors, []);
      console.log(
        "PASS " +
          name +
          ": all online screens/fields at phone/tablet/desktop widths, light and dark",
      );
    } finally {
      await browser.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
