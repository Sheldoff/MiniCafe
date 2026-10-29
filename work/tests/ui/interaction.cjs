const { chromium, webkit, base, key, chromeOptions } = require("./helpers.cjs");
(async () => {
  for (let [name, engine, opts] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    let b = await engine.launch({ headless: true, ...opts }),
      p = await b.newPage({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      }),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + "/?key=" + key + "#cash");
    await p.locator('[data-product="1"]').tap();
    await p.evaluate(() => {
      window.motionLog = [];
      let original = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        window.motionLog.push({
          className: this.className,
          id: this.id,
          frames,
          options,
        });
        return original.call(this, frames, options);
      };
    });
    await p.locator("#cartTab").tap();
    if (!(await p.locator(".cash-tab-indicator").count()))
      throw Error("tab indicator absent");
    await p
      .getByRole("button", { name: "Збільшити кількість", exact: true })
      .tap();
    if (
      !(await p.evaluate(() =>
        motionLog.some((m) => m.className === "cart-qty"),
      ))
    )
      throw Error("counter not animated");
    await p
      .getByRole("button", { name: "Коментар до Еспресо", exact: true })
      .tap();
    await p.locator("#itemNote0").fill("Без цукру");
    if (
      !(await p.evaluate(() =>
        motionLog.some(
          (m) => m.id === "itemNote0" && m.frames[0].height === "0px",
        ),
      ))
    )
      throw Error("comment not animated");
    await p
      .getByRole("button", { name: "Коментар до Еспресо", exact: true })
      .tap();
    await p.locator("#itemNote0").waitFor({ state: "detached" });
    if ((await p.locator(".saved-note").textContent()) !== "Без цукру")
      throw Error("comment lost");
    await p.evaluate(() => add(4));
    if (
      !(await p.evaluate(() =>
        motionLog.some(
          (m) =>
            String(m.className).includes("cart-compact") &&
            m.frames[0].height === "0px",
        ),
      ))
    )
      throw Error("new row not animated");
    await p
      .getByRole("button", { name: "Видалити позицію", exact: true })
      .last()
      .tap();
    await p.waitForFunction(
      () => !document.querySelector(".cart-removal-ghost"),
    );
    if (
      !(await p.evaluate(() =>
        motionLog.some(
          (m) =>
            m.className === "cart-removal-ghost" &&
            m.frames[1].height === "0px",
        ),
      ))
    )
      throw Error("row removal not animated");
    await p.locator("#cardPaid").fill("1");
    await p.locator("#send").tap();
    if ((await p.locator("#cardPaid").getAttribute("aria-invalid")) !== "true")
      throw Error("no field error");
    await p.locator("#cardPaid").fill("70");
    if (await p.locator("#cardPaid").getAttribute("aria-invalid"))
      throw Error("error not cleared");
    await p.locator("#send").tap();
    await p.waitForFunction(() => !busy && cart.length === 0);
    if (
      !(await p
        .locator(".cash-switch button.selected")
        .textContent()
        .then((t) => t === "Меню"))
    )
      throw Error("menu state");
    await p.evaluate(() => change("calculator"));
    await p
      .getByRole("button", { name: "Додаткові витрати", exact: true })
      .tap();
    await p.locator("#extraSave").tap();
    if ((await p.locator("#extraCost").getAttribute("aria-invalid")) !== "true")
      throw Error("expense error");
    await p.locator("#extraCost").fill("10");
    await p.locator("#extraSave").tap();
    await p.locator("#orderDialog").waitFor({ state: "detached" });
    if (
      !(await p.evaluate(() =>
        motionLog.some((m) => m.className === "save-check"),
      ))
    )
      throw Error("no save check");
    await p.evaluate(() => change("bar"));
    let r = await p.request.post(base + "/api/order", {
        headers: { "X-Cafe-Key": key },
        data: {
          request: "motion322-" + name,
          cash_given: 3500,
          card_amount: 0,
          items: [{ id: 1, qty: 1 }],
        },
      }),
      order = await r.json();
    await p.evaluate(() => refresh());
    await p.locator('[data-order="' + order.id + '"]').waitFor();
    if (
      !(await p.evaluate(() =>
        motionLog.some(
          (m) =>
            m.className === "card" &&
            m.frames[0].transform === "translateY(-14px)",
        ),
      ))
    )
      throw Error("no incoming ticket animation");
    await p.waitForFunction(() => !document.querySelector(".queue-arriving"));
    await p.evaluate(async () => {
      await refresh();
      clearTimeout(pollTimer);
      window.originalFetch = window.fetch;
      window.pendingGate = new Promise((resolve) => {
        window.releasePending = resolve;
      });
      window.fetch = async (...args) => {
        if (String(args[0]).includes("/api/state")) await pendingGate;
        return originalFetch(...args);
      };
    });
    await p.evaluate(() => {
      hasServerState = false;
      document.querySelector("#connection").classList.add("status-offline");
      void refresh();
    });
    await p.locator("#connection.connection-pending").waitFor();
    if (
      (await p
        .locator("#connection")
        .evaluate((e) => getComputedStyle(e).animationName)) !==
      "connectionPulse"
    )
      throw Error("no pulse");
    await p.evaluate(() => releasePending());
    await p
      .locator("#connection.connection-pending")
      .waitFor({ state: "detached" });
    await p.evaluate(() => {
      window.fetch = window.originalFetch;
    });
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.evaluate(() => {
      window.reduceDuration = motion(
        document.querySelector("#connection"),
        [{ opacity: 0 }, { opacity: 1 }],
        200,
      ).effect.getTiming().duration;
    });
    if ((await p.evaluate(() => reduceDuration)) !== 0)
      throw Error("reduced motion ignored");
    await p.emulateMedia({ reducedMotion: "no-preference" });
    for (let width of [320, 390, 900]) {
      await p.setViewportSize({ width, height: 844 });
      if (
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        )
      )
        throw Error("overflow " + width);
    }
    if (errors.length) throw Error(errors.join());
    await b.close();
    console.log(
      "PASS " +
        name +
        ": tab indicator, qty bounce, row entry/collapse, expanding/closing comments, animated validation, save check, new ticket entry, connecting-only pulse, reduced motion, responsive layout",
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
