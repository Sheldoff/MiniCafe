import { createRemoteJWKSet, jwtVerify } from "jose";

const DAY = 86400,
  encoder = new TextEncoder();
const keys = createRemoteJWKSet(
  new URL("https://oauth.telegram.org/.well-known/jwks.json"),
  { cacheMaxAge: 3600000, cooldownDuration: 30000, timeoutDuration: 5000 },
);
export const timestamp = () => Math.floor(Date.now() / 1000);
export const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export async function hash(value) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export const admins = (env) =>
  new Set(
    (env.ADMIN_TELEGRAM_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s)),
  );
export function cookie(request, name) {
  const raw = (request.headers.get("Cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="));
  return raw?.slice(name.length + 1) || "";
}
function sessionCookie(value, age = 7 * DAY) {
  return `__Host-minicafe_session=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
}
const flowCookie = (value, age = 600) =>
  `__Host-minicafe_oauth=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
const privateHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};
export function secureJson(value, status = 200, extra = {}) {
  return Response.json(value, {
    status,
    headers: { ...privateHeaders, ...extra },
  });
}
function errorPage(message, status = 400) {
  // Only fixed, server-authored messages go here; provider errors are never reflected.
  return new Response(
    `<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>МініКафе · Вхід</title><body style="font:18px system-ui;background:#f5f4ef;color:#173f35;padding:32px;max-width:640px;margin:auto"><h1>МініКафе</h1><p>${message}</p><a href="/">Повернутися до меню</a></body></html>`,
    {
      status,
      headers: { ...privateHeaders, "Content-Type": "text/html;charset=utf-8" },
    },
  );
}
export function validOrigin(request) {
  return (
    request.headers.get("Origin") === new URL(request.url).origin &&
    request.headers.get("Sec-Fetch-Site") !== "cross-site"
  );
}
export async function identity(request, env) {
  const token = cookie(request, "__Host-minicafe_session");
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await env.DB.prepare(
    `SELECT a.telegram_id,a.display_name,a.csrf,a.expires,s.role,s.enabled
    FROM auth_sessions a LEFT JOIN staff_access s ON s.telegram_id=a.telegram_id
    WHERE a.token_hash=? AND a.expires>?`,
  )
    .bind(await hash(token), timestamp())
    .first();
  if (!row) return null;
  const role = admins(env).has(row.telegram_id)
    ? "admin"
    : row.enabled === 1 &&
        ["service", "cash", "bar", "delivery"].includes(row.role)
      ? row.role
      : null;
  return role
    ? { id: row.telegram_id, name: row.display_name, role, csrf: row.csrf }
    : null;
}
export function csrfAllowed(request, user) {
  return (
    !!user &&
    validOrigin(request) &&
    request.headers.get("X-CSRF-Token") === user.csrf
  );
}
export function canRead(role, path) {
  return role === "admin" || path === "state" || path.startsWith("image/");
}
export function canWrite(role, path, input) {
  if (role === "admin") return true;
  if (role === "cash") return path === "order";
  if (role === "service")
    return [
      "order",
      "issue",
      "issue-unit",
      "issue-item",
      "undo-issue",
      "availability",
    ].includes(path);
  if (!["bar", "delivery"].includes(role)) return false;
  return (
    [
      "issue",
      "issue-unit",
      "issue-item",
      "undo-issue",
      "availability",
    ].includes(path) &&
    (path === "availability" ||
      input.route === (role === "bar" ? "bar" : "instant"))
  );
}
export function filterState(state, user) {
  state.access_role = user.role;
  if (user.role === "admin") return state;
  delete state.additional_expenses;
  delete state.sessions;
  delete state.active_session;
  if (["bar", "delivery"].includes(user.role)) {
    const route = user.role === "bar" ? "bar" : "instant";
    state.products = state.products.filter((p) => p.route === route);
    state.orders = state.orders
      .map((o) => ({
        id: o.id,
        created: o.created,
        guest: o.guest,
        items: o.items
          .filter((i) => i.route === route)
          .map((i) => {
            const { price, catalog_price, requested_price, ...safe } = i;
            return safe;
          }),
      }))
      .filter((o) => o.items.length);
    const value = state.can_undo_issue[route];
    state.can_undo_issue = { [route]: value };
  } else {
    // Cash/combined service do not receive finances, history or prior order payments.
    state.orders = state.orders.map((o) => ({
      id: o.id,
      created: o.created,
      guest: o.guest,
      items: o.items.map((i) => {
        const { catalog_price, requested_price, ...safe } = i;
        return safe;
      }),
    }));
  }
  return state;
}
export async function rateLimit(env, request, label, limit, seconds) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const current = timestamp(),
    period = Math.floor(current / seconds);
  const key = await hash(label + ":" + ip + ":" + period);
  const result = await env.DB.prepare(
    `INSERT INTO rate_limits(bucket,hits,expires) VALUES(?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 WHERE hits<? RETURNING hits`,
  )
    .bind(key, (period + 1) * seconds + 60, limit)
    .first();
  return !!result;
}
export async function authRoutes(request, env) {
  const url = new URL(request.url),
    path = url.pathname;
  if (path === "/api/me" && request.method === "GET") {
    const user = await identity(request, env);
    return secureJson({ authenticated: !!user, ...(user ? { user } : {}) });
  }
  if (path === "/auth/logout" && request.method === "POST") {
    const user = await identity(request, env);
    if (!csrfAllowed(request, user))
      return secureJson({ error: "Немає доступу" }, 403);
    await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?")
      .bind(await hash(cookie(request, "__Host-minicafe_session")))
      .run();
    return secureJson({ ok: true }, 200, {
      "Set-Cookie": sessionCookie("", 0),
    });
  }
  if (path === "/auth/login" && request.method === "GET") {
    const asset = await env.ASSETS.fetch(
      new Request(new URL("/login.html", url)),
    );
    return new Response(asset.body, {
      status: asset.status,
      headers: { ...privateHeaders, "Content-Type": "text/html;charset=utf-8" },
    });
  }
  if (path === "/auth/start" && request.method === "GET") {
    if (!env.TELEGRAM_CLIENT_ID || !env.TELEGRAM_CLIENT_SECRET)
      return errorPage(
        "Вхід через Telegram ще налаштовується. Спробуйте пізніше.",
        503,
      );
    if (request.headers.get("Sec-Fetch-Site") === "cross-site")
      return errorPage("Почніть вхід зі сторінки МініКафе.", 403);
    if (!(await rateLimit(env, request, "login", 10, 600)))
      return errorPage(
        "Забагато спроб входу. Спробуйте через кілька хвилин.",
        429,
      );
    const state = random(),
      browser = random(),
      verifier = random(),
      nonce = random();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(verifier),
    );
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM auth_flows WHERE expires<?").bind(
        timestamp(),
      ),
      env.DB.prepare("DELETE FROM auth_sessions WHERE expires<?").bind(
        timestamp(),
      ),
      env.DB.prepare("DELETE FROM rate_limits WHERE expires<?").bind(
        timestamp(),
      ),
      env.DB.prepare("INSERT INTO auth_flows VALUES(?,?,?,?,?)").bind(
        state,
        await hash(browser),
        verifier,
        nonce,
        timestamp() + 600,
      ),
    ]);
    const target = new URL("https://oauth.telegram.org/auth");
    target.search = new URLSearchParams({
      client_id: env.TELEGRAM_CLIENT_ID,
      redirect_uri: url.origin + "/auth/callback",
      response_type: "code",
      scope: "openid profile",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return new Response(null, {
      status: 302,
      headers: {
        ...privateHeaders,
        Location: target.href,
        "Set-Cookie": flowCookie(browser),
      },
    });
  }
  if (path === "/auth/callback" && request.method === "GET") {
    const state = url.searchParams.get("state"),
      code = url.searchParams.get("code"),
      browser = cookie(request, "__Host-minicafe_oauth");
    if (
      !/^[a-f0-9]{64}$/.test(state || "") ||
      !/^[a-f0-9]{64}$/.test(browser) ||
      !code ||
      code.length > 4096
    )
      return errorPage("Не вдалося підтвердити вхід. Почніть заново.");
    const flow = await env.DB.prepare(
      "DELETE FROM auth_flows WHERE state=? AND browser_hash=? AND expires>? RETURNING verifier,nonce",
    )
      .bind(state, await hash(browser), timestamp())
      .first();
    if (!flow)
      return errorPage(
        "Посилання входу прострочене або вже використане. Почніть заново.",
      );
    try {
      const response = await fetch("https://oauth.telegram.org/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            btoa(env.TELEGRAM_CLIENT_ID + ":" + env.TELEGRAM_CLIENT_SECRET),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: url.origin + "/auth/callback",
          client_id: env.TELEGRAM_CLIENT_ID,
          code_verifier: flow.verifier,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw Error("Provider exchange failed");
      const token = (await response.json()).id_token;
      if (typeof token !== "string" || token.length > 20000)
        throw Error("Invalid token");
      const payload = await verifyTelegramToken(
        token,
        flow.nonce,
        env.TELEGRAM_CLIENT_ID,
      );
      const id = String(payload.id ?? "");
      if (!/^\d{1,20}$/.test(id)) throw Error("Missing Telegram ID");
      const staff = admins(env).has(id)
        ? { role: "admin" }
        : await env.DB.prepare(
            "SELECT role FROM staff_access WHERE telegram_id=? AND enabled=1",
          )
            .bind(id)
            .first();
      if (!staff)
        return errorPage(
          "Для цього Telegram-акаунта ще не надано доступ. Зверніться до адміністратора.",
          403,
        );
      const session = random(),
        csrf = random(),
        name = String(payload.name || payload.given_name || "Працівник").slice(
          0,
          100,
        );
      await env.DB.prepare("INSERT INTO auth_sessions VALUES(?,?,?,?,?)")
        .bind(await hash(session), id, name, csrf, timestamp() + 7 * DAY)
        .run();
      const h = new Headers({ ...privateHeaders, Location: "/admin" });
      h.append("Set-Cookie", sessionCookie(session));
      h.append("Set-Cookie", flowCookie("", 0));
      return new Response(null, { status: 302, headers: h });
    } catch {
      return errorPage(
        "Не вдалося перевірити відповідь Telegram. Повторіть вхід.",
        401,
      );
    }
  }
  return null;
}

// Injectable key resolver is used by cryptographic unit tests, never by request input.
export async function verifyTelegramToken(
  token,
  nonce,
  clientId,
  resolver = keys,
) {
  const { payload } = await jwtVerify(token, resolver, {
    issuer: "https://oauth.telegram.org",
    audience: clientId,
    algorithms: ["RS256", "ES256"],
    requiredClaims: ["sub", "exp", "iat", "nonce"],
    maxTokenAge: "10m",
    clockTolerance: 5,
  });
  if (payload.nonce !== nonce) throw Error("Nonce mismatch");
  return payload;
}
