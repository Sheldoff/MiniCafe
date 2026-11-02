const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium, webkit, chromeOptions, base, key } = require("./helpers.cjs");
const online = process.env.CAFE_DESIGN_ONLINE === "1";
const url = online ? process.env.CAFE_CLOUD_TEST_URL : base;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url))
  throw Error("Disposable local server required");
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const browser = await engine.launch({ headless: true, ...options });
    try {
      const p = await browser.newPage({
          viewport: { width: 390, height: 844 },
        }),
        errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("dialog", (d) => d.accept());
      if (online)
        await p.setExtraHTTPHeaders({
          Cookie: "__Host-minicafe_session=" + "1".repeat(64),
        });
      await p.goto(url + (online ? "/admin#cash" : "/?key=" + key + "#cash"));
      await p.waitForFunction(() => hasServerState);
      await p.evaluate(() => {
        clearTimeout(pollTimer);
        setCafePalette("cafe");
      });
      const color = async (variable) =>
        p.evaluate((v) => {
          const e = document.createElement("span");
          e.style.color = `var(${v})`;
          document.body.append(e);
          const value = getComputedStyle(e).color;
          e.remove();
          return value;
        }, variable);
      for (const mode of ["light", "dark"]) {
        await p.evaluate((m) => {
          setCafeTheme(m, false);
          change("cash");
        }, mode);
        await p.evaluate(() => toggleDrawer(true));
        await p.waitForTimeout(320);
        const accent = await color("--accent"),
          text = await color("--text"),
          onAccent = await color("--on-accent");
        assert.equal(
          await p
            .locator("#drawerRefresh")
            .evaluate((b) => getComputedStyle(b).backgroundColor),
          accent,
        );
        assert.equal(
          await p
            .locator("#drawerRefresh")
            .evaluate((b) => getComputedStyle(b).color),
          onAccent,
        );
        const outlines = await p
          .locator("#appDrawer button")
          .evaluateAll((buttons) =>
            buttons.map((b) => ({
              text: b.textContent,
              width: parseFloat(getComputedStyle(b).borderTopWidth),
              style: getComputedStyle(b).borderTopStyle,
            })),
          );
        assert.ok(
          outlines.every((b) => b.width >= 1 && b.style !== "none"),
          JSON.stringify(outlines),
        );
        const nav = p.locator('.drawer-links [data-view="bar"]');
        await nav.hover();
        assert.equal(
          await nav.evaluate((b) => getComputedStyle(b).color),
          text,
        );
        await p.screenshot({
          path: path.join(
            __dirname,
            "../..",
            `cafe-drawer-${online ? "online" : "android"}-${name}-${mode}.png`,
          ),
        });
        await p.evaluate(() => toggleDrawer(false));
        await p.waitForTimeout(250);
        await p.evaluate(() => {
          change("cash");
          productFeedback(data.products[0].id, "tap-feedback");
        });
        assert.equal(
          await p
            .locator(".tile-feedback")
            .first()
            .evaluate((e) => getComputedStyle(e).backgroundColor),
          accent,
        );
        await p.evaluate(() => setCafePalette("standard"));
        assert.equal(
          await p
            .locator(".tile-feedback")
            .first()
            .evaluate((e) => getComputedStyle(e).opacity),
          "0",
        );
        await p.evaluate(() => {
          setCafePalette("cafe");
          showCashPanel(true, true);
          highlightAmount(document.querySelector("#sum"), "before");
        });
        const frames = await p.locator("#sum").evaluate((e) =>
          e
            .getAnimations()
            .flatMap((a) => a.effect.getKeyframes())
            .map((f) => f.backgroundColor)
            .filter(Boolean),
        );
        assert.ok(frames.length > 0);
        assert.ok(
          !frames.some((c) =>
            [
              "#deedce",
              "rgb(222, 237, 206)",
              "#3b553b",
              "rgb(59, 85, 59)",
            ].includes(c),
          ),
          JSON.stringify(frames),
        );
        await p.evaluate(() =>
          setCafeTheme(
            document.documentElement.dataset.theme === "dark"
              ? "light"
              : "dark",
            false,
          ),
        );
        assert.equal(
          await p.locator("#sum").evaluate((e) => e.getAnimations().length),
          0,
        );
        await p.evaluate(() => {
          data.orders = [
            {
              id: 999,
              created: "2026-01-01 12:00:00",
              guest: "Тест",
              items: [
                { id: 999, route: "bar", qty: 1, status: "new", name: "Кава" },
              ],
            },
          ];
          change("bar");
        });
        assert.equal(
          await p
            .locator('[data-order="999"] > .primary')
            .evaluate((b) => getComputedStyle(b).backgroundColor),
          await color("--palette-accent"),
        );
        await p.evaluate(() => change("calculator"));
        const buttons = await p
          .locator("#main button:visible")
          .evaluateAll((bs) =>
            bs.map((b) => ({
              text: b.textContent,
              color: getComputedStyle(b).color,
              bg: getComputedStyle(b).backgroundColor,
            })),
          );
        assert.ok(
          !buttons.some(
            (b) =>
              [
                "rgb(39, 99, 79)",
                "rgb(33, 89, 67)",
                "rgb(33, 76, 61)",
              ].includes(b.bg) || b.color === "rgb(33, 76, 61)",
          ),
          JSON.stringify(buttons),
        );
      }
      await p.evaluate(() => {
        setCafeTheme("light", false);
        change("locations");
      });
      assert.equal(
        await p
          .getByRole("button", { name: "Редагувати", exact: true })
          .count(),
        0,
      );
      const row = p.locator(".location-open").first();
      assert.equal(await row.locator("b").innerText(), "Каса");
      assert.equal(await row.locator("small").innerText(), "Основна");
      await row.click();
      await p.locator("#locationName").waitFor();
      assert.equal(await p.locator("#locationName").inputValue(), "Каса");
      await p.goBack();
      await p.locator(".location-list").waitFor();
      await p.locator(".location-open").first().focus();
      await p.keyboard.press("Enter");
      await p.locator("#locationName").waitFor();
      if (online) {
        let retried = false;
        const record = (i, status) => ({
          reference: "MC-" + String(i).padStart(16, "0"),
          guest: "Гість " + i,
          total: 5000,
          status,
          created: 1700000000,
          order_id: status === "fulfilled" ? 42 : null,
        });
        await p.route("**/api/payments/history**", (r) =>
          r.fulfill({
            json: r.request().url().includes("before=")
              ? { payments: [record(4, "paid")], next_before: null }
              : {
                  payments: [
                    record(1, "fulfilled"),
                    record(2, "expired"),
                    record(3, retried ? "fulfilled" : "review"),
                  ],
                  next_before: "MC-0000000000000003",
                },
          }),
        );
        await p.route("**/api/payments/retry", (r) => {
          retried = true;
          return r.fulfill({ json: { status: "fulfilled" } });
        });
        await p.evaluate(() => change("server"));
        assert.equal(await p.locator("#bankPaymentPanel").count(), 0);
        await p.evaluate(() => change("transactions"));
        await p
          .locator('[data-bank-reference="MC-0000000000000001"]')
          .waitFor();
        assert.ok(
          (await p.locator("#bankPaymentPanel").innerText()).includes(
            "Оплачено — передано",
          ),
        );
        assert.ok(
          (await p.locator("#bankPaymentPanel").innerText()).includes(
            "Час оплати минув",
          ),
        );
        await p.locator("[data-payment-more]").click();
        await p
          .locator('[data-bank-reference="MC-0000000000000004"]')
          .waitFor();
        assert.equal(await p.locator(".bank-payment-row").count(), 4);
        await p.locator("[data-payment-retry]").click();
        await p.waitForFunction(
          () => !document.querySelector("[data-payment-retry]"),
        );
        await p.screenshot({
          path: path.join(__dirname, "../..", `bank-history-${name}.png`),
        });
      } else {
        await p.evaluate(() => change("transactions"));
        assert.ok(
          (await p.locator("#bankPaymentHistory").innerText()).includes(
            "онлайн",
          ),
        );
      }
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${name}: Cafe controls/drawer outlines, hover and theme animation colors, row/keyboard location edit and bank history placement`,
      );
    } finally {
      await browser.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
