// Online-only guest code and full-height editor integration.
let cloudImportedCode = null;
const cloudBaseCategories = drawCategories;
drawCategories = function () {
  cloudBaseCategories();
  const host = document.querySelector("#categories");
  if (host && !host.querySelector("[data-guest-code]")) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.guestCode = "";
    b.className = "guest-code-button";
    b.textContent = "Код";
    b.onclick = cloudEnterGuestCode;
    host.appendChild(b);
  }
};
const cloudBasePost = post;
post = async function (path, input) {
  const imported =
    path === "order" && cloudImportedCode?.draft === input.request
      ? cloudImportedCode
      : null;
  const result = await cloudBasePost(
    path,
    imported ? { ...input, public_code: imported.code } : input,
  );
  if (imported && cloudImportedCode === imported) cloudImportedCode = null;
  return result;
};
function cloudEnterGuestCode() {
  if (busy || view !== "cash") return;
  closeOrderDialog(true);
  const box = document.createElement("div");
  box.id = "orderDialog";
  box.className = "order-dialog";
  box.innerHTML =
    '<form class="order-dialog-card cloud-code-form" role="dialog" aria-modal="true" aria-label="Код замовлення"><h2>Код замовлення</h2><label for="guestCodeInput">Введіть 6 цифр від гостя</label><input id="guestCodeInput" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="off"><p class="muted" role="status"></p><div class="row"><button type="submit" class="primary">Завантажити</button><button type="button" onclick="closeOrderDialog()">Скасувати</button></div></form>';
  document.body.appendChild(box);
  openOrderDialog(box);
  box.querySelector("input").focus();
  box.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const code = box.querySelector("input").value.trim();
    if (!/^\d{6}$/.test(code)) return;
    const currentDraft = draft,
      submit = box.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      const r = await fetch("/api/guest-code", {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error);
      if (view !== "cash" || !box.isConnected || draft !== currentDraft) return;
      if (
        cart.length &&
        !confirm("Замінити поточне замовлення вибраним гостем?")
      )
        return;
      await refresh(true);
      if (view !== "cash" || !box.isConnected || draft !== currentDraft) return;
      cart = j.items.map((item) => {
        const p = data.products.find((p) => p.id === item.id);
        if (
          !p ||
          productUnavailable(p) ||
          (p.stock != null && !p.stock_estimated && item.qty > p.stock)
        )
          throw Error("Наявність змінилася. Перевірте меню.");
        return { ...p, qty: item.qty, note: "" };
      });
      giftOrder = false;
      draft = crypto.randomUUID();
      cloudImportedCode = { code, draft };
      chosenProducts.clear();
      closeOrderDialog();
      drawCart();
      tiles("");
      await showCashPanel(true);
      toast("Замовлення завантажено. Перевірте ім’я та оплату.");
    } catch (error) {
      if (box.isConnected)
        box.querySelector("[role=status]").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  };
}
const cloudBaseMenu = menu;
menu = function (reset = false) {
  cloudBaseMenu(reset);
  const form = document.querySelector("#form"),
    actions = form?.lastElementChild;
  if (actions && !actions.querySelector("[data-close-editor]")) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.closeEditor = "";
    b.textContent = "Закрити редактор";
    b.onclick = () => closeProductEditor();
    actions.appendChild(b);
    actions.classList.add("editor-save-actions");
  }
};
openProductEditor = function (fromHistory = false) {
  const panel = document.querySelector(".product-form-panel");
  if (!panel) return;
  panel.editorMotion?.cancel();
  panel.dataset.closing = "false";
  panel.hidden = false;
  panel.style.height = "";
  panel.style.overflow = "";
  panel.style.opacity = "";
  panel.closest(".menu-editor-grid").classList.add("editing");
  updateEditorToggle(true);
  panel.editorMotion = appear(panel, 180, false);
  if (!fromHistory && !history.state?.cafeEditor)
    history.pushState(
      { ...history.state, cafeEditor: true },
      "",
      location.href,
    );
};
closeProductEditor = function (fromHistory = false) {
  captureEditorDraft();
  if (editorDraft) editorDraft.open = false;
  const panel = document.querySelector(".product-form-panel");
  if (!panel || panel.hidden || panel.dataset.closing === "true") return;
  document.activeElement?.blur();
  panel.editorMotion?.cancel();
  panel.dataset.closing = "true";
  updateEditorToggle(false);
  const a = (panel.editorMotion = motion(
    panel,
    [{ opacity: 1 }, { opacity: 0 }],
    140,
  ));
  const finish = () => {
    if (panel.editorMotion !== a) return;
    panel.hidden = true;
    panel.dataset.closing = "false";
    panel.closest(".menu-editor-grid").classList.remove("editing");
  };
  if (a) a.finished.then(finish, () => {});
  else finish();
  if (!fromHistory && history.state?.cafeEditor) history.back();
};
const cloudBaseServerPage = serverPage;
serverPage = function () {
  cloudBaseServerPage();
  if (window.CafeCloud.role !== "admin") return;
  const actions = document.querySelector(".cloud-server-actions"),
    b = document.createElement("button");
  b.id = "publicMenuToggle";
  b.textContent = "Гостьове меню…";
  b.disabled = true;
  actions.insertBefore(b, actions.querySelector(".cloud-logout"));
  const set = (enabled) => {
    b.dataset.enabled = String(!!enabled);
    b.textContent = enabled
      ? "Гостьове меню: відкрите"
      : "Гостьове меню: закрите";
    b.setAttribute("aria-pressed", String(!!enabled));
    b.disabled = false;
  };
  fetch("/api/public-settings")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((j) => {
      if (b.isConnected) set(j.enabled);
    })
    .catch(() => {
      b.textContent = "Гостьове меню недоступне";
    });
  b.onclick = async () => {
    const enabled = b.dataset.enabled !== "true";
    if (
      !confirm(
        enabled
          ? "Відкрити гостьове меню?"
          : "Закрити гостьове меню та створення нових кодів?",
      )
    )
      return;
    b.disabled = true;
    try {
      const r = await fetch("/api/public-settings", {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error);
      if (b.isConnected) set(j.enabled);
    } catch (e) {
      toast(e.message);
      b.disabled = false;
    }
  };
};
const cloudLayoutRender = render;
render = function () {
  const main = document.querySelector("#main"),
    changed = main.dataset.cloudView !== view;
  cloudLayoutRender();
  if (changed) main.scrollTop = 0;
  main.dataset.cloudView = view;
  syncCloudLayout();
};
if (view === "menu") menu();

if (view === "cash" && document.querySelector("#categories")) drawCategories();

if (view === "server") serverPage();
