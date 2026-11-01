const cloudBaseServerPage = serverPage;
serverPage = function () {
  cloudBaseServerPage();
  if (window.CafeCloud.role !== "admin") return;
  const actions = document.querySelector(".cloud-server-actions"),
    b = document.createElement("button");
  b.id = "publicMenuToggle";
  b.textContent = "Гостьове меню…";
  b.disabled = true;
  actions.insertBefore(b, actions.querySelector(".cloud-logout"));
  const set = (enabled) => {
    b.dataset.enabled = String(!!enabled);
    b.textContent = enabled
      ? "Гостьове меню: відкрите"
      : "Гостьове меню: закрите";
    b.setAttribute("aria-pressed", String(!!enabled));
    b.disabled = false;
  };
  fetch("/api/public-settings")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((j) => {
      if (b.isConnected) set(j.enabled);
    })
    .catch(() => {
      b.textContent = "Гостьове меню недоступне";
    });
  b.onclick = async () => {
    const enabled = b.dataset.enabled !== "true";
    if (
      !confirm(
        enabled
          ? "Відкрити гостьове меню?"
          : "Закрити гостьове меню та створення нових кодів?",
      )
    )
      return;
    b.disabled = true;
    try {
      const r = await fetch("/api/public-settings", {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error);
      if (b.isConnected) set(j.enabled);
    } catch (e) {
      toast(e.message);
      b.disabled = false;
    }
  };
};
if (view === "menu") menu();

if (view === "cash" && document.querySelector("#categories")) drawCategories();

if (view === "server") serverPage();
