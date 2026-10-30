import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { authRoutes } from "../src/auth.js";
test("APK return route survives browser OAuth and callback replay is rejected", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const f of [
    "0003_auth.sql",
    "0004_phone_access.sql",
    "0006_access_requests.sql",
  ])
    sqlite.exec(
      readFileSync(new URL("../migrations/" + f, import.meta.url), "utf8"),
    );
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...v) {
          args = v;
          return this;
        },
        first: async () => sqlite.prepare(sql).get(...args) || null,
        execute: () => ({ results: sqlite.prepare(sql).all(...args) }),
      };
    },
    async batch(a) {
      sqlite.exec("BEGIN");
      try {
        const r = a.map((s) => s.execute());
        sqlite.exec("COMMIT");
        return r;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const env = {
      DB: db,
      TELEGRAM_CLIENT_ID: "unit-client",
      TELEGRAM_CLIENT_SECRET: "unit-secret",
      ADMIN_TELEGRAM_IDS: "600810855,1402380598",
    },
    base = "https://minicafe.example";
  const start = await authRoutes(
    new Request(base + "/auth/start?return=menu-transfer"),
    env,
  );
  assert.equal(start.status, 302);
  const target = new URL(start.headers.get("location")),
    state = target.searchParams.get("state"),
    flow = sqlite.prepare("SELECT * FROM auth_flows WHERE state=?").get(state);
  const { privateKey, publicKey } = await generateKeyPair("RS256"),
    jwk = await exportJWK(publicKey);
  jwk.kid = "unit-key";
  jwk.alg = "RS256";
  const token = await new SignJWT({
    id: 600810855,
    name: "Тест",
    preferred_username: "test_owner",
    nonce: flow.nonce,
  })
    .setProtectedHeader({ alg: "RS256", kid: "unit-key" })
    .setSubject("opaque-unit-sub")
    .setIssuer("https://oauth.telegram.org")
    .setAudience("unit-client")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const original = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).endsWith("/token")
      ? Response.json({ id_token: token })
      : Response.json({ keys: [jwk] });
  try {
    const request = () =>
      new Request(base + "/auth/callback?state=" + state + "&code=unit-code", {
        headers: { Cookie: start.headers.get("set-cookie").split(";")[0] },
      });
    const response = await authRoutes(request(), env);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/admin#menu-transfer");
    assert.equal(
      sqlite.prepare("SELECT username FROM telegram_profiles").get().username,
      "test_owner",
    );
    assert.equal((await authRoutes(request(), env)).status, 400);
    await authRoutes(
      new Request(base + "/auth/start?return=https://evil.example"),
      env,
    );
    assert.equal(
      sqlite.prepare("SELECT count(*) n FROM auth_flow_returns").get().n,
      0,
    );
  } finally {
    globalThis.fetch = original;
    sqlite.close();
  }
});
