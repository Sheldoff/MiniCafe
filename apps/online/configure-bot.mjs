// Values travel through stdin/HTTPS only; never print tokens or tokenized API URLs.
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "jsonc-parser";
import { resolve4 } from "node:dns/promises";
import https from "node:https";
const root = dirname(fileURLToPath(import.meta.url));
const file = join(root, ".env.telegram.local.json"),
  data = JSON.parse(readFileSync(file, "utf8"));
const token = data.TELEGRAM_BOT_TOKEN || "";
if (!/^\d{5,15}:[A-Za-z0-9_-]{20,100}$/.test(token))
  throw Error("Fill TELEGRAM_BOT_TOKEN in the private local file.");
async function call(method, body = {}) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    if (j.ok) return j.result;
  } catch {}
  throw Error(
    "Telegram configuration request failed; credentials were not logged.",
  );
}
const config = parse(readFileSync(join(root, "wrangler.jsonc"), "utf8"));
const me = await call("getMe");
if (
  me.username !== config.vars.TELEGRAM_BOT_USERNAME ||
  String(me.id) !== config.vars.TELEGRAM_CLIENT_ID
)
  throw Error("Token belongs to a different bot; nothing was changed.");
const webhook = "https://minicafe.minicafe.workers.dev/api/telegram/webhook";
async function verifiedAddresses() {
  const hostname = new URL(webhook).hostname;
  const addresses = [];
  for (const address of await resolve4(hostname)) {
    if (
      /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(
        address,
      )
    )
      continue;
    const valid = await new Promise((resolve) => {
      const req = https.get(
        {
          hostname,
          servername: hostname,
          path: "/api/ping",
          lookup: (_host, options, callback) =>
            options.all
              ? callback(null, [{ address, family: 4 }])
              : callback(null, address, 4),
        },
        (r) => {
          let body = "";
          r.on("data", (c) => {
            body += c;
            if (body.length > 2048) req.destroy();
          });
          r.on("end", () => {
            try {
              resolve(
                r.statusCode === 200 && JSON.parse(body).app === "minicafe",
              );
            } catch {
              resolve(false);
            }
          });
        },
      );
      req.setTimeout(7000, () => {
        req.destroy();
        resolve(false);
      });
      req.on("error", () => resolve(false));
    });
    if (valid) addresses.push(address);
  }
  return addresses;
}
const prior = await call("getWebhookInfo");
if (prior.url && prior.url !== webhook)
  throw Error(
    "Bot has a different existing webhook; review it before replacing.",
  );
const mode = process.argv[2];
if (mode === "upload") {
  data.TELEGRAM_WEBHOOK_SECRET ||= randomBytes(32).toString("hex");
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
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
      input: JSON.stringify({
        TELEGRAM_BOT_TOKEN: token,
        TELEGRAM_WEBHOOK_SECRET: data.TELEGRAM_WEBHOOK_SECRET,
      }),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (result.status !== 0)
    throw Error(
      "Cloudflare secret upload failed. Secret values were not printed.",
    );
  console.log("Verified bot; bot token and webhook secret uploaded securely.");
} else if (mode === "register") {
  if (!data.TELEGRAM_WEBHOOK_SECRET)
    throw Error("Upload the secrets before registering the webhook.");
  const webhookOptions = {
    url: webhook,
    secret_token: data.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    max_connections: 4,
    drop_pending_updates: false,
  };
  let registered = false;
  // Preserve an already working override rather than resetting it through DNS.
  if (prior.url === webhook && prior.ip_address) {
    try {
      await call("setWebhook", {
        ...webhookOptions,
        ip_address: prior.ip_address,
      });
      registered = true;
    } catch {}
  } else {
    try {
      await call("setWebhook", webhookOptions);
      registered = true;
    } catch {}
  }
  if (!registered) {
    // Telegram can temporarily fail to resolve workers.dev. Keep the same URL,
    // SNI and certificate verification; use Bot API's documented IP override.
    for (const address of await verifiedAddresses()) {
      try {
        await call("setWebhook", { ...webhookOptions, ip_address: address });
        registered = true;
        break;
      } catch {}
    }
    if (!registered)
      throw Error(
        "Webhook registration failed for verified addresses; retry later.",
      );
    console.log(
      "Telegram DNS fallback: HTTPS-verified Cloudflare address used.",
    );
  }
  await call("setMyCommands", {
    commands: [
      { command: "start", description: "МініКафе · доступ" },
      { command: "apply", description: "Подати заявку на доступ" },
      { command: "status", description: "Перевірити заявку" },
    ],
  });
  console.log("MiniCafe bot webhook and commands registered.");
} else
  throw Error(
    "Use configure-bot.mjs upload, then deploy, then configure-bot.mjs register.",
  );
