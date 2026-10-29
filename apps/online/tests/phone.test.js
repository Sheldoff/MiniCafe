import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { normalizePhone, claimPhone } from "../src/phone.js";
import { identity, hash } from "../src/auth.js";
test("phone permissions require verified claims, pin identity and revoke immediately", async () => {
  assert.equal(normalizePhone("+380 (67) 123-45-67"), "+380671234567");
  assert.equal(normalizePhone("00380671234567"), "+380671234567");
  assert.equal(normalizePhone("0671234567"), null);
  assert.equal(normalizePhone("+380671234567 ext 2"), null);
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of ["0003_auth.sql", "0004_phone_access.sql"])
    sqlite.exec(
      readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
    );
  const db = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        async first() {
          return sqlite.prepare(sql).get(...values) || null;
        },
      };
    },
  };
  sqlite
    .prepare("INSERT INTO staff_phone VALUES(?,?,1,NULL,?)")
    .run("+380671234567", "cash", "test");
  const payload = { phone_number: "380671234567", phone_number_verified: true };
  assert.equal(
    await claimPhone(db, { ...payload, phone_number_verified: false }, "123"),
    null,
  );
  assert.equal(
    await claimPhone(db, { ...payload, phone_number_verified: "true" }, "123"),
    null,
  );
  assert.equal(
    await claimPhone(db, { ...payload, phone_number: "+380000000000" }, "123"),
    null,
  );
  assert.equal((await claimPhone(db, payload, "123")).role, "cash");
  assert.equal(await claimPhone(db, payload, "456"), null);
  assert.ok(await claimPhone(db, payload, "123"));
  const cookie = "7".repeat(64),
    key = await hash(cookie);
  sqlite
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?,?,?)")
    .run(key, "123", "test", "csrf", Math.floor(Date.now() / 1000) + 60);
  sqlite
    .prepare("INSERT INTO session_phone VALUES(?,?)")
    .run(key, "+380671234567");
  const request = new Request("https://example.com/api/state", {
    headers: { Cookie: "__Host-minicafe_session=" + cookie },
  });
  const env = { DB: db, ADMIN_TELEGRAM_IDS: "600810855,1402380598" };
  assert.equal((await identity(request, env)).role, "cash");
  sqlite.exec("UPDATE staff_phone SET role='bar'");
  assert.equal((await identity(request, env)).role, "bar");
  sqlite.exec("UPDATE staff_phone SET enabled=0");
  assert.equal(await identity(request, env), null);
  sqlite.exec(
    "UPDATE staff_phone SET enabled=1;INSERT INTO staff_access VALUES('123','cash',0,'test')",
  );
  assert.equal(await identity(request, env), null); // Explicit disabled ID overrides phone.
  sqlite.exec("DELETE FROM auth_sessions");
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM session_phone").get().n,
    0,
  );
  sqlite.close();
});
