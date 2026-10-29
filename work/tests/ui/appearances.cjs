const assert = require("assert");
const { chromium, webkit, base, key, chromeOptions } = require("./helpers.cjs");
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    let b = await engine.launch({ headless: true, ...options });
    for (const route of ["cash", "calculator", "menu", "history", "bar"]) {
      let p = await b.newPage({
          viewport: { width: 390, height: 844 },
          hasTouch: true,
        }),
        errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.addInitScript(() => {
        window.transitions = [];
        const native = Element.prototype.animate;
        Element.prototype.animate = function (frames, opts) {
          transitions.push({
            id: this.id,
            cls: this.className,
            frames,
            at: performance.now(),
            height: this.getBoundingClientRect().height,
          });
          return native.call(this, frames, opts);
        };
      });
      let first = true;
      await p.route("**/api/state", async (r) => {
        if (first) {
          first = false;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        await r.continue();
      });
      await p.goto(base + "/?key=" + key + "#" + route);
      await p.waitForFunction(
        () => hasServerState && !document.querySelector("#main").hidden,
      );
      if (route === "history") await p.locator(".stats-pane").waitFor();
      await p.waitForTimeout(250);
      let cold = await p.evaluate(() => transitions);
      assert.equal(
        cold.filter((t) => t.id === "main").length,
        1,
        "one data-ready page entrance on " + route,
      );
      assert(
        !cold.some(
          (t) =>
            t.cls === "calc-row" && t.frames.some((f) => f.height === "0px"),
        ),
        "no hidden/zero-height child animation on first calculator entry",
      );
      assert(
        !cold.some(
          (t) =>
            t.cls === "card" && t.frames[0].transform === "translateY(-14px)",
        ),
        "no duplicate initial queue arrivals",
      );
      assert.equal(
        await p.locator("#main").evaluate((e) => getComputedStyle(e).opacity),
        "1",
      );
      assert.equal(
        await p.locator("#main").evaluate((e) => getComputedStyle(e).transform),
        "none",
      );
      if (route === "calculator") {
        await p.evaluate(() => {
          cart = [
            {
              ...data.products.find((p) => p.route === "bar"),
              qty: 1,
              note: "",
            },
          ];
          change("cash");
          showCashPanel(true, true);
        });
        await p.waitForTimeout(250);
        await p.evaluate(() => editOrderPrice(0));
        assert(
          await p
            .locator("#orderDialog")
            .evaluate(
              (e) => e.dialogMotion?.effect.getTiming().duration === 140,
            ),
        );
        await p.waitForTimeout(200);
        assert.equal(
          await p.evaluate(() => {
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Escape" }),
            );
            return document.querySelector("#orderDialog")?.dataset.closing;
          }),
          "true",
        );
        await p.locator("#orderDialog").waitFor({ state: "detached" });
        await p.evaluate(() => {
          additionalExpenseDialog();
          closeOrderDialog();
          giftOrderDialog();
          editOrderPrice(0);
        });
        assert.equal(await p.locator("#orderDialog").count(), 1);
        await p.evaluate(() => closeOrderDialog());
        await p.locator("#orderDialog").waitFor({ state: "detached" });
        await p.evaluate(() => giftOrderDialog());
        await p.locator("#confirmGift").click();
        await p.locator("#orderDialog").waitFor({ state: "detached" });
        assert(await p.evaluate(() => giftOrder));
        await p.evaluate(() => change("calculator"));
        await p.locator("#calcCost").fill("100");
        await p.locator("#calcName-0").fill("Поява " + name);
        await p.locator("#calcQty-0").fill("2");
        await p.evaluate(() => calculatorConfirm());
        assert.equal(await p.locator("#orderDialog").count(), 1);
        await p.evaluate(() => closeOrderDialog());
        await p.locator("#orderDialog").waitFor({ state: "detached" });
        await p.locator("#calcName-0").fill("");
        await p.evaluate(() => {
          calculatorSuggestions(0);
          setTimeout(
            () => hideSuggestions(document.querySelector("#calcSuggestions-0")),
            30,
          );
          setTimeout(() => calculatorSuggestions(0), 60);
          setTimeout(
            () => hideSuggestions(document.querySelector("#calcSuggestions-0")),
            90,
          );
        });
        await p.waitForFunction(
          () => document.querySelector("#calcSuggestions-0").hidden,
        );
        assert.equal(
          await p
            .locator("#calcSuggestions-0")
            .evaluate((e) => e.style.overflow),
          "",
        );
        await p.evaluate(() => {
          calculatorSuggestions(0);
          calculatorSuggestions(0);
        });
        await p.waitForFunction(
          () =>
            !document.querySelector("#calcSuggestions-0").hidden &&
            document.querySelector("#calcSuggestions-0").style.overflow === "",
        );
        assert.equal(
          await p
            .locator("#calcSuggestions-0")
            .evaluate((e) => getComputedStyle(e).overflowY),
          "auto",
          "typing during opening keeps suggestions scrollable",
        );
        await p.evaluate(() =>
          hideSuggestions(document.querySelector("#calcSuggestions-0")),
        );
        await p.evaluate(() => {
          const native = window.setTimeout;
          window.setTimeout = (fn, ms, ...args) =>
            native(fn, ms === 5000 ? 220 : ms, ...args);
          window.restoreTimer = () => (window.setTimeout = native);
          toast("Перше повідомлення");
        });
        await p.waitForTimeout(60);
        let rect = await p.locator("#toast").boundingBox();
        assert(
          Math.abs(rect.x + rect.width / 2 - 195) < 2,
          "toast keeps horizontal centering during animation",
        );
        await p.waitForTimeout(180);
        await p.evaluate(() => toast("Нове повідомлення"));
        await p.waitForTimeout(100);
        assert.equal(
          await p.locator("#toast").innerText(),
          "Нове повідомлення",
        );
        assert(await p.locator("#toast").isVisible());
        await p.waitForTimeout(300);
        await p.locator("#toast").waitFor({ state: "hidden", timeout: 3000 });
        await p.evaluate(() => restoreTimer());
        await p.evaluate(() => {
          connectionNotice("Перевірка", "Тест");
          setTimeout(() => setNoticeVisible(false), 30);
          setTimeout(() => setNoticeVisible(true), 60);
          setTimeout(() => setNoticeVisible(false), 90);
        });
        await p.waitForFunction(
          () => document.querySelector("#browserNotice").hidden,
        );
        assert.equal(
          await p.locator("#browserNotice").evaluate((e) => e.style.overflow),
          "",
        );
        await p.evaluate(() => change("menu"));
        await p.locator("#editorToggle").click();
        await p.waitForTimeout(450);
        await p.locator("#pcategory").focus();
        await p.locator("#categorySuggestions button").first().waitFor();
        await p.evaluate(() => {
          suggestCategories("Неіснуюча");
          setTimeout(() => suggestCategories(""), 40);
        });
        await p.waitForTimeout(240);
        assert(await p.locator("#categorySuggestions").isVisible());
        await p.emulateMedia({ reducedMotion: "reduce" });
        await p.evaluate(() => additionalExpenseDialog());
        assert.equal(
          await p
            .locator(".order-dialog-card")
            .evaluate((e) => e.dialogMotion.effect.getTiming().duration),
          0,
        );
        await p.evaluate(() => closeOrderDialog());
        await p.locator("#orderDialog").waitFor({ state: "detached" });
      }
      assert.deepEqual(errors, []);
      await p.close();
    }
    let native = await b.newPage({
      userAgent: "MiniCafeAndroid",
      viewport: { width: 800, height: 1280 },
    });
    await native.addInitScript(() => {
      window.entries = 0;
      let original = Element.prototype.animate;
      Element.prototype.animate = function (f, o) {
        if (this.id === "main") entries++;
        return original.call(this, f, o);
      };
    });
    await native.goto(base + "/?key=" + key + "#calculator");
    await native.waitForFunction(() => hasServerState);
    assert.equal(
      await native.evaluate(() => entries),
      0,
      "Android first reveal belongs to native WebView",
    );
    await native.evaluate(() => change("menu"));
    assert.equal(await native.evaluate(() => entries), 1);
    await native.close();
    await b.close();
    console.log(
      "PASS " +
        name +
        ": cold pages/data-ready entrance, no initial nested/zero-height animations, all app dialogs/open-close-replace/back, suggestion reversal, centered toast interruption, reduced motion and one native first reveal",
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
