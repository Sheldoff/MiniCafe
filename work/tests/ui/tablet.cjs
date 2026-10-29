const assert = require("assert"),
  fs = require("fs"),
  path = require("path");
const { chromium, webkit, base, key, chromeOptions } = require("./helpers.cjs");
(async () => {
  const dir = path.dirname(
    process.env.CAFE_SCREENSHOT || "work/tests/results/tablet.png",
  );
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    let b = await engine.launch({ headless: true, ...options });
    for (const native of [false, true]) {
      let p = await b.newPage({
          viewport: { width: 800, height: 1280 },
          hasTouch: true,
        }),
        errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      if (native) await p.addInitScript(() => (window.CafeNative = true));
      await p.goto(base + "/?key=" + key + "#cash");
      await p.locator("[data-product]").first().waitFor();
      if (native)
        await p.evaluate(() => {
          const nativeSet = setCafeTheme;
          setCafeTheme = (mode, animate = true) =>
            nativeSet(mode, animate, false);
        });
      await p.locator("[data-product]").first().tap();
      await p.evaluate(() => showCashPanel(true, true));
      await p.locator("#guest").fill("Планшетний гість");
      for (const [width, height] of [
        [768, 1024],
        [800, 1280],
        [1024, 768],
        [1280, 800],
      ]) {
        await p.setViewportSize({ width, height });
        assert(
          await p.evaluate(() => {
            let main = document.querySelector("#main"),
              wasHidden = main.hidden;
            main.hidden = true;
            let covered =
              document.body.getBoundingClientRect().height >= innerHeight;
            main.hidden = wasHidden;
            return covered;
          }),
          "theme background must cover the entire tablet viewport",
        );
        await p.waitForTimeout(120);
        let portrait = width < 1000;
        if (portrait) {
          assert(await p.locator(".cash-switch").isVisible());
          await p.evaluate(() => showCashPanel(true, true));
        } else {
          assert(await p.locator(".menu-panel").isVisible());
          assert(await p.locator(".cart-panel").isVisible());
          assert(await p.locator(".cash-switch").isHidden());
        }
        assert.equal(
          await p.locator("#guest").inputValue(),
          "Планшетний гість",
        );
        assert(
          !(await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          )),
        );
        let qty = await p.locator(".qty-button").first().boundingBox();
        assert(qty.width >= 44 && qty.height >= 44);
        await p.evaluate(() => showCashPanel(false, true));
        await p.waitForTimeout(240);
        let cols = await p
          .locator("#tiles .compact-tiles")
          .evaluate(
            (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
          );
        assert(cols >= 3);
        assert(
          !(await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          )),
        );
        if (name === "Chrome" && !native)
          await p.screenshot({
            path: path.join(dir, `tablet-${width}-cash.png`),
          });
        for (const theme of ["dark", "light"]) {
          await p.evaluate((mode) => setCafeTheme(mode), theme);
          await p.waitForTimeout(180);
          assert.equal(
            await p.evaluate(() =>
              document.documentElement.classList.contains("theme-changing"),
            ),
            false,
          );
        }
      }
      await p.setViewportSize({ width: 800, height: 1280 });
      await p.evaluate(() => change("menu"));
      await p.locator("#editorToggle").click();
      await p.waitForTimeout(460);
      assert(
        !(await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        )),
      );
      assert(
        (await p.locator(".product-form-panel").boundingBox()).width > 650,
      );
      if (name === "Chrome" && !native)
        await p.screenshot({
          path: path.join(dir, "tablet-editor.png"),
          fullPage: true,
        });
      await p.evaluate(() => change("calculator"));
      await p.locator("#calcCost").fill("100");
      await p.locator("#calcName-0").fill("Планшетна позиція");
      await p.locator("#calcQty-0").fill("10");
      assert(
        !(await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        )),
      );
      await p.evaluate(() => additionalExpenseDialog());
      await p.locator("#extraCost").waitFor();
      let dialog = await p.locator(".order-dialog-card").boundingBox();
      assert(dialog.width <= 540 && dialog.x >= 0);
      await p.evaluate(() => closeOrderDialog());
      await p.evaluate(() => change("bar"));
      await p.locator(".availability-heading").click();
      await p.waitForTimeout(300);
      assert(
        !(await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        )),
      );
      await p.evaluate(() => change("history"));
      await p.locator(".stats-tabs button").nth(1).click();
      await p.locator("#reportDocument").waitFor();
      await p.waitForTimeout(280);
      assert(
        !(await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        )),
      );
      if (name === "Chrome" && !native)
        await p.screenshot({
          path: path.join(dir, "tablet-report.png"),
          fullPage: true,
        });
      await p.evaluate(() => {
        change("cash");
        toggleDrawer(true);
      });
      await p.waitForTimeout(320);
      await p.locator("#themeToggle").click();
      await p.waitForFunction(
        () => document.documentElement.dataset.theme === "dark",
      );
      let durations = await p
        .locator(".theme-moon")
        .evaluate((e) =>
          getComputedStyle(e).transitionDuration.split(",").map(parseFloat),
        );
      assert(durations.every((n) => n <= 0.115));
      await p.waitForTimeout(180);
      assert.equal(
        await p
          .locator(".theme-moon")
          .evaluate((e) => getComputedStyle(e).opacity),
        "1",
      );
      await p.evaluate(() => {
        setCafeTheme("light");
        setCafeTheme("dark");
        setCafeTheme("light");
      });
      await p.waitForTimeout(180);
      assert.equal(
        await p.evaluate(() => document.documentElement.dataset.theme),
        "light",
      );
      assert.equal(
        await p.evaluate(() =>
          document.documentElement.classList.contains("theme-changing"),
        ),
        false,
      );
      assert.deepEqual(errors, []);
      await p.close();
      console.log(
        "PASS " +
          name +
          " " +
          (native ? "native WebView flags" : "browser") +
          ": tablet portrait/landscape, rotate retains draft, touch targets, editor/calculator/queue/report, fast/reversible theme",
      );
    }
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
