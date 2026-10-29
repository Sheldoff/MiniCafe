let stateETag = "",
  pollFailures = 0,
  pollTimer = null;
async function post(path, d) {
  let r = await fetch("/api/" + path, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(d),
  });
  let j = await r.json();
  if (!r.ok) {
    let e = Error(j.error);
    e.missing = j.missing;
    throw e;
  }
  await refresh(true);
  return j;
}

function connectionNotice(title, message) {
  let box = document.querySelector("#browserNotice");
  document.querySelector("#browserNoticeTitle").textContent = title;
  document.querySelector("#browserNoticeText").textContent = message;
  if (!hasServerState) document.querySelector("#main").hidden = true;
  setNoticeVisible(true);
}

function setNoticeVisible(open) {
  let box = document.querySelector("#browserNotice");
  if (open === (!box.hidden && box.dataset.noticeClosing !== "true")) return;
  box.dataset.noticeClosing = String(!open);
  disclosure(box, open, 140);
}

let refreshFlight = null,
  refreshQueued = false;
function refresh(afterWrite = false) {
  if (refreshFlight) {
    if (afterWrite) refreshQueued = true;
    return refreshFlight;
  }
  refreshFlight = (async () => {
    let result;
    do {
      refreshQueued = false;
      result = await fetchState();
    } while (refreshQueued);
    return result;
  })().finally(() => {
    refreshFlight = null;
  });
  return refreshFlight;
}

let manualRefreshPending = false,
  manualRefreshUntil = 0,
  manualRefreshTimer = null;
function syncRefreshIndicator() {
  let brand = document.querySelector("#drawerRefresh");
  brand?.classList.toggle("refresh-pending", manualRefreshPending);
  brand?.setAttribute("aria-busy", String(manualRefreshPending));
}
function finishManualRefresh() {
  clearTimeout(manualRefreshTimer);
  if (
    !manualRefreshPending ||
    document.querySelector("#connection").classList.contains("status-offline")
  )
    return;
  let remaining = manualRefreshUntil - performance.now();
  if (remaining > 0) {
    manualRefreshTimer = setTimeout(finishManualRefresh, remaining);
    return;
  }
  manualRefreshPending = false;
  syncRefreshIndicator();
}

async function fetchState() {
  if (!token) {
    document
      .querySelector("#connection")
      .classList.remove("connection-pending");
    document.querySelector("#connection").textContent = "● Потрібен ключ";
    connectionNotice(
      "Посилання без ключа доступу",
      "Ви відкрили лише адресу тунелю. На головному телефоні в МініКафе відкрийте «Інтернет-доступ через Termux», перевірте адресу й натисніть «Скопіювати інтернет-посилання». Відкрийте повне посилання з ?key=… або відскануйте створений QR.",
    );
    return false;
  }
  let serial = ++refreshSerial;
  refreshing++;
  if (
    !hasServerState ||
    document.querySelector("#connection").classList.contains("status-offline")
  )
    document.querySelector("#connection").classList.add("connection-pending");
  let controller =
      typeof AbortController === "function" ? new AbortController() : null,
    timer;
  try {
    let timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(
          Error(
            "Сервер не відповів за 12 секунд. Перевірте, що сервер МініКафе й тунель Termux працюють, та повторіть підключення.",
          ),
        );
      }, 12000);
    });
    let { r, next } = await Promise.race([
      (async () => {
        let r = await fetch("/api/state", {
          headers: stateETag ? { ...auth, "If-None-Match": stateETag } : auth,
          cache: "no-store",
          signal: controller?.signal,
        });
        if (r.status === 304) return { r };
        if (r.status === 401 || r.status === 403)
          throw Error(
            "Ключ доступу неправильний. Скопіюйте повне посилання з головного телефона, на якому працює цей тунель.",
          );
        if (!r.ok)
          throw Error(
            "Сервер або тунель недоступний (HTTP " +
              r.status +
              "). Перевірте головний телефон і поточну адресу Termux.",
          );
        try {
          return { r, next: await r.json() };
        } catch (e) {
          if (e.name === "AbortError") throw e;
          throw Error(
            "Замість даних меню отримано іншу сторінку. Перевірте поточне посилання тунелю та роботу сервера.",
          );
        }
      })(),
      timeout,
    ]);
    if (serial !== refreshSerial || refreshQueued) return false;
    if (r.status === 304) {
      hasServerState = true;
      clearTimeout(startupNoticeTimer);
      pollFailures = 0;
      setNoticeVisible(false);
      document.querySelector("#connection").textContent = "● Підключено";
      document
        .querySelector("#connection")
        .classList.remove("status-offline", "connection-pending");
      finishManualRefresh();
      return true;
    }
    if (!Array.isArray(next.products) || !Array.isArray(next.orders))
      throw Error(
        "Сервер повернув неправильний формат даних. Оновіть МініКафе на головному телефоні.",
      );
    if (serial !== refreshSerial) return false;
    let max = Math.max(0, ...next.orders.map((o) => o.id));
    if (sound && seen !== null && max > seen) {
      try {
        let a = new (window.AudioContext || window.webkitAudioContext)(),
          osc = a.createOscillator();
        osc.connect(a.destination);
        osc.frequency.value = 880;
        osc.start();
        osc.stop(a.currentTime + 0.2);
        osc.onended = () => a.close();
      } catch (e) {}
    }
    seen = max;
    let previous = data.versions,
      versions = next.versions,
      changed =
        !versions ||
        !previous ||
        Object.keys(versions).some((k) => versions[k] !== previous[k]),
      productsChanged =
        !versions || !previous || versions.products !== previous.products,
      ordersChanged =
        !versions || !previous || versions.orders !== previous.orders,
      expensesChanged =
        !versions || !previous || versions.expenses !== previous.expenses;
    stateETag = r.headers.get("ETag") || "";
    pollFailures = 0;
    data = next;
    if (!allowedView(view)) {
      view = roleView();
      location.hash = view;
      render();
    }
    updateDrawer();
    hasServerState = true;
    clearTimeout(startupNoticeTimer);
    document.querySelector("#main").hidden = false;
    if (view === "cash") moveCashIndicator();
    setNoticeVisible(false);
    document.querySelector("#connection").textContent = "● Підключено";
    document
      .querySelector("#connection")
      .classList.remove("status-offline", "connection-pending");
    if (
      !issuingOrder &&
      (((ordersChanged || productsChanged) &&
        ["bar", "delivery"].includes(view)) ||
        (changed && view === "history"))
    )
      orders();
    if (
      productsChanged &&
      view === "cash" &&
      document.querySelector("#tiles")
    ) {
      drawCategories();
      tiles("");
    }
    if (
      productsChanged &&
      view === "menu" &&
      document.querySelector("#editorProducts")
    )
      filterEditorProducts(document.querySelector("#productSearch").value);
    if (
      (productsChanged || expensesChanged) &&
      view === "calculator" &&
      document.querySelector("#calcRows")
    )
      calculatorUpdate();
    revealPage();
    finishManualRefresh();
    return true;
  } catch (e) {
    if (serial !== refreshSerial) return false;
    pollFailures++;
    document.querySelector("#connection").textContent = "● Немає зв’язку";
    document
      .querySelector("#connection")
      .classList.remove("connection-pending");
    document.querySelector("#connection").classList.add("status-offline");
    connectionNotice(
      "Не вдалося завантажити меню",
      e.name === "AbortError"
        ? "Сервер не відповідає. Перевірте МініКафе й Termux на головному телефоні."
        : e.message === "Failed to fetch"
          ? "Не вдалося зв’язатися із сервером. Перевірте інтернет і поточну адресу тунелю."
          : e.message,
    );
    return false;
  } finally {
    clearTimeout(timer);
    refreshing--;
  }
}

async function refreshInPlace() {
  manualRefreshPending = true;
  manualRefreshUntil = performance.now() + 400;
  syncRefreshIndicator();
  let ok = await refresh(true);
  if (ok && view === "menu" && document.querySelector("#editorProducts"))
    filterEditorProducts(document.querySelector("#productSearch").value);
  if (ok) finishManualRefresh();
  else {
    manualRefreshPending = true;
    syncRefreshIndicator();
    scheduleRefresh(true);
  }
}

function scheduleRefresh(immediate = false) {
  clearTimeout(pollTimer);
  if (document.visibilityState === "hidden") return;
  let delay = immediate
    ? 0
    : Math.min(30000, 2000 * 2 ** Math.min(pollFailures, 4));
  pollTimer = setTimeout(async () => {
    if (!refreshing) await refresh();
    scheduleRefresh();
  }, delay);
}
