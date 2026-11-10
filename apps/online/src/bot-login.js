import {
  admins,
  hash,
  timestamp,
  random,
  rateLimit,
  validOrigin,
  cookie,
  sessionCookie,
  identityByHash,
  secureJson,
} from "./auth.js";

// Explicit ID grants (including disabled grants) always override phone grants.
export async function botAccess(env, id) {
  if (admins(env).has(id)) return { role: "admin" };
  const direct = await env.DB.prepare(
    "SELECT role,enabled FROM staff_access WHERE telegram_id=?",
  )
    .bind(id)
    .first();
  if (direct) return direct.enabled === 1 ? direct : null;
  return env.DB.prepare(
    "SELECT role,phone FROM staff_phone WHERE claimed_id=? AND enabled=1 ORDER BY phone LIMIT 1",
  )
    .bind(id)
    .first();
}

export async function createBotSession(env, id) {
  const access = await botAccess(env, id);
  if (!access) return null;
  const profile = await env.DB.prepare(
    "SELECT name FROM telegram_profiles WHERE telegram_id=?",
  )
    .bind(id)
    .first();
  const session = random(),
    digest = await hash(session);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO auth_sessions VALUES(?,?,?,?,?)").bind(
      digest,
      id,
      profile?.name || "Працівник",
      random(),
      timestamp() + 604800,
    ),
    ...(access.phone
      ? [
          env.DB.prepare("INSERT INTO session_phone VALUES(?,?)").bind(
            digest,
            access.phone,
          ),
        ]
      : []),
  ]);
  if (!(await identityByHash(digest, env))) {
    await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?")
      .bind(digest)
      .run();
    return null;
  }
  return session;
}

export async function issueBotCode(env, id) {
  if (!(await botAccess(env, id))) return null;
  // Ten uniform decimal digits, using rejection sampling rather than modulo bias.
  let code = "";
  while (code.length < 10) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 250 && code.length < 10) code += byte % 10;
    }
  }
  const now = timestamp();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM bot_login_codes WHERE expires<=?").bind(now),
    env.DB.prepare(
      "INSERT INTO bot_login_codes VALUES(?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET code_hash=excluded.code_hash,expires=excluded.expires",
    ).bind(id, await hash(code), now + 300),
  ]);
  return code.slice(0, 5) + " " + code.slice(5);
}

const formCookie = (value, age = 600) =>
  `__Host-minicafe_code=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
function codePage(csrf, bot, message = "", status = 200) {
  return new Response(
    `<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/brand.svg"><script src="/theme-boot.js"></script><link rel="stylesheet" href="/auth.css"><title>МініКафе · Код із Telegram</title><main><img class="brand-icon" src="/brand.svg" alt=""><h1>Код із Telegram</h1><p>На телефоні відкрийте <a href="https://t.me/${bot}?start=login" target="_blank" rel="noopener noreferrer">@${bot}</a> і натисніть Start або надішліть <b>/login</b>. Бот надішле одноразовий код МініКафе на 5 хвилин.</p><p>Введіть його тут, на пристрої, де хочете працювати. Кожен новий код скасовує попередній.</p>${message ? `<p role="alert">${message}</p>` : ""}<form method="post"><input type="hidden" name="csrf" value="${csrf}"><label for="code">Код МініКафе з бота</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{10,11}" maxlength="11" required placeholder="12345 67890" autofocus><button class="primary" type="submit">Увійти</button></form><small>Це окремий код МініКафе. Не вводьте тут коди входу чи пароль самого Telegram. Передавайте код тільки своєму пристрою.</small><p><a href="/auth/login">Інші способи входу</a></p></main></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; img-src 'self'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      },
    },
  );
}

export async function botLogin(request, env) {
  if (new URL(request.url).pathname !== "/auth/code") return null;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET)
    return secureJson({ error: "Вхід через бота тимчасово недоступний" }, 503);
  const bot = /^[A-Za-z0-9_]{5,32}$/.test(env.TELEGRAM_BOT_USERNAME || "")
    ? env.TELEGRAM_BOT_USERNAME
    : "minicafe_loginbot";
  if (request.method === "GET") {
    const csrf = random(),
      response = codePage(csrf, bot);
    response.headers.set("Set-Cookie", formCookie(csrf));
    return response;
  }
  if (request.method !== "POST")
    return secureJson({ error: "Метод не підтримується" }, 405);
  if (
    !validOrigin(request) ||
    !request.headers
      .get("Content-Type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    return secureJson({ error: "Почніть вхід заново" }, 403);
  const csrf = cookie(request, "__Host-minicafe_code");
  if (!/^[a-f0-9]{64}$/.test(csrf))
    return secureJson({ error: "Почніть вхід заново" }, 403);
  const reader = request.body?.getReader();
  let text = "",
    size = 0;
  if (reader)
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 512) {
        await reader.cancel();
        return secureJson({ error: "Запит завеликий" }, 413);
      }
      text += new TextDecoder().decode(value);
    }
  const input = new URLSearchParams(text);
  if (input.get("csrf") !== csrf)
    return secureJson({ error: "Почніть вхід заново" }, 403);
  const globalRequest = new Request(request.url, {
    headers: { "CF-Connecting-IP": "bot-login-global" },
  });
  if (
    !(await rateLimit(env, request, "bot-code", 8, 600)) ||
    !(await rateLimit(env, globalRequest, "bot-code", 100, 60))
  )
    return codePage(csrf, bot, "Забагато спроб. Спробуйте пізніше.", 429);
  const code = (input.get("code") || "").replace(/ /g, "");
  const row = /^\d{10}$/.test(code)
    ? await env.DB.prepare(
        "DELETE FROM bot_login_codes WHERE code_hash=? AND expires>? RETURNING telegram_id",
      )
        .bind(await hash(code), timestamp())
        .first()
    : null;
  const access = row && (await botAccess(env, row.telegram_id));
  if (!access)
    return codePage(
      csrf,
      bot,
      "Код неправильний, прострочений або доступ відкликано. Отримайте новий код у боті.",
      400,
    );
  const session = await createBotSession(env, row.telegram_id);
  if (!session)
    return codePage(
      csrf,
      bot,
      "Доступ відкликано. Зверніться до адміністратора.",
      403,
    );
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    Location: /^[a-f0-9]{64}$/.test(cookie(request, "__Host-minicafe_app"))
      ? "/auth/app/confirm"
      : new URL(request.url).searchParams.get("return") === "menu-transfer"
        ? "/admin#menu-transfer"
        : "/admin",
  });
  headers.append("Set-Cookie", sessionCookie(session));
  headers.append("Set-Cookie", formCookie("", 0));
  return new Response(null, { status: 303, headers });
}
