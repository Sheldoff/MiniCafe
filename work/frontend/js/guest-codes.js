// Shared cashier guest-code flow for the phone server and Cloudflare.
const cloudImportedCodes = new Map();
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
    b.onclick = () => cloudEnterGuestCode();
    host.appendChild(b);
  }
};
const cloudBasePost = post;
post = async function (path, input) {
  const imported =
    path === "order" && cloudImportedCodes.has(input.request)
      ? cloudImportedCodes.get(input.request)
      : null;
  const result = await cloudBasePost(
    path,
    imported ? { ...input, public_code: imported.code } : input,
  );
  if (imported) cloudImportedCodes.delete(input.request);
  return result;
};
function cloudEnterGuestCode() {
  if (busy || view !== "cash") return;
  closeOrderDialog(true);
  const box = document.createElement("div");
  box.id = "orderDialog";
  box.className = "order-dialog";
  box.innerHTML =
    '<form class="order-dialog-card cloud-code-form" role="dialog" aria-modal="true" aria-label="Код замовлення"><h2>Код замовлення</h2><label for="guestCodeInput">Введіть 3 цифри від гостя</label><input id="guestCodeInput" inputmode="numeric" pattern="[0-9]{3}" maxlength="3" required autocomplete="off"><p class="muted" role="status"></p><div class="row"><button type="submit" class="primary">Завантажити</button><button type="button" onclick="closeOrderDialog()">Скасувати</button></div></form>';
  document.body.appendChild(box);
  openOrderDialog(box);
  box.querySelector("input").focus();
  box.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const code = box.querySelector("input").value.trim();
    if (!/^\d{3}$/.test(code)) return;
    const currentLocation = activeLocation;
    const currentDraft = draft,
      submit = box.querySelector("[type=submit]");
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      const r = await fetch("/api/guest-code", {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error);
      if (
        view !== "cash" ||
        activeLocation !== currentLocation ||
        !box.isConnected ||
        draft !== currentDraft
      )
        return;
      if (
        cart.length &&
        !confirm("Замінити поточне замовлення вибраним гостем?")
      )
        return;
      await refresh(true);
      if (
        view !== "cash" ||
        activeLocation !== currentLocation ||
        !box.isConnected ||
        draft !== currentDraft
      )
        return;
      cart = j.items.map((item) => {
        const p = data.products.find((p) => p.id === item.id);
        if (
          !p ||
          productUnavailable(p) ||
          (productCashStock(p) != null &&
            (!p.stock_estimated || p.stock_by_cash) &&
            item.qty > productCashStock(p))
        )
          throw Error("Наявність змінилася. Перевірте меню.");
        return { ...p, qty: item.qty, note: "" };
      });
      giftOrder = false;
      draft = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
      cloudImportedCodes.set(draft, { code, draft });
      chosenProducts.clear();
      closeOrderDialog();
      drawCart();
      document.querySelector("#guest").value = j.guest || "";
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

// Pending drafts remain visible until their atomic payment redemption.
const pendingCodeDialog = cloudEnterGuestCode;
cloudEnterGuestCode = function () {
  pendingCodeDialog();
  const box = document.querySelector("#orderDialog");
  if (!box) return;
  const list = document.createElement("div");
  list.className = "pending-code-list";
  box.querySelector("form").appendChild(list);
  fetch("/api/guest-codes", { headers: auth })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((j) => {
      if (!box.isConnected) return;
      list.innerHTML =
        j.codes
          .map(
            (c) =>
              `<button type="button" data-pending-code="${esc(c.code)}"><b>${esc(c.code)}</b> · ${esc(c.guest)}</button>`,
          )
          .join("") || '<p class="muted">Немає неоплачених кодів</p>';
      list.onclick = (e) => {
        const b = e.target.closest("[data-pending-code]");
        if (b && !box.querySelector("[type=submit]").disabled) {
          box.querySelector("input").value = b.dataset.pendingCode;
          const form = box.querySelector("form");
          if (form.requestSubmit) form.requestSubmit();
          else
            form.dispatchEvent(
              new Event("submit", { bubbles: true, cancelable: true }),
            );
        }
      };
    })
    .catch(() => {
      if (box.isConnected) list.textContent = "Не вдалося завантажити коди";
    });
};
