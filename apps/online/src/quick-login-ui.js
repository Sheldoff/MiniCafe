/* Authentication polling is a one-use protocol; never repeat the start write. */
(() => {
  const root = document.querySelector("#quickLogin"),
    status = document.querySelector("#quickStatus"),
    refresh = document.querySelector("#refreshLoginQr"),
    link = document.querySelector("#openLoginBot");
  let timer,
    expires = 0,
    stopped = false,
    polling = false;
  const suffix =
    new URLSearchParams(location.search).get("return") === "menu-transfer"
      ? "?return=menu-transfer"
      : "";
  document.querySelector("#manualLogin").href += suffix;
  refresh.onclick = () => location.reload();
  const stop = (message) => {
    stopped = true;
    clearTimeout(timer);
    status.textContent = message;
    refresh.hidden = false;
    link.hidden = true;
    document.querySelector("#loginQr").hidden = true;
    document.querySelector("#matchLabel").hidden = true;
  };
  async function request(path) {
    const response = await fetch(path + suffix, {
      method: "POST",
      headers: { "X-CSRF-Token": root.dataset.csrf },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.json();
    if (!response.ok) throw Error(body.error || "Не вдалося перевірити вхід");
    return body;
  }
  async function poll() {
    if (stopped || polling || !expires) return;
    if (Date.now() >= expires) {
      stop("Час входу минув. Створіть новий QR-код.");
      return;
    }
    if (document.hidden) {
      timer = setTimeout(poll, 2000);
      return;
    }
    polling = true;
    try {
      const result = await request("/auth/quick/poll");
      if (stopped) return;
      if (result.redirect) {
        stopped = true;
        status.textContent = "Вхід підтверджено. Відкриваємо МініКафе…";
        location.assign(result.redirect);
      } else timer = setTimeout(poll, 2000);
    } catch (e) {
      stop(e.message || "З’єднання втрачено. Почніть вхід заново.");
    } finally {
      polling = false;
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !stopped) {
      clearTimeout(timer);
      poll();
    }
  });
  window.addEventListener("pagehide", () => {
    stopped = true;
    clearTimeout(timer);
  });
  request("/auth/quick/start")
    .then((result) => {
      document.querySelector("#loginQr").innerHTML = result.qr;
      document.querySelector("#loginMatch").textContent = result.match;
      document.querySelector("#matchLabel").hidden = false;
      link.href = result.link;
      link.hidden = false;
      expires = Date.now() + result.expires_in * 1000;
      status.textContent =
        "Очікуємо підтвердження в Telegram. Ця сторінка відкриється автоматично.";
      timer = setTimeout(poll, 2000);
    })
    .catch((e) =>
      stop(e.message || "Не вдалося створити запит. Почніть заново."),
    );
})();
