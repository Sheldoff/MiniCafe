// Online-only integration. Local Android sources retain their own server controls.
document.title = "МініКафе онлайн · тест";
const cloudStyle = document.createElement("style");
cloudStyle.textContent =
  ".cloud-test-note{padding:7px 16px;background:var(--surface,#fff3d6);color:var(--text,#263e35);font-size:12px;text-align:center;border-bottom:1px solid var(--border,#ddd)}.cloud-server-actions{display:grid;gap:12px;margin-top:16px}.cloud-server-actions button{min-height:48px}";
document.head.append(cloudStyle);
const cloudNote = document.createElement("div");
cloudNote.className = "cloud-test-note";
cloudNote.textContent =
  "Відкрита тестова версія · спільні дані для всіх · не вводьте приватну інформацію";
document.querySelector("header").after(cloudNote);
serverPage = function () {
  document.querySelector("#main").innerHTML =
    `<section class="panel developer-panel"><h2>МініКафе онлайн</h2><p>${esc(location.origin)}</p><p class="muted">Cloudflare Workers + D1. Телефон-сервер та Termux не потрібні. Telegram-вхід ще не доданий: усі користувачі мають тестовий повний доступ.</p><div class="cloud-server-actions"><button onclick="navigator.clipboard.writeText(location.origin).then(()=>toast('Посилання скопійовано')).catch(()=>toast('Скопіюйте адресу з браузера'))">Скопіювати посилання</button><button onclick="cloudBackup()">Зберегти резервну копію</button><button onclick="cloudRestore()">Відновити резервну копію</button><button onclick="refreshInPlace()">Оновити дані</button></div><p class="muted">Оновлення з інших пристроїв — приблизно кожні 15 секунд у відкритій вкладці. Локальна база Android не синхронізується автоматично.</p></section>`;
};
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
