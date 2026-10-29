function cents(raw) {
  raw = String(raw).trim().replace(",", ".");
  if (!raw) return 0;
  if (!/^\d+(?:\.\d{0,2})?$/.test(raw)) return null;
  let [whole, part = ""] = raw.split("."),
    n = Number(whole) * 100 + Number((part + "00").slice(0, 2));
  return Number.isSafeInteger(n) && n <= 100000000000 ? n : null;
}

function highlightPay() {
  document
    .querySelectorAll("[data-pay]")
    .forEach((b) => b.classList.toggle("selected", b.dataset.pay === payMode));
}

function paymentValue() {
  let cash = moneyCents(document.querySelector("#received")),
    card = moneyCents(document.querySelector("#cardPaid")),
    total = orderTotal();
  return {
    cash,
    card,
    total,
    valid: cash !== null && card !== null && cash + card >= total,
  };
}

function changeDueContent() {
  let out = document.querySelector("#change");
  if (!out) return;
  out.classList.remove("payment-error", "change-positive");
  document.querySelector(".payment-box").classList.remove("payment-blocked");
  let p = paymentValue();
  document.querySelector("#paidSum").textContent = money(
    (p.cash ?? 0) + (p.card ?? 0),
  );
  if (!cart.length) {
    out.textContent = "До сплати: —";
    return;
  }
  if (p.cash === null || p.card === null) {
    out.textContent = "Введіть коректну суму оплати";
    out.classList.add("payment-error");
    return;
  }
  let diff = p.cash + p.card - p.total;
  out.textContent =
    diff < 0 ? "Не вистачає: " + money(-diff) : "Решта: " + money(diff);
  if (diff < 0) out.classList.add("payment-error");
  else if (diff > 0) out.classList.add("change-positive");
}

function selectPay(mode) {
  payMode = mode;
  mixedAuto = true;
  document.querySelector("#received").value = "";
  document.querySelector("#cardPaid").value =
    mode === "card" || mode === "mixed" ? (orderTotal() / 100).toFixed(2) : "";
  highlightPay();
  changeDue();
  if (mode !== "card") document.querySelector("#received").focus();
}

function paymentEdited(which) {
  let cashInput = document.querySelector("#received"),
    cardInput = document.querySelector("#cardPaid");
  if (which === "cash" && !cashInput.value.trim()) {
    mixedAuto = true;
    cardInput.value = (orderTotal() / 100).toFixed(2);
  } else if (which === "cash" && mixedAuto) {
    let cash = moneyCents(cashInput);
    cardInput.value = (Math.max(0, orderTotal() - (cash || 0)) / 100).toFixed(
      2,
    );
  }
  if (which === "card") mixedAuto = false;
  payMode = "mixed";
  highlightPay();
  changeDue();
}

function isMoneyField(field) {
  if (!field?.matches?.("input")) return false;
  if (field.hasAttribute("data-money")) return true;
  let label = field.closest("label") || field.previousElementSibling;
  return (
    label?.tagName === "LABEL" &&
    /грн|₴/.test(label.textContent) &&
    !/%|кількість/i.test(label.textContent)
  );
}

function moneyRaw(field) {
  let value = String(field.value).trim().replace(",", ".");
  if (!value) return "";
  if (field.dataset.moneyEditing === "true" && !value.includes("."))
    return field.dataset.moneyEdited === "true"
      ? value + ".00"
      : field.dataset.moneyOriginal || value + ".00";
  return value;
}

function moneyCents(field) {
  return cents(moneyRaw(field));
}

function formatMoneyField(field) {
  if (field.dataset.moneyEditing === "true") return;
  let value = moneyCents(field);
  if (field.value.trim() && value !== null)
    field.value = (value / 100).toFixed(2);
}

function decorateMoneyFields(root = document) {
  let fields = root.matches?.("input")
    ? [root]
    : [...root.querySelectorAll("input")];
  fields.forEach((field) => {
    if (!isMoneyField(field)) return;
    field.setAttribute("data-money", "");
    field.type = "text";
    field.inputMode = "numeric";
    field.setAttribute("enterkeyhint", "done");
    field.setAttribute("pattern", "[0-9]+(?:[.,][0-9]{2})?");
    if (!field.closest(".money-control")) {
      let wrap = document.createElement("span");
      wrap.className = "money-control";
      field.before(wrap);
      wrap.append(field);
    }
    formatMoneyField(field);
  });
}

function changeDue() {
  let ids = ["change", "paidSum"],
    before = ids.map((id) => document.getElementById(id)?.textContent);
  changeDueContent();
  ids
    .filter((id) => id !== "change")
    .forEach((id) =>
      highlightAmount(document.getElementById(id), before[ids.indexOf(id)]),
    );
}

function initializeFields(root = document) {
  let inputs = root.matches?.("input")
    ? [root]
    : [...root.querySelectorAll("input")];
  inputs.forEach((i) => {
    if (i.type !== "file") i.setAttribute("enterkeyhint", "done");
  });
  decorateMoneyFields(root);
}
