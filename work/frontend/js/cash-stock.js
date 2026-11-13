function productCashStock(p) {
  const cash =
    view === "bar" || view === "delivery"
      ? locationInfo()?.linked_cash || "cash"
      : activeLocation || data.access_location || "cash";
  return p.stock_by_cash ? p.stock_by_cash[cash] || 0 : p.stock;
}
function cashStockLocations() {
  return allLocations().filter((l) => l.kind === "cash");
}
function editorCashStockValues() {
  const inputs = [...document.querySelectorAll("[data-cash-stock]")];
  if (!inputs.length || inputs[0].disabled) return null;
  return Object.fromEntries(
    inputs.map((input) => [input.dataset.cashStock, Number(input.value)]),
  );
}
function renderCashStock(saved) {
  const host = document.querySelector("#cashStockAllocation");
  if (!host) return;
  const rows = cashStockLocations(),
    raw = document.querySelector("#pstock").value,
    total = Number(raw),
    enabled = raw.trim() !== "" && Number.isSafeInteger(total) && total >= 0;
  host.hidden = rows.length < 2;
  if (host.hidden) {
    host.innerHTML = "";
    return;
  }
  let remaining = enabled ? total : 0;
  const values = rows.map((l, index) => {
    const n = Math.min(
      remaining,
      Math.max(0, saved ? saved[l.id] || 0 : index === 0 ? total : 0),
    );
    remaining -= n;
    return n;
  });
  if (enabled && saved) values[values.length - 1] += remaining;
  host.innerHTML = `<h3>Розподіл по касах</h3><p class="editor-field-hint">${enabled ? "0 — товар прихований на цій касі. Після введення кількості решта переходить до наступної каси." : "Вкажіть загальну невід’ємну кількість, щоб розподілити її між касами."}</p>${rows.map((l, i) => `<label class="cash-stock-row" for="cashStock-${l.id}"><span>${locationKindIcon("cash")}${esc(l.name)}</span><input id="cashStock-${l.id}" data-cash-stock="${l.id}" type="number" min="0" max="1000000" step="1" inputmode="numeric" value="${enabled ? values[i] : ""}" ${enabled ? "required" : "disabled"} oninput="redistributeCashStock(${i})"></label>`).join("")}`;
}
function redistributeCashStock(changed = -1) {
  if (changed < 0) {
    renderCashStock(editorCashStockValues());
    return;
  }
  const inputs = [...document.querySelectorAll("[data-cash-stock]")],
    total = Number(document.querySelector("#pstock").value);
  let remaining = total;
  inputs.forEach((input, i) => {
    input.setCustomValidity("");
    if (i > changed)
      input.value = i === changed + 1 ? String(Math.max(0, remaining)) : "0";
    const n = Number(input.value);
    if (!Number.isSafeInteger(n) || n < 0 || n > remaining)
      input.setCustomValidity("Кількість перевищує нерозподілений залишок");
    remaining -= n;
  });
  if (remaining !== 0)
    inputs[changed].setCustomValidity(
      "Розподіліть весь загальний залишок між касами",
    );
}
