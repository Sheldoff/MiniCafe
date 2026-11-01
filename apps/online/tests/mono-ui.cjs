const assert = require("node:assert/strict");
const {
  chromium,
  webkit,
  chromeOptions,
} = require("../../../work/tests/ui/helpers.cjs");
(async () => {
  for (const [name, engine, opts] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const b = await engine.launch({ headless: true, ...opts });
    try {
      const p = await b.newPage({
        viewport: { width: 390, height: 844 },
        colorScheme: "dark",
      });
      let paid = false,
        created = 0;
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.route("**/api/public/code", async (route) => {
        created++;
        const input = route.request().postDataJSON();
        assert.match(input.payment_request, /^[a-f0-9]{64}$/);
        await route.fulfill({
          json: {
            payment: true,
            token: input.payment_request,
            reference: "MC-1234567890ABCDEF",
            total: 5000,
            expires: Math.floor(Date.now() / 1000) + 1800,
            jar_url: "https://send.monobank.ua/jar/5wkP16948Q",
          },
        });
      });
      await p.route("**/api/public/payment-status", (route) =>
        route.fulfill({
          json: paid
            ? { status: "fulfilled", order_id: 42 }
            : { status: "waiting", order_id: null },
        }),
      );
      await p.goto("http://127.0.0.1:8795");
      await p.locator("#guestFullName").fill("Іван Петренко");
      await p.locator('#foodList [data-step="1"]').first().click();
      await p.locator("#guestSubmit").click();
      await p.locator("#paymentReference").waitFor();
      assert.equal(
        await p.locator("#paymentReference").inputValue(),
        "MC-1234567890ABCDEF",
      );
      assert.equal(
        await p.locator("a.primary").getAttribute("href"),
        "https://send.monobank.ua/jar/5wkP16948Q",
      );
      assert.match(await p.locator("#paymentStatus").innerText(), /Очікуємо/);
      await p.locator("#dialogClose").click();
      await p.locator("#guestSubmit").click();
      assert.equal(created, 1);
      paid = true;
      await p.reload();
      await p.waitForFunction(() =>
        document.querySelector("#paymentStatus")?.textContent.includes("№42"),
      );
      await p.locator("[data-new-order]").click();
      assert.equal(
        await p.evaluate(() =>
          localStorage.getItem("minicafe-pending-payment"),
        ),
        null,
      );
      assert.deepEqual(errors, []);
      console.log(
        name +
          ": payment instructions, reference, waiting, duplicate prevention, reload recovery, paid queue status OK",
      );
    } finally {
      await b.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
