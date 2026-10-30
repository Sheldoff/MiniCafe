// Online-only integration. Local Android sources retain their own server controls.
document.title = "МініКафе онлайн";
const originalCloudRender = render;
render = function () {
  if (["staff", "menu-transfer"].includes(view)) {
    if (window.CafeCloud.role !== "admin") {
      view = "server";
      originalCloudRender();
      return;
    }
    updateDrawer();
    if (view === "staff") cloudStaff();
    else cloudTransferPage();
    revealPage();
  } else originalCloudRender();
};
async function cloudStaffDelete(button) {
  if (!confirm("Видалити працівника та відкликати його доступ?")) return;
  try {
    await cloudStaffWrite({
      ...(button.dataset.phone
        ? { phone: button.dataset.phone }
        : { telegram_id: button.dataset.id }),
      role: button.dataset.role,
      enabled: false,
      action: "delete",
    });
    if (view === "staff") await cloudStaff();
    toast("Працівника видалено");
  } catch (e) {
    toast(e.message);
  }
}
function cloudTransferPage() {
  document.querySelector("#main").innerHTML =
    `<section class="panel cloud-staff-page"><button onclick="change('server')">← Сервер</button><h2>Меню телефона ↔ сайт</h2><p class="muted">Меню замінюється повністю разом із фото, цінами та залишками. Замовлення, статистика й доступи не переносяться.</p><div class="cloud-server-actions"><button onclick="cloudTransferCode('upload')">Телефон → сайт</button><button onclick="cloudTransferCode('download')">Сайт → телефон</button></div><div id="transferCode" aria-live="polite"></div></section>`;
}
let cloudTransferBusy = false;
async function cloudTransferCode(direction) {
  if (cloudTransferBusy) return;
  if (
    !confirm(
      direction === "upload"
        ? "Дозволити заміну меню сайту меню телефона?"
        : "Дозволити завантаження меню сайту на телефон?",
    )
  )
    return;
  cloudTransferBusy = true;
  try {
    const r = await fetch("/api/menu-transfer", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ direction, confirm: true }),
    });
    const j = await r.json();
    if (!r.ok) throw Error(j.error);
    const box = document.querySelector("#transferCode");
    if (!box) return;
    if (view !== "menu-transfer" || !box.isConnected) return;
    box.innerHTML = `<h3>${direction === "upload" ? "Телефон → сайт" : "Сайт → телефон"}</h3><p>Код одноразовий, діє 5 хвилин. На телефоні відкрийте Сервер → Меню телефона ↔ сайт, виберіть цей самий напрямок, вставте код і підтвердьте заміну.</p><textarea class="transfer-code" readonly aria-label="Код перенесення">${esc(j.code)}</textarea><button onclick="copyMenuTransferCode()">Скопіювати код</button><p class="muted">Новий код скасовує попередній. Код дає доступ лише до меню в обраному напрямку — передавайте його тільки на свій телефон.</p>`;
    appear(box, 180, false);
  } catch (e) {
    toast(e.message);
  } finally {
    cloudTransferBusy = false;
  }
}
async function copyMenuTransferCode() {
  const field = document.querySelector(".transfer-code");
  try {
    await navigator.clipboard.writeText(field.value);
    toast("Код скопійовано");
  } catch {
    field.select();
    toast("Скопіюйте виділений код");
  }
}
const originalCloudFetch = window.fetch.bind(window);
window.fetch = async function (input, options) {
  const response = await originalCloudFetch(input, options);
  const url = new URL(
    typeof input === "string" ? input : input.url,
    location.origin,
  );
  if (
    url.origin === location.origin &&
    url.pathname.startsWith("/api/") &&
    response.status === 401
  )
    location.replace("/");
  return response;
};
async function cloudLogout() {
  const r = await fetch("/auth/logout", { method: "POST", headers: auth });
  if (r.ok) location.replace("/");
  else toast("Оновіть сторінку та повторіть вихід");
}
async function cloudStaffWrite(data) {
  const r = await fetch("/api/staff", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error);
}
async function cloudStaffRevoke(button) {
  if (!confirm("Відкликати доступ цього працівника?")) return;
  button.disabled = true;
  try {
    await cloudStaffWrite({
      ...(button.dataset.phone
        ? { phone: button.dataset.phone }
        : { telegram_id: button.dataset.id }),
      role: button.dataset.role,
      enabled: false,
    });
    if (view === "staff") await cloudStaff();
  } catch (e) {
    toast(e.message);
    button.disabled = false;
  }
}
async function cloudBackup() {
  try {
    const r = await fetch("/api/backup", {
      headers: auth,
      credentials: "same-origin",
    });
    if (!r.ok)
      throw Error("Не вдалося завантажити копію. Перевірте з’єднання та вхід.");
    const url = URL.createObjectURL(await r.blob()),
      a = document.createElement("a");
    a.href = url;
    a.download = "MiniCafe-backup.json";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    toast(e.message);
  }
}
async function cloudRestore() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 80000000) {
      toast("Копія має бути до 80 МБ");
      return;
    }
    if (
      !confirm(
        "Замінити меню, замовлення та статистику резервною копією? Спочатку збережіть поточну копію.",
      )
    )
      return;
    try {
      const payload = JSON.parse(await file.text());
      await prepareCloudBackup(payload);
      await post("restore", payload);
      toast("Дані відновлено");
    } catch (e) {
      toast(e.message);
    }
  };
  input.click();
}
async function prepareCloudBackup(payload) {
  if (!Array.isArray(payload.products) || payload.products.length > 2000)
    throw Error("Некоректне меню в копії");
  for (const product of payload.products) {
    if (typeof product.image !== "string" || product.image.length <= 600000)
      continue;
    toast("Оптимізація фото в копії…");
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(Error("Фото в копії пошкоджене"));
      i.src = "data:image/jpeg;base64," + product.image;
    });
    const scale = Math.min(1, 480 / img.naturalWidth, 480 / img.naturalHeight),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = canvas.getContext("2d");
    c.fillStyle = "white";
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
    product.image = canvas.toDataURL("image/jpeg", 0.78).split(",")[1];
  }
  if (new Blob([JSON.stringify(payload)]).size > 8000000)
    throw Error(
      "Копія завелика для онлайн-сервера: до 8 МБ після оптимізації фото",
    );
}
function cloudScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(Error("Не вдалося завантажити PDF-модуль"));
    document.head.append(s);
  });
}
let cloudPdfReady;
exportStatistics = async function () {
  if (!statsCurrent) return;
  try {
    toast("Підготовка PDF…");
    cloudPdfReady ||= Promise.all([
      cloudScript("/vendor/pdf-lib.js"),
      cloudScript("/vendor/fontkit.js"),
    ]).catch((e) => {
      cloudPdfReady = null;
      throw e;
    });
    await cloudPdfReady;
    const pdf = await PDFLib.PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(
      await (await fetch("/vendor/font.ttf")).arrayBuffer(),
      { subset: true },
    );
    const root = document.createElement("div");
    root.innerHTML = reportMarkup(statsCurrent);
    root
      .querySelectorAll("button,.report-explanation")
      .forEach((e) => e.remove());
    const lines = [
      ...root.querySelectorAll(
        "h2,h3,.metric,.balance-values>div,.report-times p,tr,.report-note",
      ),
    ]
      .filter(
        (e) =>
          !e.closest(".balance-metric") || e.matches(".balance-values>div"),
      )
      .map((e) =>
        (
          [...e.children].map((c) => c.textContent).join(" · ") ||
          e.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean);
    let page = pdf.addPage([595, 842]),
      y = 802;
    for (const line of lines) {
      let current = "";
      for (const word of line.split(" ")) {
        if (current && font.widthOfTextAtSize(current + " " + word, 11) > 510) {
          if (y < 40) {
            page = pdf.addPage([595, 842]);
            y = 802;
          }
          page.drawText(current, { x: 40, y, size: 11, font });
          y -= 17;
          current = word;
        } else current += (current ? " " : "") + word;
      }
      if (y < 40) {
        page = pdf.addPage([595, 842]);
        y = 802;
      }
      page.drawText(current, { x: 40, y, size: 11, font });
      y -= 22;
    }
    const url = URL.createObjectURL(
      new Blob([await pdf.save()], { type: "application/pdf" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "MiniCafe-report.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    toast(e.message);
  }
};
