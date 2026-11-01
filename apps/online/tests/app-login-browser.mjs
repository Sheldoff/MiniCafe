import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
const require = createRequire(import.meta.url);
const {
  chromium,
  webkit,
  chromeOptions,
} = require("../../../work/tests/ui/helpers.cjs");
const base = process.env.CAFE_CLOUD_TEST_URL || "http://127.0.0.1:8791";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Local server required");
for (const [name, engine, options] of [
  ["Chrome", chromium, chromeOptions],
  ["WebKit", webkit, {}],
]) {
  const browser = await engine.launch({ headless: true, ...options });
  try {
    const page = await browser.newPage();
    const secret = randomBytes(32).toString("hex");
    const challenge = createHash("sha256").update(secret).digest("hex");
    await page.setExtraHTTPHeaders({
      Cookie:
        "__Host-minicafe_session=" +
        "1".repeat(64) +
        "; __Host-minicafe_app=" +
        challenge,
    });
    await page.goto(base + "/auth/app/confirm");
    const requestPromise = page.waitForRequest(
      (r) => r.method() === "POST" && r.url() === base + "/auth/app/confirm",
    );
    const responsePromise = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url() === base + "/auth/app/confirm",
    );
    await page.getByRole("button", { name: "Увійти в застосунок" }).click();
    const request = await requestPromise;
    const response = await responsePromise;
    assert.equal(
      (await request.allHeaders()).origin,
      base,
      name + ": real form must preserve Origin",
    );
    assert.equal(response.status(), 200);
    await page.getByRole("link", { name: "Повернутися в МініКафе" }).waitFor();
    const poll = () =>
      fetch(base + "/api/app/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
    const result = await poll();
    assert.equal(result.status, 200);
    const { session } = await result.json();
    const headers = { Cookie: "__Host-minicafe_session=" + session };
    const me = await (await fetch(base + "/api/me", { headers })).json();
    assert.equal(me.user.role, "admin");
    assert.equal((await poll()).status, 202);
    await fetch(base + "/auth/logout", {
      method: "POST",
      headers: { ...headers, Origin: base, "X-CSRF-Token": me.user.csrf },
    });
    console.log(
      "PASS " + name + ": real browser form approval and one-use APK session",
    );
  } finally {
    await browser.close();
  }
}
