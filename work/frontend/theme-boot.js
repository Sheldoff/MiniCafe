// Apply the saved choice before the first paint; no animated page-wide flash.
(function () {
  var theme = "light";
  try {
    if (localStorage.getItem("minicafe-theme") === "dark") theme = "dark";
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
})();
