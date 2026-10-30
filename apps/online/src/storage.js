import { fail, pending } from "./domain.js";

export async function load(
  db,
  orderQuery = `SELECT data FROM orders WHERE pending=1 OR id IN (SELECT id FROM orders ORDER BY id DESC LIMIT 30)
    OR id IN (SELECT json_extract(a.value,'$.order') FROM metadata m,json_each(m.data,'$.issue_undo.bar') a
    UNION SELECT json_extract(a.value,'$.order') FROM metadata m,json_each(m.data,'$.issue_undo.instant') a)`,
  bindings = [],
  includeImages = false,
) {
  const results = await db.batch([
    db.prepare("SELECT revision,data FROM metadata WHERE id=1"),
    db.prepare("SELECT data FROM products ORDER BY id"),
    db.prepare("SELECT data FROM sessions ORDER BY id"),
    db.prepare("SELECT data FROM expenses ORDER BY id"),
    db.prepare(orderQuery).bind(...bindings),
    ...(includeImages ? [db.prepare("SELECT id,content FROM images")] : []),
  ]);
  const meta = results[0].results[0];
  const parsed = (n) => results[n].results.map((r) => JSON.parse(r.data));
  return {
    ...JSON.parse(meta.data),
    revision: meta.revision,
    products: parsed(1),
    sessions: parsed(2),
    calculator_expenses: parsed(3),
    orders: parsed(4),
    ...(includeImages ? { _images: results[5].results } : {}),
  };
}
export function mutationQuery(path, input, meta) {
  if (path === "order")
    return ["SELECT data FROM orders WHERE request=?", [input.request]];
  if (["issue", "issue-unit", "issue-item"].includes(path))
    return ["SELECT data FROM orders WHERE id=?", [input.order ?? input.id]];
  if (path === "status")
    return [
      "SELECT data FROM orders WHERE id=(SELECT order_id FROM order_items WHERE id=?)",
      [input.id],
    ];
  if (path === "undo-issue") {
    const ids = (meta.issue_undo?.[input.route] || []).map((x) => x.order);
    return [
      "SELECT data FROM orders WHERE id IN (SELECT value FROM json_each(?))",
      [JSON.stringify(ids)],
    ];
  }
  if (path === "stats/clear") return ["SELECT data FROM orders", []];
  return ["SELECT data FROM orders WHERE 0", []];
}
export async function commit(
  db,
  before,
  after,
  imageChanges = [],
  guards = [],
) {
  const { products, orders, sessions, calculator_expenses, revision, ...meta } =
    after;
  const statements = [
    ...guards,
    // A failed CHECK rolls back the ENTIRE batch, including all entity writes.
    db
      .prepare(
        "INSERT INTO mutation_guard(ok) SELECT CASE WHEN revision=? THEN 1 ELSE 0 END FROM metadata WHERE id=1",
      )
      .bind(before.revision),
    db
      .prepare("UPDATE metadata SET revision=revision+1,data=? WHERE id=1")
      .bind(JSON.stringify(meta)),
  ];
  for (const [table, oldRows, newRows] of [
    ["products", before.products, products],
    ["sessions", before.sessions, sessions],
    ["expenses", before.calculator_expenses, calculator_expenses],
    ["orders", before.orders, orders],
  ]) {
    const old = new Map(oldRows.map((r) => [r.id, JSON.stringify(r)]));
    const removed = oldRows
      .filter((r) => !newRows.some((n) => n.id === r.id))
      .map((r) => r.id);
    if (removed.length) {
      statements.push(
        db
          .prepare(
            `DELETE FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`,
          )
          .bind(JSON.stringify(removed)),
      );
      if (table === "products")
        statements.push(
          db
            .prepare(
              "DELETE FROM images WHERE id IN (SELECT value FROM json_each(?))",
            )
            .bind(JSON.stringify(removed)),
        );
    }
    const changed = newRows.filter((r) => old.get(r.id) !== JSON.stringify(r));
    if (!changed.length) continue;
    const payload = JSON.stringify(changed);
    if (table === "orders") {
      const rows = changed.map((o) => ({ ...o, _pending: pending(o) ? 1 : 0 }));
      statements.push(
        db
          .prepare(
            `INSERT INTO orders(id,request,session_id,created,pending,data)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.request'),json_extract(value,'$.session_id'),
        json_extract(value,'$.created'),json_extract(value,'$._pending'),json_remove(value,'$._pending') FROM json_each(?) WHERE 1
        ON CONFLICT(id) DO UPDATE SET request=excluded.request,created=excluded.created,session_id=excluded.session_id,pending=excluded.pending,data=excluded.data`,
          )
          .bind(JSON.stringify(rows)),
      );
      statements.push(
        db
          .prepare(
            "DELETE FROM order_items WHERE order_id IN (SELECT json_extract(value,'$.id') FROM json_each(?))",
          )
          .bind(payload),
        db
          .prepare(
            `INSERT OR IGNORE INTO order_items(id,order_id)
        SELECT json_extract(i.value,'$.id'),json_extract(o.value,'$.id') FROM json_each(?) o,json_each(o.value,'$.items') i`,
          )
          .bind(payload),
      );
    } else {
      statements.push(
        db
          .prepare(
            `INSERT INTO ${table}(id,data) SELECT json_extract(value,'$.id'),value FROM json_each(?) WHERE 1
        ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
          )
          .bind(payload),
      );
    }
  }
  for (const image of imageChanges) {
    if (image.content === null)
      statements.push(
        db.prepare("DELETE FROM images WHERE id=?").bind(image.id),
      );
    else
      statements.push(
        db
          .prepare(
            "INSERT INTO images(id,version,content) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,content=excluded.content",
          )
          .bind(image.id, image.version, image.content),
      );
  }
  statements.push(db.prepare("DELETE FROM mutation_guard"));
  await db.batch(statements);
}
export async function prepareImages(d, maxBytes = 450000) {
  const changes = [];
  for (const p of d.products)
    if ("image" in p) {
      const value = p.image;
      delete p.image;
      delete p.image_asset;
      if (value === null) {
        delete p.image_version;
        changes.push({ id: p.id, content: null });
      } else {
        if (
          typeof value !== "string" ||
          value.length > Math.ceil(maxBytes / 3) * 4 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
        )
          fail(
            `Фото завелике або некоректне (до ${Math.round(maxBytes / 1000)} КБ)`,
          );
        let bytes;
        try {
          bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
        } catch {
          fail("Некоректне фото");
        }
        if (
          bytes.length < 4 ||
          bytes.length > maxBytes ||
          bytes[0] !== 255 ||
          bytes[1] !== 216 ||
          bytes.at(-2) !== 255 ||
          bytes.at(-1) !== 217
        )
          fail("Потрібне JPEG-зображення");
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        p.image_version = [...new Uint8Array(hash)]
          .map((x) => x.toString(16).padStart(2, "0"))
          .join("")
          .slice(0, 16);
        changes.push({ id: p.id, version: p.image_version, content: value });
      }
    }
  return changes;
}
