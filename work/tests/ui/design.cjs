const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium, webkit, chromeOptions, base, key } = require("./helpers.cjs");
const online = process.env.CAFE_DESIGN_ONLINE === "1",
  url = online ? process.env.CAFE_CLOUD_TEST_URL : base;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url))
  throw Error("Disposable local server required");
function luminance(color) {
  const channels = color
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number)
    .map((n) => n / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(fg, bg) {
  const a = luminance(fg),
    b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
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
      await p.addInitScript(() =>
        localStorage.setItem("minicafe-palette", "cafe"),
      );
      await p.goto(
        url + (online ? "/admin#themes" : "/?key=" + key + "#themes"),
      );
      await p.waitForFunction(() => hasServerState);
      await p.evaluate(() => clearTimeout(pollTimer));
      assert.equal(await p.evaluate(() => view), "server");
      assert.equal(
        await p.evaluate(() => localStorage.getItem("minicafe-palette")),
        "coffee",
      );
      assert.equal(
        await p.evaluate(() => document.documentElement.dataset.palette),
        "coffee",
      );
      assert.equal(
        await p
          .getByRole("button", { name: "Вибір теми", exact: true })
          .count(),
        0,
      );
      assert.equal(await p.locator("#main > .panel").count(), 1);
      assert.ok(
        await p
          .locator("#main button")
          .evaluateAll((bs) => bs.every((b) => !!b.closest("#settingsExtras"))),
      );
      for (const mode of ["light", "dark"]) {
        for (const hex of [
          "#ffffff",
          "#000000",
          "#777777",
          "#ffeb3b",
          "#0057b8",
          "#e91e63",
        ]) {
          await p.evaluate(
            ({ mode, hex }) => {
              setCafeTheme(mode, false, false);
              data.locations = [
                {
                  id: "cash",
                  kind: "cash",
                  name: "Каса",
                  color: hex,
                  targets: ["bar", "delivery"],
                },
              ];
              change("cash");
            },
            { mode, hex },
          );
          const samples = await p.evaluate(async () => {
            const indicator = document.querySelector(".cash-tab-indicator"),
              menu = document.querySelector(".cash-switch button"),
              head = document.querySelector("#drawerToggle"),
              send = document.querySelector("#send");
            const css = (el) => ({
              id: el.id || el.className,
              fg: getComputedStyle(el).color,
              bg: getComputedStyle(el).backgroundColor,
            });
            const result = {
              head: css(head),
              send: css(send),
              menu: {
                fg: getComputedStyle(menu).color,
                bg: getComputedStyle(indicator).backgroundColor,
              },
              frames: [],
            };
            showCashPanel(true, true);
            for (let i = 0; i < 6; i++) {
              await new Promise(requestAnimationFrame);
              result.frames.push({
                bg: getComputedStyle(indicator).backgroundColor,
                left: parseFloat(getComputedStyle(indicator).left),
              });
            }
            return result;
          });
          for (const element of [samples.head, samples.send, samples.menu])
            assert.ok(
              contrast(element.fg, element.bg) >= 4.5,
              JSON.stringify({
                mode,
                hex,
                element,
                contrast: contrast(element.fg, element.bg),
              }),
            );
          assert.ok(
            samples.frames.every((f) => f.bg === samples.menu.bg),
            JSON.stringify(samples),
          );
          assert.ok(
            samples.frames.at(-1).left > samples.frames[0].left,
            JSON.stringify(samples.frames),
          );
          await p.evaluate(() => showCashPanel(false, true));
          if (hex === "#0057b8") {
            await p.evaluate(() => toggleDrawer(true));
            await p.waitForTimeout(320);
            const widths = await p
              .locator(
                "#appDrawer button:not(#drawerRefresh):not(#themeToggle)",
              )
              .evaluateAll((bs) =>
                bs.map((b) => getComputedStyle(b).borderTopWidth),
              );
            assert.ok(
              widths.every((w) => w === "2px"),
              JSON.stringify(widths),
            );
            assert.equal(
              await p
                .locator("#drawerRefresh")
                .evaluate((b) => getComputedStyle(b).borderTopWidth),
              "0px",
            );
            await p.screenshot({
              path: path.join(
                __dirname,
                "../..",
                `standard-drawer-${online ? "online" : "android"}-${name}-${mode}.png`,
              ),
            });
            await p.evaluate(() => toggleDrawer(false));
            await p.waitForTimeout(250);
          }
        }
      }
      await p.evaluate(() => {
        data.locations = [];
        setCafeTheme("light", false, false);
        change("locations");
      });
      const row = p.locator(".location-open").first();
      await row.click();
      await p.locator("#locationName").waitFor();
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
        `PASS ${name}: standard theme rollback, unified settings, uniform drawer borders, contrasting location colors and moving menu indicator, bank history placement`,
      );
    } finally {
      await browser.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
