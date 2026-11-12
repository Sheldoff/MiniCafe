const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium, webkit, base, key, chromeOptions } = require("./helpers.cjs");
const online = process.env.CAFE_CARD_ONLINE === "1";
const target = online ? process.env.CAFE_CLOUD_TEST_URL : base;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(target))
  throw Error("Disposable local server required");
(async () => {
  for (const [name, engine, opts] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const browser = await engine.launch({ headless: true, ...opts });
    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      });
      if (online)
        await context.setExtraHTTPHeaders({
          Cookie: "__Host-minicafe_session=" + "1".repeat(64),
        });
      const p = await context.newPage(),
        errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(
        target + (online ? "/admin#cash" : "/?key=" + key + "#cash"),
      );
      await p.locator("#tiles [data-product]").first().waitFor();
      const result = await p.evaluate(async () => {
        const product = data.products.find(
          (p) =>
            p.active &&
            !p.sold_out &&
            p.price >= 100 &&
            (p.stock == null || p.stock_estimated || p.stock >= 4),
        );
        if (!product) throw Error("No disposable fixture product");
        const create = async (card, cash, gift = false) =>
          (
            await post("order", {
              request: crypto.randomUUID(),
              guest: "Тест карткової історії",
              items: [{ id: product.id, qty: 1 }],
              card_amount: card,
              cash_given: cash,
              gift,
            })
          ).id;
        const partial = Math.floor(product.price / 2),
          mixed = await create(partial, product.price - partial),
          cash = await create(0, product.price),
          gift = await create(0, 0, true),
          card = await create(product.price, 0);
        const r = await fetch("/api/stats?session=" + data.active_session, {
          headers: auth,
        });
        const stats = await r.json();
        return {
          mixed,
          cash,
          gift,
          card,
          partial,
          total: product.price,
          stats: { card: stats.card, cash: stats.cash, revenue: stats.revenue },
          session: data.active_session,
        };
      });
      await p.locator("#cartTab").click();
      const row = p.locator(`[data-card-payment="${result.mixed}"]`);
      await row.waitFor();
      const money = (n) =>
        (n / 100).toLocaleString("uk-UA", { minimumFractionDigits: 2 }) + " ₴";
      assert.equal(
        await row.locator("strong").innerText(),
        money(result.partial),
      );
      assert.equal(
        await row.locator("span > b").innerText(),
        "Тест карткової історії",
      );
      assert.equal(
        await p
          .locator(`[data-card-payment="${result.card}"] strong`)
          .innerText(),
        money(result.total),
      );
      assert.equal(
        await p.locator(`[data-card-payment="${result.cash}"]`).count(),
        0,
      );
      assert.equal(
        await p.locator(`[data-card-payment="${result.gift}"]`).count(),
        0,
      );
      await p.locator(".card-payment-history").scrollIntoViewIfNeeded();
      await p.screenshot({
        path: path.join(
          __dirname,
          "../..",
          `card-history-${online ? "online" : "android"}-${name}.png`,
        ),
      });
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await row.locator("button").click();
      await row.waitFor({ state: "detached" });
      const statsAfter = await p.evaluate(async (sid) => {
        const r = await fetch("/api/stats?session=" + sid, { headers: auth }),
          s = await r.json();
        return { card: s.card, cash: s.cash, revenue: s.revenue };
      }, result.session);
      assert.deepEqual(statsAfter, result.stats);
      await p.reload();
      await p.locator("#tiles [data-product]").first().waitFor();
      await p.locator("#cartTab").click();
      await p.locator(`[data-card-payment="${result.card}"]`).waitFor();
      assert.equal(
        await p.locator(`[data-card-payment="${result.mixed}"]`).count(),
        0,
      );
      await p.evaluate(() => setCafeTheme("dark", false, false));
      await p.locator(".card-payment-history").scrollIntoViewIfNeeded();
      await p.screenshot({
        path: path.join(
          __dirname,
          "../..",
          `card-history-${online ? "online" : "android"}-${name}-dark.png`,
        ),
      });
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${name} ${online ? "online" : "Android"}: card-only amount, mixed split, cash/gift exclusion, hide persistence, unchanged statistics, light/dark narrow layout`,
      );
    } finally {
      await browser.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
