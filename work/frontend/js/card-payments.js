let cardPaymentHost = null,
  cardPaymentRows = [],
  cardPaymentCursor = null,
  cardPaymentPages = 1,
  cardPaymentSerial = 0;
const hidingCardPayments = new Set();
function drawCardPayments(error = "") {
  if (!cardPaymentHost?.isConnected) return;
  cardPaymentHost.innerHTML =
    (cardPaymentRows.length
      ? cardPaymentRows
          .map(
            (p) =>
              `<div class="card-payment-row" data-card-payment="${p.id}"><span><b>${esc(p.guest || "Гість")}</b><strong>${money(p.amount)}</strong></span><button class="card-payment-remove" type="button" aria-label="Видалити зі списку оплату ${money(p.amount)}" onclick="hideCardPayment(${p.id})" ${hidingCardPayments.has(p.id) ? "disabled" : ""}>×</button></div>`,
          )
          .join("")
      : error
        ? ""
        : '<p class="muted">Поки немає оплат карткою</p>') +
    (error
      ? `<p role="status">${esc(error)} <button onclick="loadCardPayments()">Повторити</button></p>`
      : "");
  const more = document.querySelector("#cardPaymentMore");
  if (more) more.hidden = !cardPaymentCursor;
}
async function loadCardPayments(reset = true) {
  const host = document.querySelector("#cardPaymentHistory");
  if (!host || view !== "cash") return;
  if (host !== cardPaymentHost) {
    cardPaymentHost = host;
    cardPaymentRows = [];
    cardPaymentCursor = null;
    cardPaymentPages = 1;
    host.textContent = "Завантажуємо оплати…";
  }
  if (!reset && !cardPaymentCursor) return;
  const serial = ++cardPaymentSerial;
  let rows = reset ? [] : [...cardPaymentRows],
    cursor = reset ? null : cardPaymentCursor,
    pages = reset ? cardPaymentPages : 1;
  const more = document.querySelector("#cardPaymentMore");
  if (more) more.disabled = true;
  try {
    for (let page = 0; page < pages; page++) {
      const r = await fetch(
        "/api/card-payments" + (cursor ? "?before=" + cursor : ""),
        { headers: auth, cache: "no-store" },
      );
      const result = await r.json();
      if (!r.ok) throw Error(result.error || "Не вдалося завантажити оплати");
      rows.push(...result.payments);
      cursor = result.next_before;
      if (!cursor) break;
    }
    if (
      serial !== cardPaymentSerial ||
      host !== cardPaymentHost ||
      !host.isConnected
    )
      return;
    cardPaymentRows = rows;
    cardPaymentCursor = cursor;
    if (!reset) cardPaymentPages++;
    drawCardPayments();
  } catch (e) {
    if (serial === cardPaymentSerial && host === cardPaymentHost)
      drawCardPayments("Не вдалося завантажити оплати. " + e.message);
  } finally {
    if (serial === cardPaymentSerial && more?.isConnected)
      more.disabled = false;
  }
}
async function hideCardPayment(id) {
  if (hidingCardPayments.has(id)) return;
  hidingCardPayments.add(id);
  drawCardPayments();
  try {
    await post("card-payment/hide", { id });
    await loadCardPayments();
    toast("Оплату прибрано зі списку");
  } catch (e) {
    toast(e.message);
  } finally {
    hidingCardPayments.delete(id);
    drawCardPayments();
  }
}
