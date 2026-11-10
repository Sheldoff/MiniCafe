const assert = require("node:assert/strict");
const path = require("node:path");
const { contrast } = require("./contrast.cjs");
const { chromium, webkit, chromeOptions, base, key } = require("./helpers.cjs");
const online = process.env.CAFE_COFFEE_ONLINE === "1";
const url = online ? process.env.CAFE_CLOUD_TEST_URL : base;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url))
  throw Error("Local server required");
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const b = await engine.launch({ headless: true, ...options });
    try {
      const p = await b.newPage({ viewport: { width: 390, height: 844 } }),
        errors = [],
        reports = [];
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("dialog", (d) => d.accept());
      if (online)
        await p.setExtraHTTPHeaders({
          Cookie: "__Host-minicafe_session=" + "1".repeat(64),
        });
      await p.goto(
        url + (online ? "/admin#server" : "/?key=" + key + "#server"),
      );
      await p.waitForFunction(() => hasServerState);
      assert.equal(
        await p.evaluate(() => document.documentElement.dataset.palette),
        "coffee",
      );
      await p.getByRole("button", { name: "Оформлення", exact: true }).click();
      await p.getByRole("button", { name: /Кавова/ }).click();
      assert.equal(
        await p.evaluate(() => localStorage.getItem("minicafe-palette")),
        "coffee",
      );
      await p.reload();
      await p.waitForFunction(() => hasServerState);
      assert.equal(
        await p.evaluate(() => document.documentElement.dataset.palette),
        "coffee",
      );
      for (const mode of ["light", "dark"]) {
        await p.evaluate((mode) => {
          data.locations = [];
          setCafeTheme(mode, false, false);
        }, mode);
        for (const v of [
          "cash",
          "bar",
          "delivery",
          "history",
          "menu",
          "calculator",
          "server",
          "locations",
          "transactions",
          "appearance",
          "developer",
        ]) {
          await p.evaluate((v) => change(v), v);
          await p.waitForTimeout(260);
          reports.push({ view: mode + "/" + v, ...(await contrast(p)) });
          const green = await p.evaluate(() => {
            const bad = [];
            for (const el of document.querySelectorAll("body *")) {
              if (
                !el.getBoundingClientRect().width ||
                el.matches("img,svg,svg *, .appearance-swatches *")
              )
                continue;
              const s = getComputedStyle(el);
              for (const prop of [
                "color",
                "backgroundColor",
                "borderTopColor",
                "boxShadow",
              ]) {
                for (const m of s[prop].matchAll(
                  /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/g,
                )) {
                  const [r, g, b] = m.slice(1, 4).map(Number);
                  if (Number(m[4] ?? 1) > 0.05 && g > r + 8 && g > b + 5)
                    bad.push([el.className, prop, m[0]]);
                }
              }
            }
            return bad;
          });
          assert.deepEqual(green, [], mode + "/" + v + ": stale green");
          if (v === "cash") {
            await p.evaluate(() => {
              add(1);
              showCashPanel(true, true);
            });
            await p.waitForTimeout(250);
            reports.push({ view: mode + "/cart", ...(await contrast(p)) });
          }
        }
        await p.evaluate(() => {
          change("cash");
          toggleDrawer(true);
        });
        await p.waitForTimeout(260);
        reports.push({ view: mode + "/drawer", ...(await contrast(p)) });
        assert.ok(
          await p
            .locator("#drawerRefresh img")
            .evaluate((e) => e.complete && e.naturalWidth > 0),
        );
        await p.screenshot({
          path: path.join(
            __dirname,
            "../..",
            `coffee-${online ? "online" : "android"}-${name}-${mode}.png`,
          ),
        });
        await p.evaluate(() => toggleDrawer(false));
        await p.waitForTimeout(220);
        // Feedback keyframes and WAAPI sum highlight use the active palette.
        const animation = await p.evaluate(async () => {
          change("cash");
          showCashPanel(true, true);
          const el = document.querySelector("#sum");
          highlightAmount(el, "old");
          const frames = el
            .getAnimations()
            .flatMap((a) => a.effect.getKeyframes());
          return {
            frames,
            pulse: getComputedStyle(document.documentElement)
              .getPropertyValue("--amount-pulse")
              .trim(),
          };
        });
        assert.ok(
          animation.frames.some(
            (f) => f.backgroundColor && f.backgroundColor !== "transparent",
          ),
        );
        assert.ok(animation.pulse);
        for (const color of [
          "#ffffff",
          "#000000",
          "#777777",
          "#ffeb3b",
          "#0057b8",
        ]) {
          await p.evaluate((color) => {
            data.locations = [
              { id: "cash", kind: "cash", name: "Каса", color },
            ];
            change("cash");
          }, color);
          await p.waitForTimeout(200);
          reports.push({
            view: mode + "/location-" + color,
            ...(await contrast(p, "header")),
          });
        }
      }
      const problems = reports.flatMap((r) =>
        r.problems.map((e) => ({ view: r.view, ...e })),
      );
      const unique = [
        ...new Map(problems.map((p) => [p.view + p.cls + p.fg, p])).values(),
      ];
      assert.deepEqual(unique, []);
      await p.evaluate(() => {
        data.locations = [];
        change("appearance");
        setCafePalette("standard", false);
      });
      assert.equal(
        await p.evaluate(() => document.documentElement.dataset.palette),
        undefined,
      );
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${name} ${online ? "online" : "Android"}: Coffee persistence, ${reports.reduce((n, r) => n + r.checked, 0)} text contrasts, all screens/no stale green, feedback and location colors`,
      );
    } finally {
      await b.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
