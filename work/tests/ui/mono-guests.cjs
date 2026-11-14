const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium, webkit, chromeOptions, base, key } = require("./helpers.cjs");
const { contrast } = require("./contrast.cjs");
const online = process.env.CAFE_MONO_ONLINE === "1";
const url = online
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
    let original;
    const context = await browser.newContext({
      viewport: { width: 390, height: 950 },
    });
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
    const post = async (route, data) => {
      const r = await context.request.post(url + "/api/" + route, {
        headers,
        data,
      });
      assert(r.ok(), route + ": " + (await r.text()));
      return r.json();
    };
    try {
      original = await (
        await context.request.get(url + "/api/backup", { headers })
      ).json();
      const fixture = structuredClone(original);
      Object.assign(fixture, {
        orders: [],
        sessions: [],
        locations: [],
        calculator_expenses: [],
        active_session: 0,
        issue_undo: {},
        next_guest_number: 1,
      });
      for (const p of fixture.products) {
        delete p.stock;
        delete p.stock_by_cash;
        delete p.unavailable_at;
        p.active = 1;
        p.sold_out = false;
      }
      await post("restore", fixture);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        url + (online ? "/admin#cash" : "/?key=" + key + "#cash"),
      );
      await page.waitForFunction(() => hasServerState);
      assert.equal(
        await page.locator("#guest").getAttribute("placeholder"),
        "Гість №1",
      );
      assert.equal(await page.locator("#guest").inputValue(), "");
      const product = fixture.products.find((p) => p.active),
        pid = product.id;
      async function sale(guest, expected) {
        await page.evaluate(
          ({ pid, guest }) => {
            add(pid);
            document.querySelector("#guest").value = guest;
          },
          { pid, guest },
        );
        await page.evaluate(() => send());
        await page.waitForFunction(() => cart.length === 0 && !busy);
        const backup = await (
          await context.request.get(url + "/api/backup", { headers })
        ).json();
        assert.equal(backup.orders.at(-1).guest, expected);
      }
      await sale("", "Гість №1");
      await sale("Олена", "Олена");
      assert.equal(
        await page.locator("#guest").getAttribute("placeholder"),
        "Гість №2",
      );
      await sale("", "Гість №2");
      await page.evaluate(() => {
        change("locations");
        locationsPage("cash");
      });
      await page.locator("#guestNameRequired").check();
      await page.locator("#locationForm [type=submit]").click();
      await page.waitForFunction(() =>
        data.locations.some((l) => l.id === "cash" && l.guest_name_required),
      );
      await page.evaluate((pid) => {
        change("cash");
        add(pid);
      }, pid);
      await page.evaluate(() => send());
      assert.equal(
        await page.locator("#guest").getAttribute("aria-invalid"),
        "true",
      );
      assert.equal(await page.evaluate(() => cart.length), 1);
      await page.evaluate(() => {
        document.querySelector("#guest").value = "Іван";
      });
      await page.evaluate(() => send());
      await page.waitForFunction(() => cart.length === 0);
      assert.equal(await page.evaluate(() => data.next_guest_number), 3);
      await page.evaluate(() => change("appearance"));
      await page.getByRole("button", { name: /Чорно-біла/ }).click();
      await page.reload();
      await page.waitForFunction(() => hasServerState);
      assert.equal(
        await page.evaluate(() => document.documentElement.dataset.palette),
        "mono",
      );
      for (const mode of ["light", "dark"]) {
        await page.evaluate((mode) => setCafeTheme(mode, true, false), mode);
        for (const view of [
          "cash",
          "bar",
          "delivery",
          "menu",
          "calculator",
          "history",
          "server",
          "locations",
          "transactions",
          "appearance",
          "developer",
        ]) {
          await page.evaluate((v) => change(v), view);
          await page.waitForTimeout(230);
          const c = await contrast(page);
          assert.deepEqual(c.problems, [], mode + "/" + view + " contrast");
          const colored = await page.evaluate(() => {
            const bad = [];
            for (const el of document.querySelectorAll("body *")) {
              if (
                !el.getBoundingClientRect().width ||
                el.closest(
                  "svg,.appearance-swatches,.location-presets,.location-color",
                ) ||
                el.matches("img,input[type=color]")
              )
                continue;
              const s = getComputedStyle(el);
              for (const prop of [
                "color",
                "backgroundColor",
                "borderTopColor",
                "outlineColor",
                "boxShadow",
              ]) {
                for (const m of s[prop].matchAll(
                  /rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([\d.]+))?\)/g,
                )) {
                  if (m[4] !== undefined && Number(m[4]) === 0) continue;
                  if (
                    Math.max(+m[1], +m[2], +m[3]) -
                      Math.min(+m[1], +m[2], +m[3]) >
                    2
                  )
                    bad.push(
                      el.tagName + "." + el.className + " " + prop + "=" + m[0],
                    );
                }
              }
            }
            return bad.slice(0, 12);
          });
          assert.deepEqual(
            colored,
            [],
            mode + "/" + view + " monochrome colors",
          );
        }
        await page.evaluate(() => {
          change("cash");
          productFeedback(data.products[0].id, "add-feedback");
          showCashPanel(true);
        });
        await page.waitForTimeout(60);
        assert.equal(
          await page.evaluate(() => {
            const s = getComputedStyle(
              document.querySelector(".tile-feedback"),
            );
            const a = s.backgroundColor.match(/\d+/g);
            return a[0] === a[1] && a[1] === a[2];
          }),
          true,
          "feedback animation gray",
        );
        await page.evaluate(() => change("history"));
        await page.waitForTimeout(160);
        assert(
          await page.evaluate(() =>
            document
              .querySelector("#main")
              .firstElementChild.classList.contains("stats-tabs"),
          ),
        );
        await page.locator(".stats-tabs button").nth(2).click();
        await page.locator(".live-dashboard").waitFor();
        assert(await page.locator(".stats-select").isHidden());
        await page.locator(".stats-tabs button").nth(0).click();
        assert(await page.locator(".stats-select").isVisible());
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 950 });
          await page.evaluate(() => change("menu"));
          await page.waitForTimeout(160);
          assert(
            await page
              .getByRole("heading", { name: "Меню та ціни", exact: true })
              .isVisible(),
          );
          assert.equal(
            await page.getByText("У меню", { exact: true }).count(),
            0,
          );
          assert(
            (await page.locator(".editor-product").first().boundingBox())
              .height < 115,
            "Compact menu row",
          );
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          );
        }
        await page.screenshot({
          path: path.join(
            __dirname,
            "../../mono-guests-" +
              (online ? "online" : "android") +
              "-" +
              name +
              "-" +
              mode +
              ".png",
          ),
        });
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(() => {
        change("cash");
        showCashPanel(true);
        setCafeTheme("light", true, false);
      });
      assert.deepEqual(errors, []);
      console.log(
        "PASS " +
          name +
          " " +
          (online ? "online" : "Android") +
          ": guest placeholders/required/name sequence, mono all screens/contrast/feedback, reload, compact menu and current live session",
      );
    } finally {
      if (original) await post("restore", original);
      await browser.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
