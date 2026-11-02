// Apply the saved choice before the first paint; no animated page-wide flash.
(function () {
  var theme = "light";
  try {
    document.documentElement.dataset.palette =
      localStorage.getItem("minicafe-palette") === "cafe" ? "cafe" : "standard";
    if (localStorage.getItem("minicafe-theme") === "dark") theme = "dark";
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
})();
