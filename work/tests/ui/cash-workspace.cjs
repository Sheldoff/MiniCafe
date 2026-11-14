const assert = require("node:assert/strict"),
  path = require("node:path");
const { chromium, webkit, chromeOptions, base, key } = require("./helpers.cjs");
const { contrast } = require("./contrast.cjs");
const online = process.env.CAFE_WORKSPACE_ONLINE === "1",
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
    const b = await engine.launch({ headless: true, ...options }),
      context = await b.newContext({ viewport: { width: 390, height: 1000 } });
    let original;
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
    if (online) await context.setExtraHTTPHeaders({ Cookie: headers.Cookie });
    const read = async (route) =>
      await (
        await context.request.get(url + "/api/" + route, { headers })
      ).json();
    const post = async (route, data) => {
      const r = await context.request.post(url + "/api/" + route, {
        headers,
        data,
      });
      assert(r.ok(), route + ": " + (await r.text()));
      return r.json();
    };
    try {
      original = await read("backup");
      const f = structuredClone(original);
      Object.assign(f, {
        orders: [],
        sessions: [],
        locations: [],
        calculator_expenses: [],
        active_session: 0,
        issue_undo: {},
        next_guest_number: 1,
        next_guest_numbers: {},
      });
      for (const p of f.products) {
        delete p.stock;
        delete p.stock_by_cash;
        delete p.unavailable_at;
        p.active = 1;
        p.sold_out = false;
      }
      await post("restore", f);
      const cash = "loc-" + "cd".repeat(16),
        product = f.products[0];
      await post("location/save", {
        id: cash,
        name: "Каса низ",
        kind: "cash",
        color: "#2857A3",
        targets: ["bar", "delivery"],
        guest_prefix: "Н",
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("dialog", (d) => d.accept());
      await page.goto(
        url + (online ? "/admin#locations" : "/?key=" + key + "#locations"),
      );
      await page.waitForFunction(() => hasServerState);
      await page.evaluate((id) => locationsPage(id), cash);
      await page.locator("#locationColorHex").fill("#6B3D85");
      assert.equal(
        (await page.locator("#locationColor").inputValue()).toLowerCase(),
        "#6b3d85",
      );
      await page.locator("#colorR").fill("40");
      assert.equal(
        await page.locator("#locationColorHex").inputValue(),
        "#283D85",
      );
      await page.locator("#guestPrefix").fill("низ ");
      await page.locator("#locationForm [type=submit]").click();
      await page.waitForFunction(
        (id) =>
          data.locations.find((l) => l.id === id)?.guest_prefix === "низ ",
        cash,
      );
      await page.locator("#locationForm").waitFor({ state: "detached" });
      assert.equal(
        (await read("backup")).locations
          .find((l) => l.id === cash)
          .color.toLowerCase(),
        "#283d85",
      );
      for (const palette of ["standard", "coffee", "mono"])
        for (const mode of ["light", "dark"]) {
          await page.evaluate(
            ({ palette, mode, cash }) => {
              setCafePalette(palette, false);
              setCafeTheme(mode, false, false);
              change("cash", cash);
            },
            { palette, mode, cash },
          );
          await page.waitForTimeout(160);
          assert.equal(
            (
              await page.evaluate(() =>
                getComputedStyle(document.documentElement)
                  .getPropertyValue("--location-color")
                  .trim(),
              )
            ).toLowerCase(),
            "#283d85",
          );
          const c = await contrast(page);
          assert.deepEqual(
            c.problems,
            [],
            palette + "/" + mode + " location contrast",
          );
        }
      const makeSale = async (id, guest = "") => {
        await page.evaluate(
          ({ id, guest, pid }) => {
            change("cash", id);
            add(pid);
            document.querySelector("#guest").value = guest;
          },
          { id, guest, pid: product.id },
        );
        await page.evaluate(() => send());
        await page.waitForFunction(() => !busy && cart.length === 0);
      };
      await makeSale("");
      await makeSale(cash);
      await makeSale(cash, "Олена");
      await makeSale(cash);
      const backup = await read("backup");
      assert.deepEqual(
        backup.orders.map((o) => o.guest),
        ["Гість №1", "низ 1", "Олена", "низ 2"],
      );
      assert.equal(
        await page.locator("#guest").getAttribute("placeholder"),
        "Гість №3",
      );
      await page.evaluate(() => loadCardPayments());
      assert.equal(await page.locator(".card-payment-row").count(), 3);
      await page.evaluate(() => change("cash"));
      await page.waitForFunction(() => cardPaymentRows.length === 1);
      assert.equal(
        await page.locator(".card-payment-row b").innerText(),
        "Гість №1",
      );
      await page.evaluate(() => change("history"));
      await page.locator("#sessionNameForm button").click();
      await page.locator("#editSessionTitle").fill("Вечірня зміна");
      await page.locator("#orderDialog button.primary").click();
      await page.locator("#orderDialog").waitFor({ state: "detached" });
      await page.waitForFunction(() =>
        data.sessions.some((s) => s.name === "Вечірня зміна"),
      );
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(120);
        const select = await page.locator(".stats-period select").boundingBox(),
          end = await page.locator(".stats-end-session").boundingBox(),
          field = await page.locator("#sessionNameForm button").boundingBox();
        assert(
          Math.abs(select.y + select.height - end.y - end.height) < 3,
          "Period/end on one row",
        );
        assert(
          Math.abs(select.y + select.height - field.y - field.height) < 3,
          "Name on same row",
        );
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
      }
      await page.setViewportSize({ width: 390, height: 1000 });
      const swipe = async (
        dx,
        dy = 0,
        selector = ".stats-heading h2",
        edge = false,
      ) =>
        page.evaluate(
          ({ dx, dy, selector, edge }) => {
            const target = document.querySelector(selector),
              x = edge ? 10 : 240,
              y = 180;
            const fire = (type, points, changed = points) => {
              const event = new Event(type, {
                bubbles: true,
                cancelable: true,
              });
              Object.defineProperties(event, {
                touches: { value: points },
                changedTouches: { value: changed },
              });
              target.dispatchEvent(event);
            };
            fire("touchstart", [{ identifier: 7, clientX: x, clientY: y }]);
            fire("touchmove", [
              { identifier: 7, clientX: x + dx, clientY: y + dy },
            ]);
            fire(
              "touchend",
              [],
              [{ identifier: 7, clientX: x + dx, clientY: y + dy }],
            );
          },
          { dx, dy, selector, edge },
        );
      await swipe(-170);
      await page.waitForFunction(() => statsTab === "report");
      await page.locator("#reportDocument").waitFor();
      await swipe(10, 150);
      assert.equal(await page.evaluate(() => statsTab), "report");
      await swipe(-170, 0, ".stats-period select");
      assert.equal(await page.evaluate(() => statsTab), "report");
      await swipe(-170, 0, ".stats-heading h2", true);
      assert.equal(await page.evaluate(() => statsTab), "report");
      await swipe(-170);
      await page.waitForFunction(() => statsTab === "online");
      await page.locator(".order-timeline").waitFor();
      assert(await page.locator(".stats-select").isHidden());
      assert.equal(
        await page.locator(".live-toolbar button,.live-toolbar h2").count(),
        0,
      );
      assert.equal(await page.locator(".minute-lane").count(), 2);
      await page
        .locator("details[data-timeline-slot]")
        .first()
        .evaluate((el) => (el.open = true));
      assert(
        (await page.locator(".order-timeline").innerText()).includes(
          product.name,
        ),
      );
      await page.getByLabel("Показник", { exact: true }).selectOption("qty");
      await page
        .getByLabel("Каса для порівняння", { exact: true })
        .selectOption(cash);
      await page
        .getByLabel("Показник оплати", { exact: true })
        .selectOption("count");
      const comparison = page
        .getByRole("heading", { name: "Порівняння", exact: true })
        .locator("..");
      assert.equal(
        await comparison.locator(".live-breakdown b").innerText(),
        "3",
      );
      assert.equal(
        await page.locator(".minute-lane details").count(),
        2,
        "one marker per cash/minute includes simultaneous orders",
      );
      const slot = page.locator("details[data-timeline-slot]").first();
      await slot.evaluate((el) => (el.open = true));
      await page.evaluate(() => statistics());
      await page.waitForFunction(
        () => document.querySelector("details[data-timeline-slot]")?.open,
      );
      await page.waitForFunction(
        () =>
          !document
            .querySelector("#statisticsContent")
            .hasAttribute("aria-busy"),
      );
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => statsTab), "online");
      assert.equal(
        await page.locator(".stats-tabs .selected").innerText(),
        "Онлайн",
      );
      const c = await contrast(page);
      assert.deepEqual(c.problems, [], "timeline contrast");
      await page.screenshot({
        path: path.join(
          __dirname,
          "../../cash-workspace-" +
            (online ? "online" : "android") +
            "-" +
            name +
            ".png",
        ),
      });
      await swipe(170);
      await page.waitForFunction(() => statsTab === "report");
      if (online) {
        let hidden = false;
        await page.route("**/api/payments/history**", (route) => {
          const p = new URL(route.request().url()).pathname;
          if (p.endsWith("/hide") || p.endsWith("/clear")) {
            hidden = true;
            return route.fulfill({ json: { ok: true } });
          }
          return route.fulfill({
            json: {
              payments: hidden
                ? []
                : [
                    {
                      reference: "MC-CCCCCCCCCCCCCCCC",
                      guest: "Тест банку",
                      total: 5000,
                      status: "fulfilled",
                      created: Math.floor(Date.now() / 1000),
                      order_id: 1,
                    },
                  ],
              next_before: null,
            },
          });
        });
      }
      await page.evaluate(() => change("server"));
      assert.equal(await page.locator(".settings-panel > h2").count(), 0);
      await page.evaluate(() => change("transactions"));
      await page.locator(".transaction-row").first().waitFor();
      if (online) {
        await page.locator("[data-payment-hide]").click();
        await page.waitForFunction(
          () => !document.querySelector("[data-payment-hide]"),
        );
      }
      await page.locator("[data-transaction] button").first().click();
      await page.waitForFunction(
        () => document.querySelectorAll("[data-transaction]").length === 3,
      );
      const before = await read("stats?session=" + backup.active_session);
      await page.locator("#clearTransactions").click();
      await page.waitForFunction(
        () => !document.querySelector("[data-transaction]"),
      );
      assert.equal(
        (await read("stats?session=" + backup.active_session)).revenue,
        before.revenue,
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(() => change("history"));
      await swipe(-170);
      await page.waitForFunction(() => statsTab === "online");
      assert.deepEqual(errors, []);
      console.log(
        "PASS " +
          name +
          " " +
          (online ? "online" : "Android") +
          ": exact cash prefixes/counters and ledgers, palette-independent color/HEX/RGB, one-row session rename, guarded stats swipes, live product lanes and safe history controls",
      );
    } finally {
      if (original) await post("restore", original);
      await b.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
