function allLocations() {
  const defaultColor =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--default-accent")
      .trim() || "#27634f";
  return [
    { id: "cash", kind: "cash", name: "Каса", color: defaultColor },
    { id: "bar", kind: "bar", name: "Бариста", color: defaultColor },
    { id: "delivery", kind: "delivery", name: "Видача", color: defaultColor },
  ]
    .map((l) => ({
      ...l,
      ...(data.locations || []).find((saved) => saved.id === l.id),
    }))
    .concat(
      (data.locations || []).filter(
        (l) => !["cash", "bar", "delivery"].includes(l.id),
      ),
    );
}
function locationInfo(id = activeLocation || view) {
  return allLocations().find((l) => l.id === id);
}
function locationName() {
  return locationInfo()?.name || "";
}
function itemDestinations(item) {
  const matching = (item.destinations || []).filter(
    (d) => d.route === item.route,
  );
  if (matching.length) return matching;
  return [
    {
      route: item.route,
      id:
        (!item.destinations &&
          (!item.fulfillment_route || item.fulfillment_route === item.route) &&
          item.location_id) ||
        (item.route === "bar" ? "bar" : "delivery"),
    },
  ];
}
function itemAtDestination(item, route, id) {
  return itemDestinations(item).some((d) => d.route === route && d.id === id);
}
function locationKindIcon(kind) {
  return `<span class="location-kind-icon" aria-hidden="true">${settingsIconSvgs[kind === "cash" ? "wallet" : kind === "bar" ? "coffee" : "utensils"]}</span>`;
}
function itemAtLocation(item, route) {
  return itemAtDestination(
    item,
    route,
    activeLocation || (route === "bar" ? "bar" : "delivery"),
  );
}
function locationTextColor(color) {
  const rgb = color
    .slice(1)
    .match(/../g)
    .map((n) => parseInt(n, 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
    ? "#000000"
    : "#ffffff";
}
function applyLocationTheme() {
  const root = document.documentElement,
    configured = (data.locations || []).find(
      (l) => l.id === (activeLocation || view),
    ),
    color = configured?.color;
  const props = [
    "--accent",
    "--on-accent",
    "--page",
    "--surface",
    "--raised",
    "--input-bg",
    "--border",
    "--location-color",
    "--location-text",
    "--text",
    "--muted",
    "--success",
    "--success-bg",
    "--theme-control-bg",
    "--theme-control-text",
    "--theme-control-border",
  ];
  props.forEach((key) => root.style.removeProperty(key));
  delete root.dataset.locationTheme;
  if (!color || !/^#[a-fA-F0-9]{6}$/.test(color)) return;
  root.dataset.locationTheme = "true";
  const dark = root.dataset.theme === "dark",
    coffee = root.dataset.palette === "coffee";
  const mix = (base, amount) =>
    "#" +
    [0, 1, 2]
      .map((i) =>
        Math.round(
          parseInt(base.slice(1 + i * 2, 3 + i * 2), 16) * (1 - amount) +
            parseInt(color.slice(1 + i * 2, 3 + i * 2), 16) * amount,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  const values = {
    "--text": coffee
      ? dark
        ? "#f3e6ca"
        : "#38271d"
      : dark
        ? "#e9efe9"
        : "#26372f",
    "--muted": coffee
      ? dark
        ? "#d1bba0"
        : "#705744"
      : dark
        ? "#b0beb2"
        : "#526355",
    "--location-color": color,
    "--location-text": locationTextColor(color),
    "--accent": dark ? mix("#ffffff", 0.45) : color,
    "--page": mix(dark ? (coffee ? "#211914" : "#111815") : "#ffffff", 0.06),
    "--surface": mix(dark ? (coffee ? "#2d211b" : "#1c2520") : "#ffffff", 0.04),
    "--raised": mix(dark ? (coffee ? "#443125" : "#27342b") : "#ffffff", 0.12),
    "--input-bg": mix(
      dark ? (coffee ? "#261c17" : "#17221d") : "#ffffff",
      0.03,
    ),
    "--border": mix(
      dark ? (coffee ? "#94795e" : "#65766b") : coffee ? "#c9b69c" : "#d2d8d3",
      0.2,
    ),
  };
  values["--on-accent"] = locationTextColor(values["--accent"]);
  values["--success"] = values["--text"];
  values["--success-bg"] = values["--raised"];
  values["--theme-control-bg"] = values["--raised"];
  values["--theme-control-text"] = values["--text"];
  values["--theme-control-border"] = values["--border"];
  Object.entries(values).forEach(([key, value]) =>
    root.style.setProperty(key, value),
  );
}
function orderLocationStyle(order) {
  const id = order.cash_location || "cash",
    source = (data.locations || []).find((l) => l.id === id),
    color =
      source?.color ||
      (id === "cash"
        ? getComputedStyle(document.documentElement)
            .getPropertyValue("--default-accent")
            .trim() || "#27634f"
        : order.cash_location_color || "#27634f");
  return /^#[a-fA-F0-9]{6}$/.test(color)
    ? `--source-color:${color};--source-text:${locationTextColor(color)}`
    : "";
}
function orderLocationLabel(order) {
  return esc(
    locationInfo(order.cash_location || "cash")?.name ||
      order.cash_location_name ||
      "Каса",
  );
}
function locationUndoKey(route) {
  return activeLocation ? route + "@" + activeLocation : route;
}
function settingsExtras() {
  if (document.querySelector("#settingsExtras")) return;
  const panel = document.querySelector("#main > .panel");
  if (!panel) return;
  panel.classList.add("settings-panel");
  const isCloud = panel.classList.contains("cloud-server-panel");
  if (isCloud) {
    const title = document.createElement("h2");
    title.textContent = "Налаштування";
    panel.prepend(title);
  } else panel.querySelector("h2").textContent = "Налаштування";
  let actions = panel.querySelector(".cloud-server-actions");
  if (!actions) {
    actions = document.createElement("div");
    for (const b of [...panel.children].filter((e) => e.tagName === "BUTTON"))
      actions.append(b);
    panel.append(actions);
  }
  actions.id = "settingsExtras";
  actions.classList.add("settings-actions");
  if (!data.access_role || data.access_role === "admin")
    actions.insertAdjacentHTML(
      "afterbegin",
      '<button onclick="change(\'locations\')">Локації</button><button onclick="change(\'transactions\')">Історія транзакцій</button><button id="onlinePayToggle" onclick="toggleOnlinePayment()"></button>',
    );
  if (window.CafeNative)
    actions.insertAdjacentHTML(
      "beforeend",
      "<button onclick=\"location.href='minicafe://settings'\">Керування сервером телефона</button>",
    );
  actions.insertAdjacentHTML(
    "beforeend",
    "<button onclick=\"change('appearance')\">Оформлення</button>",
  );
  const button = actions.querySelector("#onlinePayToggle");
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
function locationsPage(id = "", fromHistory = false) {
  if (id && !fromHistory)
    history.pushState(
      { ...history.state, cafeLocationEditor: id },
      "",
      location.href,
    );
  const host = document.querySelector("#main"),
    rows = allLocations();
  if (!id) {
    host.innerHTML = `<section class="panel settings-page"><div class="locations-heading"><h2>Локації</h2><button class="primary" onclick="locationsPage('new')">Створити локацію</button></div><div class="location-list">${rows.map((l) => `<div class="location-list-row"><button class="location-open" aria-label="Редагувати ${esc(l.name)}" onclick="locationsPage('${l.id}')">${locationKindIcon(l.kind)}<b class="grow">${esc(l.name)}</b><span class="location-color" style="background:${l.color}"></span>${["cash", "bar", "delivery"].includes(l.id) ? "<small>Основна</small>" : ""}</button>${["cash", "bar", "delivery"].includes(l.id) ? "" : `<button class="danger" aria-label="Видалити ${esc(l.name)}" onclick="deleteLocation('${l.id}',this)">×</button>`}</div>`).join("")}</div><p id="locationError" role="status"></p></section>`;
    return;
  }
  const saved = rows.find((l) => l.id === id),
    editing = saved || { id: "", kind: "cash", name: "", color: "#27634f" },
    selected =
      editing.targets ||
      (editing.mode === "single"
        ? [editing.single_target || "delivery"]
        : [editing.bar_target || "bar", editing.delivery_target || "delivery"]),
    basic = ["cash", "bar", "delivery"].includes(id),
    colors = [...new Set(rows.map((l) => l.color))];
  host.innerHTML = `<section class="panel settings-page"><h2>${saved ? "Редагувати локацію" : "Створити локацію"}</h2><form id="locationForm"><label>Функціонал і група в меню<select id="locationKind" ${basic ? "disabled" : ""}><option value="cash">Каса</option><option value="bar">Бариста</option><option value="delivery">Видача</option></select></label><label>Назва в бічному меню<input id="locationName" maxlength="80" required value="${esc(editing.name)}"></label><div id="locationCashRules"><fieldset><legend>Куди відправляти замовлення</legend><p class="muted">Оберіть потрібних бариста та видачі. Напої йдуть тільки бариста, їжа — тільки на видачу. Якщо обрано кілька черг одного типу, відмітки виконання спільні. Якщо відповідної черги не обрано, використовується основна.</p><div id="locationTargets">${rows
    .filter((l) => l.kind !== "cash" && l.id !== id)
    .map(
      (l) =>
        `<label class="location-target"><input type="checkbox" value="${l.id}" ${selected.includes(l.id) ? "checked" : ""}><span class="location-color" style="background:${l.color}"></span><span>${esc(l.name)}</span></label>`,
    )
    .join(
      "",
    )}</div></fieldset></div><label id="linkedCashField">Прив’язана каса<select id="linkedCash"><option value="">Усі каси — загальна наявність</option>${rows
    .filter((l) => l.kind === "cash")
    .map(
      (l) =>
        `<option value="${l.id}" ${editing.linked_cash === l.id ? "selected" : ""}>${esc(l.name)}</option>`,
    )
    .join(
      "",
    )}</select></label><label>Колір інтерфейсу<input id="locationColor" type="color" value="${editing.color}"></label><div class="location-presets" aria-label="Кольори наявних локацій">${colors.map((color) => `<button type="button" aria-label="Обрати колір ${color}" style="background:${color};color:${locationTextColor(color)}" onclick="document.querySelector('#locationColor').value='${color}'">✓</button>`).join("")}</div><p id="locationError" role="status"></p><button class="primary" type="submit">Зберегти локацію</button></form></section>`;
  document.querySelector("#locationKind").value = editing.kind;
  const update = () => {
    document.querySelector("#linkedCashField").hidden =
      document.querySelector("#locationKind").value === "cash";
    document.querySelector("#locationCashRules").hidden =
      document.querySelector("#locationKind").value !== "cash";
  };
  document.querySelector("#locationKind").onchange = update;
  update();
  document.querySelector("#locationForm").onsubmit = async (e) => {
    e.preventDefault();
    const b = e.currentTarget.querySelector("[type=submit]");
    b.disabled = true;
    try {
      await post("location/save", {
        id:
          saved?.id ||
          "loc-" +
            [...crypto.getRandomValues(new Uint8Array(16))]
              .map((v) => v.toString(16).padStart(2, "0"))
              .join(""),
        name: document.querySelector("#locationName").value,
        kind: document.querySelector("#locationKind").value,
        color: document.querySelector("#locationColor").value,
        linked_cash: document.querySelector("#linkedCash").value,
        ...(document.querySelector("#locationKind").value === "cash"
          ? {
              targets: [
                ...document.querySelectorAll("#locationTargets input:checked"),
              ].map((input) => input.value),
            }
          : {}),
      });
      toast("Локацію збережено");
      history.back();
    } catch (e) {
      document.querySelector("#locationError").textContent = e.message;
      b.disabled = false;
    }
  };
}
async function deleteLocation(id, button) {
  if (!confirm("Видалити цю локацію? Історія замовлень і фінанси залишаться."))
    return;
  button.disabled = true;
  try {
    await post("location/delete", { id });
    cashLocationDrafts.delete(id);
    locationsPage();
    toast("Локацію видалено");
  } catch (e) {
    document.querySelector("#locationError").textContent = e.message;
    button.disabled = false;
  }
}
let transactionCursor = null;
async function transactionsPage(append = false) {
  if (!append) {
    transactionCursor = null;
    document.querySelector("#main").innerHTML =
      '<section class="panel settings-page"><h2>Історія транзакцій</h2><div id="bankPaymentHistory"><p class="muted">Історія оплат банки доступна при підключенні до онлайн-сервера.</p></div><h3>Карткові оплати замовлень</h3><p class="muted">Карткові оплати замовлень. Видалення прибирає запис зі списку та не змінює оплату чи звіти.</p><div id="transactionRows"></div><button id="transactionMore" hidden onclick="transactionsPage(true)">Показати ще</button></section>';
  }
  if (!append && typeof window.loadBankPaymentHistory === "function")
    window.loadBankPaymentHistory();
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

function availabilityContextCash() {
  return view === "cash"
    ? activeLocation || "cash"
    : locationInfo()?.linked_cash || "";
}
function locallyUnavailable(product) {
  return (product.unavailable_at || []).includes(availabilityContextCash());
}

function drawerLocationColor(id) {
  const saved = (data.locations || []).find((l) => l.id === id);
  return /^#[a-fA-F0-9]{6}$/.test(saved?.color || "")
    ? `data-nav-color="${saved.color}" style="--nav-color:${saved.color}"`
    : "";
}
