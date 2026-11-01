const assert = require("node:assert/strict");
const {
  chromium,
  webkit,
  chromeOptions,
} = require("../../../work/tests/ui/helpers.cjs");
const base = process.env.CAFE_CLOUD_TEST_URL || "http://127.0.0.1:8791";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Local server required");
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const browser = await engine.launch({ headless: true, ...options });
    try {
      const p = await browser.newPage({
        viewport: { width: 390, height: 844 },
        userAgent: "MiniCafeAndroidOnline",
      });
      await p.setExtraHTTPHeaders({
        Cookie: "__Host-minicafe_session=" + "1".repeat(64),
      });
      await p.goto(base + "/admin");
      await p.locator("[data-product]").first().waitFor();
      assert.equal(await p.evaluate(() => window.CafeNative), false);
      assert.equal(await p.evaluate(() => window.CafeAndroidOnline), true);
      await p.evaluate(() => {
        window.CafeNative = false;
        window.CafeAndroidOnline = true;
        window.savedFiles = [];
        window.CafeOnlineFiles = {
          save(data, kind) {
            window.savedFiles.push({ data, kind });
          },
        };
      });
      await p.evaluate(() => cloudBackup());
      const backup = await p.evaluate(() => savedFiles[0]);
      assert.equal(backup.kind, "json");
      assert.equal(
        JSON.parse(Buffer.from(backup.data, "base64").toString()).format,
        "minicafe-android-1",
      );
      await p.evaluate(async () => {
        statsCurrent = { session: 0 };
        await cloudSaveBlob(
          new Blob(["%PDF-test"], { type: "application/pdf" }),
          "report.pdf",
        );
      });
      const pdf = await p.evaluate(() => savedFiles[1]);
      assert.equal(pdf.kind, "pdf");
      assert.equal(Buffer.from(pdf.data, "base64").toString(), "%PDF-test");
      assert.equal(await p.evaluate(() => window.CafeNative), false);
      await p.evaluate(() => {
        window.transfers = [];
        window.CafeMenuTransfer = {
          transfer(direction, code) {
            transfers.push({ direction, code });
          },
        };
        change("server");
      });
      await p
        .getByRole("button", { name: "Меню телефона ↔ сайт", exact: true })
        .click();
      p.once("dialog", (d) => d.accept());
      await p
        .getByRole("button", { name: "Телефон → сайт", exact: true })
        .click();
      await p.waitForFunction(() => transfers.length === 1);
      const transfer = await p.evaluate(() => transfers[0]);
      assert.equal(transfer.direction, "upload");
      assert.match(transfer.code, /^[a-f0-9]{64}$/);
      await p.evaluate(() => {
        window.CafeCloud.role = "bar";
        change("server");
      });
      assert.equal(
        await p
          .getByRole("button", { name: "Меню телефона ↔ сайт", exact: true })
          .count(),
        0,
      );
      console.log(
        "PASS " +
          name +
          ": online WebView flags and native JSON/PDF save handoff (mock native interface)",
      );
    } finally {
      await browser.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
