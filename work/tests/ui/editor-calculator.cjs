const { chromium, webkit, base, key, chromeOptions } = require("./helpers.cjs");
const assert = require("assert");
(async () => {
  for (const [name, engine, opts] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    let b = await engine.launch({ headless: true, ...opts }),
      p = await b.newPage({ viewport: { width: 390, height: 844 } }),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + "/?key=" + key + "#menu");
    await p.locator(".editor-product").first().waitFor();
    assert(await p.locator("#browserNotice").isHidden());
    let count = await p.locator(".editor-product").count();
    await p.locator("#editorToggle").click();
    await p.waitForTimeout(250);
    assert.equal(await p.locator("#pcategory").inputValue(), "Їжа");
    assert.equal(await p.locator("#proute").inputValue(), "instant");
    assert.equal(
      await p
        .locator("#form")
        .getByRole("button", { name: "Новий товар", exact: true })
        .count(),
      0,
    );
    await p.locator("#pname").fill("Чернетка");
    await p.locator("#pprice").fill("50");
    await p.evaluate(() => handleAppBack());
    await p.waitForTimeout(280);
    await p.locator(".product-form-panel").waitFor({ state: "hidden" });
    await p.locator("#editorToggle").click();
    await p.waitForTimeout(260);
    assert.equal(await p.locator("#pname").inputValue(), "Чернетка");
    assert.equal(
      await p.locator("#editorToggle").textContent(),
      "Закрити редактор",
    );
    await p.evaluate(() => refreshInPlace());
    await p.waitForTimeout(280);
    assert.equal(await p.locator(".editor-product").count(), count);
    assert.equal(await p.locator("#pname").inputValue(), "Чернетка");
    await p.evaluate(() => change("cash"));
    await p.evaluate(() => change("menu"));
    assert.equal(await p.locator("#pname").inputValue(), "Чернетка");
    await p.locator("#editorToggle").click();
    await p.waitForTimeout(260);
    await p.locator(".product-form-panel").waitFor({ state: "hidden" });
    await p.reload();
    await p.locator(".editor-product").first().waitFor();
    assert.equal(await p.locator(".editor-product").count(), count);
    await p.evaluate(() => change("calculator"));
    await p.evaluate(() => {
      calculatorDraft.rows = [
        { name: "Круасан", qty: "1", price: null, id: null },
        { name: "", qty: "", price: null, id: null },
      ];
      calculatorRows();
      calculatorUpdate();
      calculatorSuggestions(1);
    });
    assert.equal(await p.locator("#calcSuggestions-1 button").count(), 0);
    await p.locator("#calcName-1").fill("Пиріг");
    await p.locator("#calcName-1").press("Enter");
    assert(
      !(await p
        .locator("#calcQty-1")
        .evaluate((e) => e === document.activeElement)),
    );
    await p.locator("#calcPrice-1").fill("55");
    assert.equal(await p.locator(".calc-fixed").count(), 0);
    await p.evaluate(() => {
      window.removePromise = calculatorRemoveRow(1);
      window.removalFrames = document
        .querySelectorAll(".calc-row")[1]
        .getAnimations()
        .map((a) => ({
          duration: a.effect.getTiming().duration,
          frames: a.effect.getKeyframes(),
        }));
    });
    assert(
      await p.evaluate(() =>
        removalFrames.some(
          (a) => a.duration === 220 && a.frames.at(-1).opacity === "0",
        ),
      ),
    );
    await p.evaluate(() => removePromise);
    assert.equal(await p.locator(".calc-row").count(), 1);
    for (let width of [320, 900]) {
      await p.setViewportSize({ width, height: 844 });
      assert(
        !(await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        )),
      );
    }
    assert.deepEqual(errors, []);
    await b.close();
    console.log(
      "PASS " +
        name +
        ": editor draft/back/toggle/defaults, reload products, soft refresh, calculator reverse animation, suggestions and Enter",
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
