// Upload secrets through stdin; never log their values or pass them as command arguments.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "jsonc-parser";
const root = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(
  readFileSync(join(root, ".env.telegram.local.json"), "utf8"),
);
if (
  !/^\d+$/.test(data.TELEGRAM_CLIENT_ID) ||
  typeof data.TELEGRAM_CLIENT_SECRET !== "string" ||
  data.TELEGRAM_CLIENT_SECRET.length < 12
)
  throw Error(
    "Fill Client ID and Client Secret in the private .env.telegram.local.json first",
  );
const config = parse(readFileSync(join(root, "wrangler.jsonc"), "utf8"));
if (config.vars.TELEGRAM_CLIENT_ID !== data.TELEGRAM_CLIENT_ID)
  throw Error("Client ID differs from this project configuration");
const values = { TELEGRAM_CLIENT_SECRET: data.TELEGRAM_CLIENT_SECRET };
const result = spawnSync(
  process.execPath,
  [join(root, "node_modules/wrangler/bin/wrangler.js"), "secret", "bulk"],
  {
    cwd: root,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(root, ".wrangler-auth"),
      WRANGLER_SEND_METRICS: "false",
    },
    input: JSON.stringify(values),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  },
);
if (result.status !== 0)
  throw Error(
    "Cloudflare secret upload failed; verify the Wrangler account and permissions. Secret values were not printed.",
  );
console.log("Telegram Login settings uploaded securely to Cloudflare.");
