const assert = require("node:assert/strict");
const {
  chromium,
  webkit,
  chromeOptions,
} = require("../../../work/tests/ui/helpers.cjs");
const base = process.env.CAFE_CLOUD_TEST_URL || "http://127.0.0.1:8791";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Local server required");
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const b = await engine.launch({ headless: true, ...options });
    try {
      const p = await b.newPage({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      });
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(base);
      await p.locator("#drinkChoice").waitFor();
      assert.equal(
        await p.getByText("Вхід для працівників", { exact: true }).count(),
        0,
      );
      assert.equal(await p.locator("a.brand").getAttribute("href"), "/admin");
      await p.locator("#drinkChoice").click();
      await p.locator('#dialogBody [data-step="1"]').first().click();
      await p.locator('#dialogBody [data-step="1"]').first().click();
      await p.locator("#confirmChoice").click();
      assert.match(await p.locator("#chosenDrinks").innerText(), /× 2/);
      await p.locator("#chosenDrinks button").first().click();
      await p.locator('#dialogBody [data-step="-1"]').first().click();
      await p.locator("#confirmChoice").click();
      const food = p.locator('#foodList [data-step="1"]').first();
      if (await food.count()) await food.click();
      await p.locator("#guestSubmit").click();
      await p.locator(".code").waitFor();
      const code = (await p.locator(".code").innerText()).trim();
      assert.match(code, /^\d{6}$/);
      await p.locator("[data-close]").click();
      assert.equal(await p.locator("#guestSubmit").innerText(), "Показати код");
      await p.locator("#guestSubmit").click();
      assert.equal((await p.locator(".code").innerText()).trim(), code);
      const a = await b.newPage({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      });
      a.on("pageerror", (e) => errors.push(e.message));
      await a.setExtraHTTPHeaders({
        Cookie: "__Host-minicafe_session=" + "1".repeat(64),
      });
      await a.goto(base + "/admin");
      await a.locator("[data-guest-code]").waitFor();
      await a.locator("[data-guest-code]").click();
      await a.locator("#guestCodeInput").fill(code);
      await a.getByRole("button", { name: "Завантажити", exact: true }).click();
      await a.waitForFunction(() => mobileCart && cart.length > 0);
      assert.ok(await a.locator("#sum").innerText());
      await a.locator("#send").click();
      await a.waitForFunction(() => !busy && cart.length === 0);
      assert.equal(
        await a.evaluate(
          async (code) =>
            (
              await fetch("/api/guest-code", {
                method: "POST",
                headers: { ...auth, "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
              })
            ).status,
          code,
        ),
        400,
        "paid code cannot be reused",
      );
      await a.evaluate(() => {
        editorDraft = null;
        change("menu");
      });
      await a.locator("#editorToggle").click();
      await a.locator("#pname").fill("Незбережена чернетка");
      assert.equal(await a.locator(".product-list-panel").isVisible(), false);
      const geometry = await a.locator(".product-form-panel").evaluate((e) => ({
        height: e.clientHeight,
        main: document.querySelector("#main").clientHeight,
        scroll: e.scrollHeight,
      }));
      assert.ok(
        geometry.height > geometry.main * 0.85,
        "full editor fills main",
      );
      const close = a.locator("[data-close-editor]");
      await close.scrollIntoViewIfNeeded();
      const pos = await close.boundingBox(),
        save = await a.locator("#form > .row button.primary").boundingBox();
      assert.ok(Math.abs(pos.y - save.y) < 2, "save and close share row");
      await close.click();
      await a.waitForFunction(
        () => document.querySelector(".product-form-panel").hidden,
      );
      await a.locator("#editorToggle").click();
      assert.equal(
        await a.locator("#pname").inputValue(),
        "Незбережена чернетка",
      );
      await a.evaluate(() => closeProductEditor());
      await a.waitForTimeout(250);
      await a.evaluate(() => change("cash"));
      await a.locator("#cartTab").click();
      const style = await a.locator("#guest").evaluate((e) => {
        e.focus();
        const s = getComputedStyle(e);
        return {
          outline: s.outlineStyle,
          shadow: s.boxShadow,
          border: s.borderWidth,
        };
      });
      assert.equal(style.outline, "none");
      assert.equal(style.border, "1px");
      for (const width of [390, 820, 1280]) {
        await a.setViewportSize({ width, height: 844 });
        await a.evaluate(() => toggleDrawer(true));
        await a.waitForTimeout(350);
        assert.ok(
          await a.evaluate(
            () =>
              Math.abs(
                document.querySelector("#appDrawer").getBoundingClientRect()
                  .bottom - innerHeight,
              ) < 1,
          ),
        );
        await a.evaluate(() => toggleDrawer(false));
        await a.waitForTimeout(350);
      }
      await p.screenshot({ path: ".wrangler/guest-code-" + name + ".png" });
      await p.locator("[data-new-order]").click();
      assert.equal(await p.locator("#guestSubmit").isDisabled(), true);
      assert.deepEqual(errors, []);
      console.log(
        "PASS " +
          name +
          ": public menu choice/code, cashier import, full editor/draft/close row, single name focus, full-height drawer",
      );
    } finally {
      await b.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
