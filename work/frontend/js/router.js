function roleView() {
  return data.access_role === "bar"
    ? "bar"
    : data.access_role === "delivery"
      ? "delivery"
      : "cash";
}
function allowedView(v) {
  if (["developer", "server"].includes(v)) return true;
  if (data.access_role === "service")
    return ["cash", "bar", "delivery"].includes(v);
  return !data.access_role || data.access_role === "admin" || v === roleView();
}
function availableViews() {
  return [
    ["cash", "Каса"],
    ["bar", "Бариста"],
    ["delivery", "Видача"],
    ["history", "Статистика"],
    ["menu", "Меню й ціни"],
    ["calculator", "Калькулятор"],
  ].filter(([v]) => allowedView(v));
}
function change(v) {
  if (!allowedView(v)) return;
  if (view === "menu") captureEditorDraft();
  view = v;
  history.pushState({ cafeCart: false, cafeEditor: false }, "", "#" + v);
  render();
  if (
    v === "menu" &&
    document.querySelector(".product-form-panel")?.hidden === false
  )
    history.pushState({ cafeEditor: true }, "", location.href);
}

function showCashPanel(open, fromHistory = false) {
  let activeGrid = document.querySelector(".cash-grid"),
    changed =
      !!activeGrid && activeGrid.classList.contains("show-cart") !== open;
  if (changed) {
    activeGrid.querySelectorAll(".cash-swipe-ghost").forEach((e) => e.remove());
    activeGrid
      .querySelectorAll(".menu-panel,.cart-panel")
      .forEach((e) => e.cashSwipeMotion?.cancel());
  }
  let transitionId = changed
    ? (activeGrid.cashTransition = (activeGrid.cashTransition || 0) + 1)
    : activeGrid?.cashTransition;
  let grid = activeGrid,
    animate = changed && innerWidth <= 999,
    oldPanel = animate
      ? grid.querySelector(open ? ".menu-panel" : ".cart-panel")
      : null,
    ghost = oldPanel ? cleanGhost(oldPanel.cloneNode(true)) : null,
    rect = oldPanel?.getBoundingClientRect(),
    bounds = grid?.getBoundingClientRect();
  if (!window.CafeNative && !fromHistory) {
    if (open && !mobileCart) {
      if (history.state?.cafeCart)
        history.replaceState(
          { ...history.state, cafeCart: false },
          "",
          location.href,
        );
      history.pushState(
        { ...history.state, cafeCart: true },
        "",
        location.href,
      );
    } else if (!open && mobileCart && history.state?.cafeCart) history.back();
  }
  mobileCart = open;
  grid?.classList.toggle("show-cart", open);
  document
    .querySelectorAll(".cash-switch button")
    .forEach((b, i) => b.classList.toggle("selected", !!i === open));
  moveCashIndicator();
  if (!animate) {
    if (changed) grid?.classList.remove("cash-swiping");
    return Promise.resolve();
  }
  document.activeElement?.blur();
  ghost.classList.add("cash-swipe-ghost");
  Object.assign(ghost.style, {
    left: rect.left - bounds.left + "px",
    top: rect.top - bounds.top + "px",
    width: rect.width + "px",
    height: rect.height + "px",
  });
  grid.appendChild(ghost);
  let pane = grid.querySelector(open ? ".cart-panel" : ".menu-panel"),
    direction = open ? 1 : -1;
  grid.classList.add("cash-swiping");
  return Promise.allSettled([
    (pane.cashSwipeMotion = motion(
      pane,
      [
        { transform: `translateX(${direction * 100}%)`, opacity: 0.7 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      220,
    ))?.finished,
    motion(
      ghost,
      [
        { transform: "translateX(0)", opacity: 1 },
        { transform: `translateX(${-direction * 100}%)`, opacity: 0.4 },
      ],
      220,
    )?.finished,
  ]).then(() => {
    ghost.remove();
    if (grid.cashTransition === transitionId)
      grid.classList.remove("cash-swiping");
  });
}

function handleAppBack() {
  if (document.querySelector("#orderDialog")) {
    if (
      additionalExpenseBusy ||
      (calculatorBusy && document.querySelector("#calcConfirmApply")?.disabled)
    )
      return true;
    closeOrderDialog();
    return true;
  }
  if (document.body.classList.contains("drawer-open")) {
    toggleDrawer(false);
    return true;
  }
  if (["developer", "server"].includes(view)) {
    change(roleView());
    return true;
  }
  if (
    view === "menu" &&
    document.querySelector(".product-form-panel")?.hidden === false
  ) {
    closeProductEditor();
    return true;
  }
  if (view === "cash" && mobileCart) {
    showCashPanel(false);
    return true;
  }
  return false;
}

function drawerMarkup() {
  return `<div id="drawerOverlay" hidden onclick="closeDrawerOverlay()"></div><aside id="appDrawer" role="dialog" aria-modal="true" aria-label="Навігація" hidden><div class="drawer-heading"><button id="drawerRefresh" type="button" onclick="refreshInPlace()" aria-label="МініКафе — оновити"><span>МініКафе</span><span class="refresh-spinner" aria-hidden="true"></span></button><button id="themeToggle" type="button" role="switch" aria-checked="false" onclick="toggleCafeTheme()">${themeIcon()}</button><button aria-label="Закрити меню" onclick="toggleDrawer(false)">×</button></div><div class="drawer-links">${availableViews()
    .map(
      ([v, t]) =>
        `<button data-view="${v}" class="${view === v ? "selected" : ""}" onclick="change('${v}');toggleDrawer(false)">${t}</button>`,
    )
    .join(
      "",
    )}</div><div class="drawer-tools"><button data-view="developer" onclick="change('developer');toggleDrawer(false)">Розробник</button><button data-native="settings" data-view="server" onclick="openServerSettings()">Сервер</button></div></aside>`;
}

function updateDrawer() {
  let old = document.querySelector("#drawerRoot");
  if (!old) {
    old = document.createElement("div");
    old.id = "drawerRoot";
    document.body.appendChild(old);
  }
  let signature = availableViews()
    .map(([v]) => v)
    .join("|");
  if (!old.innerHTML || old.dataset.signature !== signature) {
    let wasOpen = document.body.classList.contains("drawer-open");
    old.innerHTML = drawerMarkup();
    if (wasOpen) toggleDrawer(true);
    old.dataset.signature = signature;
  }
  old
    .querySelectorAll("[data-view]")
    .forEach((b) => b.classList.toggle("selected", b.dataset.view === view));
  syncThemeControl();
  syncRefreshIndicator();
  let h = document.querySelector("header");
  if (!document.querySelector("#drawerToggle")) {
    let b = document.createElement("button");
    b.id = "drawerToggle";
    b.setAttribute("aria-label", "Відкрити навігацію");
    b.setAttribute("aria-expanded", "false");
    b.innerHTML = "☰";
    b.onclick = (e) => {
      e.stopPropagation();
      toggleDrawer(true, e.detail === 0);
    };
    h.prepend(b);
  }
  h.onclick = (e) => toggleDrawer(true, e.detail === 0);
  h.style.cursor = "pointer";
  document.querySelector("#nav").hidden = true;
}

let drawerOpenedAt = -Infinity;
function closeDrawerOverlay() {
  // Ignore the second tap/compatibility click landing on the newly shown overlay.
  if (performance.now() - drawerOpenedAt < 350) return;
  toggleDrawer(false);
}

function toggleDrawer(open, keyboard = false) {
  let overlay = document.querySelector("#drawerOverlay"),
    drawer = document.querySelector("#appDrawer");
  if (
    !drawer.hidden &&
    document.body.classList.contains("drawer-open") === open
  )
    return drawer.drawerCompletion || Promise.resolve();
  if (drawer.hidden && !open) return Promise.resolve();
  let token = ++drawerAnimation;
  if (open) drawerOpenedAt = performance.now();
  let wasHidden = drawer.hidden,
    from = wasHidden ? "translateX(-105%)" : getComputedStyle(drawer).transform,
    opacity = wasHidden ? 0 : getComputedStyle(overlay).opacity;
  [drawer, overlay].forEach((e) => e.drawerMotion?.cancel());
  drawer.hidden = false;
  overlay.hidden = false;
  document.body.classList.toggle("drawer-open", open);
  document
    .querySelector("#drawerToggle")
    .setAttribute("aria-expanded", String(open));
  let duration = matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : 300;
  drawer.drawerMotion = drawer.animate(
    [
      { transform: from },
      { transform: open ? "translateX(0)" : "translateX(-105%)" },
    ],
    { duration, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" },
  );
  drawer.drawerCompletion = drawer.drawerMotion.finished.then(
    () => {
      if (token === drawerAnimation && !open) {
        drawer.hidden = true;
        overlay.hidden = true;
      }
    },
    () => {},
  );
  overlay.drawerMotion = overlay.animate(
    [{ opacity: opacity }, { opacity: open ? 1 : 0 }],
    {
      duration,
      fill: "forwards",
    },
  );
  if (open) {
    if (keyboard)
      drawer
        .querySelector('[aria-label="Закрити меню"]')
        .focus({ preventScroll: true });
    else document.activeElement?.blur();
  } else document.querySelector("#drawerToggle").focus({ preventScroll: true });
  return drawer.drawerCompletion;
}

function render() {
  cancelCashGesture();
  let main = document.querySelector("#main");
  main.viewEntrance?.cancel();
  main.dataset.motionView = "";
  updateDrawer();
  if (view === "cash") cash();
  else if (view === "menu") menu();
  else if (view === "calculator") calculator();
  else if (view === "developer") developerPage();
  else if (view === "server") serverPage();
  else orders();
  revealPage();
}

let serverOpening = false;
async function openServerSettings() {
  if (serverOpening) return;
  serverOpening = true;
  try {
    await toggleDrawer(false);
    if (window.CafeNative) location.href = "minicafe://settings";
    else change("server");
  } finally {
    serverOpening = false;
  }
}

function developerPage() {
  document.querySelector("#main").innerHTML =
    `<section class="panel developer-panel"><h2>Розробник</h2><p class="muted">Зворотний зв’язок і підтримка МініКафе</p><a class="developer-action" href="https://t.me/AlikPerepelkin" target="_blank" rel="noopener noreferrer" onclick="nativeExternal(event,this.href)"><b>Написати в Telegram</b><span>@AlikPerepelkin</span></a><a class="developer-action" href="https://send.monobank.ua/jar/7NiVRv4sW5" target="_blank" rel="noopener noreferrer" onclick="nativeExternal(event,this.href)"><b>Допомогти автору</b><span>Відкрити банку monobank</span></a><div class="support-card"><b>Підтримати переказом на картку</b><span class="support-card-number">4441 1110 5658 4349</span><button type="button" onclick="copySupportCard()">Скопіювати номер картки</button></div></section>`;
}
function nativeExternal(event, url) {
  if (!window.CafeNative) return;
  event.preventDefault();
  location.href = "minicafe://external?url=" + encodeURIComponent(url);
}
function serverPage() {
  document.querySelector("#main").innerHTML =
    `<section class="panel developer-panel"><h2>Сервер</h2><p>${esc(location.origin)}</p><p class="muted">Для зміни сервера відкрийте нове посилання або QR-код.</p><button onclick="refreshInPlace()">Перевірити з’єднання</button></section>`;
}

async function copySupportCard() {
  const number = "4441111056584349";
  try {
    if (window.CafeNative) {
      location.href = "minicafe://copy-support-card";
      return;
    }
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(number);
    } else {
      let field = document.createElement("textarea");
      field.value = number;
      field.setAttribute("readonly", "");
      field.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.append(field);
      try {
        field.select();
        if (!document.execCommand("copy")) throw Error("copy");
      } finally {
        field.remove();
      }
    }
    toast("Номер картки скопійовано");
  } catch (e) {
    toast("Не вдалося скопіювати. Виділіть номер картки вручну.");
  }
}
