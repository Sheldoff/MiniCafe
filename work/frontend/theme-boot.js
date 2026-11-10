// Apply the saved choice before the first paint; no animated page-wide flash.
(function () {
  var theme = "light";
  try {
    var palette = localStorage.getItem("minicafe-palette");
    if (palette === "coffee")
      document.documentElement.dataset.palette = palette;
    else localStorage.removeItem("minicafe-palette");
    if (localStorage.getItem("minicafe-theme") === "dark") theme = "dark";
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
})();
