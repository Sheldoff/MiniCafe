import {
  identity,
  identityByHash,
  hash,
  random,
  cookie,
  timestamp,
  validOrigin,
  rateLimit,
  secureJson as json,
} from "./auth.js";
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Content-Type": "text/html;charset=utf-8",
};
const appCookie = (value, seconds = 600) =>
  `__Host-minicafe_app=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const page = (body) =>
  new Response(
    `<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>МініКафе · Вхід у застосунок</title><body style="font:18px system-ui;background:#f5f4ef;color:#173f35;max-width:560px;margin:40px auto;padding:24px"><h1>Вхід у МініКафе</h1>${body}</body></html>`,
    { headers },
  );
export async function appLogin(request, env) {
  const url = new URL(request.url),
    path = url.pathname;
  if (!["/auth/app/start", "/auth/app/confirm", "/api/app/poll"].includes(path))
    return null;
  if (path === "/auth/app/start" && request.method === "GET") {
    if (
      (request.headers.has("Sec-Fetch-Dest") &&
        request.headers.get("Sec-Fetch-Dest") !== "document") ||
      (request.headers.has("Sec-Fetch-Mode") &&
        request.headers.get("Sec-Fetch-Mode") !== "navigate")
    )
      return json({ error: "Почніть вхід із застосунку" }, 403);
    const challenge = url.searchParams.get("challenge");
    if (!/^[a-f0-9]{64}$/.test(challenge || ""))
      return json({ error: "Некоректний запит" }, 400);
    const user = await identity(request, env);
    // A rendered first-party page resets the navigation initiator. Redirecting
    // directly can carry Android's cross-site metadata into /auth/start.
    const response = page(
      `<p>Продовжте вхід через Telegram, потім поверніться до застосунку.</p><a style="display:block;padding:16px;background:#215943;color:white;border-radius:12px;text-align:center" href="${user ? "/auth/app/confirm" : "/auth/start"}">Продовжити вхід</a>`,
    );
    response.headers.set("Set-Cookie", appCookie(challenge));
    return response;
  }
  if (path === "/auth/app/confirm") {
    const user = await identity(request, env);
    if (!user)
      return new Response(null, {
        status: 302,
        headers: { ...headers, Location: "/auth/start" },
      });
    const challenge = cookie(request, "__Host-minicafe_app");
    if (!/^[a-f0-9]{64}$/.test(challenge))
      return json({ error: "Почніть вхід із застосунку заново" }, 400);
    if (request.method === "GET")
      return page(
        `<p>Акаунт: <b>${esc(user.name)}</b></p><p>Підтвердьте вхід тільки якщо ви щойно натиснули «Онлайн» у своєму застосунку. Права визначаються вашим Telegram-акаунтом.</p><form method="post"><input type="hidden" name="csrf" value="${esc(user.csrf)}"><button style="padding:16px;background:#215943;color:white;border:0;border-radius:12px;font:inherit">Увійти в застосунок</button></form><p><a href="/admin">Продовжити в браузері</a></p>`,
      );
    if (request.method !== "POST")
      return json({ error: "Метод не підтримується" }, 405);
    if (
      !validOrigin(request) ||
      !request.headers
        .get("Content-Type")
        ?.startsWith("application/x-www-form-urlencoded")
    )
      return json({ error: "Немає доступу" }, 403);
    if (!(await rateLimit(env, request, "app-approve", 10, 60)))
      return json({ error: "Забагато запитів" }, 429);
    const text = await bounded(request);
    if (new URLSearchParams(text).get("csrf") !== user.csrf)
      return json({ error: "Немає доступу" }, 403);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM app_links WHERE expires<=?").bind(
        timestamp(),
      ),
      env.DB.prepare(
        "INSERT INTO app_links VALUES(?,?,?) ON CONFLICT(challenge) DO NOTHING",
      ).bind(
        challenge,
        await hash(cookie(request, "__Host-minicafe_session")),
        timestamp() + 600,
      ),
    ]);
    const response = page(
      '<p>Вхід підтверджено. Поверніться у застосунок — робота продовжиться там.</p><p><a href="minicafe://online-complete" style="display:block;padding:16px;background:#215943;color:white;border-radius:12px;text-align:center">Повернутися в МініКафе</a></p>',
    );
    response.headers.set("Set-Cookie", appCookie("", 0));
    return response;
  }
  if (path === "/api/app/poll") {
    if (request.method !== "POST")
      return json({ error: "Метод не підтримується" }, 405);
    if (request.headers.has("Origin") || request.headers.get("Sec-Fetch-Site"))
      return json({ error: "Лише застосунок" }, 403);
    if (!(await rateLimit(env, request, "app-poll", 300, 600)))
      return json({ error: "Забагато запитів" }, 429);
    let input;
    try {
      input = JSON.parse(await bounded(request));
    } catch {
      return json({ error: "Некоректний запит" }, 400);
    }
    if (!/^[a-f0-9]{64}$/.test(input?.secret || ""))
      return json({ error: "Некоректний запит" }, 400);
    const row = await env.DB.prepare(
      "DELETE FROM app_links WHERE challenge=? AND expires>? RETURNING source_hash",
    )
      .bind(await hash(input.secret), timestamp())
      .first();
    if (!row) return json({ pending: true }, 202);
    const user = await identityByHash(row.source_hash, env);
    if (!user)
      return json({ error: "Доступ відкликано. Увійдіть заново." }, 403);
    const session = random(),
      digest = await hash(session),
      csrf = random();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO auth_sessions VALUES(?,?,?,?,?)").bind(
        digest,
        user.id,
        user.name,
        csrf,
        timestamp() + 604800,
      ),
      env.DB.prepare(
        "INSERT INTO session_phone SELECT ?,phone FROM session_phone WHERE token_hash=?",
      ).bind(digest, row.source_hash),
    ]);
    if (!(await identityByHash(digest, env))) {
      await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?")
        .bind(digest)
        .run();
      return json({ error: "Доступ відкликано" }, 403);
    }
    return json({ session, expires_in: 604800 });
  }
  return json({ error: "Метод не підтримується" }, 405);
}
async function bounded(request) {
  const reader = request.body?.getReader();
  if (!reader) throw Error("Порожній запит");
  let size = 0,
    result = "";
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 512) {
      await reader.cancel();
      throw Error("Запит завеликий");
    }
    result += decoder.decode(value, { stream: true });
  }
  return result + decoder.decode();
}
