document.documentElement.classList.add("cloud-online");
let cloudLayoutFrame;
function cloudLayoutTop(element) {
  let top = 0;
  for (let e = element; e; e = e.offsetParent) top += e.offsetTop;
  return top;
}
function syncCloudLayout() {
  cancelAnimationFrame(cloudLayoutFrame);
  cloudLayoutFrame = requestAnimationFrame(() => {
    if (document.querySelector("#main").hidden) return;
    const header = document.querySelector("header");
    const grid = document.querySelector(".cash-grid");
    document.documentElement.style.setProperty(
      "--cloud-header",
      (header?.offsetHeight || 52) + "px",
    );
    if (grid) {
      const top = cloudLayoutTop(grid);
      const height = window.visualViewport?.height || innerHeight;
      document.documentElement.style.setProperty(
        "--cloud-cash-space",
        Math.max(160, height - top) + "px",
      );
    }
    const products = document.querySelector(".menu-editor-grid");
    if (products) {
      document.documentElement.style.setProperty(
        "--cloud-products-space",
        Math.max(
          240,
          (window.visualViewport?.height || innerHeight) -
            cloudLayoutTop(products),
        ) + "px",
      );
    }
  });
}
if (window.ResizeObserver)
  new ResizeObserver(syncCloudLayout).observe(document.querySelector("header"));
new MutationObserver(syncCloudLayout).observe(document.querySelector("#main"), {
  childList: true,
  attributes: true,
  attributeFilter: ["hidden"],
});
window.addEventListener("resize", syncCloudLayout);
window.visualViewport?.addEventListener("resize", syncCloudLayout);
syncCloudLayout();
// The whole cashier surface accepts swipes, including space below a short cart.
// Retain the shared gesture guards for controls, dialogs, holds and transitions.
const cloudBaseGestureBlocked = cashGestureBlocked;
cashGestureBlocked = function (target) {
  if (target.closest(".cash-grid")) return cloudBaseGestureBlocked(target);
  const grid = document.querySelector(".cash-grid");
  return (
    !grid ||
    !target.closest("#main") ||
    !!target.closest("input,textarea,select,a,button,[contenteditable=true]") ||
    cloudBaseGestureBlocked(grid)
  );
};
if (["staff", "server", "menu-transfer"].includes(view)) render();
// A reduced-motion animation returns null. It must still clear its toast.
toast = function (message, success = false) {
  const e = document.querySelector("#toast");
  clearTimeout(e.hideTimer);
  e.toastMotion?.cancel();
  const visible = e.style.display === "block";
  e.setAttribute("role", "status");
  e.setAttribute("aria-live", "polite");
  e.innerHTML = success
    ? '<span class="save-check" aria-hidden="true">✓</span><span>' +
      esc(message) +
      "</span>"
    : esc(message);
  e.style.display = "block";
  e.style.opacity = "1";
  if (!visible) e.toastMotion = appear(e, 140);
  e.hideTimer = setTimeout(() => {
    const a = (e.toastMotion = motion(
      e,
      [{ opacity: 1 }, { opacity: 0 }],
      120,
    ));
    if (a)
      a.finished.then(
        () => {
          if (e.toastMotion === a) e.style.display = "none";
        },
        () => {},
      );
    else e.style.display = "none";
  }, 3500);
};
