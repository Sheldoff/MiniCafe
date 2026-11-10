const assert = require("assert"),
  fs = require("fs"),
  path = require("path");
const { chromium, webkit, base, key, chromeOptions } = require("./helpers.cjs");
const { contrast } = require("./contrast.cjs");

async function rowStates(page, selector, reports, label) {
  let row = page.locator(selector).first();
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await page.waitForTimeout(160);
  reports.push({ view: label + "-hover", ...(await contrast(page, selector)) });
  await page.mouse.down();
  await page.waitForTimeout(160);
  assert(await row.evaluate((e) => e.matches(":active")));
  reports.push({
    view: label + "-pressed",
    ...(await contrast(page, selector)),
  });
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await page.keyboard.press("Tab");
  await row.focus();
  await page.waitForTimeout(160);
  assert(await row.evaluate((e) => e.matches(":focus-visible")));
  reports.push({
    view: label + "-keyboard",
    ...(await contrast(page, selector)),
  });
}
(async () => {
  let screenshotDir = path.dirname(
    process.env.CAFE_SCREENSHOT || "work/tests/results/theme.png",
  );
  fs.mkdirSync(screenshotDir, { recursive: true });
  for (let [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    let b = await engine.launch({ headless: true, ...options }),
      p = await b.newPage({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      }),
      errors = [],
      reports = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + "/?key=" + key + "#cash");
    await p.locator('[data-product="1"]').waitFor();
    assert.equal(
      await p.evaluate(() => document.documentElement.dataset.theme),
      "light",
    );
    await p.locator('[data-product="1"]').tap();
    await p.locator("#cartTab").tap();
    await p.locator("#guest").fill("Збережений гість");
    await p.locator("#drawerToggle").tap();
    await p.locator("#themeToggle").click();
    await p.waitForTimeout(420);
    assert.equal(
      await p.locator("#themeToggle").getAttribute("aria-checked"),
      "true",
    );
    assert.equal(
      await p.locator("#themeToggle").getAttribute("aria-label"),
      "Увімкнути світлу тему",
    );
    assert.equal(
      await p.evaluate(() => localStorage.getItem("minicafe-theme")),
      "dark",
    );
    await p.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".theme-moon")).opacity === "1",
    );
    assert.equal(await p.locator("#guest").inputValue(), "Збережений гість");
    assert.equal(await p.evaluate(() => cart.length), 1);
    reports.push({ view: "drawer", ...(await contrast(p)) });
    if (name === "Chrome")
      await p.screenshot({ path: path.join(screenshotDir, "dark-drawer.png") });
    await p.evaluate(() => toggleDrawer(false));
    await p.waitForTimeout(350);
    await p.locator("#received").fill("100");
    await p.locator("#received").blur();
    await p.waitForTimeout(400);
    reports.push({ view: "cash-order", ...(await contrast(p)) });
    if (name === "Chrome")
      await p.screenshot({ path: path.join(screenshotDir, "dark-order.png") });
    await p.evaluate(() => showCashPanel(false));
    await p.waitForTimeout(280);
    reports.push({ view: "menu-tiles", ...(await contrast(p)) });
    if (name === "Chrome")
      await p.screenshot({ path: path.join(screenshotDir, "dark-menu.png") });
    await p.evaluate(() => toggleDrawer(true));
    await p.waitForTimeout(320);
    await p.locator("#themeToggle").click();
    assert(
      await p.locator(".theme-sun").evaluate((e) =>
        getComputedStyle(e)
          .transitionDuration.split(",")
          .every((n) => parseFloat(n) > 0 && parseFloat(n) <= 0.115),
      ),
    );
    await p.evaluate(() => {
      toggleCafeTheme();
      toggleCafeTheme();
      toggleCafeTheme();
      setCafeTheme("dark");
    });
    await p.waitForTimeout(450);
    assert.equal(
      await p.evaluate(() => document.documentElement.dataset.theme),
      "dark",
    );
    await p.reload();
    await p.locator('[data-product="1"]').waitFor();
    assert.equal(
      await p.evaluate(() => document.documentElement.dataset.theme),
      "dark",
    );
    assert.equal(
      await p.evaluate(() =>
        document.documentElement.classList.contains("theme-changing"),
      ),
      false,
    );
    await p.evaluate(() => change("menu"));
    await p.locator("#editorToggle").click();
    await p.waitForTimeout(460);
    assert.equal(
      await p
        .locator(".product-form-panel")
        .evaluate((e) => getComputedStyle(e).paddingTop),
      "16px",
    );
    await p.locator("#pname").fill("Тест нової категорії " + name);
    await p.locator("#pcategory").fill("Десерти");
    await p.locator("#pprice").fill("50");
    reports.push({ view: "editor", ...(await contrast(p)) });
    if (name === "Chrome")
      await p.screenshot({ path: path.join(screenshotDir, "dark-editor.png") });
    await p.locator("#form > .row button.primary").click();
    await p.waitForFunction(
      () =>
        !productSaving && document.querySelector(".product-form-panel").hidden,
    );
    let samples = await p.evaluate(
      () =>
        new Promise((resolve) => {
          let result = [],
            start = performance.now();
          openProductEditor(true);
          function frame() {
            result.push({
              t: performance.now() - start,
              h: document
                .querySelector(".product-form-panel")
                .getBoundingClientRect().height,
              opacity: Number(
                getComputedStyle(document.querySelector(".product-form-panel"))
                  .opacity,
              ),
            });
            if (performance.now() - start > 460) resolve(result);
            else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        }),
    );
    assert(samples.some((v) => v.t > 250 && v.h > 10));
    assert(
      samples.some((v) => v.opacity > 0 && v.opacity < 1),
      "editor fades in",
    );
    assert(await p.locator(".product-form-panel").evaluate((e) => !e.hidden));
    let closing = await p.evaluate(
      () =>
        new Promise((resolve) => {
          let result = [],
            start = performance.now();
          closeProductEditor(true);
          function frame() {
            let el = document.querySelector(".product-form-panel");
            result.push({
              t: performance.now() - start,
              h: el.getBoundingClientRect().height,
              hidden: el.hidden,
              opacity: Number(getComputedStyle(el).opacity),
            });
            if (performance.now() - start > 460) resolve(result);
            else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        }),
    );
    let lastVisible = closing.filter((v) => !v.hidden).at(-1);
    // The shared full-height editor fades out rather than resizing its fields.
    assert(closing.at(-1).hidden, "editor finishes closing");
    assert(
      !lastVisible || closing.some((v) => !v.hidden && v.opacity < 1),
      "editor fades before hiding",
    );
    await p.evaluate(() => {
      openProductEditor(true);
      setTimeout(() => closeProductEditor(true), 60);
      setTimeout(() => openProductEditor(true), 120);
    });
    await p.waitForTimeout(650);
    assert(await p.locator(".product-form-panel").isVisible());
    for (let i = 0; i < 8; i++)
      await p.request.post(base + "/api/product", {
        headers: { "X-Cafe-Key": key },
        data: {
          name: "Категорійний тест " + name + " " + i,
          category: i % 2 ? "Випічка" : "Сувеніри",
          route: "instant",
          active: true,
          price: 5000,
        },
      });
    await p.request.post(base + "/api/product", {
      headers: { "X-Cafe-Key": key },
      data: {
        name: "Не пропонувати напій " + name,
        category: "Напої",
        route: "instant",
        active: true,
        price: 5000,
      },
    });
    await p.evaluate(async () => {
      await refresh();
      change("calculator");
    });
    await p.locator("#calcName-0").focus();
    await p.waitForTimeout(100);
    assert((await p.locator("#calcSuggestions-0 button").count()) > 6);
    assert(
      (await p.locator("#calcSuggestions-0").innerText()).includes(
        "Тест нової категорії " + name,
      ),
    );
    assert(
      !(await p.locator("#calcSuggestions-0").innerText()).includes(
        "Не пропонувати напій",
      ),
    );
    assert(
      !(await p.locator("#calcSuggestions-0").innerText()).includes("Еспресо"),
    );
    await p.locator("#calcCost").fill("100");
    await p.locator("#calcName-0").fill("Тест нової категорії " + name);
    await p.locator("#calcQty-0").fill("2");
    await p.locator("#calcQty-0").blur();
    await p.waitForTimeout(250);
    reports.push({ view: "calculator", ...(await contrast(p)) });
    if (name === "Chrome")
      await p.screenshot({
        path: path.join(screenshotDir, "dark-calculator.png"),
      });
    await p.evaluate(() => additionalExpenseDialog());
    await p.locator("#extraCost").fill("10");
    reports.push({ view: "dialog", ...(await contrast(p)) });
    if (name === "Chrome")
      await p.screenshot({ path: path.join(screenshotDir, "dark-dialog.png") });
    await p.evaluate(() => closeOrderDialog());
    await p.request.post(base + "/api/order", {
      headers: { "X-Cafe-Key": key },
      data: {
        request: "theme-" + name + "-" + Date.now(),
        guest: "Тест теми",
        cash_given: 8000,
        card_amount: 0,
        items: [
          { id: 1, qty: 1 },
          { id: 5, qty: 1 },
        ],
      },
    });
    await p.evaluate(async () => {
      await refresh();
      window.statsMotion = [];
      let original = Element.prototype.animate;
      Element.prototype.animate = function (f, o) {
        if (this.classList.contains("stats-pane")) statsMotion.push(f);
        return original.call(this, f, o);
      };
      change("history");
    });
    await p.locator(".history-record").first().waitFor();
    assert(
      await p.evaluate(() =>
        statsMotion.every((frames) => !frames.some((f) => f.transform)),
      ),
    );
    await p.locator(".history-record summary").first().click();
    await p.waitForTimeout(350);
    reports.push({ view: "history", ...(await contrast(p)) });
    await p.locator(".stats-tabs button").nth(1).click();
    await p.locator("#reportDocument").waitFor();
    await p.waitForTimeout(400);
    assert((await p.evaluate(() => statsMotion.length)) > 0);
    reports.push({ view: "report", ...(await contrast(p)) });
    if (name === "Chrome")
      await p.screenshot({
        path: path.join(screenshotDir, "dark-report.png"),
        fullPage: true,
      });
    await p.evaluate(() => change("bar"));
    await p.locator("[data-order]").first().waitFor();
    await p.locator(".availability-heading").click();
    await p.waitForTimeout(330);
    reports.push({ view: "bar", ...(await contrast(p)) });
    if (name === "Chrome")
      await p.screenshot({ path: path.join(screenshotDir, "dark-bar.png") });
    await p.evaluate(() => change("delivery"));
    await p.locator("[data-order]").first().waitFor();
    await p.waitForTimeout(200);
    reports.push({ view: "delivery", ...(await contrast(p)) });
    for (let width of [320, 900]) {
      await p.setViewportSize({ width, height: 844 });
      assert(
        !(await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        )),
      );
    }
    await p.evaluate(() => change("developer"));
    await p.waitForTimeout(220);
    reports.push({ view: "developer-and-card", ...(await contrast(p)) });
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.evaluate(() => setCafeTheme("light"));
    assert.equal(
      await p.evaluate(() => document.documentElement.dataset.theme),
      "light",
    );
    assert.equal(
      await p
        .locator(".theme-sun")
        .evaluate((e) => getComputedStyle(e).transitionDuration),
      "0s",
    );
    assert.deepEqual(errors, []);
    // Explicit interactive states: touch can leave :hover active after opening
    // an editor, while keyboard focus and a held press have different CSS rules.
    let interactive = await b.newPage({
      viewport: { width: 1280, height: 1000 },
    });
    await interactive.goto(base + "/?key=" + key + "#menu");
    await interactive.waitForFunction(() => hasServerState);
    for (const theme of ["dark", "light"]) {
      await interactive.evaluate((theme) => {
        setCafeTheme(theme);
        change("menu");
        if (!document.querySelector(".product-form-panel").hidden)
          closeProductEditor(true);
      }, theme);
      await interactive.waitForTimeout(300);
      await rowStates(
        interactive,
        ".editor-product",
        reports,
        theme + "-product",
      );
      await interactive.locator(".editor-product").first().click();
      await interactive.waitForTimeout(470);
      assert(await interactive.locator("#pid").inputValue());
      if (theme === "dark") {
        assert.equal(
          await interactive
            .locator("#picturePreview")
            .evaluate((e) => e.classList.contains("has-image")),
          false,
        );
        reports.push({
          view: "dark-existing-product-edit",
          ...(await contrast(interactive)),
        });
        if (name === "Chrome")
          await interactive.screenshot({
            path: path.join(screenshotDir, "dark-existing-product.png"),
          });
        await interactive.evaluate(() => {
          picturePreview(
            "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>",
          );
          captureEditorDraft();
          menu();
        });
        assert.equal(
          await interactive
            .locator("#picturePreview")
            .evaluate((e) => e.classList.contains("has-image")),
          true,
        );
        await interactive.evaluate(() => removePicture());
        assert.equal(
          await interactive
            .locator("#picturePreview")
            .evaluate((e) => e.classList.contains("has-image")),
          false,
        );
      }
      await interactive.evaluate(() => {
        change("calculator");
        data.additional_expenses = [
          { id: "theme-fixture", note: "Тест додаткової витрати", cost: 5000 },
        ];
        calculatorDraft.extraIds = ["theme-fixture"];
        calculatorExtras();
      });
      await interactive.waitForTimeout(300);
      await rowStates(
        interactive,
        ".calc-extra-row",
        reports,
        theme + "-expense",
      );
    }
    await interactive.close();
    fs.writeFileSync(
      path.join(screenshotDir, "contrast-" + name + ".json"),
      JSON.stringify(reports, null, 2),
    );
    let problems = reports.flatMap((r) =>
      r.problems.map((e) => ({ view: r.view, ...e })),
    );
    console.log(
      name +
        " contrast checked " +
        reports.reduce((n, r) => n + r.checked, 0) +
        " texts",
    );
    if (problems.length) {
      console.log(JSON.stringify(problems, null, 2));
      throw Error("Contrast failures: " + problems.length);
    }
    await b.close();
    console.log(
      "PASS " +
        name +
        ": saved theme/no reload flash/icon transition, all dark screens/contrast, smooth/reversible disclosure, stable first statistics, all non-drink categories, reduced motion/responsive",
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
