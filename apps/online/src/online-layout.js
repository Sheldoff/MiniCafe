document.documentElement.classList.add("cloud-online");
let cloudLayoutFrame;
function syncCloudLayout() {
  cancelAnimationFrame(cloudLayoutFrame);
  cloudLayoutFrame = requestAnimationFrame(() => {
    const header = document.querySelector("header");
    const grid = document.querySelector(".cash-grid");
    document.documentElement.style.setProperty(
      "--cloud-header",
      (header?.offsetHeight || 52) + "px",
    );
    if (grid) {
      const top = grid.getBoundingClientRect().top + scrollY;
      const height = window.visualViewport?.height || innerHeight;
      document.documentElement.style.setProperty(
        "--cloud-cash-space",
        Math.max(160, height - top - 12) + "px",
      );
    }
  });
}
if (window.ResizeObserver)
  new ResizeObserver(syncCloudLayout).observe(document.querySelector("header"));
new MutationObserver(syncCloudLayout).observe(document.querySelector("#main"), {
  childList: true,
});
window.addEventListener("resize", syncCloudLayout);
window.visualViewport?.addEventListener("resize", syncCloudLayout);
syncCloudLayout();
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
