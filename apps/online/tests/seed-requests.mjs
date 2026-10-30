// Fictional people in disposable LOCAL D1 only. Never supports --remote.
import { spawnSync } from "node:child_process";
const now = Math.floor(Date.now() / 1000),
  quote = (v) => "'" + String(v).replaceAll("'", "''") + "'";
let sql =
  "INSERT OR REPLACE INTO telegram_profiles VALUES('600810855','test_admin','Адміністратор тест'," +
  now +
  ");";
for (const [id, name, username, phone] of [
  ["990000091", "Ірина", "test_iryna", "+12025550101"],
  ["990000092", "Тарас", "test_taras", null],
]) {
  const profile = {
    user: {
      id: Number(id),
      is_bot: false,
      first_name: name,
      last_name: "Тест",
      username,
      language_code: "uk",
      is_premium: true,
    },
    chat: {
      bio: "Тестове біо <script>window.BAD_PROFILE=true</script>",
      birthdate: { day: 1, month: 5 },
    },
  };
  sql += `INSERT OR REPLACE INTO telegram_profiles VALUES(${quote(id)},${quote(username)},${quote(name + " Test")},${now});`;
  sql += `DELETE FROM staff_access WHERE telegram_id=${quote(id)};INSERT OR REPLACE INTO access_requests VALUES(${quote(id)},${quote(id)},${quote(JSON.stringify(profile))},${phone ? quote(phone) : "NULL"},'pending',1,${now},NULL,NULL);`;
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
  { stdio: "pipe", encoding: "utf8" },
);
if (r.status !== 0) throw Error("Local request fixture failed");
console.log("Local fictional request fixtures ready");
