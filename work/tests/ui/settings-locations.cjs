const assert = require("node:assert/strict"),
  path = require("node:path");
const { chromium, webkit, base, key, chromeOptions } = require("./helpers.cjs");
const online = process.env.CAFE_SETTINGS_ONLINE === "1",
  url = online ? process.env.CAFE_CLOUD_TEST_URL : base;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url))
  throw Error("Disposable local server required");
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const b = await engine.launch({ headless: true, ...options });
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
    let context, original;
    try {
      context = await b.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      });
      if (online) await context.setExtraHTTPHeaders({ Cookie: headers.Cookie });
      const backup = await context.request.get(url + "/api/backup", {
        headers,
      });
      assert.equal(backup.status(), 200);
      original = await backup.json();
      original.locations ||= [];
      const p = await context.newPage(),
        errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("dialog", (dialog) => dialog.accept());
      await p.goto(
        url + (online ? "/admin#server" : "/?key=" + key + "#server"),
      );
      await p.waitForFunction(() => hasServerState);
      await p.locator("#settingsExtras").waitFor();
      assert.equal(
        await p.locator('.drawer-tools [data-view="server"]').innerText(),
        "Налаштування",
      );
      await p.getByRole("button", { name: "Локації", exact: true }).click();
      assert.equal(await p.locator(".location-list-row").count(), 3);
      await p
        .getByRole("button", { name: "Створити локацію", exact: true })
        .click();
      await p.locator("#locationKind").selectOption("delivery");
      await p.locator("#locationName").fill("Видача низ тест");
      await p.locator("#locationColor").fill("#446688");
      await p.locator("#locationForm [type=submit]").click();
      await p.waitForFunction(() =>
        data.locations?.some((l) => l.name === "Видача низ тест"),
      );
      await p.waitForFunction(() => !!document.querySelector(".location-list"));
      const delivery = await p.evaluate(
        () => data.locations.find((l) => l.name === "Видача низ тест").id,
      );
      await p
        .getByRole("button", { name: "Створити локацію", exact: true })
        .click();
      await p.locator("#locationName").fill("Каса низ тест");
      await p.locator("#locationColor").fill("#eecc44");
      for (const checkbox of await p.locator("#locationTargets input").all())
        await checkbox.uncheck();
      await p.locator(`#locationTargets input[value="${delivery}"]`).check();
      await p.locator('#locationTargets input[value="bar"]').check();
      await p.locator("#locationForm [type=submit]").click();
      await p.waitForFunction(() =>
        data.locations?.some((l) => l.name === "Каса низ тест"),
      );
      const cashId = await p.evaluate(
        () => data.locations.find((l) => l.name === "Каса низ тест").id,
      );
      const nav = await p.locator(".drawer-links button").allTextContents();
      assert.ok(nav.indexOf("Каса низ тест") === nav.indexOf("Каса") + 1);
      assert.ok(nav.indexOf("Видача низ тест") > nav.indexOf("Видача"));
      await p
        .getByRole("button", {
          name: "Редагувати Видача низ тест",
          exact: true,
        })
        .click();
      await p.locator("#linkedCash").selectOption(cashId);
      await p.locator("#locationForm [type=submit]").click();
      await p.locator(".location-list").waitFor();
      assert.equal(
        await p.locator("button").filter({ hasText: /^←/ }).count(),
        0,
      );
      const foodId = await p.evaluate(
        () => data.products.find((p) => p.route === "instant" && p.active).id,
      );
      await p.evaluate((id) => change("delivery", id), delivery);
      await p.locator(".availability-heading").click();
      await p
        .locator(`.availability-toggle[onclick="availability(${foodId})"]`)
        .click();
      await p.waitForFunction(
        ({ foodId, cashId }) =>
          data.products
            .find((p) => p.id === foodId)
            .unavailable_at?.includes(cashId),
        { foodId, cashId },
      );
      await p.waitForFunction(
        (id) =>
          document
            .querySelector(
              `.availability-toggle[onclick="availability(${id})"]`,
            )
            ?.textContent.includes("Закінчилось · повернути"),
        foodId,
      );
      await p.evaluate((id) => change("cash", id), cashId);
      assert.equal(await p.locator(`[data-product="${foodId}"]`).count(), 0);
      await p.evaluate(() => change("cash"));
      assert.equal(await p.locator(`[data-product="${foodId}"]`).count(), 1);
      const blocked = await context.request.post(url + "/api/order", {
        headers,
        data: {
          request: "blocked-local-" + name,
          location_id: cashId,
          guest: "Тест",
          items: [{ id: foodId, qty: 1 }],
          cash_given: 10000,
          card_amount: 0,
        },
      });
      assert.equal(blocked.status(), 400);
      await p.evaluate((id) => change("delivery", id), delivery);
      await p.locator(".availability-heading").click();
      await p
        .locator(`.availability-toggle[onclick="availability(${foodId})"]`)
        .click();
      await p.waitForFunction(
        ({ foodId, cashId }) =>
          !data.products
            .find((p) => p.id === foodId)
            .unavailable_at?.includes(cashId),
        { foodId, cashId },
      );
      const cashNav = p.locator(`.drawer-links [data-location="${cashId}"]`),
        baseNav = p.locator(
          '.drawer-links [data-view="cash"][data-location=""]',
        );
      assert.equal(
        await cashNav.evaluate((b) => getComputedStyle(b).paddingLeft),
        await baseNav.evaluate((b) => getComputedStyle(b).paddingLeft),
      );
      assert.equal(
        await cashNav.evaluate((b) => getComputedStyle(b).borderColor),
        "rgb(238, 204, 68)",
      );
      await p.evaluate((id) => change("cash", id), cashId);
      assert.equal(
        await p
          .locator("header")
          .evaluate((h) => getComputedStyle(h).backgroundColor),
        "rgb(238, 204, 68)",
      );
      assert.equal(
        await p
          .locator("#drawerToggle")
          .evaluate((b) => getComputedStyle(b).color),
        "rgb(16, 23, 19)",
      );
      await p.locator('[data-product="1"]').click();
      await p.locator("#cartTab").click();
      await p.locator("#guest").fill("Локаційний Гість");
      await p.evaluate(() => change("cash"));
      assert.equal(await p.evaluate(() => cart.length), 0);
      await p.evaluate((id) => change("cash", id), cashId);
      await p.locator("#cartTab").click();
      assert.equal(await p.locator("#guest").inputValue(), "Локаційний Гість");
      assert.equal(await p.evaluate(() => cart.length), 1);

      await p.route("**/api/order", async (route) => {
        const response = await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.fulfill({ response });
      });
      await p.locator("#send").click();
      await p.waitForFunction(() => busy);
      await p.evaluate(() => {
        change("cash");
        add(1);
        document.querySelector("#guest").value = "Інша чернетка";
      });
      await p.waitForFunction(() => !busy);
      assert.equal(await p.evaluate(() => cart.length), 1);
      assert.equal(await p.locator("#guest").inputValue(), "Інша чернетка");
      await p.unroute("**/api/order");
      await p.evaluate((id) => change("cash", id), cashId);
      assert.equal(await p.evaluate(() => cart.length), 0);
      const order = await p.evaluate(() =>
        data.orders.find((o) => o.guest === "Локаційний Гість"),
      );
      assert.equal(order.cash_location, cashId);
      assert.deepEqual(
        order.items[0].destinations.map((d) => d.id),
        ["bar", delivery],
      );
      assert.equal(order.cash_location_color, "#eecc44");
      await p.screenshot({
        path: path.join(
          __dirname,
          "../..",
          `location-cash-${online ? "online" : "android"}-${name}.png`,
        ),
      });
      await p.locator("#cartTab").click();
      await p.locator(`[data-card-payment="${order.id}"]`).waitFor();
      assert.equal(
        await p
          .locator(`[data-card-payment="${order.id}"] span > b`)
          .innerText(),
        "Локаційний Гість",
      );
      await p.evaluate(() => change("delivery"));
      assert.equal(await p.locator(`[data-order="${order.id}"]`).count(), 0);
      await p.evaluate(() => change("bar"));
      await p.locator(`[data-order="${order.id}"]`).waitFor();
      assert.equal(
        await p.locator(`[data-order="${order.id}"] .order-source`).innerText(),
        "Каса низ тест",
      );
      assert.equal(
        await p
          .locator(`[data-order="${order.id}"] > .primary`)
          .evaluate((b) => getComputedStyle(b).backgroundColor),
        "rgb(238, 204, 68)",
      );
      await p.screenshot({
        path: path.join(
          __dirname,
          "../..",
          `location-source-${online ? "online" : "android"}-${name}.png`,
        ),
      });
      await p.evaluate((id) => change("delivery", id), delivery);
      await p.locator(`[data-order="${order.id}"]`).waitFor();
      await p.locator(`[data-order="${order.id}"] > .primary`).click();
      await p
        .locator(`[data-order="${order.id}"]`)
        .waitFor({ state: "detached" });
      await p.evaluate(() => change("bar"));
      assert.equal(await p.locator(`[data-order="${order.id}"]`).count(), 0);
      await p.evaluate((id) => change("delivery", id), delivery);
      await p.locator(".undo-issue").click();
      await p.locator(`[data-order="${order.id}"]`).waitFor();
      await p.evaluate(() => change("bar"));
      await p.locator(`[data-order="${order.id}"]`).waitFor();
      await p.evaluate(() => change("transactions"));
      await p.locator(`[data-transaction="${order.id}"]`).waitFor();
      await p.locator(`[data-transaction="${order.id}"] button`).click();
      await p
        .locator(`[data-transaction="${order.id}"]`)
        .waitFor({ state: "detached" });
      await p.evaluate(() => change("menu"));
      await p.locator("#editorToggle").click();
      assert.equal(await p.locator(".product-list-panel").isVisible(), false);
      await p.locator("#pname").fill("Збережена чернетка");
      await p.locator("#editorBack").click();
      await p.locator(".product-list-panel").waitFor();
      await p.locator("#editorToggle").click();
      assert.equal(
        await p.locator("#pname").inputValue(),
        "Збережена чернетка",
      );
      await p.evaluate(() => change("calculator"));
      await p.evaluate(() => additionalExpenseDialog());
      await p.locator("#extraCost").fill("12.34");
      await p.locator("#extraNote").fill("Помилкові витрати");
      await p.locator("#extraSave").click();
      await p.locator("#orderDialog").waitFor({ state: "detached" });
      await p
        .locator(".calc-extra-row")
        .filter({ hasText: "Помилкові витрати" })
        .click();
      await p.locator("#extraDelete").click();
      await p.locator("#orderDialog").waitFor({ state: "detached" });
      assert.equal(
        await p
          .locator(".calc-extra-row")
          .filter({ hasText: "Помилкові витрати" })
          .count(),
        0,
      );
      await p.evaluate(() => change("server"));
      await p.locator("#onlinePayToggle").click();
      await p.waitForFunction(() => data.online_payment_enabled === false);
      await p.screenshot({
        path: path.join(
          __dirname,
          "../..",
          `settings-${online ? "online" : "android"}-${name}.png`,
        ),
      });
      const fs = require("node:fs");
      const photoFolder = path.join(
        __dirname,
        "../../android/assets/default-menu",
      );
      const photo = fs
        .readFileSync(
          path.join(
            photoFolder,
            fs.readdirSync(photoFolder).find((f) => f.endsWith(".jpg")),
          ),
        )
        .toString("base64");
      await p.evaluate(async (image) => {
        const product = data.products.find((p) => p.active);
        await post("product", { ...product, image });
      }, photo);
      const enabled = await context.request.post(url + "/api/public-settings", {
        headers,
        data: { enabled: true },
      });
      assert.equal(enabled.status(), 200);

      await p.evaluate(() => change("locations"));
      await p
        .getByRole("button", { name: "Редагувати Бариста", exact: true })
        .click();
      assert.equal(await p.locator("#locationKind").isDisabled(), true);
      await p.locator("#locationName").fill("Бариста головний");
      await p.locator("#locationColor").fill("#2255aa");
      await p.locator("#locationForm [type=submit]").click();
      await p.locator(".location-list").waitFor();
      await p.evaluate(() => change("bar"));
      assert.equal(
        await p
          .locator("header")
          .evaluate((h) => getComputedStyle(h).backgroundColor),
        "rgb(34, 85, 170)",
      );
      await p.evaluate(() => setCafeTheme("dark", false));
      assert.equal(
        await p
          .locator("header")
          .evaluate((h) => getComputedStyle(h).backgroundColor),
        "rgb(34, 85, 170)",
      );
      await p.evaluate(() => setCafeTheme("light", false));
      await p.evaluate(() => change("locations"));
      await p
        .getByRole("button", { name: "Створити локацію", exact: true })
        .click();
      await p.locator("#locationKind").selectOption("delivery");
      await p.locator("#locationName").fill("Тимчасова");
      await p.locator("#locationForm [type=submit]").click();
      await p.locator(".location-list").waitFor();
      await p
        .getByRole("button", { name: "Редагувати Тимчасова", exact: true })
        .click();
      await p.goBack();
      await p.locator(".location-list").waitFor();
      await p
        .getByRole("button", { name: "Редагувати Тимчасова", exact: true })
        .click();
      await p.locator("#locationKind").selectOption("bar");
      await p.locator("#locationForm [type=submit]").click();
      await p.locator(".location-list").waitFor();
      assert.equal(
        await p.evaluate(
          () => data.locations.find((l) => l.name === "Тимчасова").kind,
        ),
        "bar",
      );
      await p
        .getByRole("button", { name: "Видалити Тимчасова", exact: true })
        .click();
      await p.waitForFunction(
        () => !data.locations.some((l) => l.name === "Тимчасова"),
      );
      assert.equal(await p.locator(".location-list-row").count(), 5);
      await p.screenshot({
        path: path.join(
          __dirname,
          "../..",
          `location-list-${online ? "online" : "android"}-${name}.png`,
        ),
      });

      await p.evaluate(() => change("themes"));
      await p.locator('[data-palette-choice="cafe"]').click();
      assert.equal(
        await p.evaluate(() => localStorage.getItem("minicafe-palette")),
        "cafe",
      );
      assert.equal(
        await p.locator("button").filter({ hasText: /^←/ }).count(),
        0,
      );
      await p.reload();
      await p.waitForFunction(() => hasServerState);
      assert.equal(
        await p.evaluate(() => document.documentElement.dataset.palette),
        "cafe",
      );
      assert.equal(
        await p
          .locator("header")
          .evaluate((h) => getComputedStyle(h).backgroundColor),
        "rgb(75, 46, 31)",
      );
      await p.evaluate(() => setCafeTheme("dark", false));
      assert.equal(
        await p.evaluate(() => document.documentElement.dataset.palette),
        "cafe",
      );
      await p.evaluate(() => themesPage());
      await p.waitForTimeout(220);
      await p.screenshot({
        path: path.join(
          __dirname,
          "../..",
          `cafe-palette-${online ? "online" : "android"}-${name}.png`,
        ),
      });
      await p.evaluate(() => {
        setCafeTheme("light", false);
        setCafePalette("standard");
      });
      const guest = await context.newPage();
      guest.on("pageerror", (e) => errors.push(e.message));
      await guest.addInitScript(() =>
        Object.defineProperty(window.crypto, "getRandomValues", {
          value: undefined,
        }),
      );
      await guest.goto(url + (online ? "/" : "/guest"));
      await guest.locator("#foodList .menu-row").first().waitFor();
      assert.equal(await guest.locator("#guestSubmit").isVisible(), false);
      assert.ok((await guest.locator(".guest-product-photo").count()) > 0);
      await guest.waitForFunction(() => {
        const image = document.querySelector(".guest-product-photo");
        return image?.complete && image.naturalWidth > 0;
      });
      await guest.locator("#guestCodeSubmit").click();
      await guest.getByRole("heading", { name: "Оберіть позиції" }).waitFor();
      await guest.locator("#dialogActions [data-close]").click();
      await guest.locator("#guestFullName").fill("Відвідувач Тест");
      await guest.locator('#foodList [data-step="1"]').first().click();
      await guest.locator("#guestCodeSubmit").click();
      await guest.locator(".code").waitFor();
      assert.match(
        (await guest.locator(".code").innerText()).trim(),
        /^\d{3}$/,
      );
      await guest.screenshot({
        path: path.join(
          __dirname,
          "../..",
          `guest-cards-${online ? "online" : "android"}-${name}.png`,
        ),
      });
      const firstCode = (await guest.locator(".code").innerText()).trim();
      const productId = await p.evaluate(
        () => data.products.find((p) => p.active && !p.sold_out).id,
      );
      const second = await context.request.post(url + "/api/public/code", {
        headers,
        data: {
          mode: "code",
          guest: "Другий Гість",
          items: [{ id: productId, qty: 1 }],
        },
      });
      assert.equal(second.status(), 200);
      const secondCode = (await second.json()).code;
      const loadCode = async (code, locationId) => {
        await p.evaluate((id) => change("cash", id), locationId);
        await p.locator("[data-guest-code]").click();
        await p.locator("#guestCodeInput").fill(code);
        await p.locator(".cloud-code-form [type=submit]").click();
        await p.waitForFunction(
          () =>
            mobileCart &&
            cart.length > 0 &&
            !document.querySelector("#orderDialog"),
        );
      };
      await loadCode(firstCode, cashId);
      await loadCode(secondCode, "");
      await p.evaluate((id) => change("cash", id), cashId);
      await p.locator("#cartTab").click();
      await p.locator("#send").click();
      await p.waitForFunction(() => !busy && cart.length === 0);
      let remaining = (
        await (
          await context.request.get(url + "/api/guest-codes", { headers })
        ).json()
      ).codes;
      assert.ok(!remaining.some((c) => c.code === firstCode));
      assert.ok(remaining.some((c) => c.code === secondCode));
      await p.evaluate(() => change("cash"));
      await p.locator("#cartTab").click();
      await p.locator("#send").click();
      await p.waitForFunction(() => !busy && cart.length === 0);
      remaining = (
        await (
          await context.request.get(url + "/api/guest-codes", { headers })
        ).json()
      ).codes;
      assert.ok(!remaining.some((c) => c.code === secondCode));
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${name} ${online ? "online" : "Android"}: locations/forms/menu groups, routed issue/undo, named card ledger, transaction hiding, fullscreen editor/draft, expense deletion, payment toggle and public photo/code`,
      );
    } finally {
      if (original && context) {
        const r = await context.request.post(url + "/api/restore", {
          headers,
          data: original,
        });
        assert.equal(r.status(), 200, "Fixture restore failed");
      }
      await b.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
