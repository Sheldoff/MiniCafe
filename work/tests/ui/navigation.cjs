const assert = require("assert");
const { chromium, webkit, base, key, chromeOptions } = require("./helpers.cjs");
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const browser = await engine.launch({ headless: true, ...options });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/?key=" + key + "#cash");
    await page.waitForFunction(() => hasServerState);
    await page.evaluate(async () => {
      clearTimeout(pollTimer);
      await refresh();
      clearTimeout(pollTimer);
    });
    // Rapid repeat open, overlay ghost click and duplicate close must not invalidate cleanup.
    await page.evaluate(() => {
      toggleDrawer(true);
      toggleDrawer(true);
      closeDrawerOverlay();
    });
    await page.waitForTimeout(380);
    assert(await page.locator("#appDrawer").isVisible());
    await page.evaluate(() => {
      toggleDrawer(false);
      toggleDrawer(false);
    });
    await page.waitForFunction(
      () => document.querySelector("#drawerOverlay").hidden,
    );
    await page.evaluate(() => {
      toggleDrawer(true);
      setTimeout(() => toggleDrawer(false), 30);
      setTimeout(() => toggleDrawer(true), 60);
    });
    await page.waitForTimeout(420);
    assert(await page.locator("#appDrawer").isVisible());
    assert.equal(
      await page.getByRole("button", { name: "Оновити", exact: true }).count(),
      0,
    );
    assert.equal(
      await page.locator(".drawer-tools button").last().innerText(),
      "Сервер",
    );
    await page.evaluate(() => {
      cart = [{ ...data.products[0], qty: 1, note: "" }];
      drawCart();
    });
    await page.route("**/api/state", (r) =>
      r.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"test offline"}',
      }),
    );
    await page.locator("#drawerRefresh").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#connection")
        .classList.contains("status-offline"),
    );
    await page.waitForTimeout(600);
    assert.equal(
      await page.locator("#drawerRefresh").getAttribute("aria-busy"),
      "true",
    );
    assert(await page.locator(".refresh-spinner").isVisible());
    assert.equal(await page.evaluate(() => cart.length), 1);
    await page.unroute("**/api/state");
    await page.evaluate(() => refresh());
    await page.waitForFunction(() => !manualRefreshPending);
    assert.equal(
      await page.locator("#drawerRefresh").getAttribute("aria-busy"),
      "false",
    );
    await page.locator('[data-view="developer"]').click();
    await page.locator(".developer-panel").waitFor();
    assert.equal(
      await page.locator(".developer-action").nth(0).getAttribute("href"),
      "https://t.me/AlikPerepelkin",
    );
    assert.equal(
      await page.locator(".developer-action").nth(1).getAttribute("href"),
      "https://send.monobank.ua/jar/7NiVRv4sW5",
    );
    await page.evaluate(() => handleAppBack());
    assert.equal(await page.evaluate(() => view), "cash");
    await page.evaluate(() => openServerSettings());
    assert.equal(await page.evaluate(() => view), "server");
    await page.evaluate(() => handleAppBack());
    assert.equal(await page.evaluate(() => view), "cash");
    const access = await (
      await page.request.get(base + "/api/access", {
        headers: { "X-Cafe-Key": key },
      })
    ).json();
    for (const [role, expected] of [
      ["service", ["cash", "bar", "delivery"]],
      ["cash", ["cash"]],
      ["bar", ["bar"]],
      ["delivery", ["delivery"]],
    ]) {
      await page.goto(base + "/?key=" + access[role] + "#menu");
      await page.waitForFunction(() => hasServerState);
      assert.deepEqual(
        await page
          .locator(".drawer-links [data-view]")
          .evaluateAll((es) => es.map((e) => e.dataset.view)),
        expected,
      );
      assert.equal(await page.evaluate(() => allowedView("menu")), false);
      assert.equal(await page.evaluate(() => allowedView("history")), false);
      await page.evaluate(() => change("developer"));
      assert.equal(await page.evaluate(() => view), "developer");
    }
    assert.deepEqual(errors, []);
    await browser.close();
    console.log(
      "PASS " +
        name +
        ": rapid/reversed/repeated drawer actions, ghost overlay click, brand refresh and offline/recovery spinner, preserved cart, footer/server/developer links and combined/restricted roles",
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
