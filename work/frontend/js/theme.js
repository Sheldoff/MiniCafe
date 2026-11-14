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
  if (meta && root.dataset.palette === "coffee") meta.content = "#4b3022";
  if (meta && root.dataset.palette === "mono")
    meta.content = mode === "dark" ? "#111111" : "#202020";
  syncThemeControl();
  applyLocationTheme();
  clearThemeColorMotion();
  themeChangeTimer = setTimeout(
    () => root.classList.remove("theme-changing"),
    150,
  );
  if (window.CafeNative && notifyNative)
    location.href =
      "minicafe://theme?mode=" +
      mode +
      "&palette=" +
      (root.dataset.palette || "standard");
}
function toggleCafeTheme() {
  setCafeTheme(
    document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  );
}

function setCafePalette(palette, notifyNative = true) {
  if (!["standard", "coffee", "mono"].includes(palette)) return;
  const root = document.documentElement;
  if (palette !== "standard") root.dataset.palette = palette;
  else delete root.dataset.palette;
  try {
    localStorage.setItem("minicafe-palette", palette);
    localStorage.setItem("minicafe-coffee-default-v2", "1");
  } catch (e) {}
  setCafeTheme(root.dataset.theme || "light", false, false);
  if (view === "appearance") appearancePage();
  if ((window.CafeNative || window.CafeAndroidOnline) && notifyNative)
    location.href =
      "minicafe://theme?mode=" + root.dataset.theme + "&palette=" + palette;
}

function appearancePage() {
  const palette = document.documentElement.dataset.palette || "standard";
  document.querySelector("#main").innerHTML =
    `<section class="panel settings-panel"><h2>Оформлення</h2><p class="muted">Виберіть кольори для цього пристрою. Власні кольори локацій зберігаються.</p><div class="appearance-options">${[
      ["standard", "Класична", ["#173f35", "#b3d9a4", "#f5f4ef"]],
      ["coffee", "Кавова · типова", ["#78563f", "#f3e6ca", "#211914"]],
      ["mono", "Чорно-біла", ["#111111", "#ffffff", "#b5b5b5"]],
    ]
      .map(
        ([id, name, colors]) =>
          `<button type="button" class="${palette === id ? "selected" : ""}" aria-pressed="${palette === id}" onclick="setCafePalette('${id}')"><span class="appearance-swatches" aria-hidden="true">${colors.map((c) => `<i style="background:${c}"></i>`).join("")}</span><b>${name}</b>${palette === id ? " ✓" : ""}</button>`,
      )
      .join(
        "",
      )}</div><button type="button" onclick="toggleCafeTheme();appearancePage()">${document.documentElement.dataset.theme === "dark" ? "Увімкнути світлий вигляд" : "Увімкнути темний вигляд"}</button></section>`;
}

function clearThemeColorMotion() {
  for (const animation of document.getAnimations()) {
    if (
      animation.effect
        ?.getKeyframes()
        .some((frame) =>
          Object.keys(frame).some((key) =>
            /color|background|shadow/i.test(key),
          ),
        )
    )
      animation.cancel();
  }
  document.querySelectorAll(".tile-feedback").forEach((overlay) => {
    overlay.feedbackAnimation?.cancel();
    overlay.style.opacity = "0";
  });
}
