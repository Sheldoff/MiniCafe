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
    await p.locator("#cartTab").tap();
    await p.locator("#guest").fill("Тест");
    await p.evaluate(() => {
      window.keptMenu = document.querySelector(".cash-switch button");
      window.keptPanel = document.querySelector(".menu-panel");
      window.lostMenu = false;
      window.selectedDrops = 0;
      let active = false;
      new MutationObserver(() => {
        if (!keptMenu.isConnected) lostMenu = true;
        if (keptMenu.classList.contains("selected")) active = true;
        else if (active) selectedDrops++;
      }).observe(document.querySelector("#main"), {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    });
    await p.locator("#send").tap();
    await p.waitForFunction(() => !busy && cart.length === 0);
    let result = await p.evaluate(() => ({
      same:
        keptMenu === document.querySelector(".cash-switch button") &&
        keptPanel === document.querySelector(".menu-panel"),
      lost: lostMenu,
      drops: selectedDrops,
      selected: keptMenu.classList.contains("selected"),
      guest: document.querySelector("#guest").value,
      card: document.querySelector("#cardPaid").value,
      swiping: !!document.querySelector(".cash-swiping"),
      count: document.querySelector("#cartTab").textContent,
    }));
    if (
      !result.same ||
      result.lost ||
      result.drops ||
      !result.selected ||
      result.guest ||
      result.card !== "0.00" ||
      result.swiping ||
      result.count !== "Замовлення · 0"
    )
      throw Error(JSON.stringify(result));
    await p.locator('[data-product="1"]').tap();
    await p.locator("#cartTab").tap();
    await p.evaluate(() => handleAppBack());
    await p.waitForFunction(() => !document.querySelector(".cash-swiping"));
    if ((await p.locator("#cartTab").textContent()) !== "Замовлення · 1")
      throw Error("back lost draft");
    await p.locator("#cartTab").tap();
    await p.locator("#send").tap();
    await p.waitForFunction(() => !busy && cart.length === 0);
    if (
      await p.evaluate(
        () => keptMenu !== document.querySelector(".cash-switch button"),
      )
    )
      throw Error("repeat send replaced menu");
    if (errors.length) throw Error(errors.join());
    await b.close();
    console.log(
      "PASS " +
        name +
        ": menu/button DOM preserved, selected state never drops after send, inputs/cart reset, back keeps draft, second send works",
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
