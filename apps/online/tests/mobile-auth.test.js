import test from "node:test";
import assert from "node:assert/strict";
import { authRoutes } from "../src/auth.js";
test("mobile login is a first-party page and a same-tab PKCE redirect", async () => {
  const env = {
    TELEGRAM_CLIENT_ID: "test-client",
    TELEGRAM_CLIENT_SECRET: "test-only",
    ASSETS: {
      fetch: async () => new Response('<a href="/auth/start">Continue</a>'),
    },
    DB: {
      prepare: () => ({
        bind() {
          return this;
        },
        first: async () => ({ hits: 1 }),
      }),
      batch: async () => [],
    },
  };
  const origin = "https://minicafe.example";
  const page = await authRoutes(new Request(origin + "/auth/login"), env);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.match(await page.text(), /href="\/auth\/start"/);
  const r = await authRoutes(new Request(origin + "/auth/start"), env);
  assert.equal(r.status, 302);
  const target = new URL(r.headers.get("location"));
  assert.equal(target.origin, "https://oauth.telegram.org");
  assert.equal(
    target.searchParams.get("redirect_uri"),
    origin + "/auth/callback",
  );
  assert.equal(target.searchParams.get("code_challenge_method"), "S256");
  assert.equal(target.searchParams.get("scope"), "openid profile phone");
  assert.equal(target.searchParams.get("state").length, 64);
  assert.match(r.headers.get("set-cookie"), /Secure; HttpOnly; SameSite=Lax/);
  const cross = await authRoutes(
    new Request(origin + "/auth/start", {
      headers: { "Sec-Fetch-Site": "cross-site" },
    }),
    env,
  );
  assert.equal(cross.status, 403);
});
