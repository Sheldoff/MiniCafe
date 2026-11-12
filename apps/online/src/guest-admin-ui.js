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
if (view === "menu") menu();

if (view === "cash" && document.querySelector("#categories")) drawCategories();

if (view === "server") serverPage();

window.loadBankPaymentHistory = function () {
  if (window.CafeCloud.role !== "admin") return;
  const host = document.querySelector("#bankPaymentHistory");
  if (!host || host.querySelector("#bankPaymentPanel")) return;
  host.textContent = "";
  const section = document.createElement("section");
  section.className = "card bank-payment-panel";
  section.id = "bankPaymentPanel";
  host.append(section);
  let cursor = "",
    loading = false;
  const refresh = async (append = false) => {
    if (loading) return;
    loading = true;
    if (!append) {
      cursor = "";
      section.innerHTML =
        '<h3>Оплати банки «Кафе»</h3><p>Автоматична перевірка приблизно раз на хвилину. Тут збережені оплачені замовлення та запити з їхнім статусом.</p><button data-payment-refresh>Оновити</button><div id="bankPaymentRows"></div><button data-payment-more hidden>Показати ще</button>';
    }
    try {
      const r = await fetch(
          "/api/payments/history" +
            (cursor ? "?before=" + encodeURIComponent(cursor) : ""),
          { headers: auth },
        ),
        j = await r.json();
      if (!r.ok) throw Error(j.error || "Не вдалося завантажити історію");
      if (!section.isConnected) return;
      const statuses = {
        waiting: "Очікує оплати",
        paid: "Оплачено — передаємо замовлення",
        fulfilled: "Оплачено — передано на приготування",
        review: "Оплачено — потрібна перевірка",
        expired: "Час оплати минув",
      };
      section
        .querySelector("#bankPaymentRows")
        .insertAdjacentHTML(
          "beforeend",
          j.payments
            .map(
              (p) =>
                `<div class="bank-payment-row" data-bank-reference="${esc(p.reference)}"><b>${esc(p.guest || "Гість")}</b><p>${esc(p.reference)} · ${money(p.total)}</p><small>${esc(new Date(p.created * 1000).toLocaleString("uk-UA"))}</small><p>${esc(statuses[p.status] || p.status)}${p.order_id ? " · №" + p.order_id : ""}</p>${p.status === "review" ? `<button data-payment-retry="${esc(p.reference)}">Повторити передачу на приготування</button>` : ""}</div>`,
            )
            .join("") || (!append ? "<p>Історія банки порожня.</p>" : ""),
        );
      cursor = j.next_before || "";
      section.querySelector("[data-payment-more]").hidden = !cursor;
    } catch {
      section.textContent = "Не вдалося завантажити платежі.";
    } finally {
      loading = false;
    }
  };
  section.onclick = async (e) => {
    if (e.target.closest("[data-payment-refresh]")) {
      refresh();
      return;
    }
    if (e.target.closest("[data-payment-more]")) {
      await refresh(true);
      return;
    }
    const b = e.target.closest("[data-payment-retry]");
    if (!b) return;
    if (
      !confirm(
        "Підтвердити прийняття оплаченого замовлення? Перевірте наявність товарів.",
      )
    )
      return;
    b.disabled = true;
    try {
      const r = await fetch("/api/payments/retry", {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ reference: b.dataset.paymentRetry }),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error);
      toast(
        j.status === "fulfilled"
          ? "Замовлення передано на приготування"
          : "Перевірте наявність товарів; замовлення ще потребує уваги.",
      );
      await refresh();
    } catch (e) {
      toast(e.message);
      b.disabled = false;
    }
  };
  refresh();
};
if (view === "transactions") window.loadBankPaymentHistory();
