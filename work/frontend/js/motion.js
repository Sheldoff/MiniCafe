function motion(
  el,
  frames,
  duration = 180,
  easing = "cubic-bezier(.2,.7,.3,1)",
) {
  if (!el?.isConnected) return null;
  // Keep theme/focus/status CSS transitions independent from transient motion.
  let running = el
    .getAnimations()
    .filter((a) => !("transitionProperty" in a) && !("animationName" in a));
  if (running.length > 2) running.slice(0, -2).forEach((a) => a.cancel());
  return el.animate(frames, {
    duration: matchMedia("(prefers-reduced-motion:reduce)").matches
      ? 0
      : duration,
    easing,
  });
}

function cleanGhost(el) {
  el.removeAttribute("id");
  el.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));
  el.querySelectorAll("button,input,textarea,select").forEach((e) => {
    e.disabled = true;
    e.tabIndex = -1;
  });
  el.setAttribute("aria-hidden", "true");
  el.style.pointerEvents = "none";
  return el;
}

function appear(element, duration = 160, move = true) {
  if (!element?.isConnected || !element.getClientRects().length) return null;
  let opacity = Math.min(0.82, Number(getComputedStyle(element).opacity));
  element.appearance?.cancel();
  let base = getComputedStyle(element).transform;
  let start = base === "none" ? "translateY(5px)" : base + " translateY(5px)",
    end = base === "none" ? "translateY(0)" : base;
  return (element.appearance = motion(
    element,
    [
      { opacity, ...(move ? { transform: start } : {}) },
      { opacity: 1, ...(move ? { transform: end } : {}) },
    ],
    duration,
  ));
}

function revealPage() {
  let main = document.querySelector("#main");
  if (!hasServerState || main.hidden || main.dataset.motionView === view)
    return;
  main.dataset.motionView = view;
  let initial = !main.dataset.entered;
  main.dataset.entered = "true";
  // Android's WebView already fades in only after server data has arrived.
  if (initial && window.CafeNative) return;
  main.viewEntrance = appear(main, 160);
}

function openOrderDialog(box) {
  box.returnFocus = document.activeElement;
  box.dialogMotion = motion(box, [{ opacity: 0 }, { opacity: 1 }], 140);
  let card = box.querySelector(".order-dialog-card");
  card.dialogMotion = appear(card, 160);
}

function closeOrderDialog(immediate = false) {
  let box = document.querySelector("#orderDialog");
  if (!box) return;
  if (box.dataset.closing === "true" && !immediate) return;
  let card = box.querySelector(".order-dialog-card"),
    opacity = getComputedStyle(box).opacity,
    transform = getComputedStyle(card).transform;
  box.dialogMotion?.cancel();
  card.dialogMotion?.cancel();
  if (immediate) {
    box.remove();
    return;
  }
  document.activeElement?.blur();
  box.dataset.closing = "true";
  box.querySelectorAll("button,input").forEach((e) => (e.disabled = true));
  let a = (box.dialogMotion = motion(box, [{ opacity }, { opacity: 0 }], 120));
  card.dialogMotion = motion(
    card,
    [{ transform }, { transform: "translateY(5px)" }],
    120,
  );
  const remove = () => {
    if (box.dialogMotion !== a) return;
    box.remove();
    let focus = box.returnFocus;
    if (focus?.isConnected && focus.matches("button,summary,[role=button]"))
      focus.focus({ preventScroll: true });
  };
  if (a) a.finished.then(remove, () => {});
  else remove();
}

function hideSuggestions(box) {
  if (!box || box.hidden || box.dataset.hiding === "true") return;
  box.dataset.hiding = "true";
  let a = (box.popupMotion = disclosure(box, false, 140));
  const finish = () => {
    if (box.popupMotion === a) {
      box.hidden = true;
      box.dataset.hiding = "false";
    }
  };
  if (a) a.finished.then(finish, () => {});
  else finish();
}

function drawCart() {
  let box = document.querySelector("#cart");
  if (!box) return;
  let oldSum = document.querySelector("#sum")?.textContent,
    before = new Map(
      [...box.querySelectorAll(".cart-compact[data-cart-key]")].map((e) => [
        e.dataset.cartKey,
        {
          element: e.cloneNode(true),
          height: e.getBoundingClientRect().height,
          qty: e.querySelector(".cart-qty")?.textContent,
        },
      ]),
    );
  drawCartContent();
  highlightAmount(document.querySelector("#sum"), oldSum);
  let rows = [...box.querySelectorAll(".cart-compact[data-cart-key]")],
    heights = new Map(rows.map((e) => [e, e.getBoundingClientRect().height])),
    keys = new Set(rows.map((e) => e.dataset.cartKey));
  rows.forEach((e) => {
    let old = before.get(e.dataset.cartKey);
    if (!e.getClientRects().length) return;
    if (!old) {
      let height = heights.get(e);
      e.style.overflow = "hidden";
      let a = motion(e, [
        { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px" },
        {
          height: height + "px",
          opacity: 1,
          paddingTop: "7px",
          paddingBottom: "7px",
        },
      ]);
      a?.finished.then(
        () => e.style.removeProperty("overflow"),
        () => {},
      );
    } else if (old.qty !== e.querySelector(".cart-qty")?.textContent)
      motion(
        e.querySelector(".cart-qty"),
        [
          { transform: "scale(1)" },
          { transform: "scale(1.2)", offset: 0.4 },
          { transform: "scale(1)" },
        ],
        200,
      );
  });
  for (let [key, old] of before) {
    if (keys.has(key) || old.height <= 0) continue;
    let ghost = cleanGhost(old.element);
    ghost.className = "cart-removal-ghost";
    ghost.removeAttribute("data-edit-price");
    ghost.removeAttribute("data-cart-key");
    let oldKeys = [...before.keys()],
      nextKey = oldKeys
        .slice(oldKeys.indexOf(key) + 1)
        .find((k) => keys.has(k)),
      next = rows.find((e) => e.dataset.cartKey === nextKey);
    box.insertBefore(ghost, next || box.querySelector(".empty-cart"));
    ghost.style.overflow = "hidden";
    let a = motion(ghost, [
      {
        height: old.height + "px",
        opacity: 1,
        paddingTop: "7px",
        paddingBottom: "7px",
      },
      { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px" },
    ]);
    if (a)
      a.finished.then(
        () => ghost.remove(),
        () => ghost.remove(),
      );
    else ghost.remove();
  }
}

function moveCashIndicator() {
  let host = document.querySelector(".cash-switch"),
    selected = host?.querySelector("button.selected");
  if (!selected || !host.getClientRects().length) return;
  let indicator = host.querySelector(".cash-tab-indicator"),
    fresh = !indicator;
  if (!indicator) {
    indicator = document.createElement("span");
    indicator.className = "cash-tab-indicator";
    indicator.setAttribute("aria-hidden", "true");
    host.prepend(indicator);
  }
  if (fresh) indicator.style.transition = "none";
  Object.assign(indicator.style, {
    left: selected.offsetLeft + "px",
    top: selected.offsetTop + "px",
    width: selected.offsetWidth + "px",
    height: selected.offsetHeight + "px",
  });
  host.classList.add("indicator-ready");
  if (fresh) {
    void indicator.offsetWidth;
    indicator.style.removeProperty("transition");
  }
}

const queueEntranceDuration = 220;
const queueEasing = "cubic-bezier(.2,.7,.3,1)";

function queueEntrance(element) {
  return motion(
    element,
    [
      { opacity: 0, transform: "translateY(-14px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    queueEntranceDuration,
    queueEasing,
  );
}

function animateQueueArrival(route, before) {
  let cards = [...document.querySelectorAll("[data-order]")],
    now = new Set(cards.map((e) => e.dataset.order)),
    previous = queueMotionSeen[route];
  queueMotionSeen[route] = now;
  if (
    document.querySelector("#main").dataset.motionView !== view ||
    !previous ||
    issuingOrder ||
    !cards.some((e) => !previous.has(e.dataset.order))
  )
    return;
  let grid = document.querySelector(".queue-grid"),
    animations = [];
  grid?.classList.add("queue-arriving");
  cards.forEach((e) => {
    let old = before.get(e.dataset.order),
      next = e.getBoundingClientRect();
    if (!previous.has(e.dataset.order)) animations.push(queueEntrance(e));
    else if (old && (old.top !== next.top || old.left !== next.left))
      animations.push(
        motion(
          e,
          [
            {
              transform: `translate(${old.left - next.left}px,${old.top - next.top}px)`,
            },
            { transform: "translate(0,0)" },
          ],
          queueEntranceDuration,
        ),
      );
  });
  Promise.allSettled(animations.filter(Boolean).map((a) => a.finished)).then(
    () => grid?.classList.remove("queue-arriving"),
  );
}

async function savedFeedback(button) {
  if (!button?.isConnected) return;
  let wasDisabled = button.disabled;
  button.disabled = true;
  let mark = document.createElement("span");
  mark.className = "save-check";
  mark.textContent = "✓";
  mark.setAttribute("aria-hidden", "true");
  button.prepend(mark);
  button.classList.add("save-confirmed");
  let a = motion(
    mark,
    [
      { opacity: 0, transform: "scale(.7)" },
      { opacity: 1, transform: "scale(1)" },
    ],
    180,
  );
  if (a) await a.finished.catch(() => {});
  mark.remove();
  button.classList.remove("save-confirmed");
  button.disabled = wasDisabled;
}

function showFieldError(field, message, output) {
  if (!field) return;
  field.setAttribute("aria-invalid", "true");
  field.classList.add("field-invalid");
  let box = output || field.nextElementSibling;
  if (!box?.classList.contains("field-error") && !output) {
    box = document.createElement("small");
    box.className = "field-error";
    box.setAttribute("role", "alert");
    field.after(box);
  }
  box.textContent = message;
  field.errorOutput = box;
  motion(
    box,
    [
      { opacity: 0, transform: "translateY(-3px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    150,
  );
}

function highlightAmount(el, previous) {
  if (
    !el ||
    !previous ||
    previous === el.textContent ||
    !el.getClientRects().length
  )
    return;
  el.amountMotion?.cancel();
  el.amountMotion = motion(
    el,
    [
      { backgroundColor: "transparent" },
      {
        backgroundColor:
          getComputedStyle(document.documentElement)
            .getPropertyValue("--amount-pulse")
            .trim() || "#deedce",
        offset: 0.25,
      },
      { backgroundColor: "transparent" },
    ],
    380,
  );
}

function animateCategory() {
  let pane = document.querySelector("#tiles");
  if (!pane) return;
  let opacity = getComputedStyle(pane).opacity;
  pane.categoryMotion?.cancel();
  pane.scrollTop = 0;
  pane.categoryMotion = motion(
    pane,
    [
      {
        opacity: Math.max(0.65, Math.min(0.85, Number(opacity))),
        transform: "translateY(4px)",
      },
      { opacity: 1, transform: "translateY(0)" },
    ],
    160,
  );
}

function animateList(box, update, selector, key) {
  if (!box) {
    update();
    return;
  }
  let initial = !box.dataset.motionInitialized && !box.children.length;
  box.dataset.motionInitialized = "true";
  if (initial || !box.getClientRects().length) {
    update();
    return;
  }
  box.querySelectorAll(".list-removal-ghost").forEach((e) => e.remove());
  let before = new Map(
    [...box.querySelectorAll(selector)].map((e, i) => [
      key ? e.dataset[key] : e.dataset.motionKey,
      { clone: e.cloneNode(true), rect: e.getBoundingClientRect() },
    ]),
  );
  box.querySelectorAll(selector).forEach((e) => {
    e.listMotion?.cancel();
    e.listMotion = null;
    e.style.removeProperty("overflow");
  });
  update();
  // Measure the final layout once before starting any animation. Animating
  // height while measuring later rows caused repeated layout and wrong offsets.
  let rows = [...box.querySelectorAll(selector)],
    rects = new Map(rows.map((e) => [e, e.getBoundingClientRect()])),
    bounds = box.getBoundingClientRect(),
    keys = new Set();
  rows.forEach((e) => {
    let id = key ? e.dataset[key] : e.dataset.motionKey;
    keys.add(id);
    let prev = before.get(id),
      rect = rects.get(e);
    if (!prev) {
      e.listMotion = motion(
        e,
        [
          {
            opacity: 0,
            transform: "translateY(8px)",
          },
          {
            opacity: 1,
            transform: "translateY(0)",
          },
        ],
        220,
      );
    } else if (prev.rect.top !== rect.top)
      e.listMotion = motion(
        e,
        [
          { transform: `translateY(${prev.rect.top - rect.top}px)` },
          { transform: "translateY(0)" },
        ],
        220,
      );
  });
  for (let [id, prev] of before) {
    if (keys.has(id)) continue;
    let ghost = cleanGhost(prev.clone);
    ghost.classList.add("list-removal-ghost");
    ghost.classList.remove(selector.slice(1));
    Object.assign(ghost.style, {
      position: "absolute",
      width: prev.rect.width + "px",
      height: prev.rect.height + "px",
      left: "0",
      top: prev.rect.top - bounds.top + "px",
      margin: "0",
    });
    box.style.position = "relative";
    box.append(ghost);
    let a = motion(
      ghost,
      [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(8px)" },
      ],
      220,
    );
    a?.finished.then(
      () => ghost.remove(),
      () => ghost.remove(),
    );
  }
}

/** Animate real occupied space, including padding/borders, and reverse from the current frame. */
function disclosure(element, open, duration = 320) {
  if (!element) return null;
  function frame() {
    let css = getComputedStyle(element),
      result = {
        height: element.getBoundingClientRect().height + "px",
        opacity: css.opacity,
      };
    for (let property of [
      "paddingTop",
      "paddingBottom",
      "marginTop",
      "marginBottom",
      "borderTopWidth",
      "borderBottomWidth",
    ])
      result[property] = css[property];
    return result;
  }
  let hidden = element.hidden,
    start = hidden ? null : frame();
  element.disclosureAnimation?.cancel();
  element.hidden = false;
  let expanded = frame(),
    collapsed = {
      height: "0px",
      opacity: 0,
      paddingTop: "0px",
      paddingBottom: "0px",
      marginTop: "0px",
      marginBottom: "0px",
      borderTopWidth: "0px",
      borderBottomWidth: "0px",
    };
  expanded.opacity = 1;
  if (element.disclosureOverflow === undefined)
    element.disclosureOverflow = element.style.overflow;
  element.style.overflow = "hidden";
  let animation = motion(
    element,
    [start || collapsed, open ? expanded : collapsed],
    duration,
    "cubic-bezier(.4,0,.2,1)",
  );
  element.disclosureAnimation = animation;
  function finish() {
    if (element.disclosureAnimation !== animation) return;
    element.hidden = !open;
    element.style.overflow = element.disclosureOverflow;
  }
  if (animation) animation.finished.then(finish, () => {});
  else finish();
  return animation;
}
