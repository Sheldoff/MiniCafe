const assert = require("assert");
const { chromium, webkit, base, key, chromeOptions } = require("./helpers.cjs");
(async () => {
  for (let [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    let b = await engine.launch({ headless: true, ...options }),
      p = await b.newPage({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      }),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + "/?key=" + key + "#cash");
    await p.locator('[data-product="1"]').waitFor();
    let tile = p.locator('[data-product="1"]');
    await tile.tap();
    await tile.dispatchEvent("pointerdown", {
      pointerType: "mouse",
      button: 0,
      clientX: 20,
      clientY: 20,
    });
    await p.waitForTimeout(350);
    await tile.dispatchEvent("pointerup", { pointerType: "mouse", button: 0 });
    assert.equal(await p.evaluate(() => cart.length), 0);
    assert(await tile.locator(".selected-count").isHidden());
    await p.waitForTimeout(1550);
    await tile.tap();
    await p.locator("#cartTab").tap();
    await p.waitForTimeout(240);
    await p.locator('[data-edit-price="0"]').dispatchEvent("pointerdown", {
      pointerType: "mouse",
      button: 0,
      clientX: 20,
      clientY: 20,
    });
    await p.waitForTimeout(350);
    await p
      .locator('[data-edit-price="0"]')
      .dispatchEvent("pointerup", { pointerType: "mouse", button: 0 });
    await p.locator("#orderPrice").waitFor();
    await p.locator("#orderPrice").fill("50");
    await p.locator("#orderDialog button.primary").click();
    await p.locator("#orderDialog").waitFor({ state: "detached" });
    assert.equal(await p.evaluate(() => cart[0].price), 5000);
    await p.locator("[data-gift-hold]").dispatchEvent("pointerdown", {
      pointerType: "mouse",
      button: 0,
      clientX: 20,
      clientY: 20,
    });
    await p.waitForTimeout(450);
    await p
      .locator("[data-gift-hold]")
      .dispatchEvent("pointerup", { pointerType: "mouse", button: 0 });
    await p.locator("#confirmGift").click();
    assert.equal(await p.evaluate(() => orderTotal()), 0);
    await p.locator("#send").click();
    await p.waitForFunction(() => !busy && cart.length === 0);
    assert.equal(await p.locator('[data-product="1"]').count(), 1);
    await p.evaluate(() => {
      window.keepTile = document.querySelector('[data-product="1"]');
    });
    await p.request.post(base + "/api/order", {
      headers: { "X-Cafe-Key": key },
      data: {
        request: "optimized-" + name + "-" + Date.now(),
        cash_given: 3500,
        card_amount: 0,
        items: [{ id: 1, qty: 1 }],
      },
    });
    await p.evaluate(() => refresh());
    assert(
      await p.evaluate(
        () => keepTile === document.querySelector('[data-product="1"]'),
      ),
    );
    let responses = [];
    p.on("response", (r) => {
      if (r.url().endsWith("/api/state")) responses.push(r.status());
    });
    await p.evaluate(() => refresh());
    assert.equal(
      await p.evaluate(async () => {
        let response = await fetch("/api/state", {
          headers: { ...auth, "If-None-Match": stateETag },
          cache: "no-store",
        });
        return response.status;
      }),
      304,
    );
    await p.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    let count = responses.length;
    await p.waitForTimeout(2300);
    assert.equal(responses.length, count);
    await p.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await p.waitForTimeout(200);
    assert(responses.length > count);
    await p.evaluate(() => change("calculator"));
    await p.locator("#calcCost").fill("100");
    await p.locator("#calcName-0").fill("Тест їжі " + name);
    await p.locator("#calcQty-0").fill("2");
    await p.locator("#calcApply").click();
    await p.locator("#calcConfirmApply").click();
    await p.waitForFunction(() => view === "cash" && !calculatorBusy);
    assert(
      await p.evaluate(
        () =>
          calculatorDraft.rows.length === 1 &&
          calculatorDraft.rows[0].name === "",
      ),
    );
    await p.evaluate(() => change("menu"));
    let editor = p.locator("#editorToggle");
    await editor.click();
    await p.locator("#pname").fill("Чернетка назад");
    await p.goBack();
    await p.locator(".product-form-panel").waitFor({ state: "hidden" });
    await editor.click();
    assert.equal(await p.locator("#pname").inputValue(), "Чернетка назад");
    let access = await (
      await p.request.get(base + "/api/access", {
        headers: { "X-Cafe-Key": key },
      })
    ).json();
    await p.goto(base + "/?key=" + access.bar + "#menu");
    await p.waitForFunction(() => hasServerState && view === "bar");
    assert.equal(await p.locator(".drawer-links [data-view]").count(), 1);
    assert.equal(
      await p.evaluate(() =>
        data.orders.flatMap((o) => o.items).some((i) => i.route !== "bar"),
      ),
      false,
    );
    await p.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await p.evaluate(
        () =>
          motion(
            document.querySelector("#connection"),
            [{ opacity: 0 }, { opacity: 1 }],
            220,
          ).effect.getTiming().duration,
      ),
      0,
    );
    assert.deepEqual(errors, []);
    await b.close();
    console.log(
      "PASS " +
        name +
        ": holds/custom price/gifts, stable keyed DOM/304/pause polling, calculator apply/reset, browser back draft, restricted-role UI, reduced motion",
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
