const assert = require("node:assert/strict");
const {
  chromium,
  webkit,
  chromeOptions,
} = require("../../../work/tests/ui/helpers.cjs");
const base = "http://127.0.0.1:8791";
const headers = {
  Cookie: "__Host-minicafe_session=" + "1".repeat(64),
  "X-CSRF-Token": "2".repeat(64),
  Origin: base,
  "Content-Type": "application/json",
};
const post = async (path, body) => {
  const r = await fetch(base + "/api/" + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return r.json();
};
(async () => {
  const r = await fetch(base + "/api/backup", { headers });
  assert.equal(r.status, 200);
  const original = await r.json();
  try {
    for (const [name, engine, options] of [
      ["Chrome", chromium, chromeOptions],
      ["WebKit", webkit, {}],
    ]) {
      const browser = await engine.launch({ headless: true, ...options });
      try {
        const p = await browser.newPage({
          viewport: { width: 390, height: 844 },
          reducedMotion: "reduce",
        });
        await p.setExtraHTTPHeaders({ Cookie: headers.Cookie });
        const product = await post("product", {
          name: "Залишок тест",
          category: "Їжа",
          route: "instant",
          price: 5000,
          stock: 1,
          stock_estimated: false,
          active: true,
        });
        await p.goto(base + "/admin");
        await p.locator(`[data-product="${product.id}"]`).waitFor();
        await p.locator(`[data-product="${product.id}"]`).press("Enter");
        await p.waitForFunction(() => cart.length === 1);
        await p.locator("#cartTab").click();
        assert.equal(await p.locator("#guest").inputValue(), "");
        assert.equal(await p.locator("#guest").getAttribute("required"), null);
        await p.locator("#send").click();
        await p.waitForFunction(
          (id) =>
            !busy &&
            cart.length === 0 &&
            data.products.find((x) => x.id === id).stock === 0,
          product.id,
        );
        assert.equal(
          await p
            .locator(`[data-product="${product.id}"]`)
            .getAttribute("aria-disabled"),
          "true",
        );
        await p.evaluate((id) => {
          change("menu");
          editProduct(id);
        }, product.id);
        assert.equal(await p.locator("#pestimated").isChecked(), false);
        await p.locator("#pestimated").check();
        await p.getByRole("button", { name: "Зберегти", exact: true }).click();
        await p.waitForFunction(
          (id) =>
            data.products.find((x) => x.id === id).stock_estimated === true,
          product.id,
        );
        await p.evaluate(() => change("cash"));
        assert.equal(
          await p
            .locator(`[data-product="${product.id}"]`)
            .getAttribute("aria-disabled"),
          "false",
        );
        await p.locator(`[data-product="${product.id}"]`).press("Enter");
        await p.waitForFunction(() => cart.length === 1);
        await p.locator("#cartTab").click();
        await p.locator("#send").click();
        await p.waitForFunction(
          (id) => !busy && data.products.find((x) => x.id === id).stock === -1,
          product.id,
        );
        await p.evaluate((id) => {
          change("menu");
          editProduct(id);
          change("developer");
          change("menu");
        }, product.id);
        assert.equal(await p.locator("#pstock").inputValue(), "-1");
        assert.equal(await p.locator("#pestimated").isChecked(), true);
        console.log(
          "PASS " +
            name +
            ": optional guest, strict zero disabled, estimated negative available, checkbox save and draft retention",
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    await post("restore", original);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
