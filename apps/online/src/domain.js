import { liveSession } from "./live-stats.js";
import {
  validateCashStock,
  reconcileCashStock,
  changeStock,
  checkStockBasis,
} from "./cash-stock.js";
import {
  locationById,
  validateLocation,
  applyRouting,
  inLocation,
  undoKey,
  checkLocationChange,
  availabilityCash,
} from "./locations.js";
// Money is integer kopiykas. Reducer works on a private snapshot; DB commit is atomic.
export const now = () =>
  new Date().toISOString().slice(0, 19).replace("T", " ");
export function fail(message, missing) {
  const error = new Error(message);
  if (missing !== undefined) error.missing = missing;
  throw error;
}
export function integer(value, min = 0, max = 100000000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail("Некоректне числове значення");
  return value;
}
function text(value, limit, required = false) {
  if (typeof value !== "string") fail("Некоректний текст");
  const s = value.trim();
  if (s.length > limit || (required && !s))
    fail("Перевірте довжину та назву поля");
  return s;
}
export const find = (rows, id) =>
  rows.find((x) => x.id === id) || fail("Позицію не знайдено");
const routeCheck = (r) =>
  ["bar", "instant"].includes(r) || fail("Невідома видача");
const normalize = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
export const pending = (o) =>
  o.items.some((i) => !["delivered", "cancelled"].includes(i.status));
export function validateProduct(p) {
  p.name = text(p.name, 100, true);
  p.category = text(p.category, 100, true);
  integer(p.price, 0, 100000000);
  routeCheck(p.route);
  p.active = p.active ? 1 : 0;
  if (
    p.unavailable_at !== undefined &&
    (!Array.isArray(p.unavailable_at) ||
      p.unavailable_at.length > 50 ||
      new Set(p.unavailable_at).size !== p.unavailable_at.length ||
      p.unavailable_at.some(
        (id) => typeof id !== "string" || !/^(cash|loc-[a-f0-9]{32})$/.test(id),
      ))
  )
    fail("Некоректна наявність каси");
  if (p.stock != null) integer(p.stock, -1000000, 1000000);
  if (p.stock_estimated !== undefined && typeof p.stock_estimated !== "boolean")
    fail("Некоректний режим залишку");
  validateCashStock(p);
  return p;
}
export function flags(i) {
  return Array.isArray(i.unit_issued) && i.unit_issued.length === i.qty
    ? [...i.unit_issued]
    : Array(i.qty).fill(i.status === "delivered");
}
function apply(i, values) {
  i.unit_issued = values;
  i.status = values.every(Boolean) ? "delivered" : "new";
}
function event(o, message) {
  o.events ||= [];
  o.events.push({ created: now(), message });
  o.events = o.events.slice(-64);
}
function session(d, name = "") {
  const id = d.nextSession++;
  d.sessions.push({
    id,
    name: text(name, 100) || `Сесія №${id}`,
    started: now(),
    ended: null,
  });
  d.active_session = id;
  for (const e of d.calculator_expenses)
    if (e.pending_session) {
      e.session_id = id;
      e.pending_session = false;
    }
  return id;
}
function requestId(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id))
    fail("Некоректний номер запиту");
  return id;
}
function remember(d, route, order, units) {
  if (!units.length) return;
  d.issue_undo[route] ||= [];
  d.issue_undo[route].push({ order, units });
  d.issue_undo[route] = d.issue_undo[route].slice(-50);
}
export function undoAvailable(d, route) {
  return (d.issue_undo[route] || []).some((a) =>
    d.orders.some(
      (o) =>
        o.id === a.order &&
        a.units.some((u) => {
          const i = o.items.find((i) => i.id === u.id);
          return (
            i &&
            inLocation(i, route.split("@")[0], route.split("@")[1]) &&
            i.status !== "cancelled" &&
            flags(i)[u.unit]
          );
        }),
    ),
  );
}
export function mutate(d, path, input) {
  const p = d.products,
    orders = d.orders;
  let result = { ok: true };
  const changed = new Set();
  if (path === "product") {
    let product = input.id
      ? find(p, integer(input.id, 1))
      : { id: d.nextProduct++, sold_out: false };
    if (input.id) checkStockBasis(product, input.stock_basis);
    if (!input.id) p.push(product);
    Object.assign(
      product,
      validateProduct({
        ...product,
        name: input.name,
        category: input.category,
        price: input.price,
        route: input.route,
        active: input.active ?? true,
      }),
    );
    if ("stock_estimated" in input) {
      if (typeof input.stock_estimated !== "boolean")
        fail("Некоректний режим залишку");
      product.stock_estimated = input.stock_estimated;
    }
    if ("stock" in input) {
      if (input.stock === null) delete product.stock;
      else
        product.stock = integer(
          input.stock,
          product.stock_estimated ? -1000000 : 0,
          1000000,
        );
    }
    if ("stock_by_cash" in input) {
      if (input.stock_by_cash === null) delete product.stock_by_cash;
      else {
        product.stock_by_cash = structuredClone(input.stock_by_cash);
        validateCashStock(product, d.locations || []);
      }
    } else reconcileCashStock(product, d.locations || []);
    if ("image" in input) product.image = input.image;
    result.id = product.id;
    changed.add("products");
  } else if (path === "delete-product") {
    find(p, input.id);
    d.products = p.filter((p) => p.id !== input.id);
    changed.add("products");
  } else if (path === "availability") {
    if (typeof input.sold_out !== "boolean") fail("Некоректна наявність");
    const product = find(p, input.id),
      cash = availabilityCash(
        d.locations,
        input.location_id || (product.route === "bar" ? "bar" : "delivery"),
      );
    if (cash) {
      const ids = new Set(product.unavailable_at || []);
      if (input.sold_out) ids.add(cash);
      else ids.delete(cash);
      product.unavailable_at = [...ids];
    } else product.sold_out = input.sold_out;
    changed.add("products");
  } else if (path === "location/save") {
    d.locations ||= [];
    const row = validateLocation(input, d.locations),
      index = d.locations.findIndex((l) => l.id === row.id);
    if (index >= 0 && d.locations[index].kind !== row.kind)
      checkLocationChange(row.id, d.locations, orders);
    if (index < 0) d.locations.push(row);
    else d.locations[index] = row;
    for (const product of p) reconcileCashStock(product, d.locations || []);
    changed.add("products");
    changed.add("locations");
  } else if (path === "location/delete") {
    if (["cash", "bar", "delivery"].includes(input.id))
      fail("Основні локації видаляти не можна");
    if (!(d.locations || []).some((l) => l.id === input.id))
      fail("Локацію не знайдено");
    checkLocationChange(input.id, d.locations, orders);
    d.locations = d.locations.filter((l) => l.id !== input.id);
    for (const product of p) reconcileCashStock(product, d.locations || []);
    changed.add("products");
    changed.add("locations");
  } else if (path === "settings/update") {
    if (typeof input.online_payment_enabled !== "boolean")
      fail("Некоректне налаштування");
    d.online_payment_enabled = input.online_payment_enabled;
    changed.add("locations");
  } else if (path === "expenses/delete") {
    const old = d.calculator_expenses.find((e) => e.id === input.id);
    if (old && old.kind !== "additional") fail("Це не додаткові витрати");
    if (old) {
      d.calculator_expenses = d.calculator_expenses.filter(
        (e) => e.id !== input.id,
      );
      d.expenses_version++;
      changed.add("expenses");
    }
  } else if (path === "transaction/hide") {
    const o = find(orders, integer(input.id, 1));
    if (!(o.payment?.card_amount > 0)) fail("Карткову оплату не знайдено");
    o.transaction_history_hidden = true;
    changed.add("orders");
  } else if (path === "card-payment/hide") {
    const order = find(orders, integer(input.id, 1));
    if (order.gift || !order.payment || order.payment.card_amount <= 0)
      fail("Карткову оплату не знайдено");
    if (!order.card_history_hidden) {
      order.card_history_hidden = true;
      changed.add("orders");
    }
  } else if (path === "order") {
    const idempotency = requestId(input.request);
    const existing = orders.find((o) => o.request === idempotency);
    if (existing) return { result: { id: existing.id }, changed };
    if (
      !Array.isArray(input.items) ||
      !input.items.length ||
      input.items.length > 100
    )
      fail("Додайте позиції");
    const id = d.nextOrder++;
    const items = input.items.map((row) => {
      const product = find(p, integer(row.id, 1));
      const qty = integer(row.qty, 1, 99);
      if (
        !product.active ||
        product.sold_out ||
        product.unavailable_at?.includes(input.location_id || "cash")
      )
        fail("Позиція недоступна на цій касі");
      const price =
        row.unit_price === undefined
          ? product.price
          : integer(row.unit_price, 0, 100000000);
      changeStock(
        product,
        input.location_id || "cash",
        -qty,
        d.locations || [],
      );
      return {
        id: d.nextItem++,
        order_id: id,
        product_id: product.id,
        name: product.name,
        category: product.category,
        route: product.route,
        qty,
        price: input.gift ? 0 : price,
        catalog_price: product.price,
        requested_price: price,
        status: "new",
        note: text(row.note || "", 300),
      };
    });
    const total = items.reduce((n, i) => n + i.price * i.qty, 0);
    const cash = integer(input.cash_given),
      card = integer(input.card_amount);
    if (input.gift && (cash || card)) fail("Подарунок має нульову оплату");
    if (cash + card < total) fail("Недостатня оплата", total - cash - card);
    let guest = text(input.guest || "", 100);
    if (
      !guest &&
      locationById(d.locations || [], input.location_id || "cash")
        ?.guest_name_required
    )
      fail("Вкажіть ім’я гостя");
    if (!guest) {
      const number = integer(d.next_guest_number ?? 1, 1, 1000000000);
      guest = "Гість №" + number;
      d.next_guest_number = number + 1;
    }
    const sid = d.active_session || session(d);
    orders.push({
      id,
      request: idempotency,
      session_id: sid,
      created: now(),
      guest,
      gift: !!input.gift,
      comment: text(input.comment || "", 500),
      place: "",
      items,
      events: [],
      payment: {
        cash_given: cash,
        card_amount: card,
        cash_amount: total - card,
        change: cash + card - total,
        total,
      },
    });
    applyRouting(orders[orders.length - 1], input, d.locations || []);
    result = { id };
    ["orders", "products", "sessions", "expenses"].forEach((x) =>
      changed.add(x),
    );
  } else if (["issue", "issue-unit", "issue-item"].includes(path)) {
    routeCheck(input.route);
    const o = find(orders, input.order ?? input.id);
    const units = [];
    const selected = path === "issue" ? o.items : [find(o.items, input.id)];
    for (const i of selected) {
      if (
        !inLocation(i, input.route, input.location_id) ||
        i.status === "cancelled"
      ) {
        if (path !== "issue") fail("Позиція іншої видачі");
        continue;
      }
      const values = flags(i),
        delivered = path === "issue" ? true : input.delivered;
      if (typeof delivered !== "boolean") fail("Некоректний стан видачі");
      const indexes =
        path === "issue-unit"
          ? [integer(input.unit, 0, i.qty - 1)]
          : values.map((_, n) => n);
      for (const n of indexes) {
        if (delivered && !values[n]) units.push({ id: i.id, unit: n });
        values[n] = delivered;
      }
      apply(i, values);
    }
    remember(d, undoKey(input.route, input.location_id), o.id, units);
    event(o, "Оновлено видачу");
    changed.add("orders");
  } else if (path === "undo-issue") {
    routeCheck(input.route);
    const stack = d.issue_undo[undoKey(input.route, input.location_id)] || [];
    let restored = false;
    while (stack.length && !restored) {
      const action = stack.pop(),
        o = orders.find((o) => o.id === action.order);
      if (!o) continue;
      for (const u of action.units) {
        const i = o.items.find((i) => i.id === u.id);
        if (
          !i ||
          !inLocation(i, input.route, input.location_id) ||
          i.status === "cancelled"
        )
          continue;
        const values = flags(i);
        if (values[u.unit]) {
          values[u.unit] = false;
          apply(i, values);
          restored = true;
        }
      }
      if (restored) event(o, "Останню видачу повернуто");
    }
    if (!restored) fail("Немає виданих позицій для повернення");
    changed.add("orders");
  } else if (path === "status") {
    if (
      !["new", "making", "ready", "delivered", "cancelled"].includes(
        input.status,
      )
    )
      fail("Невідомий статус");
    const o =
      orders.find((o) => o.items.some((i) => i.id === input.id)) ||
      fail("Позицію не знайдено");
    const i = find(o.items, input.id),
      product = p.find((p) => p.id === i.product_id);
    if (
      i.status !== input.status &&
      (i.status === "cancelled" || input.status === "cancelled") &&
      product?.stock != null
    ) {
      changeStock(
        product,
        o.cash_location || "cash",
        input.status === "cancelled" ? i.qty : -i.qty,
        d.locations || [],
      );
      changed.add("products");
    }
    delete i.unit_issued;
    i.status = input.status;
    event(o, `${i.name} → ${i.status}`);
    changed.add("orders");
  } else if (path === "session/end") {
    if (d.active_session) find(d.sessions, d.active_session).ended = now();
    d.active_session = 0;
    changed.add("sessions");
  } else if (path === "session/start") {
    if (d.active_session) fail("Спочатку завершіть сесію");
    result.id = session(d, input.name || "");
    ["sessions", "expenses"].forEach((x) => changed.add(x));
  } else if (path === "expenses" || path === "expenses/update") {
    const id = requestId(path === "expenses" ? input.request : input.id);
    const cost = integer(input.cost, 1),
      note = text(input.note || "", 200);
    const existing = d.calculator_expenses.find((e) => e.id === id);
    if (path === "expenses/update") {
      if (!existing || existing.kind !== "additional")
        fail("Витрати не знайдено");
      Object.assign(existing, { cost, note, updated: now() });
    } else if (existing) {
      if (
        existing.kind !== "additional" ||
        existing.cost !== cost ||
        existing.note !== note
      )
        fail("Номер витрат уже використано");
      return { result: { ok: true, id }, changed };
    } else {
      const sid = input.session_id ?? d.active_session;
      if (input.session_id != null || sid) find(d.sessions, integer(sid));
      d.calculator_expenses.push({
        id,
        kind: "additional",
        cost,
        note,
        created: now(),
        updated: now(),
        session_id: sid,
        pending_session: input.session_id == null && !sid,
      });
    }
    d.expenses_version++;
    result.id = id;
    changed.add("expenses");
  } else if (path === "calculate-menu") {
    if (
      input.confirm !== true ||
      !Array.isArray(input.items) ||
      !input.items.length ||
      input.items.length > 100
    )
      fail("Підтвердьте позиції");
    const names = new Set(),
      touched = new Set();
    result = { ok: true, created: 0, updated: 0, ids: [] };
    for (const row of input.items) {
      const name = text(row.name, 100, true),
        norm = normalize(name);
      if (names.has(norm)) fail("Повторна позиція");
      names.add(norm);
      const price = integer(row.price, 0, 100000000),
        stock = integer(row.stock, 1, 1000000);
      if (price % 500) fail("Ціна має бути кратна 5 грн");
      let product = row.id
        ? find(p, row.id)
        : p.find((p) => p.route === "instant" && normalize(p.name) === norm);
      if (
        product &&
        (product.route !== "instant" || normalize(product.name) !== norm)
      )
        fail("Виберіть позицію знову");
      if (!product) {
        product = {
          id: d.nextProduct++,
          name,
          category: "Їжа",
          route: "instant",
          active: 1,
          sold_out: false,
        };
        p.push(product);
        result.created++;
      } else result.updated++;
      if (touched.has(product.id)) fail("Повторна позиція");
      touched.add(product.id);
      Object.assign(product, { price, stock });
      reconcileCashStock(product, d.locations || []);
      result.ids.push(product.id);
    }
    if (input.calculation_id !== undefined || input.cost !== undefined) {
      const id = requestId(input.calculation_id),
        cost = integer(input.cost, 1);
      let e = d.calculator_expenses.find((e) => e.id === id);
      if (e?.kind === "additional") fail("Номер розрахунку вже використано");
      if (!e) {
        e = {
          id,
          created: now(),
          session_id: d.active_session,
          pending_session: !d.active_session,
        };
        d.calculator_expenses.push(e);
      }
      Object.assign(e, { cost, updated: now() });
      d.expenses_version++;
      changed.add("expenses");
    }
    changed.add("products");
  } else if (path === "stats/clear") {
    if (input.confirm !== true) fail("Підтвердьте очищення");
    d.orders = orders
      .filter(pending)
      .map((o) => ({ ...o, stats_cleared: true, session_id: 0 }));
    d.sessions = [];
    d.calculator_expenses = [];
    d.active_session = 0;
    d.issue_undo = {};
    d.expenses_version++;
    ["orders", "sessions", "expenses"].forEach((x) => changed.add(x));
  } else fail("Невідома дія");
  for (const key of changed) d.versions[key] = (d.versions[key] || 0) + 1;
  return { result, changed };
}

export function selected(o, params) {
  if (o.stats_cleared) return false;
  if (params.has("session"))
    return o.session_id === Number(params.get("session")) && !o.pending_session;
  const offset = Math.max(-840, Math.min(840, Number(params.get("tz")) || 0));
  return (
    new Date(Date.parse(o.created.replace(" ", "T") + "Z") + offset * 60000)
      .toISOString()
      .slice(0, 10) === params.get("day")
  );
}
export function report(d, params) {
  const orders = d.orders.filter((o) => selected(o, params));
  const sid = params.has("session") ? Number(params.get("session")) : null;
  const r = {
    title:
      sid === null
        ? `Сьогодні · ${params.get("day")}`
        : d.sessions.find((s) => s.id === sid)?.name || `Сесія №${sid}`,
    session_id: sid,
    day: params.get("day"),
    revenue: 0,
    expenses: 0,
    calculator_expenses: 0,
    additional_expenses: 0,
    cash: 0,
    card: 0,
    unknown: 0,
    cash_count: 0,
    card_count: 0,
    cancelled: 0,
    order_count: orders.length,
    gift_count: 0,
    check_count: 0,
    min_check: 0,
    max_check: 0,
    avg_check: 0,
    first_order: "",
    last_order: "",
    drinks_amount: 0,
    food_amount: 0,
    drinks: [],
    food: [],
    categories: [],
    expense_groups: [],
    expense_details: [],
    note: "Подарунки не входять у найменший та середній чек. Скасування позиції не реєструє повернення коштів. Решта віднімається від готівки. Витрати — за обраний період.",
  };
  const checks = [],
    category = new Map(),
    drinks = new Map(),
    food = new Map();
  const sum = (map, name, i) => {
    const v = map.get(name) || { name, qty: 0, amount: 0 };
    v.qty += i.qty;
    v.amount += i.price * i.qty;
    map.set(name, v);
  };
  for (const o of orders) {
    const total = o.items.reduce((s, i) => s + i.price * i.qty, 0);
    r.revenue += total;
    r.max_check = Math.max(r.max_check, total);
    if (o.gift) r.gift_count++;
    else checks.push(total);
    if (!r.first_order || o.created < r.first_order) r.first_order = o.created;
    if (o.created > r.last_order) r.last_order = o.created;
    if (o.payment) {
      r.cash += o.payment.cash_amount;
      r.card += o.payment.card_amount;
      if (o.payment.cash_given > 0) r.cash_count++;
      if (o.payment.card_amount > 0) r.card_count++;
    } else r.unknown += total;
    for (const i of o.items) {
      if (i.status === "cancelled") {
        r.cancelled += i.price * i.qty;
        continue;
      }
      sum(category, i.category || (i.route === "bar" ? "Напої" : "Їжа"), i);
      sum(i.route === "bar" ? drinks : food, i.name, i);
      r[i.route === "bar" ? "drinks_amount" : "food_amount"] += i.price * i.qty;
    }
  }
  const groups = new Map();
  for (const e of d.calculator_expenses.filter((e) => selected(e, params))) {
    r.expenses += e.cost;
    r[
      e.kind === "additional" ? "additional_expenses" : "calculator_expenses"
    ] += e.cost;
    if (e.kind !== "additional") continue;
    r.expense_details.push(e);
    const label =
      text(e.note || "", 200).replace(/\s+/g, " ") || "Додаткові витрати";
    const key = label.toLowerCase(),
      group = groups.get(key) || { note: label, cost: 0 };
    group.cost += e.cost;
    groups.set(key, group);
  }
  r.expense_groups = [...groups.values()];
  r.net_revenue = r.revenue - r.expenses;
  r.check_count = checks.length;
  if (checks.length) {
    r.min_check = Math.min(...checks);
    r.avg_check = Math.round(checks.reduce((a, b) => a + b, 0) / checks.length);
  }
  r.duration_seconds = r.first_order
    ? (Date.parse(r.last_order.replace(" ", "T") + "Z") -
        Date.parse(r.first_order.replace(" ", "T") + "Z")) /
      1000
    : 0;
  if (params.get("live") === "1")
    r.live = liveSession(orders, sid === d.active_session);
  r.categories = [...category.values()];
  r.drinks = [...drinks.values()];
  r.food = [...food.values()];
  return r;
}
