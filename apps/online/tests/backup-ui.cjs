const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
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
    const b = await engine.launch({ headless: true, ...options });
    try {
      const p = await b.newPage({
        viewport: { width: 390, height: 844 },
        reducedMotion: "reduce",
      });
      await p.setExtraHTTPHeaders({
        Cookie: "__Host-minicafe_session=" + "1".repeat(64),
      });
      await p.goto("http://127.0.0.1:8791/admin#server");
      await p
        .getByRole("button", { name: "Зберегти резервну копію", exact: true })
        .waitFor();
      const downloaded = p.waitForEvent("download");
      await p
        .getByRole("button", { name: "Зберегти резервну копію", exact: true })
        .click();
      const file = await downloaded;
      const body = fs.readFileSync(await file.path()),
        data = JSON.parse(body);
      assert.equal(data.format, "minicafe-android-1");
      assert.ok(data.products[0].image);
      const folder = fs.mkdtempSync(
          path.join(os.tmpdir(), "minicafe-backup-ui-"),
        ),
        saved = path.join(folder, "portable.json");
      fs.writeFileSync(saved, body);
      const chooser = p.waitForEvent("filechooser");
      await p
        .getByRole("button", { name: "Відновити резервну копію", exact: true })
        .click();
      p.once("dialog", (d) => d.accept());
      const restored = p.waitForResponse(
        (r) =>
          r.url().endsWith("/api/restore") && r.request().method() === "POST",
      );
      await (await chooser).setFiles(saved);
      assert.equal((await restored).status(), 200);
      const image = await p.evaluate(async () => {
        const c = document.createElement("canvas");
        c.width = c.height = 1000;
        const ctx = c.getContext("2d"),
          pixels = ctx.createImageData(1000, 1000);
        for (let n = 0; n < pixels.data.length; n += 4) {
          pixels.data[n] = Math.random() * 255;
          pixels.data[n + 1] = Math.random() * 255;
          pixels.data[n + 2] = Math.random() * 255;
          pixels.data[n + 3] = 255;
        }
        ctx.putImageData(pixels, 0, 0);
        const original = c.toDataURL("image/jpeg", 1).split(",")[1];
        const backup = { products: [{ image: original }] };
        await prepareCloudBackup(backup);
        return {
          before: original.length,
          after: backup.products[0].image.length,
        };
      });
      assert.ok(image.before > 600000 && image.after < 600000);
      console.log(
        "PASS " +
          name +
          ": portable JSON download/confirmed file restore and browser compression for older large menu photos",
      );
    } finally {
      await b.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
