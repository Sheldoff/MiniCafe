import { mutate, report, selected, undoAvailable, fail } from "./domain.js";
import { load, commit, mutationQuery, prepareImages } from "./storage.js";
import { restoreData } from "./restore.js";
import { normalizePhone } from "./phone.js";
import {
  authRoutes,
  identity,
  csrfAllowed,
  canRead,
  canWrite,
  filterState,
  secureJson,
  admins,
  rateLimit,
} from "./auth.js";

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const json = (data, status = 200, extra = {}) =>
  Response.json(data, { status, headers: { ...headers, ...extra } });
const quote = (revision, user) => `"cloud-${revision}-${user.role}-${user.id}"`;
// Cloudflare can weaken ETags when compressing responses. GET uses weak comparison.
const matchesETag = (request, etag) =>
  (request.headers.get("If-None-Match") || "").split(",").some((value) => {
    const tag = value.trim().replace(/^W\//, "");
    return tag === "*" || tag === etag.replace(/^W\//, "");
  });
const writes = new Set([
  "product",
  "delete-product",
  "availability",
  "order",
  "issue",
  "issue-unit",
  "issue-item",
  "undo-issue",
  "status",
  "session/start",
  "session/end",
  "expenses",
  "expenses/update",
  "calculate-menu",
  "stats/clear",
  "restore",
]);

async function handle(request, env) {
  const url = new URL(request.url),
    path = url.pathname.slice(5);
  const authentication = await authRoutes(request, env);
  if (authentication) return authentication;
  if (url.pathname.startsWith("/private/"))
    return new Response("Not found", { status: 404, headers });
  if (url.pathname === "/admin" || url.pathname === "/admin/") {
    if (request.method !== "GET")
      return json({ error: "Метод не підтримується" }, 405);
    const user = await identity(request, env);
    if (!user)
      return new Response(null, {
        status: 302,
        headers: { ...headers, Location: "/auth/login" },
      });
    const asset = await env.ASSETS.fetch(
      new Request(new URL("/private/admin.html", url)),
    );
    if (!asset.ok) return json({ error: "Інтерфейс недоступний" }, 503);
    const context = JSON.stringify({
      authenticated: true,
      csrf: user.csrf,
      role: user.role,
      name: user.name,
    }).replace(/</g, "\\u003c");
    return new Response(
      (await asset.text()).replace("__CLOUD_CONTEXT__", context),
      {
        headers: {
          ...headers,
          "Content-Type": "text/html;charset=utf-8",
          "X-Frame-Options": "DENY",
        },
      },
    );
  }
  if (url.pathname === "/")
    return env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
  if (!url.pathname.startsWith("/api/")) {
    if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/admin/"))
      return json({ error: "Не знайдено" }, 404);
    return env.ASSETS.fetch(request);
  }
  if (path === "public/menu" && request.method === "GET")
    return json(
      {
        published: false,
        accepting: false,
        message: "Меню формується",
        products: [],
      },
      200,
      { "Cache-Control": "public,max-age=60" },
    );
  if (path.startsWith("public/"))
    return json({ error: "Онлайн-замовлення ще не відкриті" }, 403);
  if (path === "ping" && request.method === "GET")
    return json({
      ok: true,
      app: "minicafe",
      mode: "cloud-telegram",
      api_version: 2,
    });
  const user = await identity(request, env);
  if (!user)
    return json({ error: "Потрібен вхід працівника через Telegram" }, 401);
  if (request.method === "GET" && !canRead(user.role, path))
    return json({ error: "Недостатньо прав" }, 403);
  if (path === "staff") {
    if (user.role !== "admin")
      return json({ error: "Лише адміністратор" }, 403);
    if (request.method === "GET")
      return json({
        staff: (
          await env.DB.prepare(
            `SELECT telegram_id,role,enabled,updated,NULL AS phone FROM staff_access
             UNION ALL SELECT claimed_id AS telegram_id,role,enabled,updated,phone FROM staff_phone
             ORDER BY updated DESC`,
          ).all()
        ).results,
      });
    if (request.method !== "POST" || !csrfAllowed(request, user))
      return json({ error: "Немає доступу" }, 403);
    if (!(await rateLimit(env, request, "staff", 30, 60)))
      return json({ error: "Забагато змін" }, 429);
    if (Number(request.headers.get("Content-Length")) > 2048)
      return json({ error: "Запит завеликий" }, 413);
    const text = await request.text();
    if (text.length > 2048) return json({ error: "Запит завеликий" }, 413);
    let input;
    try {
      input = JSON.parse(text);
    } catch {
      return json({ error: "Некоректний JSON" }, 400);
    }
    const id = String(input.telegram_id || "");
    const phone =
      input.phone !== undefined ? normalizePhone(input.phone) : null;
    if (
      (input.phone !== undefined
        ? !phone || !!id
        : !/^\d{1,20}$/.test(id) || admins(env).has(id)) ||
      !["service", "cash", "bar", "delivery"].includes(input.role) ||
      typeof input.enabled !== "boolean"
    )
      return json({ error: "Некоректний доступ" }, 400);
    if (phone) {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO staff_phone(phone,role,enabled,updated) VALUES(?,?,?,?)
          ON CONFLICT(phone) DO UPDATE SET role=excluded.role,enabled=excluded.enabled,updated=excluded.updated`,
        ).bind(
          phone,
          input.role,
          input.enabled ? 1 : 0,
          new Date().toISOString(),
        ),
        env.DB.prepare(
          "DELETE FROM auth_sessions WHERE token_hash IN (SELECT token_hash FROM session_phone WHERE phone=?)",
        ).bind(phone),
      ]);
      return json({ ok: true });
    }
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO staff_access VALUES(?,?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET role=excluded.role,enabled=excluded.enabled,updated=excluded.updated`,
      ).bind(id, input.role, input.enabled ? 1 : 0, new Date().toISOString()),
      env.DB.prepare("DELETE FROM auth_sessions WHERE telegram_id=?").bind(id),
    ]);
    return json({ ok: true });
  }
  if (request.method === "GET") {
    if (path === "state") {
      const meta = await env.DB.prepare(
        "SELECT revision FROM metadata WHERE id=1",
      ).first();
      if (matchesETag(request, quote(meta.revision, user)))
        return new Response(null, {
          status: 304,
          headers: { ...headers, ETag: quote(meta.revision, user) },
        });
      const d = await load(env.DB);
      return json(
        filterState(
          {
            versions: d.versions,
            products: d.products,
            orders: d.orders
              .sort((a, b) => b.id - a.id)
              .map((o) => ({ ...o, events: o.events.slice(-8).reverse() })),
            sessions: d.sessions,
            active_session: d.active_session,
            require_session_start: false,
            expenses_version: d.expenses_version,
            additional_expenses: d.calculator_expenses.filter(
              (e) => e.kind === "additional",
            ),
            can_undo_issue: {
              bar: undoAvailable(d, "bar"),
              instant: undoAvailable(d, "instant"),
            },
          },
          user,
        ),
        200,
        { ETag: quote(d.revision, user) },
      );
    }
    if (path.startsWith("image/")) {
      const id = Number(path.slice(6));
      if (!Number.isSafeInteger(id))
        return json({ error: "Фото не знайдено" }, 404);
      const p = await env.DB.prepare("SELECT data FROM products WHERE id=?")
        .bind(id)
        .first();
      if (!p) return json({ error: "Фото не знайдено" }, 404);
      const product = JSON.parse(p.data);
      if (
        ["bar", "delivery"].includes(user.role) &&
        product.route !== (user.role === "bar" ? "bar" : "instant")
      )
        return json({ error: "Недостатньо прав" }, 403);
      if (product.image_asset)
        return env.ASSETS.fetch(
          new Request(new URL(product.image_asset, url), request),
        );
      const image = await env.DB.prepare(
        "SELECT version,content FROM images WHERE id=?",
      )
        .bind(id)
        .first();
      if (!image) return json({ error: "Фото не знайдено" }, 404);
      const etag = `"${image.version}"`;
      const h = {
        ...headers,
        ETag: etag,
        "Content-Type": "image/jpeg",
        "Cache-Control": "private,no-cache",
        Vary: "Cookie",
      };
      if (matchesETag(request, etag))
        return new Response(null, { status: 304, headers: h });
      return new Response(
        Uint8Array.from(atob(image.content), (c) => c.charCodeAt(0)),
        { headers: h },
      );
    }
    if (["stats", "history"].includes(path)) {
      if (
        !url.searchParams.has("session") &&
        !/^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("day") || "")
      )
        fail("Оберіть період");
      let sql, values;
      if (url.searchParams.has("session")) {
        const sid = Number(url.searchParams.get("session"));
        if (!Number.isSafeInteger(sid) || sid < 0) fail("Некоректна сесія");
        sql = "SELECT data FROM orders WHERE session_id=?";
        values = [sid];
      } else {
        const day = url.searchParams.get("day"),
          offset = Math.max(
            -840,
            Math.min(840, Number(url.searchParams.get("tz")) || 0),
          );
        const start = new Date(Date.parse(day + "T00:00:00Z") - offset * 60000);
        const end = new Date(start.getTime() + 86400000);
        const format = (d) => d.toISOString().slice(0, 19).replace("T", " ");
        sql = "SELECT data FROM orders WHERE created>=? AND created<?";
        values = [format(start), format(end)];
      }
      if (path === "stats") {
        const d = await load(env.DB, sql, values);
        return json(report(d, url.searchParams));
      }
      const page = Math.max(
          0,
          Math.min(
            100000,
            Math.floor(Number(url.searchParams.get("page")) || 0),
          ),
        ),
        size = 30;
      const filtered =
        sql + " AND coalesce(json_extract(data,'$.stats_cleared'),0)=0";
      const rows = await env.DB.batch([
        env.DB.prepare("SELECT count(*) AS total FROM (" + filtered + ")").bind(
          ...values,
        ),
        env.DB.prepare(filtered + " ORDER BY id DESC LIMIT ? OFFSET ?").bind(
          ...values,
          size,
          page * size,
        ),
      ]);
      const total = rows[0].results[0].total;
      return json({
        orders: rows[1].results.map((r) => JSON.parse(r.data)),
        total,
        has_next: total > (page + 1) * size,
      });
    }
    if (path === "backup") {
      const d = await load(env.DB, "SELECT data FROM orders ORDER BY id");
      const images = (
        await env.DB.prepare("SELECT id,content FROM images").all()
      ).results;
      for (const p of d.products) {
        const image = images.find((i) => i.id === p.id);
        if (image) p.image = image.content;
        else if (p.image_asset) {
          const asset = await env.ASSETS.fetch(
            new Request(new URL(p.image_asset, url)),
          );
          const bytes = new Uint8Array(await asset.arrayBuffer());
          let s = "";
          for (let n = 0; n < bytes.length; n += 8192)
            s += String.fromCharCode(...bytes.subarray(n, n + 8192));
          p.image = btoa(s);
        }
        delete p.image_asset;
      }
      return json({ ...d, format: "minicafe-android-1" }, 200, {
        "Content-Disposition":
          "attachment; filename=MiniCafe-cloud-backup.json",
      });
    }
    return json({ error: "Не знайдено" }, 404);
  }
  if (request.method !== "POST")
    return json({ error: "Метод не підтримується" }, 405);
  if (!csrfAllowed(request, user))
    return json({ error: "Сесію не підтверджено. Оновіть сторінку." }, 403);
  // Public is not cross-origin writable; APIs have no CORS wildcard.
  if (
    request.headers.get("Origin") &&
    request.headers.get("Origin") !== url.origin
  )
    return json({ error: "Запит з іншого сайту заборонено" }, 403);
  if (request.headers.get("Sec-Fetch-Site") === "cross-site")
    return json({ error: "Запит з іншого сайту заборонено" }, 403);
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    return json({ error: "Потрібен JSON" }, 415);
  if (!writes.has(path)) return json({ error: "Невідома дія" }, 404);
  const max = path === "restore" ? 8000000 : 700000;
  if (Number(request.headers.get("Content-Length")) > max)
    return json({ error: "Запит завеликий" }, 413);
  // Bound even chunked requests before parsing or allocating an unbounded string.
  const reader = request.body?.getReader();
  if (!reader) fail("Порожній запит");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return json({ error: "Запит завеликий" }, 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  let input;
  try {
    input = JSON.parse(new TextDecoder().decode(body));
  } catch {
    fail("Некоректний JSON");
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("Некоректний запит");
  if (!canWrite(user.role, path, input))
    return json({ error: "Недостатньо прав" }, 403);
  for (let attempt = 0; attempt < 4; attempt++) {
    const meta = await env.DB.prepare(
      "SELECT revision,data FROM metadata WHERE id=1",
    ).first();
    const [sql, bindings] = mutationQuery(path, input, JSON.parse(meta.data));
    const before = await load(
      env.DB,
      path === "restore" ? "SELECT data FROM orders" : sql,
      path === "restore" ? [] : bindings,
    );
    if (before.revision !== meta.revision) continue;
    if (path === "availability" && ["bar", "delivery"].includes(user.role)) {
      const product = before.products.find((p) => p.id === input.id);
      if (
        !product ||
        product.route !== (user.role === "bar" ? "bar" : "instant")
      )
        return json({ error: "Інша видача" }, 403);
    }
    const after =
      path === "restore" ? restoreData(before, input) : structuredClone(before);
    const { result, changed } =
      path === "restore"
        ? {
            result: { ok: true },
            changed: new Set(["products", "orders", "sessions", "expenses"]),
          }
        : mutate(after, path, input);
    if (!changed.size) return json(result);
    const images = await prepareImages(after);
    try {
      await commit(env.DB, before, after, images);
      return json(result);
    } catch (error) {
      if (!String(error).includes("CHECK constraint failed")) throw error;
      if (attempt === 3)
        return json({ error: "Дані одночасно змінилися. Повторіть дію." }, 409);
    }
  }
  return json({ error: "Дані одночасно змінилися. Повторіть дію." }, 409);
}
export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      const internal = /D1_|SQLITE|no such|constraint/i.test(String(error));
      return json(
        {
          error: internal
            ? "Помилка збереження. Спробуйте ще раз."
            : error.message || "Помилка запиту",
          ...(error.missing !== undefined ? { missing: error.missing } : {}),
        },
        internal ? 500 : 400,
      );
    }
  },
};
