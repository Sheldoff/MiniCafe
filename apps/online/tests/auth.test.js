import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";
import { verifyTelegramToken, admins, canWrite } from "../src/auth.js";
test("Telegram JWT rejects forged signatures, wrong audience/issuer, expiry and nonce", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  const sign = (options = {}) =>
    new SignJWT({ nonce: "expected", id: 600810855, ...options.claims })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject("opaque-subject")
      .setIssuer(options.issuer || "https://oauth.telegram.org")
      .setAudience(options.audience || "9119381884")
      .setIssuedAt()
      .setExpirationTime(options.exp || "5m")
      .sign(options.key || privateKey);
  assert.equal(
    (
      await verifyTelegramToken(
        await sign(),
        "expected",
        "9119381884",
        publicKey,
      )
    ).id,
    600810855,
  );
  for (const option of [
    { key: other.privateKey },
    { issuer: "https://evil.example" },
    { audience: "other" },
    { exp: 1 },
    { claims: { nonce: "replay" } },
  ])
    await assert.rejects(
      verifyTelegramToken(
        await sign(option),
        "expected",
        "9119381884",
        publicKey,
      ),
    );
  assert.deepEqual(
    [...admins({ ADMIN_TELEGRAM_IDS: "600810855,1402380598" })],
    ["600810855", "1402380598"],
  );
  assert.equal(canWrite("bar", "issue", { route: "instant" }), false);
  assert.equal(canWrite("cash", "restore", {}), false);
});
