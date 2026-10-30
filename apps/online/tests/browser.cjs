const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  chromium,
  webkit,
  chromeOptions,
} = require("../../../work/tests/ui/helpers.cjs");
const base = "http://127.0.0.1:8791";
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const b = await engine.launch({ headless: true, ...options });
    const p = await b.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    try {
      await p.goto(base);
      await p.locator("h1").waitFor();
      await p.setExtraHTTPHeaders({
        Cookie: "__Host-minicafe_session=" + "1".repeat(64),
      });
      await p.goto(base + "/admin");
      await p.locator('[data-product="1"]').waitFor();
      assert.equal(await p.evaluate(() => window.CafeCloud.role), "admin");
      assert.equal(await p.locator(".cloud-test-note").count(), 0);
      await p.waitForFunction(() => {
        const i = document.querySelector('[data-product="1"] img');
        return i?.complete && i.naturalWidth > 0;
      });
      await p.locator('[data-product="1"]').tap();
      await p.locator("#cartTab").tap();
      await p.locator("#guest").fill("Тест браузера " + name);
      await p.locator("#send").tap();
      await p.waitForFunction(() => !busy && cart.length === 0);
      await p.evaluate(() => change("bar"));
      await p.locator(".queue-grid article").first().waitFor();
      await p.evaluate(() => change("history"));
      await p.waitForFunction(() => document.querySelector(".history-record"));
      await p.evaluate(() => statsTabChange("report"));
      await p.locator("#reportDocument").waitFor();
      const download = p.waitForEvent("download", { timeout: 60000 });
      await p
        .getByRole("button", {
          name: "Завантажити статистику PDF",
          exact: true,
        })
        .click();
      const f = await download,
        path = await f.path();
      assert.ok(
        fs.readFileSync(path).subarray(0, 5).equals(Buffer.from("%PDF-")),
      );
      await p.evaluate(() => change("menu"));
      await p.locator("#editorProducts").waitFor();
      await p.evaluate(() => change("calculator"));
      await p.locator("#calcRows").waitFor();
      await p.evaluate(() => {
        change("server");
        toggleCafeTheme();
      });
      await p
        .getByRole("button", { name: "Зберегти резервну копію", exact: true })
        .waitFor();
      await p.evaluate(() => cloudStaff());
      await p
        .locator('#staffForm input[name="identifier"]')
        .fill("+1 (202) 555-0199");
      await p.locator("#staffForm button.primary").click();
      const phoneRow = p
        .locator("#cloudStaff .row")
        .filter({ hasText: "+12025550199" });
      await phoneRow.locator('[onclick*="cloudStaffEdit"]').click();
      await p.locator('#staffForm select[name="role"]').selectOption("bar");
      await p.locator("#staffForm button.primary").click();
      await phoneRow.filter({ hasText: "Бариста" }).waitFor();
      p.once("dialog", (dialog) => dialog.accept());
      await phoneRow.locator('[onclick*="cloudStaffRevoke"]').click();
      await phoneRow.filter({ hasText: "вимкнено" }).waitFor();
      p.once("dialog", (dialog) => dialog.accept());
      await phoneRow.locator('[onclick*="cloudStaffDelete"]').click();
      await phoneRow.waitFor({ state: "detached" });
      await p.evaluate(() => change("server"));
      assert.equal(
        await p
          .getByRole("button", { name: "Меню телефона ↔ сайт", exact: true })
          .count(),
        0,
      );
      await p.evaluate(() => change("menu-transfer")); // Hidden return route used by the existing APK.
      p.once("dialog", (dialog) => dialog.accept());
      await p
        .getByRole("button", { name: "Сайт → телефон", exact: true })
        .click();
      await p.locator(".transfer-code").waitFor();
      assert.match(
        await p.locator(".transfer-code").inputValue(),
        /^[a-f0-9]{64}$/,
      );
      await p.evaluate(() => change("cash"));
      await p.screenshot({
        path: `../../outputs/cloud-${name}-phone.png`,
        fullPage: true,
      });
      await p.setViewportSize({ width: 1280, height: 900 });
      await p.screenshot({
        path: `../../outputs/cloud-${name}-desktop.png`,
        fullPage: true,
      });
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      console.log(
        "PASS " +
          name +
          ": no-key entry, images, cashier submit, queue, history/report, Cyrillic PDF download, editor, calculator, cloud settings, dark theme/responsive",
      );
    } finally {
      await b.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
