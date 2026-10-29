// Capture before the product/price hold listeners. Only lock deliberate horizontal
// movement; ordinary scrolling, text editing and long presses retain their behavior.
let cashGesture = null,
  cashGestureClickUntil = 0;
function cancelCashGesture() {
  cashGesture = null;
}
function cashGestureBlocked(target) {
  return (
    view !== "cash" ||
    innerWidth > 999 ||
    busy ||
    document.body.classList.contains("drawer-open") ||
    !!document.querySelector("#orderDialog") ||
    !target.closest(".cash-grid") ||
    !!target.closest("input,textarea,select,a,[contenteditable=true]") ||
    !!target.closest("button:not(.tile)") ||
    !!document.querySelector(".cash-swiping")
  );
}
document.addEventListener(
  "touchstart",
  (event) => {
    cashGesture = null;
    if (event.touches.length !== 1) {
      clearProductPress();
      clearOrderHold();
      tileTouch = null;
      return;
    }
    if (cashGestureBlocked(event.target)) return;
    const touch = event.touches[0];
    // Leave the system/browser edge-back gesture available.
    if (touch.clientX < 24 || touch.clientX > innerWidth - 24) return;
    cashGesture = {
      x: touch.clientX,
      y: touch.clientY,
      dx: 0,
      dy: 0,
      axis: null,
      id: touch.identifier,
      panel: mobileCart,
      grid: document.querySelector(".cash-grid"),
      started: performance.now(),
    };
  },
  { capture: true, passive: true },
);
document.addEventListener(
  "touchmove",
  (event) => {
    const gesture = cashGesture;
    if (!gesture) return;
    if (
      event.touches.length !== 1 ||
      cashGestureBlocked(event.target) ||
      gesture.grid !== document.querySelector(".cash-grid") ||
      gesture.panel !== mobileCart ||
      productPress?.long ||
      orderHold?.fired
    ) {
      cashGesture = null;
      return;
    }
    const touch = [...event.touches].find((t) => t.identifier === gesture.id);
    if (!touch) return;
    gesture.dx = touch.clientX - gesture.x;
    gesture.dy = touch.clientY - gesture.y;
    if (
      !gesture.axis &&
      Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) > 12
    ) {
      if (Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5)
        gesture.axis = "horizontal";
      else if (Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2)
        gesture.axis = "vertical";
    }
    if (gesture.axis !== "horizontal") return;
    clearProductPress();
    clearOrderHold();
    tileTouch = null;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  { capture: true, passive: false },
);
document.addEventListener(
  "touchend",
  (event) => {
    const gesture = cashGesture;
    cashGesture = null;
    if (!gesture || gesture.axis !== "horizontal") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    clearProductPress();
    clearOrderHold();
    tileTouch = null;
    cashGestureClickUntil = Date.now() + 350;
    if (
      gesture.grid !== document.querySelector(".cash-grid") ||
      gesture.panel !== mobileCart ||
      view !== "cash" ||
      document.querySelector("#orderDialog") ||
      document.body.classList.contains("drawer-open")
    )
      return;
    const touch = [...event.changedTouches].find(
      (t) => t.identifier === gesture.id,
    );
    if (!touch) return;
    const dx = touch.clientX - gesture.x,
      dy = touch.clientY - gesture.y;
    if (
      Math.abs(dx) < Math.max(60, Math.min(100, innerWidth * 0.15)) ||
      Math.abs(dx) < Math.abs(dy) * 1.5 ||
      performance.now() - gesture.started > 1200
    )
      return;
    if ((!mobileCart && dx < 0) || (mobileCart && dx > 0))
      showCashPanel(!mobileCart);
  },
  { capture: true, passive: false },
);
document.addEventListener(
  "touchcancel",
  () => {
    if (cashGesture?.axis === "horizontal")
      cashGestureClickUntil = Date.now() + 350;
    cashGesture = null;
    clearProductPress();
    clearOrderHold();
    tileTouch = null;
  },
  { capture: true, passive: true },
);
document.addEventListener(
  "click",
  (event) => {
    if (
      Date.now() < cashGestureClickUntil &&
      event.target.closest(".cash-grid")
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);
window.addEventListener("resize", cancelCashGesture);
