let liveStatsTimer = null,
  liveStatsLast = null;
function liveChart(title, rows, key, currency, interval) {
  const rawMax = Math.max(0, ...rows.map((r) => r[key])),
    max = Math.max(1, rawMax);
  const label = (r) =>
    new Date(r.time).toLocaleString(
      "uk-UA",
      interval >= 86400
        ? { day: "2-digit", month: "2-digit" }
        : { hour: "2-digit", minute: "2-digit" },
    );
  return `<section class="live-card"><h3>${title}</h3>${rows.length ? `<div class="live-axis"><span>${currency ? money(rawMax) : rawMax}</span><span>0</span></div><div class="live-chart" style="--live-columns:${rows.length}">${rows.map((r, i) => `<div class="live-column" title="${esc(label(r))}: ${currency ? money(r[key]) : r[key]}"><span class="live-bar" role="img" aria-label="${esc(label(r))}: ${currency ? money(r[key]) : r[key]}" style="height:${(Math.max(0, r[key]) / max) * 100}%"></span><small>${i === 0 || i === rows.length - 1 || i % Math.max(1, Math.ceil(rows.length / 6)) === 0 ? esc(label(r)) : ""}</small></div>`).join("")}</div>` : '<p class="live-empty">Ще немає замовлень для графіка</p>'}</section>`;
}
function liveBars(title, rows, currency) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<section class="live-card"><h3>${title}</h3>${rows.length ? rows.map((r) => `<div class="live-breakdown"><div><span>${esc(r.name)}</span><b>${currency ? money(r.value) : r.value}</b></div><div class="live-track"><span style="width:${(Math.max(0, r.value) / max) * 100}%;${/^#[a-f0-9]{6}$/i.test(r.color || "") ? "background:" + r.color : ""}"></span></div>${r.hint ? `<small>${esc(r.hint)}</small>` : ""}</div>`).join("") : '<p class="live-empty">Дані з’являться після оформлення замовлень</p>'}</section>`;
}
function liveStatisticsMarkup(r, error = "") {
  const l = r.live,
    rows = l.timeline,
    at = new Date(l.generated_at).toLocaleTimeString("uk-UA", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  const kpi = (label, value, hint = "") =>
    `<div class="live-kpi"><span>${label}</span><b>${value}</b>${hint ? `<small>${hint}</small>` : ""}</div>`;
  const top = [...r.drinks, ...r.food]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);
  return `<section class="live-dashboard"><div class="live-toolbar"><div><h2>${esc(r.title)}</h2><p class="live-status ${error ? "is-stale" : ""}" role="status">${error ? esc(error) + " · Останні дані: " : "Оновлено: "}${at} · кожні 15 с</p></div><button type="button" onclick="statistics()">Оновити</button></div><div class="live-kpis">${kpi("Виручка", money(r.revenue))}${kpi("Після витрат", money(r.net_revenue))}${kpi("Замовлень", r.order_count, "Подарункових: " + r.gift_count)}${kpi("Середній чек", r.check_count ? money(r.avg_check) : "—", "Без подарунків")}${kpi("Порцій у черзі", l.pending_units, "Замовлень: " + l.pending_orders)}${kpi("Найдовше очікування", l.pending_orders ? Math.floor(l.oldest_wait_seconds / 60) + " хв" : "—", "У поточній сесії")}</div><p class="live-period">Крок графіків: ${durationText(l.interval_seconds)}</p><div class="live-graphs">${liveChart("Виручка у часі", rows, "revenue", true, l.interval_seconds)}${liveChart("Кількість замовлень у часі", rows, "orders", false, l.interval_seconds)}${liveBars("Спосіб оплати", [{ name: "Готівка", value: r.cash, hint: "Оплат: " + r.cash_count }, { name: "Картка", value: r.card, hint: "Оплат: " + r.card_count }, ...(r.unknown ? [{ name: "Невідомий тип", value: r.unknown }] : [])], true)}${liveBars(
    "Виручка по касах",
    l.cashiers.map((c) => ({
      name: locationInfo(c.id)?.name || c.name,
      value: c.revenue,
      color: locationInfo(c.id)?.color,
      hint: "Замовлень: " + c.orders + " · У черзі порцій: " + c.pending_units,
    })),
    true,
  )}${liveBars(
    "Популярні позиції · порції",
    top.map((p) => ({ name: p.name, value: p.qty, hint: money(p.amount) })),
    false,
  )}</div><details class="live-data"><summary>Дані графіків за періодами</summary><table class="report-table"><thead><tr><th>Період</th><th>Замовлень</th><th>Виручка</th></tr></thead><tbody>${rows.map((p) => `<tr><td>${new Date(p.time).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td><td>${p.orders}</td><td>${money(p.revenue)}</td></tr>`).join("")}</tbody></table></details><p class="live-note">Дані поточної сесії за оформленими чеками. Скасування позиції не означає повернення оплати. Автооновлення працює, поки сторінка відкрита й видима.</p></section>`;
}
async function liveStatistics(current, serial) {
  clearTimeout(liveStatsTimer);
  if (!current) {
    replaceStatistics(
      '<div class="panel live-empty"><h3>Немає відкритої сесії</h3><p>Графіки з’являться після початку нової сесії.</p></div>',
    );
  } else {
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(
        "/api/stats?session=" + current + "&live=1",
        { headers: auth, cache: "no-store", signal: controller.signal },
      );
      if (response.status === 401 || response.status === 403) {
        const error = Error("Доступ до статистики обмежено");
        error.auth = true;
        throw error;
      }
      const r = await response.json();
      if (!response.ok) throw Error(r.error);
      if (
        serial !== statsRequest ||
        view !== "history" ||
        statsTab !== "online" ||
        current !== data.active_session
      )
        return;
      liveStatsLast = { current, r };
      replaceStatistics(liveStatisticsMarkup(r));
    } catch (e) {
      if (
        serial !== statsRequest ||
        view !== "history" ||
        statsTab !== "online"
      )
        return;
      if (e.auth) {
        liveStatsLast = null;
        replaceStatistics(
          '<div class="panel"><p role="status">Доступ до статистики обмежено. Перевірте авторизацію.</p></div>',
        );
        return;
      }
      const message =
        e.name === "AbortError"
          ? "Сервер не відповів; повторюємо оновлення"
          : "Не вдалося оновити дані";
      replaceStatistics(
        liveStatsLast?.current === current
          ? liveStatisticsMarkup(liveStatsLast.r, message)
          : `<div class="panel"><p role="status">${message}</p><button onclick="statistics()">Повторити</button></div>`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  if (serial === statsRequest && view === "history" && statsTab === "online")
    liveStatsTimer = setTimeout(() => {
      if (
        view === "history" &&
        statsTab === "online" &&
        document.visibilityState === "visible"
      )
        statistics();
    }, 15000);
}
document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    view === "history" &&
    statsTab === "online"
  )
    statistics();
});
