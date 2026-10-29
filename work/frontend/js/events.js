window.addEventListener("popstate", () => {
  let target = location.hash.slice(1) || "cash";
  if (
    [
      "cash",
      "bar",
      "delivery",
      "history",
      "menu",
      "calculator",
      "developer",
      "server",
    ].includes(target) &&
    target !== view
  ) {
    view = target;
    render();
  }
  if (view === "cash") showCashPanel(!!history.state?.cafeCart, true);
  if (view === "menu") {
    if (history.state?.cafeEditor) openProductEditor(true);
    else closeProductEditor(true);
  }
});

window.addEventListener("resize", () => {
  if (view === "cash" && document.querySelector("#tiles")) tiles("");
});

document.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length !== 1) {
      clearOrderHold();
      return;
    }
    if (startOrderHold(e.target, e.touches[0].clientX, e.touches[0].clientY))
      e.preventDefault();
  },
  { passive: false, capture: true },
);

document.addEventListener(
  "touchmove",
  (e) => {
    if (!orderHold) return;
    e.preventDefault();
    let t = e.touches[0];
    if (Math.hypot(t.clientX - orderHold.x, t.clientY - orderHold.y) > 12) {
      clearTimeout(orderHold.timer);
      orderHold.moved = true;
      let scroller = orderHold.target.closest("#cart");
      if (scroller) scroller.scrollTop += orderHold.lastY - t.clientY;
      else scrollBy(0, orderHold.lastY - t.clientY);
    }
    orderHold.lastY = t.clientY;
  },
  { passive: false, capture: true },
);

document.addEventListener(
  "touchend",
  (e) => {
    if (orderHold) {
      e.preventDefault();
      clearOrderHold();
    }
  },
  { passive: false, capture: true },
);

document.addEventListener("touchcancel", clearOrderHold);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && handleAppBack()) e.preventDefault();
});

document.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch" && e.button === 0)
    startOrderHold(e.target, e.clientX, e.clientY);
});

document.addEventListener("pointerup", (e) => {
  if (e.pointerType !== "touch") clearOrderHold();
});

document.addEventListener("pointermove", (e) => {
  if (
    e.pointerType !== "touch" &&
    orderHold &&
    Math.hypot(e.clientX - orderHold.x, e.clientY - orderHold.y) > 12
  )
    clearOrderHold();
});

document.addEventListener("contextmenu", (e) => {
  if (e.target.closest("[data-edit-price],[data-gift-hold]"))
    e.preventDefault();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (document.body.classList.contains("drawer-open")) toggleDrawer(false);
    else if (view === "menu") closeProductEditor();
  }
});

document.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch" || e.button !== 0) return;
  beginProductPress(e.target.closest("[data-product]"), e.clientX, e.clientY);
});

document.addEventListener("pointermove", (e) => {
  if (
    e.pointerType !== "touch" &&
    productPress &&
    Math.hypot(e.clientX - productPress.x, e.clientY - productPress.y) > 18
  )
    clearProductPress();
});

document.addEventListener("pointerup", (e) => {
  if (e.pointerType !== "touch") clearProductPress();
});

document.addEventListener("pointercancel", (e) => {
  if (e.pointerType !== "touch") clearProductPress();
});

document.addEventListener(
  "touchstart",
  (e) => {
    let target = e.target.closest("[data-product]");
    if (!target) return;
    if (e.touches.length !== 1) {
      clearProductPress();
      tileTouch = null;
      return;
    }
    e.preventDefault();
    let t = e.touches[0];
    tileTouch = {
      id: Number(target.dataset.product),
      x: t.clientX,
      y: t.clientY,
      lastY: t.clientY,
      moved: false,
    };
    beginProductPress(target, t.clientX, t.clientY);
  },
  { passive: false, capture: true },
);

document.addEventListener(
  "touchmove",
  (e) => {
    if (!tileTouch) return;
    e.preventDefault();
    let t = e.touches[0];
    if (!t) return;
    if (Math.hypot(t.clientX - tileTouch.x, t.clientY - tileTouch.y) > 12) {
      tileTouch.moved = true;
      clearProductPress();
    }
    if (tileTouch.moved) {
      let pane = e.target.closest("#tiles");
      if (pane) pane.scrollTop += tileTouch.lastY - t.clientY;
      else window.scrollBy(0, tileTouch.lastY - t.clientY);
    }
    tileTouch.lastY = t.clientY;
  },
  { passive: false, capture: true },
);

document.addEventListener(
  "touchend",
  (e) => {
    if (!tileTouch) return;
    e.preventDefault();
    let touch = tileTouch,
      long = productPress?.long;
    clearProductPress();
    tileTouch = null;
    if (!touch.moved && !long) {
      lastLongPress.until = 0;
      add(touch.id);
    }
  },
  { passive: false, capture: true },
);

document.addEventListener(
  "touchcancel",
  () => {
    clearProductPress();
    tileTouch = null;
  },
  { passive: true },
);

document.addEventListener("contextmenu", (e) => {
  if (e.target.closest("[data-product]")) e.preventDefault();
});

fieldObserver.observe(document.body, { childList: true, subtree: true });

document.addEventListener(
  "keydown",
  (e) => {
    if (
      e.key === "Enter" &&
      e.target.matches(
        "input:not([type=file]):not([type=checkbox]):not([type=radio])",
      )
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.target.blur();
      if (window.CafeNative) location.href = "minicafe://hidekeyboard";
    }
  },
  true,
);

document.addEventListener(
  "focus",
  (event) => {
    let field = event.target;
    if (!isMoneyField(field)) return;
    let value = String(field.value).trim().replace(",", "."),
      parts = value.split(".");
    field.dataset.moneyFraction = ((parts[1] || "") + "00").slice(0, 2);
    field.dataset.moneyOriginal = value;
    field.dataset.moneyEdited = "false";
    field.dataset.moneyEditing = "true";
    field.value =
      field.id === "cardPaid" && Number(value) === 0 ? "" : parts[0];
    let wrap = field.closest(".money-control");
    if (wrap) {
      wrap.classList.add("money-editing");
      wrap.querySelector(".money-fraction")?.remove();
    }
    field.select();
    requestAnimationFrame(() => {
      if (
        document.activeElement === field &&
        field.dataset.moneyEdited !== "true"
      )
        field.select();
    });
  },
  true,
);

document.addEventListener(
  "beforeinput",
  (event) => {
    if (isMoneyField(event.target) && event.data && /^[.,]$/.test(event.data))
      event.preventDefault();
  },
  true,
);

document.addEventListener(
  "paste",
  (event) => {
    let field = event.target;
    if (!isMoneyField(field)) return;
    let text = event.clipboardData?.getData("text");
    if (!text) return;
    event.preventDefault();
    let whole = text
      .trim()
      .replace(/\s/g, "")
      .split(/[.,]/)[0]
      .replace(/\D/g, "");
    field.setRangeText(
      whole,
      field.selectionStart ?? 0,
      field.selectionEnd ?? field.value.length,
      "end",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  },
  true,
);

document.addEventListener(
  "input",
  (event) => {
    let field = event.target;
    if (!isMoneyField(field)) return;
    let value = field.value.split(/[.,]/)[0].replace(/\D/g, "");
    if (field.value !== value) field.value = value;
    field.dataset.moneyEdited = "true";
    field.dataset.moneyFraction = "00";
    let fraction = field
      .closest(".money-control")
      ?.querySelector(".money-fraction");
    if (fraction) fraction.textContent = ".00";
  },
  true,
);

document.addEventListener(
  "blur",
  (event) => {
    let field = event.target;
    if (!isMoneyField(field)) return;
    let raw = moneyRaw(field);
    field.dataset.moneyEditing = "false";
    field.value = raw;
    field.closest(".money-control")?.classList.remove("money-editing");
    formatMoneyField(field);
  },
  true,
);

document.addEventListener(
  "focusout",
  (event) => {
    if (isMoneyField(event.target)) formatMoneyField(event.target);
  },
  true,
);

document.addEventListener(
  "input",
  (e) => {
    let field = e.target;
    if (field.getAttribute?.("aria-invalid") !== "true") return;
    field.removeAttribute("aria-invalid");
    field.classList.remove("field-invalid");
    let box = field.errorOutput;
    if (box) {
      box.textContent = "";
      if (box.classList.contains("field-error")) box.remove();
      field.errorOutput = null;
    }
  },
  true,
);

document.addEventListener(
  "invalid",
  (e) => showFieldError(e.target, e.target.validationMessage),
  true,
);

window.addEventListener("resize", moveCashIndicator);

document.addEventListener("click", (event) => {
  let summary = event.target.closest(".history-record>summary");
  if (!summary) return;
  event.preventDefault();
  let details = summary.parentElement,
    body = details.querySelector(".history-body"),
    closing = details.open && !details.classList.contains("details-closing");
  if (!details.open) body.hidden = true;
  details.classList.toggle("details-closing", closing);
  details.open = true;
  let a = disclosure(body, !closing, 300);
  body.detailsMotion = a;
  const done = () => {
    if (body.detailsMotion !== a) return;
    if (closing) details.open = false;
    details.classList.remove("details-closing");
  };
  if (a) a.finished.then(done, () => {});
  else done();
});
