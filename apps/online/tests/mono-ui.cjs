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
      await p.route("**/api/public/menu", async (route) => {
        const r = await route.fetch();
        const j = await r.json();
        await route.fulfill({ json: { ...j, online_payment: true } });
      });
      await p.route("**/api/public/code", async (route) => {
        created++;
        const input = route.request().postDataJSON();
        if (input.mode === "code")
          assert.equal(input.payment_request, undefined);
        else assert.match(input.payment_request, /^[a-f0-9]{64}$/);
        if (input.mode === "code") {
          await route.fulfill({
            json: { code: "123", expires_in: 1800, total: 5000 },
          });
          return;
        }
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
      await p.locator("#payInMono").waitFor();
      await p.locator("#paymentHelp summary").click();
      assert.equal(
        await p.locator("#paymentReference").inputValue(),
        "MC-1234567890ABCDEF",
      );
      assert.equal(
        await p.locator("#paymentManualLink").getAttribute("href"),
        "https://send.monobank.ua/jar/5wkP16948Q?a=50.00",
      );
      await p.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: () => Promise.reject(Error("denied")) },
        });
        document.execCommand = () => false;
      });
      await p.locator("#payInMono").click();
      assert.match(
        await p.locator("#paymentCopyStatus").innerText(),
        /не дозволив/,
      );
      assert.ok(p.url().startsWith("http://127.0.0.1:8795"));
      assert.match(await p.locator("#paymentStatus").innerText(), /Очікуємо/);
      await p.locator("#dialogClose").click();
      await p.locator("#guestSubmit").click();
      assert.equal(created, 1);
      await p.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text) =>
              localStorage.setItem("test-copied-reference", text),
          },
        }),
      );
      await p.route("https://send.monobank.ua/**", (route) =>
        route.fulfill({
          body: "Bank navigation test only",
          contentType: "text/html",
        }),
      );
      await p.locator("#payInMono").click();
      await p.waitForURL("https://send.monobank.ua/jar/5wkP16948Q?a=50.00");
      await p.goto("http://127.0.0.1:8795");
      assert.equal(
        await p.evaluate(() => localStorage.getItem("test-copied-reference")),
        "MC-1234567890ABCDEF",
      );
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
      await p.locator('#foodList [data-step="1"]').first().click();
      await p.locator("#guestFullName").fill("Гість Коду");
      assert.equal(await p.locator("#guestSubmit").isVisible(), true);
      await p.locator("#guestCodeSubmit").click();
      await p.locator(".code").waitFor();
      assert.equal((await p.locator(".code").innerText()).trim(), "123");
      await p.locator("[data-close]").click();
      assert.equal(await p.locator("#guestSubmit").isVisible(), false);
      assert.equal(
        await p.locator("#guestCodeSubmit").innerText(),
        "Показати код",
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
