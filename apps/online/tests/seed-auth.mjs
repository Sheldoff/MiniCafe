// Disposable local D1 only. These fixtures are never deployed.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const now = Math.floor(Date.now() / 1000);
let sql = "";
for (const [digit, id, role] of [
  ["1", "600810855", "admin"],
  ["3", "990000001", "cash"],
  ["4", "990000002", "bar"],
  ["5", "990000003", "delivery"],
  ["6", "990000004", "service"],
]) {
  const hash = createHash("sha256").update(digit.repeat(64)).digest("hex");
  if (role !== "admin")
    sql += `INSERT OR REPLACE INTO staff_access VALUES('${id}','${role}',1,'test');`;
  sql += `INSERT OR REPLACE INTO auth_sessions VALUES('${hash}','${id}','Local test','${"2".repeat(64)}',${now + 3600});`;
}
const r = spawnSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "execute",
    "DB",
    "--local",
    "--command",
    sql,
  ],
  { stdio: "inherit" },
);
process.exit(r.status ?? 1);
