function setLocationColor(color) {
  if (!/^#[a-f0-9]{6}$/i.test(color)) return;
  const native = document.querySelector("#locationColor");
  if (!native) return;
  native.value = color;
  const hex = document.querySelector("#locationColorHex");
  hex.value = color.toUpperCase();
  hex.setCustomValidity("");
  for (const [n, channel] of ["R", "G", "B"].entries()) {
    const input = document.querySelector("#color" + channel);
    input.value = parseInt(color.slice(1 + n * 2, 3 + n * 2), 16);
    input.setCustomValidity("");
  }
  const preview = document.querySelector("#locationColorPreview");
  preview.style.background = color;
  preview.style.color = locationTextColor(color);
}
function bindLocationColor() {
  document.querySelector("#locationColor").oninput = (e) =>
    setLocationColor(e.target.value);
  const hex = document.querySelector("#locationColorHex");
  hex.oninput = () => {
    const color = "#" + hex.value.replace(/^#/, "");
    hex.setCustomValidity(
      /^#[a-f0-9]{6}$/i.test(color)
        ? ""
        : "Введіть 6 цифр HEX, наприклад #78563F",
    );
    if (hex.checkValidity()) setLocationColor(color);
  };
  for (const channel of ["R", "G", "B"])
    document.querySelector("#color" + channel).oninput = () => {
      const fields = ["R", "G", "B"].map((c) =>
        document.querySelector("#color" + c),
      );
      if (fields.some((field) => !field.value || !field.checkValidity()))
        return;
      setLocationColor(
        "#" +
          fields
            .map((field) => Number(field.value).toString(16).padStart(2, "0"))
            .join(""),
      );
    };
}
async function clearTransactions(button) {
  if (
    !confirm(
      "Очистити історію транзакцій? Замовлення, оплати та фінансові підсумки збережуться.",
    )
  )
    return;
  button.disabled = true;
  try {
    if (window.CafeCloud) await post("payments/history/clear", {});
    await post("transaction/clear", {});
    await transactionsPage();
    toast("Історію очищено");
  } catch (error) {
    toast(error.message);
    if (button.isConnected) button.disabled = false;
  }
}
function orderTimeline(live) {
  const interval = 300000;
  const end = Math.floor(Date.parse(live.generated_at) / interval) * interval;
  const start = end - 11 * interval;
  const events = (live.events || []).filter(
    (event) => Date.parse(event.created.replace(" ", "T") + "Z") >= start,
  );
  const cashes = allLocations().filter((l) => l.kind === "cash");
  for (const event of events)
    if (!cashes.some((c) => c.id === event.cash_location))
      cashes.push({ id: event.cash_location, name: "Архівна каса" });
  const time = (at) =>
    new Date(at).toLocaleTimeString("uk-UA", {
      hour: "2-digit",
      minute: "2-digit",
    });
  const buckets = Array.from({ length: 12 }, (_, n) => start + n * interval);
  return `<section class="order-timeline"><h3>Що замовляють · остання година</h3><div class="order-timeline-scroll" tabindex="0" aria-label="Таймлайн замовлень по касах"><div class="order-timeline-grid"><span class="timeline-cash-label">Каса / час</span>${buckets.map((at) => `<time>${time(at)}</time>`).join("")}${cashes
    .map(
      (cash) =>
        `<b class="timeline-cash-label">${esc(cash.name)}</b>${buckets
          .map((at) => {
            const orders = events.filter(
              (e) =>
                e.cash_location === cash.id &&
                Math.floor(
                  Date.parse(e.created.replace(" ", "T") + "Z") / interval,
                ) *
                  interval ===
                  at,
            );
            if (!orders.length)
              return '<div class="timeline-slot is-empty"><span aria-label="Немає замовлень">—</span></div>';
            const products = new Map();
            for (const o of orders)
              for (const i of o.items)
                if (i.status !== "cancelled")
                  products.set(i.name, (products.get(i.name) || 0) + i.qty);
            const lines = [...products].map(
              ([name, qty]) => `${qty} × ${name}`,
            );
            return `<details class="timeline-slot" data-timeline-slot="${esc(cash.id)}-${at}"><summary><b>${orders.length} зам.</b><span>${esc(lines.slice(0, 2).join(", ") || "Скасовано")}</span></summary><div>${lines.map((line) => `<p>${esc(line)}</p>`).join("")}<small>Чеки: ${orders.map((o) => "№" + o.id).join(", ")}</small></div></details>`;
          })
          .join("")}`,
    )
    .join(
      "",
    )}</div></div><p class="muted tiny">Крок — 5 хвилин. Натисніть блок для всіх позицій. Показано до 500 останніх замовлень сесії.</p></section>`;
}

// Swipe only after a deliberate horizontal gesture. Scrollable timelines,
// tables, editable fields, controls and the device edge keep their own gestures.
let statisticsGesture = null,
  statisticsClickUntil = 0;
function statisticsGestureBlocked(target) {
  return (
    view !== "history" ||
    busy ||
    document.body.classList.contains("drawer-open") ||
    !!document.querySelector("#orderDialog") ||
    !target.closest("#main") ||
    !!target.closest(
      "input,textarea,select,button,a,[contenteditable=true],.order-timeline-scroll,.report-table,.report-table-wrap",
    )
  );
}
document.addEventListener(
  "touchstart",
  (event) => {
    statisticsGesture = null;
    if (event.touches.length !== 1 || statisticsGestureBlocked(event.target))
      return;
    const touch = event.touches[0];
    if (touch.clientX < 24 || touch.clientX > innerWidth - 24) return;
    statisticsGesture = {
      x: touch.clientX,
      y: touch.clientY,
      id: touch.identifier,
      tab: statsTab,
      started: performance.now(),
      axis: null,
    };
  },
  { capture: true, passive: true },
);
document.addEventListener(
  "touchmove",
  (event) => {
    const g = statisticsGesture;
    if (!g) return;
    if (
      event.touches.length !== 1 ||
      statisticsGestureBlocked(event.target) ||
      statsTab !== g.tab
    ) {
      statisticsGesture = null;
      return;
    }
    const touch = [...event.touches].find((t) => t.identifier === g.id);
    if (!touch) return;
    const dx = touch.clientX - g.x,
      dy = touch.clientY - g.y;
    if (!g.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 12)
      g.axis =
        Math.abs(dx) > Math.abs(dy) * 1.5
          ? "horizontal"
          : Math.abs(dy) > Math.abs(dx) * 1.2
            ? "vertical"
            : null;
    if (g.axis === "horizontal") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  { capture: true, passive: false },
);
document.addEventListener(
  "touchend",
  (event) => {
    const g = statisticsGesture;
    statisticsGesture = null;
    if (!g || g.axis !== "horizontal") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    statisticsClickUntil = Date.now() + 350;
    const touch = [...event.changedTouches].find((t) => t.identifier === g.id);
    if (!touch || statisticsGestureBlocked(event.target) || statsTab !== g.tab)
      return;
    const dx = touch.clientX - g.x,
      dy = touch.clientY - g.y;
    if (
      Math.abs(dx) < Math.max(60, Math.min(100, innerWidth * 0.15)) ||
      Math.abs(dx) < Math.abs(dy) * 1.5 ||
      performance.now() - g.started > 1200
    )
      return;
    const tabs = ["orders", "report", "online"],
      n = tabs.indexOf(g.tab) + (dx < 0 ? 1 : -1);
    if (n >= 0 && n < tabs.length) statsTabChange(tabs[n]);
  },
  { capture: true, passive: false },
);
document.addEventListener(
  "touchcancel",
  () => {
    statisticsGesture = null;
  },
  { capture: true, passive: true },
);
document.addEventListener(
  "click",
  (event) => {
    if (
      view === "history" &&
      Date.now() < statisticsClickUntil &&
      event.target.closest("#main")
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);
window.addEventListener("resize", () => {
  statisticsGesture = null;
});

function editSessionName() {
  const id = Number(statsSelection),
    session = data.sessions.find((s) => s.id === id);
  if (!session) return;
  closeOrderDialog(true);
  const box = document.createElement("div");
  box.id = "orderDialog";
  box.className = "order-dialog";
  box.innerHTML = `<form class="order-dialog-card" role="dialog" aria-modal="true" aria-label="Назва сесії"><h2>Назва сесії</h2><input id="editSessionTitle" aria-label="Назва сесії" maxlength="100" required value="${esc(session.name)}"><div class="row"><button type="button" onclick="closeOrderDialog()">Скасувати</button><button class="primary">Зберегти</button></div></form>`;
  document.body.append(box);
  openOrderDialog(box);
  box.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await post("session/rename", {
        id,
        name: box.querySelector("input").value,
      });
      closeOrderDialog();
      statistics();
    } catch (error) {
      toast(error.message);
    }
  };
}
function minuteTimeline(live) {
  const end = Math.floor(Date.parse(live.generated_at) / 60000) * 60000,
    start = end - 59 * 60000;
  const cashes = allLocations().filter((l) => l.kind === "cash");
  return `<section class="order-timeline"><h3>Замовлення · хвилинна лінійка</h3><div class="order-timeline-scroll"><div class="minute-ruler"><div class="minute-ticks">${Array.from({ length: 60 }, (_, n) => `<time style="left:${(n / 60) * 100}%">${new Date(start + n * 60000).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</time>`).join("")}</div>${cashes
    .map(
      (c) =>
        `<div class="minute-lane"><b>${esc(c.name)}</b>${(live.events || [])
          .filter(
            (e) =>
              e.cash_location === c.id &&
              Date.parse(e.created.replace(" ", "T") + "Z") >= start,
          )
          .map(
            (e) =>
              `<details style="left:${Math.min(99, ((Date.parse(e.created.replace(" ", "T") + "Z") - start) / 3600000) * 100)}%"><summary aria-label="Замовлення ${e.id}">●</summary><div>№${e.id} ${esc(e.created.slice(11))}${e.items.map((i) => `<p>${i.qty} × ${esc(i.name)}</p>`).join("")}</div></details>`,
          )
          .join("")}</div>`,
    )
    .join("")}</div></div></section>`;
}
let analyticsGroup = "cash",
  analyticsMetric = "orders",
  analyticsSource = "all",
  paymentMetric = "amount";
function analyticsChanged(key, value) {
  if (key === "group") analyticsGroup = value;
  if (key === "metric") analyticsMetric = value;
  if (key === "source") analyticsSource = value;
  if (key === "payment") paymentMetric = value;
  if (liveStatsLast) replaceStatistics(liveStatisticsMarkup(liveStatsLast.r));
}
function interactiveAnalytics(r) {
  const events = (r.live.events || []).filter(
      (e) => analyticsSource === "all" || e.cash_location === analyticsSource,
    ),
    groups = new Map(),
    minutes = new Map();
  for (const e of events) {
    const minute = e.created.slice(0, 16),
      m = minutes.get(minute) || {
        time: minute.replace(" ", "T") + ":00Z",
        orders: 0,
        qty: 0,
      };
    m.orders++;
    m.qty += e.items.reduce((n, i) => n + i.qty, 0);
    minutes.set(minute, m);
    const keys = new Map();
    for (const i of e.items) {
      if (i.status === "cancelled") continue;
      const ids =
        analyticsGroup === "cash"
          ? [e.cash_location]
          : analyticsGroup === "delivery"
            ? (i.destinations || []).map((d) => d.id)
            : [i.name];
      for (const id of new Set(ids)) {
        if (analyticsGroup === "drinks" && i.route !== "bar") continue;
        const row = keys.get(id) || { qty: 0, amount: 0 };
        row.qty += i.qty;
        row.amount += (i.price || 0) * i.qty;
        keys.set(id, row);
      }
    }
    for (const [id, line] of keys) {
      const row = groups.get(id) || {
        name: locationInfo(id)?.name || id,
        orders: 0,
        qty: 0,
        amount: 0,
      };
      row.orders++;
      row.qty += line.qty;
      row.amount += line.amount;
      groups.set(id, row);
    }
  }
  const options = (values, selected) =>
    values
      .map(
        ([id, label]) =>
          `<option value="${id}" ${id === selected ? "selected" : ""}>${label}</option>`,
      )
      .join("");
  const rows = [...groups.values()].map((g) => ({
    name: g.name,
    value:
      analyticsMetric === "price"
        ? g.qty
          ? g.amount / g.qty
          : 0
        : g[analyticsMetric],
  }));
  const drinkGroups = new Map();
  for (const e of events)
    for (const i of e.items)
      if (i.route === "bar" && i.status !== "cancelled")
        drinkGroups.set(i.name, (drinkGroups.get(i.name) || 0) + i.qty);
  const totals =
    analyticsSource === "all"
      ? {
          cash: r.cash,
          card: r.card,
          cash_count: r.cash_count,
          card_count: r.card_count,
        }
      : events.reduce(
          (v, e) => {
            v.cash += e.payment?.cash_amount || 0;
            v.card += e.payment?.card_amount || 0;
            v.cash_count += e.payment?.cash_amount > 0 ? 1 : 0;
            v.card_count += e.payment?.card_amount > 0 ? 1 : 0;
            return v;
          },
          { cash: 0, card: 0, cash_count: 0, card_count: 0 },
        );
  const payments =
    paymentMetric === "amount"
      ? [
          { name: "Готівка", value: totals.cash },
          { name: "Картка", value: totals.card },
        ]
      : [
          { name: "Готівка", value: totals.cash_count },
          { name: "Картка", value: totals.card_count },
        ];
  return `<section class="live-card"><h3>Порівняння кас, видач і напоїв</h3><div class="row"><select aria-label="Групування" onchange="analyticsChanged('group',this.value)">${options(
    [
      ["cash", "Каси"],
      ["delivery", "Видачі / бариста"],
      ["drinks", "Напої"],
      ["products", "Усі позиції"],
    ],
    analyticsGroup,
  )}</select><select aria-label="Показник" onchange="analyticsChanged('metric',this.value)">${options(
    [
      ["orders", "Замовлення"],
      ["qty", "Порції"],
      ["amount", "Сума"],
      ["price", "Ціна порції"],
    ],
    analyticsMetric,
  )}</select><select aria-label="Каса для порівняння" onchange="analyticsChanged('source',this.value)"><option value="all">Усі каси</option>${allLocations()
    .filter((l) => l.kind === "cash")
    .map(
      (l) =>
        `<option value="${l.id}" ${analyticsSource === l.id ? "selected" : ""}>${esc(l.name)}</option>`,
    )
    .join(
      "",
    )}</select></div><p class="muted">Без скасованих позицій. Детальні порівняння — за останніми 500 чеками поточної сесії. Спільні видачі враховують спільне замовлення у кожному напрямку.</p>${liveBars("Порівняння", rows, ["amount", "price"].includes(analyticsMetric))}${liveChart("Час і кількість замовлень / порцій", [...minutes.values()], analyticsMetric === "qty" ? "qty" : "orders", false, 60)}${liveBars(
    "Напої · порції",
    [...drinkGroups].map(([name, value]) => ({ name, value })),
    false,
  )}<h3>Спосіб оплати · ${analyticsSource === "all" ? "вся сесія" : "вибрана каса, останні 500 чеків"}</h3><select aria-label="Показник оплати" onchange="analyticsChanged('payment',this.value)">${options(
    [
      ["amount", "Сума"],
      ["count", "Кількість оплат"],
    ],
    paymentMetric,
  )}</select>${liveBars("Співвідношення оплат", payments, paymentMetric === "amount")}</section>`;
}
