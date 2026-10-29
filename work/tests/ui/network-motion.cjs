const assert = require("assert");
const { chromium, webkit, base, key, chromeOptions } = require("./helpers.cjs");
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const browser = await engine.launch({ headless: true, ...options }),
      p = await browser.newPage({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      }),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + "/?key=" + key + "#cash");
    await p.locator('[data-product="1"]').waitFor();
    assert(
      await p.evaluate(async () => {
        let e = document.createElement("div");
        e.style.cssText =
          "position:fixed;left:0;bottom:0;width:10px;height:10px;background:rgb(0,0,0);color:rgb(0,0,0);border:1px solid rgb(0,0,0);transition:background-color 2s,color 2s,border-color 2s";
        document.body.append(e);
        void e.offsetWidth;
        e.style.backgroundColor = "rgb(255,255,255)";
        e.style.color = "rgb(255,255,255)";
        e.style.borderColor = "rgb(255,255,255)";
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        let transitions = e
          .getAnimations()
          .filter((a) => "transitionProperty" in a);
        motion(e, [
          { transform: "translateY(1px)" },
          { transform: "translateY(0)" },
        ]);
        let intact =
          transitions.length >= 3 &&
          transitions.every((a) => a.playState !== "idle");
        e.remove();
        return intact;
      }),
      "transient motion must preserve theme/focus CSS transitions",
    );
    let concurrent = await p.evaluate(async () => {
      clearTimeout(pollTimer);
      await refresh();
      window.originalFetch = window.fetch;
      let count = 0;
      window.fetch = async (...args) => {
        if (args[0] === "/api/state") {
          count++;
          await new Promise((r) => setTimeout(r, 180));
        }
        return originalFetch(...args);
      };
      await Promise.all(Array.from({ length: 8 }, () => refresh()));
      window.fetch = originalFetch;
      return count;
    });
    assert.equal(
      concurrent,
      1,
      "simultaneous refreshes must share one request",
    );
    let changedName = "Повільна мережа " + name + " " + Date.now();
    let ordered = await p.evaluate(async (name) => {
      let count = 0;
      window.fetch = async (...args) => {
        if (args[0] === "/api/state") {
          count++;
          let r = await originalFetch(...args);
          if (count === 1) {
            let text = await r.text();
            await new Promise((resolve) => setTimeout(resolve, 250));
            return new Response(text, { status: r.status, headers: r.headers });
          }
          return r;
        }
        return originalFetch(...args);
      };
      stateETag = "";
      let first = refresh();
      await new Promise((r) => setTimeout(r, 40));
      await originalFetch("/api/product", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          price: 5000,
          category: "Тести",
          route: "instant",
          active: true,
        }),
      });
      await Promise.all([first, refresh(true)]);
      window.fetch = originalFetch;
      return { count, found: data.products.some((p) => p.name === name) };
    }, changedName);
    assert.deepEqual(
      ordered,
      { count: 2, found: true },
      "a write during a read requires one fresh follow-up",
    );
    const timed = await p.evaluate(async () => {
      const originalTimer = window.setTimeout;
      window.setTimeout = (f, ms, ...a) =>
        originalTimer(f, ms === 12000 ? 80 : ms, ...a);
      window.fetch = (...args) =>
        args[0] === "/api/state"
          ? Promise.resolve({
              status: 200,
              ok: true,
              json: () => new Promise(() => {}),
            })
          : originalFetch(...args);
      let result = await refresh();
      window.fetch = originalFetch;
      window.setTimeout = originalTimer;
      return {
        result,
        refreshing,
        offline: document
          .querySelector("#connection")
          .classList.contains("status-offline"),
      };
    });
    assert.deepEqual(
      timed,
      { result: false, refreshing: 0, offline: true },
      "timeout must cover response body too",
    );
    await p.evaluate(() => refresh());
    await p.evaluate(
      () =>
        new Promise((resolve) => {
          showCashPanel(true, true);
          setTimeout(() => showCashPanel(false, true), 40);
          setTimeout(() => showCashPanel(true, true).then(resolve), 80);
          setTimeout(() => setCafeTheme("dark"), 100);
        }),
    );
    assert.equal(await p.locator(".cash-swipe-ghost").count(), 0);
    assert.equal(await p.locator(".cash-swiping").count(), 0);
    assert(
      await p
        .locator("#cartTab")
        .evaluate((e) => e.classList.contains("selected")),
    );
    await p.evaluate(
      () =>
        new Promise((resolve) => {
          toggleDrawer(true);
          setTimeout(() => toggleDrawer(false), 40);
          setTimeout(() => toggleDrawer(true), 80);
          setTimeout(() => toggleDrawer(false).then(resolve), 120);
        }),
    );
    assert(await p.locator("#appDrawer").isHidden());
    assert(await p.locator("#drawerOverlay").isHidden());
    await p.evaluate(() => change("menu"));
    await p.locator("#productSearch").fill("Немає такого товару");
    await p.waitForTimeout(240);
    await p.locator("#productSearch").fill("");
    await p.waitForTimeout(60);
    await p.locator("#productSearch").fill("Круасан");
    await p.waitForTimeout(350);
    assert.equal(await p.locator(".editor-product").count(), 1);
    assert.notEqual(
      await p.locator(".editor-product").evaluate((e) => e.style.overflow),
      "hidden",
    );
    assert.equal(await p.locator(".list-removal-ghost").count(), 0);
    await p.evaluate(() => {
      openProductEditor(true);
      setTimeout(() => closeProductEditor(true), 60);
      setTimeout(() => openProductEditor(true), 120);
    });
    await p.waitForTimeout(600);
    assert(await p.locator(".product-form-panel").isVisible());
    const orderGuest = "Підтверджена видача " + name + " " + Date.now();
    let response = await p.request.post(base + "/api/order", {
      headers: { "X-Cafe-Key": key },
      data: {
        request: orderGuest,
        guest: orderGuest,
        cash_given: 7000,
        card_amount: 0,
        items: [{ id: 1, qty: 2 }],
      },
    });
    assert(response.ok());
    let orderId = (await response.json()).id;
    await p.evaluate(async () => {
      await refresh(true);
      change("bar");
    });
    await p.locator(`[data-order="${orderId}"]`).waitFor();
    await p.evaluate(() => {
      window.fetch = (...args) =>
        args[0] === "/api/state"
          ? Promise.reject(Error("Failed to fetch"))
          : originalFetch(...args);
    });
    await p.locator(`[data-order="${orderId}"] .queue-item`).first().click();
    await p.waitForFunction(() => !issuingOrder);
    assert.equal(
      await p
        .locator(`[data-order="${orderId}"] .queue-item`)
        .first()
        .getAttribute("aria-pressed"),
      "true",
    );
    await p.locator(`[data-order="${orderId}"] > button.primary`).click();
    await p.waitForFunction(() => !issuingOrder);
    assert.equal(
      await p.locator(`[data-order="${orderId}"]`).count(),
      0,
      "acknowledged ticket must not reappear after failed refresh",
    );
    await p.evaluate(async () => {
      window.fetch = originalFetch;
      await refresh(true);
    });
    assert(
      await p.evaluate(async () => {
        const nativeAnimate = Element.prototype.animate;
        let incoming = null,
          newOrder = null;
        Element.prototype.animate = function (frames, options) {
          if (this.matches("[data-order]")) {
            options = { ...options, duration: 700 };
            if (!incoming)
              incoming = originalFetch("/api/order", {
                method: "POST",
                headers: { ...auth, "Content-Type": "application/json" },
                body: JSON.stringify({
                  request: "during-undo-" + Date.now(),
                  guest: "Нове під час повернення",
                  cash_given: 3500,
                  card_amount: 0,
                  items: [{ id: 1, qty: 1 }],
                }),
              }).then(async (r) => {
                newOrder = (await r.json()).id;
                await refresh(true);
              });
          }
          return nativeAnimate.call(this, frames, options);
        };
        try {
          await undoIssue("bar", document.querySelector(".undo-issue"));
          await incoming;
          return (
            !!newOrder && !!document.querySelector(`[data-order="${newOrder}"]`)
          );
        } finally {
          Element.prototype.animate = nativeAnimate;
        }
      }),
      "a new ticket arriving during undo animation must remain visible",
    );
    await p.locator(".availability-heading").click();
    await p.waitForTimeout(300);
    await p.request.post(base + "/api/availability", {
      headers: { "X-Cafe-Key": key },
      data: { id: 1, sold_out: true },
    });
    await p.evaluate(() => refresh());
    assert(
      await p
        .locator(".availability-toggle.off")
        .filter({ hasText: "Еспресо" })
        .count(),
    );
    await p.request.post(base + "/api/availability", {
      headers: { "X-Cafe-Key": key },
      data: { id: 1, sold_out: false },
    });
    await p.evaluate(() => refresh());
    await p.evaluate(() => change("history"));
    await p.locator(".history-record").first().waitFor();
    await p.evaluate(async () => {
      let count = 0;
      window.fetch = (...args) => {
        if (String(args[0]).startsWith("/api/history") && ++count === 1)
          return new Promise((_, reject) =>
            setTimeout(() => reject(Error("Old delayed request")), 180),
          );
        return originalFetch(...args);
      };
      let old = historyCompact();
      await new Promise((r) => setTimeout(r, 20));
      await Promise.all([old, historyCompact()]);
      window.fetch = originalFetch;
    });
    assert(
      (await p.locator(".history-record").count()) > 0,
      "stale request failure must not replace current history",
    );
    await p.locator(".history-record summary").first().click();
    await p.waitForTimeout(350);
    let expandedId = await p
      .locator(".history-record[open]")
      .getAttribute("data-history-order");
    await p.request.post(base + "/api/order", {
      headers: { "X-Cafe-Key": key },
      data: {
        request: "history-live-" + name + Date.now(),
        cash_given: 3500,
        card_amount: 0,
        items: [{ id: 1, qty: 1 }],
      },
    });
    await p.evaluate(() => refresh());
    await p.waitForTimeout(250);
    assert(
      await p
        .locator(`.history-record[data-history-order="${expandedId}"]`)
        .evaluate((e) => e.open),
    );
    assert.deepEqual(errors, []);
    await browser.close();
    console.log(
      "PASS " +
        name +
        ": coalesced reads, post-write ordering, stalled body timeout, rapid transitions/cleanup, interrupted list animation, acknowledged issue on failed read, live availability and stable expanded history",
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
