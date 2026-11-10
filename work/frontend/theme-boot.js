// Apply the saved choice before the first paint; no animated page-wide flash.
(function () {
  var theme = "light",
    palette = "coffee";
  try {
    if (localStorage.getItem("minicafe-coffee-default-v2") !== "1") {
      localStorage.setItem("minicafe-palette", "coffee");
      localStorage.setItem("minicafe-coffee-default-v2", "1");
    }
    palette =
      localStorage.getItem("minicafe-palette") === "standard"
        ? "standard"
        : "coffee";
    if (localStorage.getItem("minicafe-theme") === "dark") theme = "dark";
  } catch (e) {}
  if (palette === "coffee") document.documentElement.dataset.palette = palette;
  else delete document.documentElement.dataset.palette;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta && palette === "coffee") meta.content = "#4b3022";
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
})();
