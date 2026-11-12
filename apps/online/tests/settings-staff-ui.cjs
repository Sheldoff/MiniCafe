const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  chromium,
  webkit,
  chromeOptions,
} = require("../../../work/tests/ui/helpers.cjs");
const base = process.env.CAFE_CLOUD_TEST_URL || "http://127.0.0.1:8791";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Local server only");
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const b = await engine.launch({ headless: true, ...options });
    try {
      const p = await b.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.setExtraHTTPHeaders({
        Cookie: "__Host-minicafe_session=" + "1".repeat(64),
      });
      await p.goto(base + "/admin");
      await p.waitForFunction(() => hasServerState);
      await p.evaluate(() => change("server"));
      await p.waitForFunction(
        () =>
          document.querySelector("#settingsExtras")?.children[1]
            ?.textContent === "Доступи працівників",
      );
      const labels = await p
        .locator("#settingsExtras>button")
        .allTextContents();
      assert.equal(labels[0], "Локації");
      assert.equal(labels[1], "Доступи працівників");
      assert.equal(labels.at(-1), "Вийти з акаунта");
      await p.waitForFunction(
        () =>
          document.querySelector("#publicMenuToggle")?.dataset.enabled !==
          undefined,
      );
      await p.waitForTimeout(80);
      await p.screenshot({
        path: "../../outputs/settings-3.52-" + name + ".png",
      });
      const menu = labels.findIndex((t) => t.startsWith("Гостьове меню"));
      assert.equal(
        labels.findIndex((t) => t.startsWith("Онлайн-оплата")),
        menu + 1,
      );
      await p.getByRole("button", { name: "Оформлення", exact: true }).click();
      await p.evaluate(() => handleAppBack());
      await p.waitForFunction(() => view === "server");
      await p.getByRole("button", { name: "Оформлення", exact: true }).click();
      await p.goBack();
      await p.waitForFunction(() => view === "server");
      await p.evaluate(() => toggleDrawer(true));
      await p.waitForTimeout(320);
      assert.equal(
        await p
          .getByRole("button", { name: "Закрити меню", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await p
          .locator("#themeToggle")
          .evaluate((e) => getComputedStyle(e).borderTopWidth),
        "0px",
      );
      assert.ok(await p.locator(".drawer-links .nav-symbol").count());
      await p.evaluate(() => toggleDrawer(false));
      await p
        .getByRole("button", { name: "Доступи працівників", exact: true })
        .click();
      await p.locator("#staffForm").waitFor();
      assert.ok(
        await p
          .locator('#staffForm option[value="bar@loc-' + "9".repeat(32) + '"]')
          .count(),
        "custom location automatically offered",
      );
      const id = name === "Chrome" ? "990000071" : "990000072";
      await p.evaluate(async (id) => {
        await cloudStaffWrite({
          telegram_id: id,
          role: "bar@loc-" + "9".repeat(32),
          enabled: true,
        });
        await loadCloudStaff();
      }, id);
      const row = p
        .locator(".staff-entry")
        .filter({ has: p.locator('.staff-name[data-id="' + id + '"]') });
      assert.equal(
        await row
          .getByRole("button", { name: "Відкликати", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await row
          .getByRole("button", { name: "Редагувати", exact: true })
          .count(),
        1,
      );
      await row.locator(".staff-name small").click();
      await p.locator("#staffLabelForm input").fill("Оля низ");
      await p.locator("#staffLabelForm .primary").click();
      await row.getByRole("button", { name: "Оля низ", exact: true }).waitFor();
      assert.match(await row.innerText(), new RegExp(id));
      await p.screenshot({ path: "../../outputs/staff-3.52-" + name + ".png" });
      p.once("dialog", (d) => d.accept());
      await row.getByRole("button", { name: "Видалити", exact: true }).click();
      await row.waitFor({ state: "detached" });
      const scopedId = "990000079",
        scopedToken = "8".repeat(64),
        scopedLocation = "loc-" + "5".repeat(32);
      await p.evaluate(
        async ({ id, location }) =>
          cloudStaffWrite({
            telegram_id: id,
            role: "cash",
            location,
            enabled: true,
          }),
        { id: scopedId, location: scopedLocation },
      );
      const digest = createHash("sha256").update(scopedToken).digest("hex");
      const seeded = spawnSync(
        process.execPath,
        [
          "node_modules/wrangler/bin/wrangler.js",
          "d1",
          "execute",
          "DB",
          "--local",
          "--command",
          `INSERT OR REPLACE INTO auth_sessions VALUES('${digest}','${scopedId}','Scoped','${"2".repeat(64)}',${Math.floor(Date.now() / 1000) + 3600});`,
        ],
        { encoding: "utf8" },
      );
      assert.equal(seeded.status, 0);
      const scoped = await b.newPage({ viewport: { width: 390, height: 844 } });
      scoped.on("pageerror", (e) => errors.push(e.message));
      await scoped.setExtraHTTPHeaders({
        Cookie: "__Host-minicafe_session=" + scopedToken,
      });
      await scoped.goto(base + "/admin");
      await scoped.waitForFunction(() => hasServerState);
      assert.equal(await scoped.evaluate(() => activeLocation), scopedLocation);
      assert.equal(
        await scoped.evaluate(() => renderedCashLocation),
        scopedLocation,
      );
      assert.equal(
        await scoped.locator('.drawer-links [data-view="cash"]').count(),
        1,
      );
      await scoped.evaluate(() => change("server"));
      assert.equal(
        await scoped
          .getByRole("button", { name: "Доступи працівників", exact: true })
          .count(),
        0,
      );
      await scoped.close();
      assert.deepEqual(errors, []);
      console.log(
        "PASS " +
          name +
          ": settings order/icons, adjacent toggles, footer logout, appearance Back, drawer controls, scoped staff options and cosmetic rename/delete",
      );
    } finally {
      await b.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
