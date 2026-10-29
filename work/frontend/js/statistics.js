async function setItemStatus(id, status) {
  try {
    await post("status", { id, status });
  } catch (e) {
    toast(e.message);
  }
}

function localDay() {
  let d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function statQuery() {
  return statsSelection.startsWith("day:")
    ? "day=" +
        encodeURIComponent(statsSelection.slice(4)) +
        "&tz=" +
        -new Date().getTimezoneOffset()
    : "session=" + encodeURIComponent(statsSelection);
}

function statsFilter(value) {
  historyPage = 0;
  statsSelection = value;
  statistics();
}

function statsTabChange(tab) {
  statsTab = tab;
  statistics();
}

async function statistics() {
  if (!hasServerState) return;
  let sessions = data.sessions || [],
    current = data.active_session || 0;
  if (!statsSelection)
    statsSelection = current
      ? String(current)
      : sessions.length
        ? String(sessions[sessions.length - 1].id)
        : "day:" + localDay();
  let today = "day:" + localDay(),
    serial = ++statsRequest;
  ++historyRequest;
  if (!document.querySelector("#statisticsContent"))
    document.querySelector("#main").innerHTML =
      `<div class="stats-top"><div><h2>Статистика</h2><p class="muted">${current ? "Відкрита сесія №" + current : "Немає відкритої сесії"}</p></div>${current ? `<button class="remove" onclick="endSession()">Завершити сесію</button>` : ""}</div><div class="stats-select"><select aria-label="Період статистики" onchange="statsFilter(this.value)"><option value="${today}" ${statsSelection === today ? "selected" : ""}>Сьогодні · ${localDay()}</option>${[
        ...sessions,
      ]
        .reverse()
        .map(
          (s) =>
            `<option value="${s.id}" ${String(s.id) === statsSelection ? "selected" : ""}>${esc(s.name)} · ${s.legacy ? "історія" : s.ended ? "завершена" : "відкрита"}</option>`,
        )
        .join(
          "",
        )}</select><div class="stats-tabs"><button class="${statsTab === "orders" ? "selected" : ""}" onclick="statsTabChange('orders')">Замовлення</button><button class="${statsTab === "report" ? "selected" : ""}" onclick="statsTabChange('report')">Звіт</button></div></div><div id="statisticsContent"><div class="stats-initial" aria-label="Завантаження статистики"></div></div>`;
  let header = document.querySelector(".stats-top");
  if (header.dataset.current !== String(current)) {
    header.innerHTML = `<div><h2>Статистика</h2><p class="muted">${current ? "Відкрита сесія №" + current : "Немає відкритої сесії"}</p></div>${current ? '<button class="remove" onclick="endSession()">Завершити сесію</button>' : ""}`;
    header.dataset.current = String(current);
  }
  let select = document.querySelector(".stats-select select"),
    signature = JSON.stringify(sessions) + today;
  if (select.dataset.signature !== signature) {
    select.innerHTML = `<option value="${today}">Сьогодні · ${localDay()}</option>${[
      ...sessions,
    ]
      .reverse()
      .map(
        (s) =>
          `<option value="${s.id}">${esc(s.name)} · ${s.legacy ? "історія" : s.ended ? "завершена" : "відкрита"}</option>`,
      )
      .join("")}`;
    select.dataset.signature = signature;
  }
  select.value = statsSelection;
  document
    .querySelectorAll(".stats-tabs button")
    .forEach((button, i) =>
      button.classList.toggle(
        "selected",
        i === (statsTab === "report" ? 1 : 0),
      ),
    );
  let content = document.querySelector("#statisticsContent");
  content.classList.add("stats-loading");
  content.setAttribute("aria-busy", "true");
  if (statsTab === "orders") {
    historyCompact();
    return;
  }
  try {
    let r = await fetch("/api/stats?" + statQuery(), {
        headers: auth,
        cache: "no-store",
      }),
      report = await r.json();
    if (!r.ok) throw Error(report.error);
    if (serial !== statsRequest || view !== "history" || statsTab !== "report")
      return;
    statsCurrent = report;
    replaceStatistics(
      reportMarkup(report) +
        `<div class="report-actions"><button class="primary" onclick="exportStatistics()">Завантажити статистику PDF</button><button class="remove" onclick="clearStatistics()">Повністю очистити статистику</button></div>`,
    );
  } catch (e) {
    if (serial === statsRequest && view === "history" && statsTab === "report")
      replaceStatistics('<p class="calc-invalid">' + esc(e.message) + "</p>");
  }
}

async function historyCompact() {
  let request = ++historyRequest,
    selection = statsSelection;
  try {
    let r = await fetch(
        "/api/history?" + statQuery() + "&page=" + historyPage,
        { headers: auth, cache: "no-store" },
      ),
      j = await r.json();
    if (!r.ok) throw Error(j.error);
    if (
      request !== historyRequest ||
      view !== "history" ||
      statsTab !== "orders" ||
      selection !== statsSelection
    )
      return;
    renderHistoryCompact(j.orders, j.total, j.has_next);
  } catch (e) {
    if (
      request === historyRequest &&
      selection === statsSelection &&
      view === "history" &&
      statsTab === "orders"
    )
      replaceStatistics('<p class="calc-invalid">' + esc(e.message) + "</p>");
  }
}

function renderHistoryCompact(orders, total, hasNext) {
  replaceStatistics(
    `<div class="history-compact">${orders.length ? orders.map((o) => `<details class="history-record" data-history-order="${o.id}"><summary><span class="history-id">№${o.id}</span><span class="grow"><b>${esc(o.guest || "Гість")}${o.gift ? " · 🎁" : ""}</b><small>${new Date(o.created.replace(" ", "T") + "Z").toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</small></span><b>${money(o.items.reduce((s, i) => s + i.price * i.qty, 0))}</b></summary><div class="history-body">${o.payment ? `<p class="tiny">Готівка: ${money(o.payment.cash_amount)} · Картка: ${money(o.payment.card_amount)} · Решта: ${money(o.payment.change)}</p>` : '<p class="tiny">Тип оплати до оновлення не записувався</p>'}${o.comment ? `<div class="order-note">${esc(o.comment)}</div>` : ""}${o.items.map((i) => `<div class="history-item"><span class="grow">${i.qty} × ${esc(i.name)}<small>${i.route === "bar" ? "Напій" : "Їжа"} · ${labels[i.status]}${i.note ? " · " + esc(i.note) : ""}</small></span><b>${money(i.price * i.qty)}</b>${!["delivered", "cancelled"].includes(i.status) ? `<button class="remove" onclick="cancelItem(${i.id})">Скасувати</button>` : `<button class="tiny" onclick="setItemStatus(${i.id},'new')">Повернути</button>`}</div>`).join("")}</div></details>`).join("") : '<div class="panel">За цей період замовлень немає</div>'}</div><div class="row page-controls"><button onclick="historyPage--;historyCompact()" ${historyPage === 0 ? "disabled" : ""}>← Назад</button><span>Сторінка ${historyPage + 1} · Усього ${total}</span><button onclick="historyPage++;historyCompact()" ${hasNext ? "" : "disabled"}>Далі →</button></div>`,
  );
}

function reportMarkup(r) {
  let group = (title, metrics, css = "") =>
    `<section class="report-group ${css}"><h3>${title}</h3><div class="metrics">${metrics.map(([name, value, hint]) => (value && typeof value === "object" ? `<div class="metric balance-metric"><span>${esc(name)}</span><div class="balance-values"><div><span>Уся каса</span><b>${money(value.gross)}</b></div><div><span>Після витрат</span><b>${money(value.net)}</b></div></div></div>` : `<div class="metric"><span>${esc(name)}</span><b>${value}</b>${hint ? `<small>${hint}</small>` : ""}</div>`)).join("")}</div></section>`;
  return `<section id="reportDocument" class="report-document"><h2>${esc(r.title)}</h2>${group("Гроші", [["Їжа", money(r.calculator_expenses ?? r.expenses ?? 0)], ...(r.expense_groups || r.expense_details || []).map((e) => [e.note || "Додаткові витрати", money(e.cost)]), ["Усього витрачено", money(r.expenses || 0)], ["Виручка після витрат", { gross: r.revenue, net: r.revenue - (r.expenses || 0) }]], "report-finances" + (r.revenue - (r.expenses || 0) < 0 ? " report-negative" : ""))}<button class="expense-add" onclick="additionalExpenseDialog(${Number.isInteger(r.session_id) ? r.session_id : "null"})">＋ Додаткові витрати</button>${group("Оплата", [["Готівкою", money(r.cash), "Оплат: " + (r.cash_count || 0)], ["Карткою", money(r.card), "Оплат: " + (r.card_count || 0)], ...(r.unknown ? [["Невідомий тип", money(r.unknown)]] : [])])}${group(
    "Замовлення та чеки",
    [
      ["Усього замовлень", r.order_count],
      ["Із них подарункових", r.gift_count || 0],
      [
        "Найменший чек (без подарунків)",
        r.check_count === 0 ? "—" : money(r.min_check),
      ],
      ["Найбільший чек", money(r.max_check)],
      [
        "Середній чек (без подарунків)",
        r.check_count === 0 ? "—" : money(r.avg_check),
      ],
    ],
  )}<section class="report-group"><h3>Час роботи</h3><div class="report-times"><p>Перше замовлення: <b>${timeText(r.first_order)}</b></p><p>Останнє замовлення: <b>${timeText(r.last_order)}</b></p><p>Час між ними: <b>${durationText(r.duration_seconds)}</b></p></div></section>${tableReport("Продажі за категоріями", r.categories || [])}${tableReport("Кожен напій", r.drinks, r.drinks_amount)}${tableReport("Їжа", r.food, r.food_amount)}${r.cancelled ? `<p>Скасовані позиції: ${money(r.cancelled)}</p>` : ""}<details class="report-explanation"><summary>Як рахується статистика</summary><p class="report-note">${esc(r.note)}</p></details></section>`;
}

async function endSession() {
  if (
    !confirm(
      "Завершити поточну сесію? Наступна почнеться автоматично після оформлення нового замовлення.",
    )
  )
    return;
  try {
    await post("session/end", {});
    statistics();
  } catch (e) {
    toast(e.message);
  }
}

async function clearStatistics() {
  if (
    !confirm(
      "Повністю видалити історію та звіти ВСІХ сесій? Меню й невидані замовлення збережуться. Спочатку завантажте потрібні PDF. Відновлення можливе лише з резервної копії.",
    )
  )
    return;
  try {
    await post("stats/clear", { confirm: true });
    statsSelection = "day:" + localDay();
    historyPage = 0;
    statistics();
    toast("Статистику очищено");
  } catch (e) {
    toast(e.message);
  }
}

function exportStatistics() {
  if (!statsCurrent) return;
  const link =
    "/api/report.pdf?" + statQuery() + "&key=" + encodeURIComponent(token);
  if (window.CafeNative) {
    location.href = link;
    return;
  }
  let a = document.createElement("a");
  a.href = link;
  a.download = "MiniCafe-report.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function additionalExpenseDialog(session, id) {
  if (additionalExpenseBusy) return;
  let existing = id
    ? (data.additional_expenses || []).find((e) => e.id === id)
    : null;
  if (id && !existing)
    return toast("Витрати вже недоступні. Оновіть сторінку.");
  closeOrderDialog(true);
  let fromCalculator = view === "calculator",
    sid = existing
      ? existing.session_id
      : Number.isInteger(session)
        ? session
        : data.active_session || null,
    found = (data.sessions || []).find((s) => s.id === sid),
    request =
      "extra-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2);
  let box = document.createElement("div");
  box.id = "orderDialog";
  box.className = "order-dialog";
  box.innerHTML = `<section class="order-dialog-card" role="dialog" aria-modal="true" aria-label="Додаткові витрати"><h2>Додаткові витрати</h2><p class="muted">${esc(found ? found.name : "Наступна сесія — після першого замовлення")}</p><label>Сума, грн<input data-money id="extraCost" type="number" inputmode="decimal" enterkeyhint="done" min="0.01" step="0.01" placeholder="0,00" value="${existing ? (existing.cost / 100).toFixed(2) : ""}"></label><label>Опис (необов’язково)<input id="extraNote" maxlength="200" enterkeyhint="done" placeholder="Наприклад, кава" value="${esc(existing?.note || "")}"></label><p id="extraError" class="calc-invalid" role="status"></p><div class="row"><button onclick="closeOrderDialog()">Скасувати</button><button id="extraSave" class="primary">Зберегти</button></div></section>`;
  document.body.appendChild(box);
  openOrderDialog(box);
  decorateMoneyFields();
  box.querySelector("#extraSave").onclick = async () => {
    if (additionalExpenseBusy) return;
    let cost = moneyCents(box.querySelector("#extraCost"));
    if (!cost || cost < 0 || cost > 100000000000) {
      showFieldError(
        box.querySelector("#extraCost"),
        "Вкажіть суму більше нуля",
        box.querySelector("#extraError"),
      );
      return;
    }
    additionalExpenseBusy = true;
    box.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      let note = box.querySelector("#extraNote").value,
        result = await post(
          existing ? "expenses/update" : "expenses",
          existing
            ? { id: existing.id, cost, note }
            : { request, cost, note, session_id: sid },
        );
      if (fromCalculator) {
        calculatorDraft.extraIds = calculatorDraft.extraIds || [];
        if (!calculatorDraft.extraIds.includes(result.id))
          calculatorDraft.extraIds.push(result.id);
        saveCalculatorDraft();
        calculatorExtras();
      }
      await savedFeedback(box.querySelector("#extraSave"));
      closeOrderDialog();
      if (view === "history") await statistics();
      toast("Додаткові витрати збережено", true);
    } catch (e) {
      if (box.isConnected) {
        box.querySelector("#extraError").textContent = e.message;
        box.querySelectorAll("button").forEach((b) => (b.disabled = false));
      }
    } finally {
      additionalExpenseBusy = false;
    }
  };
}

function replaceStatistics(html) {
  let box = document.querySelector("#statisticsContent");
  if (!box || view !== "history") return;
  let key = statsTab + "|" + statsSelection + "|" + historyPage,
    same = box.dataset.contentKey === key,
    old = box.querySelector(".stats-pane"),
    before = [...box.querySelectorAll(".report-finances .metric b")].map(
      (e) => e.textContent,
    );
  if (same && box.dataset.markup === html) {
    box.classList.remove("stats-loading");
    box.removeAttribute("aria-busy");
    return;
  }
  box.dataset.markup = html;
  let previousRows = same
    ? new Map(
        [...box.querySelectorAll(".history-record[data-history-order]")].map(
          (e) => [e.dataset.historyOrder, e.getBoundingClientRect()],
        ),
      )
    : new Map();
  let expandedHistory = same
    ? [
        ...box.querySelectorAll(".history-record[open][data-history-order]"),
      ].map((e) => e.dataset.historyOrder)
    : [];
  box.querySelectorAll(".stats-content-ghost").forEach((e) => e.remove());
  let ghost = old && !same ? cleanGhost(old.cloneNode(true)) : null;
  box.innerHTML = '<div class="stats-pane">' + html + "</div>";
  box.querySelectorAll(".history-record[data-history-order]").forEach((e) => {
    if (expandedHistory.includes(e.dataset.historyOrder)) e.open = true;
    if (same) {
      let previous = previousRows.get(e.dataset.historyOrder),
        next = e.getBoundingClientRect();
      if (!previous) appear(e, 160);
      else if (previous.top !== next.top)
        motion(
          e,
          [
            { transform: `translateY(${previous.top - next.top}px)` },
            { transform: "translateY(0)" },
          ],
          160,
        );
    }
  });
  box.dataset.contentKey = key;
  box.classList.remove("stats-loading");
  box.removeAttribute("aria-busy");
  let pane = box.firstElementChild;
  if (ghost) {
    ghost.className = "stats-content-ghost";
    box.appendChild(ghost);
    let direction = statsTab === "report" ? 1 : -1;
    motion(
      pane,
      [
        { opacity: 0, transform: `translateX(${direction * 28}px)` },
        { opacity: 1, transform: "translateX(0)" },
      ],
      240,
    );
    let a = motion(
      ghost,
      [
        { opacity: 1, transform: "translateX(0)" },
        { opacity: 0, transform: `translateX(${-direction * 28}px)` },
      ],
      200,
    );
    a?.finished.then(
      () => ghost.remove(),
      () => ghost.remove(),
    );
  } else if (!old) {
    if (document.querySelector("#main").viewEntrance?.playState !== "running")
      appear(pane, 140, false);
  } else if (same)
    box
      .querySelectorAll(".report-finances .metric b")
      .forEach((e, i) => highlightAmount(e, before[i]));
}
