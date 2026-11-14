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
