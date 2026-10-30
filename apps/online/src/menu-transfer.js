import {
  identity,
  csrfAllowed,
  random,
  hash,
  cookie,
  timestamp,
  admins,
  secureJson,
} from "./auth.js";
import { load, commit, prepareImages } from "./storage.js";
import { validateProduct, fail } from "./domain.js";

export function replaceMenu(d, products) {
  if (!Array.isArray(products) || products.length > 2000)
    fail("Некоректне меню");
  d.products = products.map((source) => {
    const p = {
      id: d.nextProduct++,
      name: source.name,
      category: source.category,
      route: source.route,
      price: source.price,
      active: source.active === undefined ? 1 : source.active,
      sold_out: source.sold_out === true,
      stock_estimated: source.stock_estimated === true,
    };
    if (source.stock != null) p.stock = source.stock;
    if (source.image != null) p.image = source.image;
    return validateProduct(p);
  });
  d.versions.products++;
}
async function exportMenu(d, env, url) {
  const images = new Map(d._images.map((x) => [x.id, x.content]));
  for (const p of d.products) {
    if (images.has(p.id)) p.image = images.get(p.id);
    else if (p.image_asset) {
      if (!p.image_asset.startsWith("/images/")) fail("Некоректне фото");
      const r = await env.ASSETS.fetch(
        new Request(new URL(p.image_asset, url)),
      );
      if (!r.ok) fail("Фото недоступне");
      const bytes = new Uint8Array(await r.arrayBuffer());
      let raw = "";
      for (let i = 0; i < bytes.length; i += 8192)
        raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
      p.image = btoa(raw);
    }
    delete p.image_asset;
    delete p.image_file;
  }
  return { format: "minicafe-menu-1", products: d.products };
}
async function boundedJson(request) {
  const reader = request.body?.getReader();
  if (!reader) fail("Порожній запит");
  let size = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8000000) {
      await reader.cancel();
      fail("Меню завелике: до 8 МБ");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let pos = 0;
  for (const c of chunks) {
    bytes.set(c, pos);
    pos += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail("Некоректний JSON");
  }
}
export async function menuTransfer(request, env) {
  const url = new URL(request.url),
    path = url.pathname;
  if (!path.startsWith("/api/menu-transfer")) return null;
  if (request.method !== "POST")
    return secureJson({ error: "Потрібен POST" }, 405);
  if (path === "/api/menu-transfer") {
    const user = await identity(request, env);
    if (!user) return secureJson({ error: "Потрібен вхід" }, 401);
    if (user.role !== "admin" || !csrfAllowed(request, user))
      return secureJson({ error: "Немає доступу" }, 403);
    const input = await boundedJson(request);
    if (
      !["upload", "download"].includes(input.direction) ||
      input.confirm !== true
    )
      fail("Підтвердьте напрямок");
    const meta = await env.DB.prepare(
      "SELECT data FROM metadata WHERE id=1",
    ).first();
    const token = random(),
      sessionHash = await hash(cookie(request, "__Host-minicafe_session"));
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM menu_transfer WHERE expires<=? OR session_hash=?",
      ).bind(timestamp(), sessionHash),
      env.DB.prepare("INSERT INTO menu_transfer VALUES(?,?,?,?,?,?)").bind(
        await hash(token),
        sessionHash,
        user.id,
        input.direction,
        JSON.parse(meta.data).versions.products,
        timestamp() + 300,
      ),
    ]);
    return secureJson({ code: token, expires_in: 300 });
  }
  const direction =
    path === "/api/menu-transfer/upload"
      ? "upload"
      : path === "/api/menu-transfer/download"
        ? "download"
        : null;
  if (!direction) return secureJson({ error: "Не знайдено" }, 404);
  const raw = request.headers.get("X-Menu-Transfer") || "";
  if (!/^[a-f0-9]{64}$/.test(raw))
    return secureJson({ error: "Некоректний код" }, 401);
  if (
    request.headers.get("Sec-Fetch-Site") === "cross-site" ||
    (request.headers.get("Origin") &&
      request.headers.get("Origin") !== url.origin)
  )
    return secureJson({ error: "Інший сайт" }, 403);
  const key = await hash(raw),
    now = timestamp();
  const token = await env.DB.prepare(
    `SELECT t.* FROM menu_transfer t JOIN auth_sessions a ON a.token_hash=t.session_hash
    WHERE t.token_hash=? AND t.direction=? AND t.expires>? AND a.expires>?`,
  )
    .bind(key, direction, now, now)
    .first();
  if (!token || !admins(env).has(token.creator))
    return secureJson(
      { error: "Код використаний, прострочений або іншого напрямку" },
      401,
    );
  const before = await load(
    env.DB,
    "SELECT data FROM orders WHERE 0",
    [],
    direction === "download",
  );
  if (direction === "download") {
    const data = await exportMenu(before, env, url);
    const current = await env.DB.prepare(
      "SELECT data FROM metadata WHERE id=1",
    ).first();
    if (JSON.parse(current.data).versions.products !== before.versions.products)
      return secureJson(
        { error: "Меню змінилося під час завантаження. Повторіть дію." },
        409,
      );
    if (JSON.stringify(data).length > 8000000) fail("Меню завелике: до 8 МБ");
    const consumed = await env.DB.prepare(
      `DELETE FROM menu_transfer WHERE token_hash=? AND expires>?
      AND session_hash IN (SELECT token_hash FROM auth_sessions WHERE expires>?) RETURNING token_hash`,
    )
      .bind(key, timestamp(), timestamp())
      .first();
    if (!consumed) return secureJson({ error: "Код вже використаний" }, 401);
    return secureJson(data);
  }
  const input = await boundedJson(request);
  if (input.format !== "minicafe-menu-1" || input.confirm !== true)
    fail("Підтвердьте перенесення меню");
  if (before.versions.products !== token.products_version)
    return secureJson(
      { error: "Меню сайту змінилося. Створіть новий код." },
      409,
    );
  const after = structuredClone(before);
  replaceMenu(after, input.products);
  const images = await prepareImages(after, 1500000);
  const guards = [
    env.DB.prepare(
      `INSERT INTO mutation_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM menu_transfer t
      JOIN auth_sessions a ON a.token_hash=t.session_hash WHERE t.token_hash=? AND t.expires>? AND a.expires>?) THEN 1 ELSE 0 END`,
    ).bind(key, timestamp(), timestamp()),
    env.DB.prepare("DELETE FROM menu_transfer WHERE token_hash=?").bind(key),
  ];
  try {
    await commit(env.DB, before, after, images, guards);
  } catch (e) {
    if (String(e).includes("CHECK constraint"))
      return secureJson(
        { error: "Дані змінилися або код використаний. Створіть новий код." },
        409,
      );
    throw e;
  }
  return secureJson({ ok: true, count: after.products.length });
}
