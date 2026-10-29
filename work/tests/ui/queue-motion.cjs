const assert = require("assert");
const { chromium, webkit, base, key, chromeOptions } = require("./helpers.cjs");
(async () => {
  for (const [name, engine, options] of [
    ["Chrome", chromium, chromeOptions],
    ["WebKit", webkit, {}],
  ]) {
    const browser = await engine.launch({ headless: true, ...options });
    const signatures = [];
    for (const route of ["bar", "delivery"]) {
      const page = await browser.newPage({
        viewport: { width: 800, height: 1000 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "/?key=" + key + "#" + route);
      await page.waitForFunction(
        () => hasServerState && !!document.querySelector(".queue-grid"),
      );
      await page.waitForTimeout(250);
      await page.evaluate(() => {
        clearTimeout(pollTimer);
        refresh = async () => true;
        data.orders = [];
        orders();
        window.queueLog = [];
        const original = Element.prototype.animate;
        Element.prototype.animate = function (frames, options) {
          queueLog.push({
            cls: this.className,
            frames,
            duration: options.duration,
            easing: options.easing,
          });
          return original.call(this, frames, options);
        };
        window.addQueueFixture = () => {
          data.orders = [
            {
              id: 99901,
              guest: "Анімація",
              created: "2026-10-23 10:00:00",
              items: [
                {
                  id: 99902,
                  name: "Тест",
                  qty: 1,
                  route: view === "bar" ? "bar" : "instant",
                  status: "new",
                  unit_issued: [false],
                },
              ],
            },
          ];
          orders();
        };
        addQueueFixture();
      });
      const incoming = await page.evaluate(() =>
        queueLog.find((e) => e.cls === "card"),
      );
      assert(incoming, "live arrival on " + route);
      await page.route("**/api/issue", (r) =>
        r.fulfill({ json: { ok: true } }),
      );
      // Issue during the entrance: one owner must take over the transform.
      await page.evaluate(() =>
        issue(
          99901,
          view === "bar" ? "bar" : "instant",
          document.querySelector("article .primary"),
        ),
      );
      await page.waitForFunction(
        () => !issuingOrder && !!document.querySelector(".empty-state"),
      );
      const empty = await page.evaluate(() =>
        queueLog.find((e) => String(e.cls).includes("empty-state")),
      );
      assert(empty, "last issued card must reveal the empty queue");
      assert.deepEqual(
        {
          frames: empty.frames,
          duration: empty.duration,
          easing: empty.easing,
        },
        {
          frames: incoming.frames,
          duration: incoming.duration,
          easing: incoming.easing,
        },
      );
      await page.waitForTimeout(300);
      assert.equal(
        await page
          .locator(".empty-state")
          .evaluate((e) => getComputedStyle(e).opacity),
        "1",
      );
      assert.equal(
        await page
          .locator(".queue-grid")
          .evaluate((e) => e.style.minHeight + e.style.position),
        "",
      );
      assert.equal(await page.locator("article").count(), 0);
      await page.evaluate(() => addQueueFixture());
      await page.waitForTimeout(260);
      await page.evaluate(() => {
        data.orders[0].items[0].unit_issued = [true];
        data.orders[0].items[0].status = "delivered";
        orders();
      });
      await page.waitForTimeout(260);
      await page.route("**/api/undo-issue", (r) =>
        r.fulfill({ json: { ok: true } }),
      );
      await page.evaluate(async () => {
        refresh = async () => {
          data.orders[0].items[0].status = "new";
          data.orders[0].items[0].unit_issued = [false];
          return true;
        };
        data.can_undo_issue[view === "bar" ? "bar" : "instant"] = true;
        document.querySelector(".undo-issue").disabled = false;
        queueLog.length = 0;
        await undoIssue(
          view === "bar" ? "bar" : "instant",
          document.querySelector(".undo-issue"),
        );
      });
      const returned = await page.evaluate(() =>
        queueLog.find((e) => e.cls === "card"),
      );
      assert.deepEqual(
        {
          frames: returned.frames,
          duration: returned.duration,
          easing: returned.easing,
        },
        {
          frames: incoming.frames,
          duration: incoming.duration,
          easing: incoming.easing,
        },
      );
      assert.equal(await page.locator(".issue-locked").count(), 0);
      assert.equal(
        await page
          .locator("article")
          .evaluate((e) => getComputedStyle(e).transform),
        "none",
      );
      signatures.push({
        frames: incoming.frames,
        duration: incoming.duration,
        easing: incoming.easing,
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await page.evaluate(
          () =>
            queueEntrance(document.querySelector("article")).effect.getTiming()
              .duration,
        ),
        0,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    assert.deepEqual(
      signatures[0],
      signatures[1],
      "both serving tabs share exactly the same entrance",
    );
    const page = await browser.newPage();
    await page.goto(base + "/?key=" + key + "#calculator");
    await page.waitForFunction(
      () => hasServerState && !!document.querySelector(".calc-row"),
    );
    const list = await page.evaluate(async () => {
      clearTimeout(pollTimer);
      const box = document.createElement("div");
      document.querySelector("#main").append(box);
      const rows = (n) =>
        (box.innerHTML = Array.from(
          { length: n },
          (_, i) =>
            `<div class="stress-row" data-motion-key="${i}" style="height:24px">${i}</div>`,
        ).join(""));
      animateList(box, () => rows(50), ".stress-row");
      animateList(box, () => rows(80), ".stress-row");
      const layoutFrames = [...box.querySelectorAll(".stress-row")]
        .flatMap((e) => e.getAnimations())
        .flatMap((a) => a.effect.getKeyframes())
        .some((f) => "height" in f || "paddingTop" in f);
      animateList(box, () => rows(20), ".stress-row");
      animateList(box, () => rows(40), ".stress-row");
      await Promise.allSettled(
        box.getAnimations({ subtree: true }).map((a) => a.finished),
      );
      return {
        layoutFrames,
        count: box.querySelectorAll(".stress-row").length,
        ghosts: box.querySelectorAll(".list-removal-ghost").length,
        running: box.getAnimations({ subtree: true }).length,
        willChange: getComputedStyle(document.querySelector("#tiles") || box)
          .willChange,
      };
    });
    assert.equal(
      list.layoutFrames,
      false,
      "large list entrances only use opacity/transform",
    );
    assert.equal(list.count, 40);
    assert.equal(list.ghosts, 0);
    assert.equal(list.running, 0);
    assert.equal(list.willChange, "auto");
    await browser.close();
    console.log(
      "PASS " +
        name +
        ": identical serving entrances/returns/empty queues, issue during entrance, restored layout/locks, reduced motion, interrupted large lists without height animation or lingering layers",
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
