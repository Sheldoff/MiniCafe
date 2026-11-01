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

const cloudPaymentServerPage = serverPage;
serverPage = function () {
  cloudPaymentServerPage();
  if (window.CafeCloud.role !== "admin") return;
  const actions = document.querySelector(".cloud-server-actions");
  if (!actions) return;
  const section = document.createElement("section");
  section.className = "card";
  actions.after(section);
  const refresh = async () => {
    section.textContent = "Завантажуємо платежі банки…";
    try {
      const r = await fetch("/api/payments"),
        j = await r.json();
      if (!r.ok) throw Error();
      if (!section.isConnected) return;
      section.innerHTML =
        "<h3>Оплати банки «Кафе»</h3><p>Автоматична перевірка приблизно раз на хвилину. Переказ без точного коду або з іншою сумою перевіряйте у monobank вручну.</p><button data-payment-refresh>Оновити</button>" +
        (j.payments.length
          ? j.payments
              .map(
                (p) =>
                  `<div class="queue-item"><b>${esc(p.reference)}</b><p>${esc(p.data.guest)} · ${money(p.total)} · ${p.status === "review" ? "Оплачено — потрібна перевірка" : "Очікує оплати"}</p>${p.status === "review" ? `<button data-payment-retry="${esc(p.reference)}">Повторити передачу на приготування</button>` : ""}</div>`,
              )
              .join("")
          : "<p>Немає платежів, що очікують перевірки.</p>");
    } catch {
      section.textContent = "Не вдалося завантажити платежі.";
    }
  };
  section.onclick = async (e) => {
    if (e.target.closest("[data-payment-refresh]")) {
      refresh();
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
if (view === "server") serverPage();
