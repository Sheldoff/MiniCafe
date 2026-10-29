const { chromium, webkit, base, key, chromeOptions } = require("./helpers.cjs");
(async () => {
  let b = await chromium.launch({ headless: true, ...chromeOptions }),
    p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto(base + "/?key=" + key + "#cash");
  await p.locator('[data-product="1"]').waitFor();
  await p.evaluate(() => {
    window.events = [];
    let old = Element.prototype.animate;
    Element.prototype.animate = function (f, o) {
      events.push({ cls: this.className, f, o });
      return old.call(this, f, o);
    };
  });
  await p.locator('[data-product="1"]').click();
  await p.locator("#cartTab").click();
  await p.waitForTimeout(250);
  if (
    !(await p.evaluate(() =>
      events.some((e) => e.f[0].transform === "translateX(100%)"),
    ))
  )
    throw Error("forward animation");
  await p.evaluate(() => change("history"));
  await p.locator(".history-record").first().waitFor();
  await p.locator(".history-record summary").first().click();
  await p.waitForTimeout(350);
  if (
    !(await p
      .locator(".history-record")
      .first()
      .evaluate((e) => e.open))
  )
    throw Error("details open");
  await p.locator(".history-record summary").first().click();
  await p.waitForTimeout(350);
  if (
    await p
      .locator(".history-record")
      .first()
      .evaluate((e) => e.open)
  )
    throw Error("details close");
  await p.locator(".stats-tabs button").nth(1).click();
  await p.locator("#reportDocument").waitFor();
  if (
    !(await p.evaluate(() =>
      events.some(
        (e) =>
          e.cls === "stats-pane" && e.f[0].transform === "translateX(28px)",
      ),
    ))
  )
    throw Error("stats motion");
  await p.evaluate(() => change("menu"));
  await p.locator("#productSearch").fill("Кру");
  await p.waitForTimeout(250);
  if ((await p.locator(".editor-product").count()) !== 1) throw Error("search");
  await p.locator("#productSearch").fill("");
  await p.waitForTimeout(250);
  await p.screenshot({
    path: process.env.CAFE_SCREENSHOT || "work/tests/results/menu.png",
  });
  await b.close();
  console.log(
    "PASS forward cashier, history expand/collapse, independent stats pane, menu search",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
