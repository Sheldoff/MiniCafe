import {
  hash,
  random,
  timestamp,
  cookie,
  sessionCookie,
  validOrigin,
  rateLimit,
  secureJson,
} from "./auth.js";
import { botAccess, createBotSession } from "./bot-login.js";

const proofCookie = (value, age = 600) =>
  `__Host-minicafe_quick=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
const ready = (env) =>
  !!env.TELEGRAM_BOT_TOKEN && !!env.TELEGRAM_WEBHOOK_SECRET;
const expired = () =>
  secureJson({ error: "Час входу минув. Створіть новий QR-код." }, 410);
const page = (csrf) =>
  new Response(
    `<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/brand.svg"><link rel="stylesheet" href="/auth.css"><script src="/theme-boot.js"></script><script src="/qr-generator.js" defer></script><script src="/quick-login.js" defer></script><title>МініКафе · Вхід без коду</title><main id="quickLogin" data-csrf="${csrf}"><img class="brand-icon" src="/brand.svg" alt=""><h1>Вхід без коду</h1><p>Відскануйте QR-код камерою телефона або відкрийте Telegram кнопкою нижче. У боті натисніть Start, звірте цифри й підтвердьте вхід.</p><div id="loginQr" aria-label="QR-код входу"></div><p id="matchLabel" hidden>Цифри на цьому пристрої: <strong id="loginMatch"></strong></p><a id="openLoginBot" class="primary" target="_blank" rel="noopener noreferrer" hidden>Відкрити Telegram</a><p id="quickStatus" role="status">Створюємо запит…</p><small>Після підтвердження цей пристрій увійде автоматично. QR діє 5 хвилин. Підтверджуйте тільки свій запит із такими самими цифрами.</small><button id="refreshLoginQr" type="button" hidden>Створити новий QR-код</button><p><a id="manualLogin" href="/auth/code">Увести код вручну</a></p><a href="/auth/login">Інші способи входу</a></main></html>`,
    {
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "same-origin",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      },
    },
  );

export async function quickLogin(request, env) {
  const url = new URL(request.url),
    path = url.pathname;
  if (!["/auth/quick", "/auth/quick/start", "/auth/quick/poll"].includes(path))
    return null;
  if (!ready(env))
    return secureJson({ error: "Вхід через бота тимчасово недоступний" }, 503);
  if (path === "/auth/quick" && request.method === "GET") {
    const proof = random(),
      response = page(proof);
    response.headers.set("Set-Cookie", proofCookie(proof));
    return response;
  }
  if (request.method !== "POST" || path === "/auth/quick")
    return secureJson({ error: "Метод не підтримується" }, 405);
  const proof = cookie(request, "__Host-minicafe_quick");
  if (
    !validOrigin(request) ||
    !/^[a-f0-9]{64}$/.test(proof) ||
    request.headers.get("X-CSRF-Token") !== proof
  )
    return secureJson({ error: "Почніть вхід із цієї сторінки заново" }, 403);
  const browserHash = await hash(proof),
    now = timestamp();
  if (path === "/auth/quick/start") {
    if (!(await rateLimit(env, request, "quick-start", 10, 600)))
      return secureJson({ error: "Забагато запитів. Спробуйте пізніше." }, 429);
    const ticket = random().slice(0, 48),
      match = String(
        crypto.getRandomValues(new Uint32Array(1))[0] % 1000000,
      ).padStart(6, "0");
    const bot = /^[A-Za-z0-9_]{5,32}$/.test(env.TELEGRAM_BOT_USERNAME || "")
      ? env.TELEGRAM_BOT_USERNAME
      : "minicafe_loginbot";
    const link = `https://t.me/${bot}?start=q_${ticket}`;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM telegram_login_links WHERE expires<=?").bind(
        now,
      ),
      env.DB.prepare(
        "INSERT INTO telegram_login_links VALUES(?,?,?,'pending',NULL,?) ON CONFLICT(browser_hash) DO UPDATE SET ticket_hash=excluded.ticket_hash,match_code=excluded.match_code,status='pending',telegram_id=NULL,expires=excluded.expires",
      ).bind(await hash(ticket), browserHash, match, now + 300),
    ]);
    return secureJson({
      link,
      match,
      expires_in: 300,
    });
  }
  if (!(await rateLimit(env, request, "quick-poll", 900, 600)))
    return secureJson({ error: "Забагато запитів. Спробуйте пізніше." }, 429);
  if (!(await rateLimit(env, request, "quick-poll:" + browserHash, 180, 600)))
    return secureJson({ error: "Забагато запитів. Почніть вхід заново." }, 429);
  const row = await env.DB.prepare(
    "SELECT status FROM telegram_login_links WHERE browser_hash=? AND expires>?",
  )
    .bind(browserHash, now)
    .first();
  if (!row) return expired();
  if (row.status === "pending") return secureJson({ pending: true }, 202);
  const approved = await env.DB.prepare(
    "DELETE FROM telegram_login_links WHERE browser_hash=? AND expires>? AND status!='pending' RETURNING telegram_id,status",
  )
    .bind(browserHash, now)
    .first();
  if (!approved) return expired();
  if (approved.status === "denied")
    return secureJson({ error: "Вхід скасовано на телефоні." }, 403);
  const session = await createBotSession(env, approved.telegram_id);
  if (!session)
    return secureJson(
      { error: "Доступ відкликано. Зверніться до адміністратора." },
      403,
    );
  const destination = /^[a-f0-9]{64}$/.test(
    cookie(request, "__Host-minicafe_app"),
  )
    ? "/auth/app/confirm"
    : url.searchParams.get("return") === "menu-transfer"
      ? "/admin#menu-transfer"
      : "/admin";
  const response = secureJson({ redirect: destination });
  response.headers.append("Set-Cookie", sessionCookie(session));
  response.headers.append("Set-Cookie", proofCookie("", 0));
  return response;
}

// Called only after the existing webhook has checked its secret, private chat,
// Telegram sender, update replay and per-user rate limit.
export async function quickLoginMessage(env, id, text) {
  const ticket = text.match(/^\/start q_([a-f0-9]{48})$/)?.[1];
  if (!ticket) return null;
  const row = await env.DB.prepare(
    "SELECT match_code FROM telegram_login_links WHERE ticket_hash=? AND status='pending' AND expires>?",
  )
    .bind(await hash(ticket), timestamp())
    .first();
  if (!row)
    return {
      text: "Запит входу вже використаний або час минув. Створіть новий QR-код на потрібному пристрої.",
    };
  if (!(await botAccess(env, id)))
    return {
      text: "Вашому акаунту не надано доступ або його відкликано. Зверніться до адміністратора.",
    };
  return {
    text: `МініКафе · підтвердження входу\n\nЦифри на пристрої: ${row.match_code}\n\nПідтвердьте тільки якщо ви самі відкрили вхід на своєму пристрої та бачите там ці самі цифри. Він увійде з правами вашого акаунта. Якщо це не ваш запит — скасуйте.`,
    reply_markup: {
      inline_keyboard: [
        [{ text: "✓ Підтвердити вхід", callback_data: "qa_" + ticket }],
        [{ text: "Скасувати", callback_data: "qx_" + ticket }],
      ],
    },
  };
}

export async function quickLoginCallback(env, id, data) {
  const match = /^q([ax])_([a-f0-9]{48})$/.exec(data || "");
  if (!match) return null;
  if (!(await botAccess(env, id)))
    return "Доступ не надано або відкликано. Вхід не підтверджено.";
  const row = await env.DB.prepare(
    "UPDATE telegram_login_links SET status=?,telegram_id=? WHERE ticket_hash=? AND status='pending' AND expires>? RETURNING ticket_hash",
  )
    .bind(
      match[1] === "a" ? "approved" : "denied",
      id,
      await hash(match[2]),
      timestamp(),
    )
    .first();
  return !row
    ? "Запит уже опрацьовано або час минув."
    : match[1] === "a"
      ? "Вхід підтверджено. Ваш пристрій зараз відкриє МініКафе."
      : "Вхід скасовано.";
}
