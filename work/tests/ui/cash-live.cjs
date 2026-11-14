const assert = require("node:assert/strict"),
  path = require("node:path");
const { chromium, webkit, chromeOptions, base, key } = require("./helpers.cjs");
const { contrast } = require("./contrast.cjs");
const online = process.env.CAFE_CASH_LIVE_ONLINE === "1",
  url = online
    ? process.env.CAFE_CLOUD_TEST_URL || "http://127.0.0.1:8791"
    : base;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url))
  throw Error("Disposable local server required");
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const browser = await engine.launch({ headless: true, ...options });
    let original, context;
    const headers = {
      "Content-Type": "application/json",
      Origin: url,
      ...(online
        ? {
            Cookie: "__Host-minicafe_session=" + "1".repeat(64),
            "X-CSRF-Token": "2".repeat(64),
          }
        : { "X-Cafe-Key": key }),
    };
    try {
      context = await browser.newContext({
        viewport: { width: 390, height: 1000 },
      });
      if (online) await context.setExtraHTTPHeaders({ Cookie: headers.Cookie });
      const post = async (route, input) => {
        const r = await context.request.post(url + "/api/" + route, {
          headers,
          data: input,
        });
        assert(r.ok(), route + ": " + (await r.text()));
        return r.json();
      };
      original = await (
        await context.request.get(url + "/api/backup", { headers })
      ).json();
      const fixture = structuredClone(original);
      fixture.locations = [];
      fixture.orders = [];
      fixture.sessions = [];
      fixture.calculator_expenses = [];
      fixture.active_session = 0;
      fixture.issue_undo = {};
      for (const p of fixture.products) {
        delete p.stock_by_cash;
        delete p.stock;
        delete p.unavailable_at;
        p.sold_out = false;
      }
      await post("restore", fixture);
      const cash2 = "loc-" + "7".repeat(32),
        cash3 = "loc-" + "8".repeat(32),
        bar2 = "loc-" + "9".repeat(32),
        delivery = "loc-" + "a7".repeat(16);
      const location = (id, kind, label) => ({
        id,
        kind,
        name: label,
        color: kind === "cash" ? "#7b5137" : "#385d77",
      });
      await post("location/save", location(bar2, "bar", "Бариста 2"));
      await post("location/save", location(delivery, "delivery", "Видача 2"));
      await post("location/save", {
        ...location(cash2, "cash", "Каса 2"),
        targets: ["bar", bar2, "delivery", delivery],
      });
      await post("location/save", {
        ...location(cash3, "cash", "Каса 3"),
        targets: ["bar", delivery],
      });
      const food = fixture.products.find(
          (p) => p.active && p.route === "instant",
        ),
        drink = fixture.products.find((p) => p.active && p.route === "bar");
      const productInput = {
        id: food.id,
        name: food.name,
        category: food.category,
        route: food.route,
        price: food.price,
        active: true,
        stock: 20,
        stock_estimated: false,
        stock_by_cash: null,
      };
      await post("product", productInput);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        url + (online ? "/admin#menu" : "/?key=" + key + "#menu"),
      );
      await page.waitForFunction(
        () => typeof hasServerState !== "undefined" && hasServerState,
      );
      await page.screenshot({
        path: path.join(
          __dirname,
          "../..",
          `cash-live-catalog-${online ? "online" : "android"}-${name}.png`,
        ),
      });
      if (online) {
        const box = await page.locator(".editor-product").first().boundingBox();
        assert(box.height < 112, "compact web mobile row");
      }
      await page.locator(`[data-product-id="${food.id}"]`).click();
      assert.equal(await page.locator("#editorBack").count(), 0);
      assert.equal(await page.locator(".product-form-panel h2").count(), 0);
      assert.equal(
        await page.locator('[data-cash-stock="cash"]').inputValue(),
        "20",
      );
      await page.locator('[data-cash-stock="cash"]').fill("7");
      assert.equal(
        await page.locator(`[data-cash-stock="${cash2}"]`).inputValue(),
        "13",
      );
      await page.locator(`[data-cash-stock="${cash2}"]`).fill("5");
      assert.equal(
        await page.locator(`[data-cash-stock="${cash3}"]`).inputValue(),
        "8",
      );
      await page.screenshot({
        path: path.join(
          __dirname,
          "../..",
          `cash-live-allocation-${online ? "online" : "android"}-${name}.png`,
        ),
      });
      await page.locator(".editor-save-actions .primary").click();
      await page.waitForFunction(
        ({ id, cash }) =>
          data.products.find((p) => p.id === id).stock_by_cash?.[cash] === 8,
        { id: food.id, cash: cash3 },
      );
      await page.locator(`[data-product-id="${food.id}"]`).click();
      await page.locator('[data-cash-stock="cash"]').fill("0");
      await page.locator(`[data-cash-stock="${cash2}"]`).fill("12");
      await page.locator(".editor-save-actions .primary").click();
      await page.waitForFunction(
        (id) =>
          data.products.find((p) => p.id === id).stock_by_cash?.cash === 0,
        food.id,
      );
      await page.evaluate(() => change("cash"));
      assert.equal(
        await page.locator(`[data-product="${food.id}"]`).count(),
        0,
      );
      await page.evaluate((id) => change("cash", id), cash2);
      assert.equal(
        await page.locator(`[data-product="${food.id}"]`).count(),
        1,
      );
      const mixed = {
        request: "cash-live-mixed-" + name,
        location_id: cash2,
        guest: "Черга Каса Два",
        cash_given: 100000,
        card_amount: 0,
        items: [
          { id: drink.id, qty: 2 },
          { id: food.id, qty: 1 },
        ],
      };
      const o = await post("order", mixed);
      assert.equal((await post("order", mixed)).id, o.id);
      await post("order", {
        request: "cash-live-base-" + name,
        guest: "Черга База",
        cash_given: 100000,
        card_amount: 0,
        items: [{ id: drink.id, qty: 1 }],
      });
      await page.evaluate(async () => {
        await refresh(true);
        change("bar");
      });
      const barNav = page.locator(
        '.drawer-links [data-view="bar"][data-location=""]',
      );
      assert.equal(await barNav.locator(".drawer-unit-count").count(), 2);
      assert.equal(
        await barNav.locator(`[data-cash="${cash2}"]`).textContent(),
        "2",
      );
      await page.evaluate((id) => change("delivery", id), delivery);
      assert.equal(
        await page.locator(`[data-order="${o.id}"] .queue-item`).count(),
        1,
      );
      assert.equal(
        await page
          .locator(`[data-order="${o.id}"] .queue-item b`)
          .textContent(),
        food.name,
      );
      await page.evaluate((id) => change("bar", id), bar2);
      assert.equal(
        await page.locator(`[data-order="${o.id}"] .queue-item`).count(),
        2,
      );
      await page.locator(`[data-order="${o.id}"] .queue-item`).first().click();
      await page.waitForFunction(() => !issuingOrder);
      await page.evaluate(() => change("bar"));
      assert.equal(
        await page
          .locator(`[data-order="${o.id}"] .queue-item.item-issued`)
          .count(),
        1,
      );
      await page.locator(`[data-order="${o.id}"] > button.primary`).click();
      await page.waitForFunction(() => !issuingOrder);
      await page.evaluate((id) => change("bar", id), bar2);
      await page.locator(".empty-state .empty-icon svg").waitFor();
      assert.equal(await page.locator(`[data-order="${o.id}"]`).count(), 0);
      assert.equal(
        await barNav.locator(`[data-cash="${cash2}"]`).count(),
        0,
        "zero source badge remains",
      );
      await page.evaluate((id) => change("delivery", id), delivery);
      await page.locator(`[data-order="${o.id}"] > button.primary`).click();
      await page.waitForFunction(() => !issuingOrder);
      await page.locator(".empty-state .empty-icon svg").waitFor();
      await page.evaluate(() => change("delivery"));
      assert.equal(
        await page.locator(`[data-order="${o.id}"]`).count(),
        0,
        "shared food queue did not synchronize",
      );
      await page.evaluate(() => {
        change("history");
        statsTabChange("online");
      });
      await page.locator(".live-dashboard").waitFor();
      assert.equal(
        await page
          .locator(".stats-tabs button")
          .nth(2)
          .getAttribute("aria-pressed"),
        "true",
      );
      assert(await page.locator(".stats-select select").isDisabled());
      const count = await page.evaluate(() => liveStatsLast.r.order_count);
      await post("order", {
        request: "live-update-" + name,
        location_id: cash2,
        cash_given: 100000,
        card_amount: 0,
        items: [{ id: drink.id, qty: 1 }],
      });
      await page.waitForFunction(
        (count) => liveStatsLast.r.order_count === count + 1,
        count,
        { timeout: 22000 },
      );
      await page.locator(".live-data summary").click();
      for (const palette of ["coffee", "standard"])
        for (const mode of ["light", "dark"])
          for (const width of [1440, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.evaluate(
              ({ palette, mode }) => {
                setCafePalette(palette, false);
                setCafeTheme(mode, false, false);
              },
              { palette, mode },
            );
            await page.waitForTimeout(220);
            assert(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
              "dashboard overflow " + width,
            );
            assert.deepEqual(
              (await contrast(page, "#main")).problems,
              [],
              name + " live " + palette + "/" + mode + "/" + width,
            );
            if (palette === "coffee" && [1440, 390].includes(width)) {
              await page.evaluate(
                () => (document.querySelector("#main").scrollTop = 0),
              );
              await page.screenshot({
                path: path.join(
                  __dirname,
                  "../..",
                  `cash-live-${online ? "online" : "android"}-${name}-${mode}-${width}.png`,
                ),
              });
            }
          }
      await page.route("**/api/stats?*live=1", (r) =>
        r.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "offline fixture" }),
        }),
      );
      await page.evaluate(() => statistics());
      await page.locator(".live-status.is-stale").waitFor();
      assert.equal(await page.locator(".live-kpi").count(), 5);
      assert(
        await page.locator(".live-data").evaluate((e) => e.open),
        "expanded graph data collapsed on refresh",
      );
      await page.unroute("**/api/stats?*live=1");
      await page.route("**/api/stats?*live=1", (r) =>
        r.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: "revoked" }),
        }),
      );
      await page.evaluate(() => statistics());
      await page
        .getByRole("status")
        .filter({ hasText: "Доступ до статистики обмежено" })
        .waitFor();
      assert.equal(await page.locator(".live-kpi").count(), 0);
      await page.unroute("**/api/stats?*live=1");
      await page.evaluate(() => change("locations"));
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const heading = await page
            .locator(".locations-heading h2")
            .boundingBox(),
          create = await page
            .getByRole("button", { name: "Створити локацію", exact: true })
            .boundingBox();
        assert(
          Math.abs(
            heading.y + heading.height / 2 - (create.y + create.height / 2),
          ) < 4,
          "location heading row",
        );
      }
      assert.equal(
        await page
          .locator(".location-list-row .location-kind-icon svg")
          .count(),
        7,
      );
      assert(
        await page
          .locator(".location-open")
          .first()
          .evaluate((b) => {
            const children = [...b.children];
            return (
              children.indexOf(b.querySelector("b")) <
              children.indexOf(b.querySelector(".location-color"))
            );
          }),
      );
      await post("session/end", {});
      await page.evaluate(async () => {
        await refresh(true);
        change("history");
        statsTabChange("online");
      });
      await page
        .getByRole("heading", { name: "Немає відкритої сесії", exact: true })
        .waitFor();
      assert.equal(await page.locator(".live-dashboard").count(), 0);
      const denied = await context.request.get(
        url + "/api/stats?session=1&live=1",
        {
          headers: online
            ? { Cookie: "__Host-minicafe_session=" + "4".repeat(64) }
            : {
                "X-Cafe-Key": (
                  await (
                    await context.request.get(url + "/api/access", { headers })
                  ).json()
                ).bar,
              },
        },
      );
      assert.equal(denied.status(), 403);
      assert.deepEqual(errors, []);
      console.log(
        "PASS " +
          name +
          (online ? " online" : " Android") +
          ": compact catalog, headerless editor/partition UI, source stock, no cross-route duplication, shared bars, cash badges, SVG empties, live auto/stale/session-end graphs, themes and finance access",
      );
    } finally {
      if (original && context) {
        const r = await context.request.post(url + "/api/restore", {
          headers,
          data: original,
        });
        assert(r.ok(), "fixture restore failed");
      }
      await browser.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
