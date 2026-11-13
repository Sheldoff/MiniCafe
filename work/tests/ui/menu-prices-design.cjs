const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium, webkit, chromeOptions, base, key } = require("./helpers.cjs");
const { contrast } = require("./contrast.cjs");
const online = process.env.CAFE_MENU_ONLINE === "1";
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
        }),
        errors = [],
        writes = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (r.method() === "POST" && r.url().startsWith(url + "/api/"))
          writes.push(r.url());
      });
      if (online)
        await page.setExtraHTTPHeaders({
          Cookie: "__Host-minicafe_session=" + "1".repeat(64),
        });
      await page.goto(
        url + (online ? "/admin#menu" : "/?key=" + key + "#menu"),
      );
      await page.waitForFunction(
        () => typeof hasServerState !== "undefined" && hasServerState,
      );
      await page.locator(".editor-product").first().waitFor();
      const products = await page.evaluate(() => JSON.stringify(data.products));
      for (const palette of ["coffee", "standard"])
        for (const mode of ["light", "dark"])
          for (const width of [1440, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.evaluate(
              ({ palette, mode }) => {
                setCafePalette(palette, false);
                setCafeTheme(mode, false, false);
              },
              { palette, mode },
            );
            await page.waitForTimeout(250);
            for (const stage of ["catalog", "editor"]) {
              if (stage === "editor") {
                await page.locator(".editor-product").first().click();
                await page.waitForTimeout(250);
                assert(await page.locator(".product-list-panel").isHidden());
                for (const id of [
                  "pname",
                  "pcategory",
                  "proute",
                  "pprice",
                  "pstock",
                ])
                  assert(await page.locator("#" + id).isVisible(), id);
                const save = await page
                    .locator(".editor-save-actions .primary")
                    .boundingBox(),
                  close = await page
                    .locator("[data-close-editor]")
                    .boundingBox();
                assert(Math.abs(save.y - close.y) < 2, "save/close share row");
              }
              assert(
                await page.evaluate(
                  () => document.documentElement.scrollWidth <= innerWidth,
                ),
                name + " " + stage + "/" + width + " page overflow",
              );
              assert(
                await page
                  .locator(
                    stage === "editor"
                      ? ".product-form-panel"
                      : ".product-list-panel",
                  )
                  .evaluate((e) => e.scrollWidth <= e.clientWidth),
                name + " " + stage + "/" + width + " inner overflow",
              );
              assert.deepEqual(
                (await contrast(page, "#main")).problems,
                [],
                name +
                  " " +
                  stage +
                  "/" +
                  palette +
                  "/" +
                  mode +
                  "/" +
                  width +
                  " contrast",
              );
              for (const button of await page
                .locator(".menu-editor-grid button:visible")
                .all())
                assert(
                  (await button.boundingBox()).height >= 44,
                  "touch target",
                );
              if (palette === "coffee" && [1440, 390].includes(width))
                await page.screenshot({
                  path: path.join(
                    __dirname,
                    "../..",
                    `menu-prices-${online ? "online" : "android"}-${name}-${stage}-${mode}-${width}.png`,
                  ),
                });
              if (stage === "editor") {
                await page.locator("[data-close-editor]").click();
                await page
                  .locator(".product-form-panel")
                  .waitFor({ state: "hidden" });
              }
            }
          }
      const firstName = await page
        .locator(".editor-product-name")
        .first()
        .textContent();
      await page.locator("#productSearch").fill(firstName);
      await page.waitForTimeout(300);
      assert.equal(
        await page.locator(".editor-product").count(),
        await page.evaluate((q) => editorMatchingProducts(q).length, firstName),
      );
      assert.equal(
        await page.locator("#editorProductCount").textContent(),
        await page.evaluate((q) => editorProductCount(q), firstName),
      );
      await page.locator("#productSearch").fill("No matching menu item 771290");
      await page.locator(".menu-catalog-empty").waitFor();
      await page.locator("#productSearch").fill("");
      await page.locator(".editor-product").first().waitFor();
      await page.waitForTimeout(300);
      page.once("dialog", (d) => d.dismiss());
      await page.locator(".editor-product button.remove").first().click();
      assert(
        await page.locator(".product-form-panel").isHidden(),
        "delete must not open editor",
      );
      await page.locator(".editor-product").first().focus();
      await page.keyboard.press("Enter");
      await page.locator("#pname").fill("Draft without saving");
      await page.evaluate(() => handleAppBack());
      await page.locator(".product-form-panel").waitFor({ state: "hidden" });
      await page.locator("#editorToggle").click();
      assert.equal(
        await page.locator("#pname").inputValue(),
        "Draft without saving",
      );
      assert.equal(
        await page.evaluate(() => JSON.stringify(data.products)),
        products,
        "design must preserve catalog data",
      );
      assert.deepEqual(writes, [], "design checks must not write menu");
      assert.deepEqual(errors, []);
      console.log(
        "PASS " +
          name +
          (online ? " online" : " Android") +
          ": menu/editor responsive themes, contrast, touch targets, search/count, keyboard, delete isolation and preserved draft/data",
      );
    } finally {
      await browser.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
