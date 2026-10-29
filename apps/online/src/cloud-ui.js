// Online-only integration. Local Android sources retain their own server controls.
document.title = "МініКафе онлайн";
const cloudStyle = document.createElement("style");
cloudStyle.textContent =
  ".cloud-test-note{padding:7px 16px;background:var(--surface,#fff3d6);color:var(--text,#263e35);font-size:12px;text-align:center;border-bottom:1px solid var(--border,#ddd)}.cloud-server-actions{display:grid;gap:12px;margin-top:16px}.cloud-server-actions button{min-height:48px}";
document.head.append(cloudStyle);
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
cloudStyle.textContent += `.cloud-logout{background:var(--danger-bg,#fbe8e3);color:var(--danger,#983b2c);border-color:var(--danger,#983b2c)}.cloud-logout:hover{filter:brightness(.94)}.cloud-staff-page{max-width:920px;margin:16px auto}.cloud-staff-page form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:18px;background:var(--raised,#f2f5ee);border-radius:16px;margin:20px 0}.cloud-staff-page label{min-width:0;display:grid;gap:7px}.cloud-staff-page input,.cloud-staff-page select{width:100%;min-width:0}.cloud-staff-page .row{padding:14px 0;border-top:1px solid var(--border,#d6dfd4);flex-wrap:wrap}.staff-actions{display:flex;gap:8px;flex-wrap:wrap}.staff-actions button{min-height:44px}.transfer-code{width:100%;font:14px monospace;word-break:break-all}.cloud-staff-page .grow{overflow-wrap:anywhere}@media(max-width:540px){.cloud-staff-page form{grid-template-columns:1fr;padding:14px}.staff-actions{width:100%}.staff-actions button{flex:1}}`;

function cloudStaffEdit(button) {
  const form = document.querySelector("#staffForm");
  form.elements.kind.value = button.dataset.phone ? "phone" : "id";
  form.elements.identifier.value = button.dataset.phone || button.dataset.id;
  form.elements.kind.disabled = true;
  form.elements.identifier.readOnly = true;
  form.elements.role.value = button.dataset.role;
  // Disabled controls are omitted by FormData, so retain the selected type.
  form.dataset.editKind = form.elements.kind.value;
  form.querySelector("button").textContent = "Зберегти зміни";
  form.scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion:reduce)").matches
      ? "auto"
      : "smooth",
    block: "start",
  });
}
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
serverPage = function () {
  document.querySelector("#main").innerHTML =
    `<section class="panel developer-panel"><h2>МініКафе онлайн</h2><p>${esc(location.origin)}</p><p class="muted">${esc(window.CafeCloud.name || "Працівник")} · ${window.CafeCloud.role === "admin" ? "Адміністратор" : "Доступ працівника"}</p><div class="cloud-server-actions">${window.CafeCloud.role === "admin" ? '<button class="primary" onclick="cloudStaff()">Доступи працівників</button><button onclick="change(\'menu-transfer\')">Меню телефона ↔ сайт</button>' : ""}<button onclick="navigator.clipboard.writeText(location.origin).then(()=>toast('Посилання скопійовано')).catch(()=>toast('Скопіюйте адресу з браузера'))">Скопіювати гостьове посилання</button>${window.CafeCloud.role === "admin" ? '<button onclick="cloudBackup()">Зберегти резервну копію</button><button onclick="cloudRestore()">Відновити резервну копію</button>' : ""}<button onclick="refreshInPlace()">Оновити дані</button><button class="cloud-logout" onclick="cloudLogout()">Вийти з акаунта</button></div><div id="cloudStaff"></div><p class="muted">Гостьове меню тимчасово закрите: «Меню формується». Зміни між пристроями оновлюються приблизно кожні 15 секунд.</p></section>`;
};
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
async function cloudStaff() {
  if (view !== "staff") {
    change("staff");
    return;
  }
  document.querySelector("#main").innerHTML =
    `<section class="panel cloud-staff-page"><button onclick="change('server')">← Сервер</button><div id="cloudStaff" aria-live="polite"></div></section>`;
  const box = document.querySelector("#cloudStaff");
  if (!box) return;
  try {
    const r = await fetch("/api/staff"),
      j = await r.json();
    if (!r.ok) throw Error(j.error);
    if (view !== "staff" || !box.isConnected) return;
    box.innerHTML = `<h3>Доступи працівників</h3><p class="muted">Номер у міжнародному форматі, наприклад +380…, або Telegram ID. Працівник має підтвердити номер через Telegram. Після зміни прав потрібно ввійти знову.</p><form id="staffForm"><label>Надати доступ за<select name="kind"><option value="phone">Номером телефону</option><option value="id">Telegram ID</option></select></label><label>Номер телефону або ID<input name="identifier" inputmode="tel" autocomplete="off" required maxlength="40" placeholder="+380…"></label><label>Роль<select name="role"><option value="service">Каса та обидві видачі</option><option value="cash">Тільки каса</option><option value="bar">Тільки бариста</option><option value="delivery">Тільки видача їжі</option></select></label><button class="primary">Надати доступ</button><button type="button" onclick="cloudStaff()">Новий працівник</button></form><div>${j.staff.map((s) => `<div class="row" style="margin-top:12px"><span class="grow">${esc(s.phone || s.telegram_id)} · ${esc({ service: "Каса та видачі", cash: "Каса", bar: "Бариста", delivery: "Видача їжі" }[s.role])}${s.enabled ? "" : " · вимкнено"}</span><span class="staff-actions"><button data-id="${esc(s.telegram_id || "")}" data-phone="${esc(s.phone || "")}" data-role="${esc(s.role)}"  onclick="cloudStaffEdit(this)">Змінити</button><button data-id="${esc(s.telegram_id || "")}" data-phone="${esc(s.phone || "")}" data-role="${esc(s.role)}" onclick="cloudStaffRevoke(this)" ${s.enabled ? "" : "disabled"}>Відкликати</button><button class="danger" data-id="${esc(s.telegram_id || "")}" data-phone="${esc(s.phone || "")}" data-role="${esc(s.role)}"  onclick="cloudStaffDelete(this)">Видалити</button></span></div>`).join("")}</div>`;
    box.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const form = new FormData(e.target),
        button = e.target.querySelector("button");
      button.disabled = true;
      try {
        await cloudStaffWrite({
          ...((e.target.dataset.editKind || form.get("kind")) === "phone"
            ? { phone: form.get("identifier") }
            : { telegram_id: form.get("identifier") }),
          role: form.get("role"),
          enabled: true,
        });
        if (view === "staff") await cloudStaff();
        toast("Доступ надано");
      } catch (error) {
        toast(error.message);
        button.disabled = false;
      }
    };
  } catch (e) {
    toast(e.message);
  }
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
  const a = document.createElement("a");
  a.href = "/api/backup";
  a.download = "MiniCafe-cloud-backup.json";
  a.click();
}
async function cloudRestore() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 8000000) {
      toast("Копія має бути до 8 МБ");
      return;
    }
    if (
      !confirm(
        "Замінити всі спільні тестові дані резервною копією? Спочатку збережіть поточну копію.",
      )
    )
      return;
    try {
      const payload = JSON.parse(await file.text());
      await post("restore", payload);
      toast("Дані відновлено");
    } catch (e) {
      toast(e.message);
    }
  };
  input.click();
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
