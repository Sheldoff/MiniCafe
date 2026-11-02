function locationInfo(id = activeLocation) {
  return (data.locations || []).find((l) => l.id === id);
}
function locationName() {
  return (
    locationInfo()?.name ||
    { cash: "Каса", bar: "Бариста", delivery: "Видача" }[view] ||
    ""
  );
}
function fulfillmentRoute(item) {
  return item.fulfillment_route || item.route;
}
function itemAtLocation(item, route) {
  return (
    fulfillmentRoute(item) === route &&
    (item.location_id || (route === "bar" ? "bar" : "delivery")) ===
      (activeLocation || (route === "bar" ? "bar" : "delivery"))
  );
}
function locationUndoKey(route) {
  return activeLocation ? route + "@" + activeLocation : route;
}
function settingsExtras() {
  if (document.querySelector("#settingsExtras")) return;
  const root = document.createElement("section");
  root.id = "settingsExtras";
  root.className = "panel";
  const admin = !data.access_role || data.access_role === "admin";
  root.innerHTML =
    "<h2>Налаштування</h2>" +
    (admin
      ? '<div class="settings-actions"><button onclick="change(\'locations\')">Створити локацію</button><button onclick="change(\'transactions\')">Історія транзакцій</button><button id="onlinePayToggle" onclick="toggleOnlinePayment()"></button></div>'
      : "") +
    (window.CafeNative
      ? "<button onclick=\"location.href='minicafe://settings'\">Керування сервером телефона</button>"
      : "");
  document.querySelector("#main").prepend(root);
  const button = root.querySelector("#onlinePayToggle");
  if (button)
    button.textContent =
      data.online_payment_enabled === false
        ? "Онлайн-оплата: вимкнена"
        : "Онлайн-оплата: увімкнена";
}
async function toggleOnlinePayment() {
  const b = document.querySelector("#onlinePayToggle");
  b.disabled = true;
  try {
    await post("settings/update", {
      online_payment_enabled: data.online_payment_enabled === false,
    });
    b.textContent =
      data.online_payment_enabled === false
        ? "Онлайн-оплата: вимкнена"
        : "Онлайн-оплата: увімкнена";
  } catch (e) {
    toast(e.message);
  } finally {
    b.disabled = false;
  }
}
function locationsPage(id = "") {
  const saved = (data.locations || []).find((l) => l.id === id),
    editing = saved || {
      id: "",
      kind: "cash",
      name: "",
      color: "#27634f",
      mode: "split",
      bar_target: "bar",
      delivery_target: "delivery",
      single_target: "delivery",
    };
  const targets = [
    { id: "bar", name: "Бариста", kind: "bar" },
    { id: "delivery", name: "Видача", kind: "delivery" },
    ...(data.locations || []).filter((l) => l.kind !== "cash"),
  ];
  const options = (key, kind) =>
    targets
      .filter((l) => !kind || l.kind === kind)
      .map(
        (l) =>
          `<option value="${l.id}" ${l.id === editing[key] ? "selected" : ""}>${esc(l.name)}</option>`,
      )
      .join("");
  document.querySelector("#main").innerHTML =
    `<section class="panel settings-page"><button onclick="change('server')">← Налаштування</button><h2>${saved ? "Налаштування локації" : "Створити локацію"}</h2><form id="locationForm"><label>Функціонал і група в меню<select id="locationKind" ${saved ? "disabled" : ""}><option value="cash">Каса</option><option value="bar">Бариста</option><option value="delivery">Видача</option></select></label><label>Назва в бічному меню<input id="locationName" maxlength="80" required value="${esc(editing.name)}"></label><label>Колір<input id="locationColor" type="color" value="${editing.color}"></label><div id="locationCashRules"><label>Куди відправляти замовлення<select id="locationMode"><option value="split">Окремо напої та їжу</option><option value="single">Усе на одну видачу</option></select></label><div id="locationSplit"><label>Напої<select id="locationBar">${options("bar_target", "bar")}</select></label><label>Їжа<select id="locationDelivery">${options("delivery_target", "delivery")}</select></label></div><label id="locationSingle">Усе замовлення<select id="locationTarget">${options("single_target")}</select></label></div><p id="locationError" role="status"></p><button class="primary" type="submit">Зберегти локацію</button></form><h3>Створені локації</h3><button onclick="locationsPage('cash')">Налаштувати основну касу</button><div>${(
      data.locations || []
    )
      .filter((l) => l.id !== "cash")
      .map(
        (l) =>
          `<button class="location-entry" onclick="locationsPage('${l.id}')"><span style="background:${l.color}" class="location-color"></span>${esc(l.name)}</button>`,
      )
      .join("")}</div></section>`;
  document.querySelector("#locationKind").value = editing.kind;
  document.querySelector("#locationMode").value = editing.mode || "split";
  const update = () => {
    document.querySelector("#locationCashRules").hidden =
      document.querySelector("#locationKind").value !== "cash";
    const single = document.querySelector("#locationMode").value === "single";
    document.querySelector("#locationSplit").hidden = single;
    document.querySelector("#locationSingle").hidden = !single;
  };
  document.querySelector("#locationKind").onchange = update;
  document.querySelector("#locationMode").onchange = update;
  update();
  document.querySelector("#locationForm").onsubmit = async (e) => {
    e.preventDefault();
    const b = e.currentTarget.querySelector("[type=submit]");
    b.disabled = true;
    try {
      await post("location/save", {
        id:
          id ||
          "loc-" +
            [...crypto.getRandomValues(new Uint8Array(16))]
              .map((v) => v.toString(16).padStart(2, "0"))
              .join(""),
        name: document.querySelector("#locationName").value,
        kind: document.querySelector("#locationKind").value,
        color: document.querySelector("#locationColor").value,
        mode: document.querySelector("#locationMode").value,
        bar_target: document.querySelector("#locationBar").value,
        delivery_target: document.querySelector("#locationDelivery").value,
        single_target: document.querySelector("#locationTarget").value,
      });
      toast("Локацію збережено");
      locationsPage();
    } catch (e) {
      document.querySelector("#locationError").textContent = e.message;
      b.disabled = false;
    }
  };
}
let transactionCursor = null;
async function transactionsPage(append = false) {
  if (!append) {
    transactionCursor = null;
    document.querySelector("#main").innerHTML =
      '<section class="panel settings-page"><button onclick="change(\'server\')">← Налаштування</button><h2>Історія транзакцій</h2><p class="muted">Карткові оплати замовлень. Видалення прибирає запис зі списку та не змінює оплату чи звіти.</p><div id="transactionRows"></div><button id="transactionMore" hidden onclick="transactionsPage(true)">Показати ще</button></section>';
  }
  const host = document.querySelector("#transactionRows");
  if (!host) return;
  try {
    const r = await fetch(
        "/api/transactions" +
          (transactionCursor ? "?before=" + transactionCursor : ""),
        { headers: auth },
      ),
      j = await r.json();
    if (!r.ok) throw Error(j.error);
    if (!host.isConnected) return;
    host.insertAdjacentHTML(
      "beforeend",
      j.payments
        .map(
          (p) =>
            `<div class="transaction-row" data-transaction="${p.id}"><span><b>${esc(p.guest || "Гість")}</b><small>${esc(p.created)}</small></span><strong>${money(p.amount)}</strong><button aria-label="Прибрати транзакцію" onclick="hideTransaction(${p.id},this)">×</button></div>`,
        )
        .join("") || (!append ? "<p>Немає карткових оплат</p>" : ""),
    );
    transactionCursor = j.next_before;
    document.querySelector("#transactionMore").hidden = !transactionCursor;
  } catch (e) {
    toast(e.message);
  }
}
async function hideTransaction(id, button) {
  button.disabled = true;
  try {
    await post("transaction/hide", { id });
    button.closest("[data-transaction]")?.remove();
  } catch (e) {
    toast(e.message);
    button.disabled = false;
  }
}

const cashLocationDrafts = new Map();
let renderedCashLocation = "";
function captureLocationDraft() {
  if (view !== "cash" || !document.querySelector("#guest")) return;
  cashLocationDrafts.set(activeLocation, {
    cart: JSON.parse(JSON.stringify(cart)),
    gift: giftOrder,
    draft,
    mixedAuto,
    payMode,
    guest: document.querySelector("#guest").value,
    cash: document.querySelector("#received").value,
    card: document.querySelector("#cardPaid").value,
  });
}
const locationBaseCash = cash;
cash = function () {
  const changing = renderedCashLocation !== activeLocation;
  if (!changing && document.querySelector("#guest")) captureLocationDraft();
  let saved = cashLocationDrafts.get(activeLocation);
  if (changing) {
    cart = saved?.cart || [];
    giftOrder = saved?.gift || false;
    draft =
      saved?.draft ||
      crypto.randomUUID?.() ||
      Date.now() + "-" + Math.random().toString(36).slice(2);
  }
  renderedCashLocation = activeLocation;
  locationBaseCash();
  if (saved) {
    document.querySelector("#guest").value = saved.guest;
    document.querySelector("#received").value = saved.cash;
    document.querySelector("#cardPaid").value = saved.card;
    mixedAuto = saved.mixedAuto !== false;
    payMode = saved.payMode || "mixed";
    highlightPay();
    changeDue();
  }
};
