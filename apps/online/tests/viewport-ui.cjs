const assert = require("node:assert/strict");
const {
  chromium,
  webkit,
  chromeOptions,
} = require("../../../work/tests/ui/helpers.cjs");
async function swipe(page, dx) {
  await page.evaluate(async (dx) => {
    // Deliberately start on the blank grid surface, outside both panels.
    const target = document.querySelector(".cash-grid");
    for (const [type, part] of [
      ["touchstart", 0],
      ["touchmove", 0.5],
      ["touchend", 1],
    ]) {
      const touch = {
        identifier: 7,
        target,
        clientX: innerWidth / 2 + dx * part,
        clientY: innerHeight - 30,
      };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: type === "touchend" ? [] : [touch] },
        changedTouches: { value: [touch] },
      });
      target.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 20));
    }
  }, dx);
  await page.waitForTimeout(450);
}
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
      await p.setExtraHTTPHeaders({
        Cookie: "__Host-minicafe_session=" + "1".repeat(64),
      });
      await p.goto("http://127.0.0.1:8791/admin");
      await p.locator("[data-product]").first().waitFor();
      assert.match(
        await p.locator('meta[name="viewport"]').getAttribute("content"),
        /viewport-fit=cover/,
      );
      for (const width of [390, 820, 1280]) {
        await p.setViewportSize({ width, height: 844 });
        await p.evaluate(() => change("cash"));
        await p.waitForTimeout(350);
        assert.ok(
          await p.evaluate(
            () =>
              Math.abs(
                document.querySelector(".menu-panel").getBoundingClientRect()
                  .bottom - innerHeight,
              ) < 2,
          ),
          name + " menu fills bottom",
        );
        assert.equal(
          await p
            .locator("#tiles")
            .evaluate((e) => getComputedStyle(e).scrollbarWidth),
          "none",
        );
        if (width < 1000) {
          await swipe(p, -150);
          assert.equal(
            await p.evaluate(() => mobileCart),
            true,
            name + " blank surface to cart",
          );
          await swipe(p, 150);
          assert.equal(
            await p.evaluate(() => mobileCart),
            false,
            name + " blank surface to menu",
          );
        }
        await p.evaluate(() => {
          change("menu");
          const list = document.querySelector("#editorProducts");
          list.innerHTML = list.innerHTML.repeat(15);
        });
        await p.waitForTimeout(350);
        const before = await p.locator("#productSearch").boundingBox();
        await p.locator("#editorProducts").evaluate((e) => (e.scrollTop = 500));
        const after = await p.locator("#productSearch").boundingBox();
        assert.ok(
          Math.abs(after.y - before.y) < 1,
          name + " search stays fixed",
        );
        assert.ok(
          await p.locator("#editorProducts").evaluate((e) => e.scrollTop > 0),
          name + " product list scrolls",
        );
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollHeight <= innerHeight + 2,
          ),
          name + " page has no bottom overflow",
        );
        await p.evaluate(() => toggleProductEditor());
        await p.waitForTimeout(700);
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          name + " editor fits",
        );
      }
      await p.evaluate(() => change("server"));
      const h = await p.locator(".cloud-account-heading h2").boundingBox(),
        r = await p.locator(".cloud-account-heading .staff-role").boundingBox();
      assert.ok(
        Math.abs(h.y + h.height / 2 - r.y - r.height / 2) < 2,
        name + " account and role share line",
      );
      // Desktop engines don't emulate Android's native chin. Inject its safe
      // inset to verify our layout protects controls without shortening layers.
      await p.setViewportSize({ width: 390, height: 844 });
      await p.evaluate(() => {
        document.documentElement.style.setProperty(
          "--cloud-safe-bottom",
          "34px",
        );
        change("cash");
      });
      await p.waitForTimeout(400);
      assert.ok(
        await p.evaluate(
          () =>
            Math.abs(
              document.querySelector(".menu-panel").getBoundingClientRect()
                .bottom -
                (innerHeight - 34),
            ) < 2,
        ),
        name + " safe content bottom",
      );
      await p.evaluate(() => toggleDrawer(true));
      await p.waitForTimeout(400);
      const layers = await p.evaluate(() => ({
        drawer: document.querySelector("#appDrawer").getBoundingClientRect()
          .bottom,
        overlay: document
          .querySelector("#drawerOverlay")
          .getBoundingClientRect().bottom,
        control: document.querySelector(".drawer-tools").getBoundingClientRect()
          .bottom,
        height: innerHeight,
      }));
      assert.ok(
        Math.abs(layers.drawer - layers.height) < 1,
        name + " drawer background reaches screen edge",
      );
      assert.ok(
        Math.abs(layers.overlay - layers.height) < 1,
        name + " overlay reaches screen edge",
      );
      assert.ok(
        layers.control <= layers.height - 34,
        name + " drawer controls above gesture zone",
      );
      console.log(
        "PASS " +
          name +
          " viewport, blank-area swipes, fixed product controls, account row",
      );
    } finally {
      await b.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
