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
let paymentTimer = null,
  paymentRequest = null,
  pendingPayment = null;
try {
  pendingPayment = JSON.parse(localStorage.getItem("minicafe-pending-payment"));
} catch {}
function savePending(value) {
  pendingPayment = value;
  try {
    if (value)
      localStorage.setItem("minicafe-pending-payment", JSON.stringify(value));
    else localStorage.removeItem("minicafe-pending-payment");
  } catch {}
}
function showPayment(j) {
  clearTimeout(paymentTimer);
  const paymentUrl = new URL("https://send.monobank.ua/jar/5wkP16948Q");
  paymentUrl.searchParams.set("a", (j.total / 100).toFixed(2));
  let paymentCanOpen = false;
  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(j.reference);
      return true;
    } catch {}
    const field = document.createElement("textarea");
    field.value = j.reference;
    field.style.cssText = "position:fixed;opacity:0;left:0;top:0";
    document.body.append(field);
    field.focus();
    field.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {}
    field.remove();
    return copied;
  };
  showDialog(
    "Оплата замовлення",
    `<p class="payment-amount">${money(j.total)}</p><p>Натисніть «Оплатити»: сума вже буде заповнена, а код замовлення скопіюється.</p><p><strong>У банку вставте код у поле коментаря</strong> та підтвердьте переказ. Після оплати поверніться до меню — статус оновиться автоматично.</p><p id="paymentCopyStatus" role="status"></p><details id="paymentHelp"><summary>Код та допомога з оплатою</summary><p><input id="paymentReference" aria-label="Код оплати" readonly value="${escapeHtml(j.reference)}"></p><button id="copyPaymentReference">Копіювати код</button><p>Оплатіть до ${new Date(j.expires * 1000).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}. Переказ без цього коду в коментарі потрібно перевіряти з касиром.</p><a id="paymentManualLink" href="${escapeHtml(paymentUrl.href)}">Відкрити банку із сумою</a></details><p id="paymentStatus" role="status">Очікуємо оплату. Не переказуйте повторно.</p>`,
    `<button id="payInMono" class="primary" disabled>Оплатити ${money(j.total)}</button><button data-close>Пізніше</button>`,
  );
  $("#payInMono").onclick = async () => {
    const button = $("#payInMono");
    button.disabled = true;
    const copied = await copyReference();
    button.disabled = false;
    if (!paymentCanOpen) return;
    if (copied) {
      $("#paymentCopyStatus").textContent =
        "Код скопійовано. Вставте його в коментар у банку.";
      location.assign(paymentUrl.href);
    } else {
      $("#paymentHelp").open = true;
      $("#paymentReference").focus();
      $("#paymentReference").select();
      $("#paymentCopyStatus").textContent =
        "Браузер не дозволив копіювання. Скопіюйте виділений код і відкрийте банку за посиланням нижче.";
    }
  };
  $("#copyPaymentReference").onclick = async () => {
    if (await copyReference())
      $("#paymentCopyStatus").textContent =
        "Код скопійовано. Вставте його в коментар у банку.";
    else {
      $("#paymentReference").focus();
      $("#paymentReference").select();
    }
  };
  const check = async () => {
    if (pendingPayment?.token !== j.token) return;
    const label = $("#paymentStatus");
    try {
      const r = await fetch("/api/public/payment-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: j.token }),
      });
      const result = await r.json();
      if (!r.ok) throw Error();
      paymentCanOpen =
        result.status === "waiting" && j.expires * 1000 > Date.now();
      const payButton = $("#payInMono");
      if (payButton) payButton.disabled = !paymentCanOpen;
      if (!paymentCanOpen) $("#paymentManualLink")?.setAttribute("hidden", "");
      const messages = {
        fulfilled: `Оплату підтверджено. Замовлення №${result.order_id} передано на приготування.`,
        paid: "Оплату підтверджено. Передаємо замовлення на приготування.",
        review:
          "Оплату отримано, але замовлення потребує перевірки касиром. Покажіть касиру код оплати. Не платіть повторно.",
        expired:
          "Час оплати минув. Якщо вже переказали кошти — зверніться до касира з кодом оплати. Не платіть повторно.",
      };
      if (label)
        label.textContent =
          messages[result.status] ||
          "Очікуємо оплату. Перевірка може тривати кілька хвилин. Не переказуйте повторно.";
      if (["fulfilled", "review", "expired"].includes(result.status)) {
        if (label) {
          $("#dialogActions").innerHTML =
            "<button data-close>Закрити</button><button data-new-order>Нове замовлення</button>";
        }
        return;
      }
    } catch {
      if (label)
        label.textContent =
          "Перевірка тимчасово недоступна. Не платіть повторно; зверніться до касира з кодом оплати.";
    }
    paymentTimer = setTimeout(check, 15000);
  };
  check();
}

const quantity = (source, id) => source[id] || 0;
const guestName = () => $("#guestFullName").value.trim().replace(/\s+/g, " ");
const validName = (name) =>
  name.length <= 100 &&
  !/[<>\u0000-\u001f\u007f]/.test(name) &&
  name.split(" ").length >= 2 &&
  name.split(" ").every((part) => /\p{L}/u.test(part));
$("#guestFullName").oninput = () => {
  $("#guestFullName").removeAttribute("aria-invalid");
  $("#guestNameError").hidden = true;
  drawSummary();
};
$("#guestFullName").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    e.currentTarget.blur();
  }
};
const selectionPayload = () =>
  JSON.stringify({
    guest: guestName(),
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
  $("#guestSubmit").disabled = (!t.qty && !pendingPayment) || submitting;
  $("#guestSubmit").textContent = pendingPayment
    ? "Показати оплату"
    : lastCode?.payload === selectionPayload() && lastCode.until > Date.now()
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
    paymentRequest = null;
    savePending(null);
    clearTimeout(paymentTimer);
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
  if (pendingPayment) {
    showPayment(pendingPayment);
    return;
  }
  if (submitting) return;
  if (!validName(guestName())) {
    const field = $("#guestFullName");
    field.setAttribute("aria-invalid", "true");
    $("#guestNameError").textContent = "Вкажіть, будь ласка, ім’я та прізвище.";
    $("#guestNameError").hidden = false;
    field.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion:reduce)").matches
        ? "auto"
        : "smooth",
    });
    field.focus({ preventScroll: true });
    return;
  }
  submitting = true;
  drawSummary();
  try {
    const payload = selectionPayload();
    if (!paymentRequest || paymentRequest.payload !== payload)
      paymentRequest = {
        payload,
        token:
          crypto.randomUUID().replaceAll("-", "") +
          crypto.randomUUID().replaceAll("-", ""),
      };
    let j;
    if (lastCode?.payload === payload && lastCode.until > Date.now())
      j = lastCode.result;
    else {
      const r = await fetch("/api/public/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...JSON.parse(payload),
          payment_request: paymentRequest.token,
        }),
      });
      j = await r.json();
      if (!r.ok) throw Error(j.error);
      if (j.payment) {
        savePending(j);
        showPayment(j);
        return;
      }
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
    if (pendingPayment) {
      showPayment(pendingPayment);
      $("#checkout").hidden = false;
      drawSummary();
    }
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
