document.documentElement.classList.add("cafe-app");
let appLayoutFrame;
function appLayoutTop(element) {
  let top = 0;
  for (let e = element; e; e = e.offsetParent) top += e.offsetTop;
  return top;
}
function syncAppLayout() {
  cancelAnimationFrame(appLayoutFrame);
  appLayoutFrame = requestAnimationFrame(() => {
    if (document.querySelector("#main").hidden) return;
    const bottomInset =
      parseFloat(
        getComputedStyle(document.querySelector("#main")).paddingBottom,
      ) || 0;
    const header = document.querySelector("header");
    const grid = document.querySelector(".cash-grid");
    document.documentElement.style.setProperty(
      "--cloud-header",
      (header?.offsetHeight || 52) + "px",
    );
    if (grid) {
      const top = appLayoutTop(grid);
      const height = window.visualViewport?.height || innerHeight;
      document.documentElement.style.setProperty(
        "--cloud-cash-space",
        Math.max(160, height - top - bottomInset) + "px",
      );
    }
    const products = document.querySelector(".menu-editor-grid");
    if (products) {
      document.documentElement.style.setProperty(
        "--cloud-products-space",
        Math.max(
          240,
          (window.visualViewport?.height || innerHeight) -
            appLayoutTop(products) -
            bottomInset,
        ) + "px",
      );
    }
  });
}
if (window.ResizeObserver)
  new ResizeObserver(syncAppLayout).observe(document.querySelector("header"));
new MutationObserver(syncAppLayout).observe(document.querySelector("#main"), {
  childList: true,
  attributes: true,
  attributeFilter: ["hidden"],
});
window.addEventListener("resize", syncAppLayout);
window.visualViewport?.addEventListener("resize", syncAppLayout);
syncAppLayout();

const appLayoutRender = render;
render = function () {
  const main = document.querySelector("#main"),
    changed = main.dataset.appView !== view;
  appLayoutRender();
  if (changed) main.scrollTop = 0;
  main.dataset.appView = view;
  syncAppLayout();
};
