import { fail, integer, validateProduct } from "./domain.js";

export function restoreData(before, input) {
  if (input.format !== "minicafe-android-1")
    fail("Невідомий формат резервної копії");
  const d = structuredClone(input);
  for (const [key, max] of [
    ["products", 2000],
    ["orders", 10000],
    ["sessions", 10000],
  ]) {
    if (!Array.isArray(d[key]) || d[key].length > max)
      fail("Некоректна колекція: " + key);
    const ids = new Set();
    for (const row of d[key]) {
      integer(row.id, key === "sessions" ? 0 : 1);
      if (ids.has(row.id)) fail("Повторні ID");
      ids.add(row.id);
    }
  }
  d.calculator_expenses ||= [];
  if (
    !Array.isArray(d.calculator_expenses) ||
    d.calculator_expenses.length > 10000
  )
    fail("Некоректні витрати");
  const date = (s) => {
    if (
      typeof s !== "string" ||
      !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ||
      !Number.isFinite(Date.parse(s.replace(" ", "T") + "Z"))
    )
      fail("Некоректна дата");
  };
  const string = (s, max) => {
    if (typeof s !== "string" || s.length > max) fail("Некоректний текст");
  };
  for (const p of d.products) {
    validateProduct(p);
    if (p.image_file) fail("Копія без фото: експортуйте її штатною кнопкою");
    delete p.image_asset;
  }
  for (const s of d.sessions) {
    string(s.name, 100);
    date(s.started);
    if (s.ended) date(s.ended);
  }
  const sessionIds = new Set(d.sessions.map((s) => s.id)),
    itemIds = new Set(),
    requests = new Set();
  const validSession = (id) => {
    integer(id);
    if (id && !sessionIds.has(id)) fail("Невідома сесія");
  };
  let maxItem = 0;
  for (const o of d.orders) {
    string(o.request, 100);
    if (!/^[A-Za-z0-9_-]+$/.test(o.request) || requests.has(o.request))
      fail("Повторні запити замовлень");
    requests.add(o.request);
    validSession(o.session_id || 0);
    string(o.guest || "", 100);
    string(o.comment || "", 500);
    date(o.created);
    if (!Array.isArray(o.items) || !o.items.length || o.items.length > 100)
      fail("Некоректні позиції");
    for (const i of o.items) {
      integer(i.id, 1);
      if (itemIds.has(i.id)) fail("Повторні ID позицій");
      itemIds.add(i.id);
      maxItem = Math.max(maxItem, i.id);
      integer(i.qty, 1, 99);
      integer(i.price, 0, 100000000);
      string(i.name, 100);
      string(i.note || "", 300);
      if (
        !["bar", "instant"].includes(i.route) ||
        !["new", "making", "ready", "delivered", "cancelled"].includes(i.status)
      )
        fail("Некоректний стан позиції");
      if (
        i.unit_issued &&
        (!Array.isArray(i.unit_issued) ||
          i.unit_issued.length !== i.qty ||
          i.unit_issued.some((v) => typeof v !== "boolean"))
      )
        fail("Некоректні порції");
    }
    if (o.payment) {
      for (const k of ["cash_given", "card_amount", "change", "total"])
        integer(o.payment[k]);
      integer(o.payment.cash_amount, -100000000000, 100000000000);
      const total = o.items.reduce((s, i) => s + i.price * i.qty, 0),
        pay = o.payment;
      if (
        pay.total !== total ||
        pay.cash_amount + pay.card_amount !== total ||
        pay.cash_given - pay.cash_amount !== pay.change
      )
        fail("Некоректна оплата");
    }
    o.events = Array.isArray(o.events) ? o.events.slice(-64) : [];
  }
  const expenseIds = new Set();
  for (const e of d.calculator_expenses) {
    if (
      typeof e.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(e.id) ||
      expenseIds.has(e.id)
    )
      fail("Некоректний ID витрат");
    expenseIds.add(e.id);
    integer(e.cost, 1);
    string(e.note || "", 200);
    date(e.created);
    date(e.updated);
    validSession(e.session_id || 0);
    if (e.kind && e.kind !== "additional" && e.kind !== "calculator")
      fail("Некоректний тип витрат");
  }
  validSession(d.active_session || 0);
  d.nextProduct = Math.max(
    before.nextProduct,
    ...d.products.map((p) => p.id + 1),
  );
  d.nextOrder = Math.max(before.nextOrder, ...d.orders.map((o) => o.id + 1));
  d.nextItem = Math.max(before.nextItem, maxItem + 1);
  d.nextSession = Math.max(
    before.nextSession,
    ...d.sessions.map((s) => s.id + 1),
  );
  d.active_session ||= 0;
  d.issue_undo = {}; // Old undo entries are intentionally invalidated by full database replacement.
  d.versions = Object.fromEntries(
    Object.entries(before.versions).map(([k, v]) => [k, v + 1]),
  );
  d.expenses_version = (before.expenses_version || 0) + 1;
  d.revision = before.revision;
  // Keep only documented metadata; imported keys must not change server settings.
  return Object.fromEntries(
    [
      "nextProduct",
      "nextOrder",
      "nextItem",
      "nextSession",
      "active_session",
      "issue_undo",
      "versions",
      "expenses_version",
      "revision",
      "products",
      "orders",
      "sessions",
      "calculator_expenses",
    ].map((k) => [k, d[k]]),
  );
}
