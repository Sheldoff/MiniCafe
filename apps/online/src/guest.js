const $ = (s) => document.querySelector(s),
  escapeHtml = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const money = (n) =>
  new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH" }).format(
    n / 100,
  );
let products = [],
  selection = {},
  dialogSelection = {},
  dialogItems = [],
  submitting = false;
let lastCode = null;
const quantity = (source, id) => source[id] || 0;
const selectionPayload = () =>
  JSON.stringify({
    items: products
      .filter((p) => selection[p.id])
      .map((p) => ({ id: p.id, qty: selection[p.id] })),
  });
const totals = (source) =>
  products.reduce(
    (r, p) => ({
      qty: r.qty + quantity(source, p.id),
      sum: r.sum + quantity(source, p.id) * p.price,
    }),
    { qty: 0, sum: 0 },
  );
function row(p, source) {
  return `<div class="menu-row ${p.available ? "" : "is-unavailable"}" data-id="${p.id}"><span class="item-name"><b>${escapeHtml(p.name)}</b><small>${money(p.price)}${p.available ? "" : " · Закінчилось"}</small></span><div class="qty-controls"><button type="button" data-step="-1" aria-label="Зменшити ${escapeHtml(p.name)}" ${quantity(source, p.id) ? "" : "disabled"}>−</button><b class="quantity">${quantity(source, p.id)}</b><button type="button" data-step="1" aria-label="Додати ${escapeHtml(p.name)}" ${p.available && quantity(source, p.id) < p.limit ? "" : "disabled"}>＋</button></div></div>`;
}
function updateRow(host, source, id) {
  const p = products.find((p) => p.id === id),
    e = host.querySelector(`[data-id="${id}"]`);
  if (e) e.outerHTML = row(p, source);
}
function changeQty(source, id, step) {
  const p = products.find((p) => p.id === id);
  source[id] = Math.max(
    0,
    Math.min(p.available ? p.limit : 0, quantity(source, id) + step),
  );
}
function drawSummary() {
  const drinks = products.filter((p) => p.route === "bar" && selection[p.id]);
  $("#chosenDrinks").innerHTML = drinks
    .map(
      (p) =>
        `<button class="chosen-row" data-drinks><span>${escapeHtml(p.name)} × ${selection[p.id]}</span><b>${money(p.price * selection[p.id])}</b></button>`,
    )
    .join("");
  const t = totals(selection);
  $("#guestCount").textContent = t.qty ? `· ${t.qty} шт.` : "";
  $("#guestTotal").textContent = money(t.sum);
  $("#guestSubmit").disabled = !t.qty || submitting;
  $("#guestSubmit").textContent =
    lastCode?.payload === selectionPayload() && lastCode.until > Date.now()
      ? "Показати код"
      : "Оформити замовлення";
}
function drawMenu() {
  $("#foodList").innerHTML = products
    .filter((p) => p.route === "instant")
    .map((p) => row(p, selection))
    .join("");
  $("#drinkChoice").hidden = !products.some((p) => p.route === "bar");
  drawSummary();
}
function showDialog(title, body, actions) {
  $("#guestDialogTitle").textContent = title;
  $("#dialogBody").innerHTML = body;
  $("#dialogActions").innerHTML = actions;
  if (!$("#guestDialog").open) $("#guestDialog").showModal();
}
function editItems(items) {
  dialogItems = items;
  dialogSelection = { ...selection };
  showDialog(
    items.every((p) => p.route === "bar") ? "Вибрати напій" : "Обрати страву",
    items.map((p) => row(p, dialogSelection)).join(""),
    '<div class="checkout-total"><span id="dialogQty"></span><b id="dialogTotal"></b></div><button class="primary" id="confirmChoice">Підтвердити</button>',
  );
  updateDialogTotal();
}
function updateDialogTotal() {
  const t = dialogItems.reduce(
    (r, p) => ({
      qty: r.qty + quantity(dialogSelection, p.id),
      sum: r.sum + quantity(dialogSelection, p.id) * p.price,
    }),
    { qty: 0, sum: 0 },
  );
  $("#dialogQty").textContent = `${t.qty} шт.`;
  $("#dialogTotal").textContent = money(t.sum);
}
$("#drinkChoice").onclick = () =>
  editItems(products.filter((p) => p.route === "bar"));
$("#chosenDrinks").onclick = () =>
  editItems(products.filter((p) => p.route === "bar"));
$("#foodList").onclick = (e) => {
  const r = e.target.closest("[data-id]");
  if (!r) return;
  const id = +r.dataset.id,
    step = e.target.closest("[data-step]");
  if (step) {
    changeQty(selection, id, +step.dataset.step);
    updateRow($("#foodList"), selection, id);
    drawSummary();
  } else editItems(products.filter((p) => p.id === id));
};
$("#dialogBody").onclick = (e) => {
  const r = e.target.closest("[data-id]"),
    b = e.target.closest("[data-step]");
  if (!r || !b) return;
  changeQty(dialogSelection, +r.dataset.id, +b.dataset.step);
  updateRow($("#dialogBody"), dialogSelection, +r.dataset.id);
  updateDialogTotal();
};
$("#dialogActions").onclick = (e) => {
  if (e.target.closest("[data-new-order]")) {
    lastCode = null;
    selection = {};
    drawMenu();
    $("#guestDialog").close();
    return;
  }
  if (e.target.closest("#confirmChoice")) {
    selection = { ...dialogSelection };
    drawMenu();
    $("#guestDialog").close();
  }
  if (e.target.closest("[data-close]")) $("#guestDialog").close();
};
$("#dialogClose").onclick = () => $("#guestDialog").close();
$("#guestSubmit").onclick = async () => {
  if (submitting) return;
  submitting = true;
  drawSummary();
  try {
    const payload = selectionPayload();
    let j;
    if (lastCode?.payload === payload && lastCode.until > Date.now())
      j = lastCode.result;
    else {
      const r = await fetch("/api/public/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      j = await r.json();
      if (!r.ok) throw Error(j.error);
      lastCode = {
        payload,
        result: j,
        until: Date.now() + j.expires_in * 1000,
      };
    }
    showDialog(
      "Код замовлення",
      `<p>Назвіть код на касі. Касир перевірить замовлення та прийме оплату.</p><strong class="code">${escapeHtml(j.code)}</strong><p>Разом: ${money(j.total)} · Код до ${new Date(lastCode.until).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}.</p>`,
      '<button class="primary" data-close>Зрозуміло</button><button data-new-order>Нове замовлення</button>',
    );
  } catch (e) {
    showDialog(
      "Не вдалося оформити",
      `<p>${escapeHtml(e.message)}</p>`,
      "<button data-close>Повернутися</button>",
    );
  } finally {
    submitting = false;
    drawSummary();
  }
};
(async () => {
  try {
    const r = await fetch("/api/public/menu");
    const j = await r.json();
    if (!r.ok) throw Error(j.error);
    products = j.products;
    if (!j.accepting || !products.length) {
      $("#guestStatus").textContent = j.accepting
        ? "Меню формується"
        : "Меню тимчасово недоступне";
      return;
    }
    $("#guestStatus").hidden = true;
    $("#guestMenu").hidden = false;
    $("#checkout").hidden = false;
    drawMenu();
  } catch {
    $("#guestStatus").textContent =
      "Не вдалося завантажити меню. Оновіть сторінку.";
  }
})();
