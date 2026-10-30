const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const {
  chromium,
  webkit,
  chromeOptions,
} = require("../../../work/tests/ui/helpers.cjs");
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const seed = spawnSync(process.execPath, ["tests/seed-requests.mjs"], {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
    });
    assert.equal(seed.status, 0, seed.stderr);
    const b = await engine.launch({ headless: true, ...options });
    try {
      const p = await b.newPage({
        viewport: { width: 390, height: 844 },
        reducedMotion: "reduce",
      });
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.setExtraHTTPHeaders({
        Cookie: "__Host-minicafe_session=" + "1".repeat(64),
      });
      await p.goto("http://127.0.0.1:8791/admin#staff");
      await p.locator("#staffForm").waitFor();
      assert.equal(
        await p.getByRole("button", { name: "← Сервер", exact: true }).count(),
        0,
      );
      await p.locator(".request-entry").first().waitFor();
      assert.equal(await p.locator(".request-entry").count(), 2);
      await p
        .locator('[data-request="990000091"][onclick*="requestDetails"]')
        .click();
      await p.locator("#orderDialog").waitFor();
      assert.match(
        await p.locator(".profile-fields").innerText(),
        /12025550101/,
      );
      await p.getByText("Усі дані Telegram", { exact: true }).click();
      assert.match(
        await p.locator(".request-dialog pre").innerText(),
        /is_premium/,
      );
      assert.equal(await p.evaluate(() => window.BAD_PROFILE), undefined);
      await p.getByRole("button", { name: "Закрити", exact: true }).click();
      await p
        .locator('[data-request="990000091"][onclick*="requestApprove"]')
        .click();
      await p.locator("#requestRoleForm select").selectOption("bar");
      await p.locator("#requestRoleForm button.primary").click();
      await p
        .locator("#staffRows .staff-entry")
        .filter({ hasText: "990000091" })
        .filter({ hasText: "Бариста" })
        .waitFor();
      await p.waitForFunction(
        () => document.querySelectorAll(".request-entry").length === 1,
      );
      p.once("dialog", (d) => d.accept());
      await p
        .locator('[data-request="990000092"][onclick*="requestReject"]')
        .click();
      await p.waitForFunction(
        () => document.querySelector("#requestPanel").hidden,
      );
      await p.evaluate(() => change("server"));
      assert.equal(
        await p
          .getByRole("heading", { name: "@test_admin", exact: true })
          .count(),
        1,
      );
      for (const label of [
        "Меню телефона ↔ сайт",
        "Оновити дані",
        "Скопіювати гостьове посилання",
      ])
        assert.equal(
          await p.getByRole("button", { name: label, exact: true }).count(),
          0,
        );
      await p.evaluate(() => change("cash"));
      await p.waitForTimeout(70);
      const bottom = await p
        .locator(".menu-panel")
        .evaluate((e) => e.getBoundingClientRect().bottom);
      assert.ok(
        bottom >= 820 && bottom <= 845,
        "cash menu uses available height: " + bottom,
      );
      await p.evaluate(() => toast("Тест сповіщення"));
      await p.waitForFunction(
        () =>
          getComputedStyle(document.querySelector("#toast")).display === "none",
        {},
        { timeout: 6000 },
      );
      assert.equal(
        await p
          .locator("#toast")
          .evaluate((e) => getComputedStyle(e).pointerEvents),
        "none",
      );
      await p.screenshot({
        path: path.resolve(
          __dirname,
          `../../../outputs/online-layout-${name}.png`,
        ),
        fullPage: true,
      });
      await p.evaluate(() => change("staff"));
      await p.locator("#staffRows .staff-entry").first().waitFor();
      await p.screenshot({
        path: path.resolve(
          __dirname,
          `../../../outputs/online-staff-compact-${name}.png`,
        ),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      console.log(
        "PASS " +
          name +
          ": direct staff route, compact form, safe full profile, role approval/rejection, hidden empty requests, server identity, removed duplicates and viewport/toast",
      );
    } finally {
      await b.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
