const assert = require("assert");
const { chromium, webkit, base, key, chromeOptions } = require("./helpers.cjs");
async function swipe(
  page,
  selector,
  dx,
  dy = 0,
  { cancel = false, delay = 15, multi = false } = {},
) {
  await page
    .locator(selector)
    .first()
    .evaluate(
      async (target, { dx, dy, cancel, delay, multi }) => {
        const rect = target.getBoundingClientRect();
        const x = Math.max(
            35,
            Math.min(innerWidth - 35, rect.x + rect.width / 2),
          ),
          y = rect.y + Math.min(30, rect.height / 2);
        const fire = (type, px, py, ended = false) => {
          const touch = { identifier: 7, target, clientX: px, clientY: py };
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            touches: {
              value: ended
                ? []
                : multi
                  ? [touch, { ...touch, identifier: 8 }]
                  : [touch],
            },
            changedTouches: { value: [touch] },
          });
          target.dispatchEvent(event);
        };
        fire("touchstart", x, y);
        for (const part of [0.2, 0.5, 1]) {
          await new Promise((r) => setTimeout(r, delay));
          fire("touchmove", x + dx * part, y + dy * part);
        }
        fire(cancel ? "touchcancel" : "touchend", x + dx, y + dy, true);
      },
      { dx, dy, cancel, delay, multi },
    );
  await page.waitForTimeout(390);
}
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const b = await engine.launch({ headless: true, ...options });
    const p = await b.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + "/?key=" + key + "#cash");
    await p.waitForFunction(() => hasServerState);
    await p.evaluate(() => {
      clearTimeout(pollTimer);
      add(data.products[0].id);
    });
    const snapshot = await p.evaluate(() => JSON.stringify(cart));
    await swipe(p, "[data-product]", -140);
    assert.equal(await p.evaluate(() => mobileCart), true);
    assert.equal(await p.locator("#orderDialog").count(), 0);
    assert.equal(await p.evaluate(() => JSON.stringify(cart)), snapshot);
    await p.locator("#guest").fill("Свайп гість");
    await swipe(p, "#guest", 150);
    assert.equal(await p.evaluate(() => mobileCart), true);
    await p.locator("#guest").blur();
    await swipe(p, ".cart-name", 160);
    assert.equal(await p.evaluate(() => mobileCart), false);
    assert.equal(await p.locator("#guest").inputValue(), "Свайп гість");
    await swipe(p, "[data-product]", 15);
    assert.equal(await p.evaluate(() => mobileCart), false);
    await swipe(p, "[data-product]", 20, 140);
    assert.equal(await p.evaluate(() => mobileCart), false);
    await swipe(p, "[data-product]", -140, 0, { cancel: true });
    assert.equal(await p.evaluate(() => mobileCart), false);
    await swipe(p, "[data-product]", -140, 0, { multi: true });
    assert.equal(await p.evaluate(() => mobileCart), false);
    assert.equal(await p.evaluate(() => JSON.stringify(cart)), snapshot);
    // After a swipe/cancel the original tap and hold paths still work.
    await p.locator("[data-product]").first().tap();
    assert.equal(await p.evaluate(() => cart[0].qty), 2);
    await p.locator("[data-product]").first().dispatchEvent("pointerdown", {
      pointerType: "mouse",
      button: 0,
      clientX: 80,
      clientY: 200,
    });
    await p.waitForTimeout(340);
    await p
      .locator("[data-product]")
      .first()
      .dispatchEvent("pointerup", { pointerType: "mouse", button: 0 });
    assert.equal(await p.evaluate(() => cart[0].qty), 1);
    if (name === "Chrome") {
      const session = await p.context().newCDPSession(p);
      const rect = await p.locator("[data-product]").nth(1).boundingBox();
      const x = rect.x + rect.width * 0.65,
        y = rect.y + Math.min(35, rect.height / 2);
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (const delta of [25, 70, 130]) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x - delta, y }],
        });
        await p.waitForTimeout(20);
      }
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await p.waitForFunction(() => mobileCart);
      await p.waitForFunction(() => !document.querySelector(".cash-swiping"));
      assert.equal(
        await p.evaluate(() => cart[0].qty),
        1,
        "real touch must not edit quantities",
      );
      await session.detach();
      await swipe(p, ".cart-name", 160);
    }
    await p.setViewportSize({ width: 800, height: 1000 });
    await p.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await swipe(p, "[data-product]", -180);
    assert.equal(await p.evaluate(() => mobileCart), true);
    await swipe(p, ".cart-name", 180);
    assert.equal(await p.evaluate(() => mobileCart), false);
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await swipe(p, "[data-product]", -180);
    assert.equal(await p.evaluate(() => mobileCart), false);
    assert.equal(await p.locator(".cash-swipe-ghost").count(), 0);
    await p.evaluate(() => change("developer"));
    assert.equal(
      (await p.locator(".support-card-number").innerText()).replace(/\s/g, ""),
      "4441111056584349",
    );
    await p.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text) => (window.copiedCard = text) },
      }),
    );
    await p
      .getByRole("button", { name: "Скопіювати номер картки", exact: true })
      .click();
    assert.equal(await p.evaluate(() => copiedCard), "4441111056584349");
    for (const theme of ["light", "dark"]) {
      await p.evaluate((theme) => {
        setCafeTheme(theme);
        toggleDrawer(true);
      }, theme);
      await p.waitForTimeout(350);
      assert.notEqual(
        await p.evaluate(() => document.activeElement?.id),
        "drawerRefresh",
      );
      const selected = p.locator('.drawer-tools [data-view="developer"]');
      assert(await selected.evaluate((e) => e.classList.contains("selected")));
      assert.equal(
        await selected.evaluate((e) => getComputedStyle(e).color),
        theme === "light" ? "rgb(255, 255, 255)" : "rgb(22, 38, 25)",
      );
      assert.equal(
        await selected.evaluate((e) => getComputedStyle(e).backgroundColor),
        theme === "light" ? "rgb(33, 89, 67)" : "rgb(179, 217, 164)",
      );
      await p.evaluate(() => toggleDrawer(false));
      await p.waitForTimeout(330);
    }
    await p.evaluate(() => toggleDrawer(true, true));
    assert.equal(
      await p.evaluate(() => document.activeElement.getAttribute("aria-label")),
      "Закрити меню",
    );
    await p.waitForTimeout(320);
    await p.evaluate(() => {
      window.serverTransition = openServerSettings();
      window.viewBeforeServer = view;
    });
    assert.equal(
      await p.evaluate(() => viewBeforeServer),
      "developer",
      "close drawer before changing page",
    );
    await p.evaluate(() => serverTransition);
    assert.equal(await p.evaluate(() => view), "server");
    await p.waitForTimeout(250);
    assert.equal(
      await p.locator("#main").evaluate((e) => getComputedStyle(e).opacity),
      "1",
    );
    assert.deepEqual(errors, []);
    await b.close();
    console.log(
      "PASS " +
        name +
        ": cashier swipe directions, vertical/edit/short/cancel/multitouch guards, quantities/guest/hold preserved, tablet/desktop layout, card copy, developer selection, pointer/keyboard focus, sequenced server transition" +
        (name === "Chrome" ? " and real CDP touch" : ""),
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
