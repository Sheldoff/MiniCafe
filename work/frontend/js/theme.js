let themeChangeTimer = null;
function themeIcon() {
  return `<span class="theme-icon" aria-hidden="true"><svg class="theme-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="theme-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.4 14.2A8.7 8.7 0 0 1 9.8 3.6 8.7 8.7 0 1 0 20.4 14.2Z"/></svg></span>`;
}
function syncThemeControl() {
  let button = document.querySelector("#themeToggle");
  if (!button) return;
  let dark = document.documentElement.dataset.theme === "dark";
  button.setAttribute("aria-checked", String(dark));
  button.setAttribute(
    "aria-label",
    dark ? "Увімкнути світлу тему" : "Увімкнути темну тему",
  );
  button.title = dark ? "Світла тема" : "Темна тема";
}
function setCafeTheme(mode, animate = true, notifyNative = true) {
  if (!["light", "dark"].includes(mode)) return;
  let root = document.documentElement,
    changed = root.dataset.theme !== mode;
  clearTimeout(themeChangeTimer);
  if (
    changed &&
    animate &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    root.classList.add("theme-changing");
    void root.offsetWidth;
  }
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  try {
    localStorage.setItem("minicafe-theme", mode);
  } catch (e) {}
  let meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = mode === "dark" ? "#142d25" : "#173f35";
  syncThemeControl();
  themeChangeTimer = setTimeout(
    () => root.classList.remove("theme-changing"),
    150,
  );
  if (window.CafeNative && notifyNative)
    location.href = "minicafe://theme?mode=" + mode;
}
function toggleCafeTheme() {
  setCafeTheme(
    document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  );
}
