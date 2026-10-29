// Online-only integration. Local Android sources retain their own server controls.
document.title = "МініКафе онлайн";
const cloudStyle = document.createElement("style");
cloudStyle.textContent =
  ".cloud-test-note{padding:7px 16px;background:var(--surface,#fff3d6);color:var(--text,#263e35);font-size:12px;text-align:center;border-bottom:1px solid var(--border,#ddd)}.cloud-server-actions{display:grid;gap:12px;margin-top:16px}.cloud-server-actions button{min-height:48px}";
document.head.append(cloudStyle);
const cloudNote = document.createElement("div");
cloudNote.className = "cloud-test-note";
cloudNote.textContent =
  "Ви увійшли через Telegram · " + (window.CafeCloud.name || "Працівник");
document.querySelector("header").after(cloudNote);
serverPage = function () {
  document.querySelector("#main").innerHTML =
    `<section class="panel developer-panel"><h2>МініКафе онлайн</h2><p>${esc(location.origin)}</p><p class="muted">${esc(window.CafeCloud.name || "Працівник")} · ${window.CafeCloud.role === "admin" ? "Адміністратор" : "Доступ працівника"}</p><div class="cloud-server-actions"><button onclick="navigator.clipboard.writeText(location.origin).then(()=>toast('Посилання скопійовано')).catch(()=>toast('Скопіюйте адресу з браузера'))">Скопіювати гостьове посилання</button>${window.CafeCloud.role === "admin" ? '<button onclick="cloudBackup()">Зберегти резервну копію</button><button onclick="cloudRestore()">Відновити резервну копію</button><button onclick="cloudStaff()">Доступи працівників</button>' : ""}<button onclick="refreshInPlace()">Оновити дані</button><button onclick="cloudLogout()">Вийти з акаунта</button></div><div id="cloudStaff"></div><p class="muted">Гостьове меню тимчасово закрите: «Меню формується». Зміни між пристроями оновлюються приблизно кожні 15 секунд.</p></section>`;
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
  const box = document.querySelector("#cloudStaff");
  if (!box) return;
  try {
    const r = await fetch("/api/staff"),
      j = await r.json();
    if (!r.ok) throw Error(j.error);
    box.innerHTML = `<h3>Доступи працівників</h3><p class="muted">Вкажіть Telegram ID. Після зміни прав працівник має ввійти знову.</p><form id="staffForm"><label>Telegram ID<input name="telegram_id" inputmode="numeric" pattern="[0-9]{1,20}" required maxlength="20"></label><label>Роль<select name="role"><option value="service">Каса та обидві видачі</option><option value="cash">Тільки каса</option><option value="bar">Тільки бариста</option><option value="delivery">Тільки видача їжі</option></select></label><button class="primary">Надати доступ</button></form><div>${j.staff.map((s) => `<div class="row" style="margin-top:12px"><span class="grow">${esc(s.telegram_id)} · ${esc({ service: "Каса та видачі", cash: "Каса", bar: "Бариста", delivery: "Видача їжі" }[s.role])}${s.enabled ? "" : " · вимкнено"}</span><button data-id="${esc(s.telegram_id)}" data-role="${esc(s.role)}" onclick="cloudStaffRevoke(this)" ${s.enabled ? "" : "disabled"}>Відкликати</button></div>`).join("")}</div>`;
    box.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const form = new FormData(e.target),
        button = e.target.querySelector("button");
      button.disabled = true;
      try {
        await cloudStaffWrite({
          telegram_id: form.get("telegram_id"),
          role: form.get("role"),
          enabled: true,
        });
        await cloudStaff();
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
      telegram_id: button.dataset.id,
      role: button.dataset.role,
      enabled: false,
    });
    await cloudStaff();
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
