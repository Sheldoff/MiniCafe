import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const javaRoot =
  process.env.JAVA_HOME ||
  path.join(
    root,
    "work/android-tools/jdk",
    readdirSync(path.join(root, "work/android-tools/jdk")).sort().at(-1),
  );
const java = path.join(
    javaRoot,
    "bin",
    process.platform === "win32" ? "java.exe" : "java",
  ),
  javac = path.join(
    javaRoot,
    "bin",
    process.platform === "win32" ? "javac.exe" : "javac",
  );
const dir = mkdtempSync(path.join(tmpdir(), "minicafe-backup-interop-"));
const jsonJar = path.join(root, "work/android/test-libs/android-json.jar");
const src = path.join(root, "work/android/src/ua/minicafe/mobile");
const classes = ["CafeStore", "ImageStore", "CafeStats", "Codec"].map((n) =>
  path.join(src, n + ".java"),
);
const run = (bin, args) => {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw Error((r.stdout || "") + (r.stderr || ""));
};
run(javac, [
  "-encoding",
  "UTF-8",
  "--release",
  "8",
  "-cp",
  jsonJar,
  "-d",
  dir,
  ...classes,
  path.join(root, "apps/online/tests/BackupInterop.java"),
]);
run(java, [
  "-cp",
  dir + path.delimiter + jsonJar,
  "BackupInterop",
  "create",
  dir,
  path.join(root, "work/android/assets/default-menu/drink-1.jpg"),
]);
const base = "http://127.0.0.1:8791",
  headers = {
    Cookie: "__Host-minicafe_session=" + "1".repeat(64),
    "X-CSRF-Token": "2".repeat(64),
    Origin: base,
    "Content-Type": "application/json",
  };
const get = async () => {
  const r = await fetch(base + "/api/backup", { headers });
  assert.equal(r.status, 200);
  return r.json();
};
const restore = async (d) => {
  const r = await fetch(base + "/api/restore", {
    method: "POST",
    headers,
    body: JSON.stringify(d),
  });
  assert.equal(r.status, 200, await r.text());
};
const original = await get();
try {
  const android = JSON.parse(
    readFileSync(path.join(dir, "android.json"), "utf8"),
  );
  await restore(android);
  const web = await get();
  writeFileSync(path.join(dir, "web.json"), JSON.stringify(web));
  assert.equal(web.orders[0].request, "legacy.1700000000.25");
  assert.ok(
    web.nextProduct >= 100 &&
      web.nextOrder >= 100 &&
      web.nextItem >= 100 &&
      web.nextSession >= 100,
  );
  assert.equal(web.products[0].image, android.products[0].image);
  assert.deepEqual(web.orders, android.orders);
  assert.deepEqual(web.calculator_expenses, android.calculator_expenses);
  run(java, [
    "-cp",
    dir + path.delimiter + jsonJar,
    "BackupInterop",
    "restore",
    dir,
  ]);
  const roundtrip = JSON.parse(
    readFileSync(path.join(dir, "android-roundtrip.json"), "utf8"),
  );
  assert.deepEqual(roundtrip.orders, web.orders);
  assert.deepEqual(roundtrip.sessions, web.sessions);
  assert.deepEqual(roundtrip.calculator_expenses, web.calculator_expenses);
  assert.equal(roundtrip.products[0].image, web.products[0].image);
  await restore(roundtrip);
  console.log(
    "PASS APK Java → web D1 → APK Java → web: photos, mixed payment, legacy request, per-unit issue, sessions, expenses and non-reused counters",
  );
} finally {
  await restore(original);
}
