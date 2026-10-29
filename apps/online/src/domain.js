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
  if (p.stock != null) integer(p.stock, -1000000, 1000000);
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
          return i && i.status !== "cancelled" && flags(i)[u.unit];
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
    if ("stock" in input) {
      if (input.stock === null) delete product.stock;
      else product.stock = integer(input.stock, 0, 1000000);
    }
    if ("image" in input) product.image = input.image;
    result.id = product.id;
    changed.add("products");
  } else if (path === "delete-product") {
    find(p, input.id);
    d.products = p.filter((p) => p.id !== input.id);
    changed.add("products");
  } else if (path === "availability") {
    if (typeof input.sold_out !== "boolean") fail("Некоректна наявність");
    find(p, input.id).sold_out = input.sold_out;
    changed.add("products");
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
      if (!product.active || product.sold_out) fail("Позиція недоступна");
      const price =
        row.unit_price === undefined
          ? product.price
          : integer(row.unit_price, 0, 100000000);
      if (product.stock != null) product.stock -= qty;
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
    const sid = d.active_session || session(d);
    orders.push({
      id,
      request: idempotency,
      session_id: sid,
      created: now(),
      guest: text(input.guest || "", 100),
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
      if (i.route !== input.route || i.status === "cancelled") {
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
    remember(d, input.route, o.id, units);
    event(o, "Оновлено видачу");
    changed.add("orders");
  } else if (path === "undo-issue") {
    routeCheck(input.route);
    const stack = d.issue_undo[input.route] || [];
    let restored = false;
    while (stack.length && !restored) {
      const action = stack.pop(),
        o = orders.find((o) => o.id === action.order);
      if (!o) continue;
      for (const u of action.units) {
        const i = o.items.find((i) => i.id === u.id);
        if (!i || i.route !== input.route || i.status === "cancelled") continue;
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
      product.stock += input.status === "cancelled" ? i.qty : -i.qty;
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
  r.categories = [...category.values()];
  r.drinks = [...drinks.values()];
  r.food = [...food.values()];
  return r;
}
