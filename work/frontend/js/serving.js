// Update only after the server acknowledged the action, so a failed follow-up read
// cannot resurrect an issued ticket. The next successful state remains authoritative.
function acknowledgeIssue(
  order,
  route,
  itemId = null,
  unit = null,
  delivered = true,
) {
  let ticket = data.orders.find((o) => o.id === order);
  ticket?.items.forEach((item) => {
    if (
      item.route !== route ||
      item.status === "cancelled" ||
      (itemId !== null && item.id !== itemId)
    )
      return;
    let flags =
      Array.isArray(item.unit_issued) && item.unit_issued.length === item.qty
        ? [...item.unit_issued]
        : Array(item.qty).fill(item.status === "delivered");
    if (unit === null) flags.fill(delivered);
    else flags[unit] = delivered;
    item.unit_issued = flags;
    item.status = flags.every(Boolean) ? "delivered" : "new";
  });
  data.can_undo_issue ||= {};
  data.can_undo_issue[route] = true;
  stateETag = "";
  refreshSerial++;
}

function unitRows(o, route) {
  return o.items
    .filter((i) => i.route === route && i.status !== "cancelled")
    .map((i) =>
      Array.from({ length: i.qty }, (_, unit) => {
        let issued =
          Array.isArray(i.unit_issued) && i.unit_issued.length === i.qty
            ? i.unit_issued[unit]
            : i.status === "delivered";
        return `<button type="button" class="order-item queue-item ${issued ? "item-issued" : ""}" data-item="${i.id}" data-unit="${unit}" aria-pressed="${!!issued}" onclick="issueUnit(${o.id},${i.id},${unit},'${route}',this)"><span class="item-check" aria-hidden="true">${issued ? "✓" : "○"}</span><span class="grow"><b>${esc(i.name)}</b>${i.qty > 1 ? `<small class="muted">Порція ${unit + 1} із ${i.qty}</small>` : ""}${i.note ? `<span class="item-comment">${esc(i.note)}</span>` : ""}</span></button>`;
      }).join(""),
    )
    .join("");
}

function queueOrders() {
  let route = view === "bar" ? "bar" : "instant",
    pending = (i) => !["delivered", "cancelled"].includes(i.status),
    os = data.orders
      .filter((o) => o.items.some((i) => i.route === route && pending(i)))
      .reverse();
  document.querySelector("#main").innerHTML =
    `<div class="row queue-title"><h2 class="grow">${route === "bar" ? "Черга напоїв" : "Видача їжі"} <span class="queue-count">${os.length}</span></h2><button class="undo-issue" onclick="undoIssue('${route}',this)" ${data.can_undo_issue?.[route] ? "" : "disabled"}>↶ Повернути замовлення</button></div><div class="queue-grid">${os.length ? os.map((o) => `<article class="card" data-order="${o.id}"><div class="order-head"><span class="muted tiny">${new Date(o.created.replace(" ", "T") + "Z").toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</span><div class="order-place">${esc(o.guest || "Гість")}</div></div>${o.comment ? `<div class="order-note">${esc(o.comment)}</div>` : ""}${unitRows(o, route)}<button class="primary" style="width:100%;margin-top:12px" onclick="issue(${o.id},'${route}',this)">✓ Видано</button></article>`).join("") : '<div class="panel empty-state" style="grid-column:1/-1"><div class="empty-icon">' + (route === "bar" ? "☕" : "🥐") + "</div><h2>Черга порожня</h2></div>"}</div>`;
}

async function animateIssued(card) {
  if (!card || !card.isConnected) return;
  let grid = card.parentElement,
    rect = card.getBoundingClientRect(),
    bounds = grid.getBoundingClientRect(),
    others = [...grid.children].filter((e) => e !== card),
    before = new Map(others.map((e) => [e, e.getBoundingClientRect()])),
    oldHeight = grid.style.minHeight,
    oldPosition = grid.style.position;
  // Preserve the currently displayed positions, then stop arrival/return
  // transforms before measuring the new layout for this one transition.
  [card, ...others].forEach((e) =>
    e
      .getAnimations()
      .filter((a) => !("transitionProperty" in a) && !("animationName" in a))
      .forEach((a) => a.cancel()),
  );
  grid.style.minHeight = bounds.height + "px";
  grid.style.position = "relative";
  Object.assign(card.style, {
    position: "absolute",
    top: rect.top - bounds.top + "px",
    left: rect.left - bounds.left + "px",
    width: rect.width + "px",
    height: rect.height + "px",
    margin: "0",
    zIndex: "1",
  });
  card.classList.add("issued-away");
  let duration = matchMedia("(prefers-reduced-motion:reduce)").matches
      ? 0
      : 168,
    nextRects = new Map(others.map((e) => [e, e.getBoundingClientRect()])),
    animations = [
      card.animate(
        [
          { transform: "translateY(0)", opacity: 1 },
          {
            transform: "translateY(-" + (rect.height + 18) + "px)",
            opacity: 0,
          },
        ],
        { duration, easing: "ease-in-out", fill: "forwards" },
      ),
    ];
  others.forEach((e) => {
    let old = before.get(e),
      next = nextRects.get(e);
    if (old.top !== next.top || old.left !== next.left)
      animations.push(
        e.animate(
          [
            {
              transform: `translate(${old.left - next.left}px,${old.top - next.top}px)`,
            },
            { transform: "translate(0,0)" },
          ],
          { duration, easing: "ease-in-out" },
        ),
      );
  });
  await Promise.allSettled(animations.map((a) => a.finished));
  card.remove();
  grid.style.minHeight = oldHeight;
  grid.style.position = oldPosition;
}

async function issueUnit(order, id, unit, route, button) {
  if (issuingOrder) return;
  issuingOrder = true;
  let grid = button.closest(".queue-grid"),
    card = button.closest("article"),
    delivered = button.getAttribute("aria-pressed") !== "true";
  grid.classList.add("issue-locked");
  button.disabled = true;
  try {
    let r = await fetch("/api/issue-unit", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ order, id, unit, route, delivered }),
      }),
      j = await r.json();
    if (!r.ok) throw Error(j.error);
    acknowledgeIssue(order, route, id, unit, delivered);
    button.classList.toggle("item-issued", delivered);
    button.setAttribute("aria-pressed", String(delivered));
    button.querySelector(".item-check").textContent = delivered ? "✓" : "○";
    let markedAt = performance.now();
    motion(
      button.querySelector(".item-check"),
      [{ opacity: 0.5 }, { opacity: 1 }],
      120,
    );
    let rows = [...card.querySelectorAll(".queue-item")];
    if (rows.every((b) => b.getAttribute("aria-pressed") === "true")) {
      await animateIssued(card);
    }
    await refresh(true);
    if (!matchMedia("(prefers-reduced-motion:reduce)").matches)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, 150 - (performance.now() - markedAt))),
      );
  } catch (e) {
    toast(e.message);
  } finally {
    issuingOrder = false;
    if (["bar", "delivery"].includes(view)) orders();
  }
}

async function undoIssue(route, button) {
  if (issuingOrder) return;
  issuingOrder = true;
  let renderedVersions = null,
    originalView = view,
    beforeUnits = new Set(
      [...document.querySelectorAll('.queue-item[aria-pressed="true"]')].map(
        (e) => e.dataset.item + ":" + e.dataset.unit,
      ),
    ),
    before = new Map(
      [...document.querySelectorAll("[data-order]")].map((e) => [
        e.dataset.order,
        e.getBoundingClientRect(),
      ]),
    );
  button.disabled = true;
  try {
    let r = await fetch("/api/undo-issue", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ route }),
      }),
      j = await r.json();
    if (!r.ok) throw Error(j.error);
    if (!(await refresh(true)))
      throw Error(
        "Видачу повернуто. Не вдалося оновити список — натисніть «Оновити» після відновлення зв’язку.",
      );
    if (view === originalView) {
      renderedVersions = JSON.stringify(data.versions);
      orders();
      let grid = document.querySelector(".queue-grid");
      grid?.classList.add("issue-locked");
      let duration = matchMedia("(prefers-reduced-motion:reduce)").matches
          ? 0
          : queueEntranceDuration,
        animations = [];
      document.querySelectorAll("[data-order]").forEach((e) => {
        let old = before.get(e.dataset.order),
          next = e.getBoundingClientRect();
        if (old && old.top === next.top && old.left === next.left) return;
        animations.push(
          e.animate(
            old
              ? [
                  {
                    transform: `translate(${old.left - next.left}px,${old.top - next.top}px)`,
                  },
                  { transform: "translate(0,0)" },
                ]
              : [
                  { opacity: 0, transform: "translateY(-14px)" },
                  { opacity: 1, transform: "translateY(0)" },
                ],
            { duration, easing: queueEasing },
          ),
        );
      });
      document
        .querySelectorAll('.queue-item[aria-pressed="false"]')
        .forEach((e) => {
          if (beforeUnits.has(e.dataset.item + ":" + e.dataset.unit))
            animations.push(
              e.animate([{ opacity: 0.4 }, { opacity: 1 }], {
                duration,
                easing: "ease-out",
              }),
            );
        });
      await Promise.allSettled(animations.map((a) => a.finished));
      grid?.classList.remove("issue-locked");
    }
    toast("Останню видачу повернуто");
  } catch (e) {
    toast(e.message);
  } finally {
    issuingOrder = false;
    if (
      view === originalView &&
      (renderedVersions !== JSON.stringify(data.versions) ||
        !document.querySelector(".queue-grid"))
    )
      orders();
  }
}

async function issue(id, route, button) {
  if (issuingOrder) return;
  issuingOrder = true;
  let grid = button.closest(".queue-grid"),
    card = button.closest("article");
  grid?.classList.add("issue-locked");
  button.disabled = true;
  button.textContent = "Видаємо…";
  card?.classList.add("issuing");
  try {
    let r = await fetch("/api/issue", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ id, route }),
      }),
      j = await r.json();
    if (!r.ok) throw Error(j.error);
    acknowledgeIssue(id, route);
    button.textContent = "✓ Видано";
    await animateIssued(card);
    await refresh(true);
    toast(route === "bar" ? "Напої видано" : "Їжу видано");
  } catch (e) {
    button.disabled = false;
    button.textContent = "✓ Видано";
    card?.classList.remove("issuing", "issued-away");
    toast(e.message);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 105));
    issuingOrder = false;
    if (["bar", "delivery"].includes(view)) orders();
    grid?.classList.remove("issue-locked");
    document.querySelector(".queue-grid")?.classList.remove("issue-locked");
  }
}

function orders() {
  let oldQueue = document.querySelector(".queue-grid"),
    hadOrders = oldQueue?.dataset.hadOrders === "true";
  let beforeCards = new Map(
    [...document.querySelectorAll("[data-order]")].map((e) => [
      e.dataset.order,
      e.getBoundingClientRect(),
    ]),
  );
  let availabilityOpen =
    document
      .querySelector(".availability-heading")
      ?.getAttribute("aria-expanded") === "true" &&
    document.querySelector(".availability-panel")?.dataset.route ===
      (view === "bar" ? "bar" : "instant");
  if (view === "history") statistics();
  else {
    queueOrders();
    let grid = document.querySelector(".queue-grid");
    grid.dataset.hadOrders = String(!!grid.querySelector("[data-order]"));
    document
      .querySelector("#main")
      .insertAdjacentHTML(
        "afterbegin",
        availabilityPanel(view === "bar" ? "bar" : "instant"),
      );
    if (availabilityOpen) {
      let b = document.querySelector(".availability-heading");
      b.setAttribute("aria-expanded", "true");
      b.nextElementSibling.hidden = false;
    }
    animateQueueArrival(view === "bar" ? "bar" : "instant", beforeCards);
    if (
      hadOrders &&
      !document.querySelector("[data-order]") &&
      document.querySelector("#main").dataset.motionView === view
    )
      queueEntrance(document.querySelector(".empty-state"));
  }
}

function availabilityPanel(route) {
  let products = data.products.filter((p) => p.route === route && p.active);
  return `<section class="availability-panel" data-route="${route}"><button class="availability-heading" aria-expanded="false" onclick="toggleAvailability(this)"><span>Наявність позицій</span><span class="availability-chevron">⌄</span></button><div class="availability-body" hidden><div class="availability-grid">${products.map((p) => `<button class="availability-toggle ${productUnavailable(p) ? "off" : ""}" aria-pressed="${productUnavailable(p)}" ${p.stock != null && !p.stock_estimated && p.stock <= 0 ? "disabled" : ""} onclick="availability(${p.id})"><span>${esc(p.name)}</span><b>${p.stock != null && !p.stock_estimated && p.stock <= 0 ? "Залишок 0 · оновіть кількість" : p.sold_out ? "Закінчилось · повернути" : "Є в наявності · вимкнути"}</b></button>`).join("")}</div></div></section>`;
}

function toggleAvailability(button) {
  let open = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(open));
  disclosure(button.nextElementSibling, open, 280);
}
