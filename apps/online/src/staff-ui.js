const cloudRoleNames = {
  admin: "Адміністратор",
  service: "Каса та обидві видачі",
  cash: "Каса",
  bar: "Бариста",
  delivery: "Видача їжі",
};
serverPage = function () {
  const person = window.CafeCloud.username
    ? "@" + window.CafeCloud.username
    : window.CafeCloud.name || "Працівник";
  document.querySelector("#main").innerHTML =
    `<section class="panel cloud-server-panel"><h2>${esc(person)}</h2><span class="staff-role">${esc(cloudRoleNames[window.CafeCloud.role] || "Працівник")}</span><p class="muted">${esc(location.host)}</p><div class="cloud-server-actions">${window.CafeCloud.role === "admin" ? '<button class="primary" onclick="cloudStaff()">Доступи працівників</button><button onclick="cloudBackup()">Зберегти резервну копію</button><button onclick="cloudRestore()">Відновити резервну копію</button>' : ""}<button class="cloud-logout" onclick="cloudLogout()">Вийти з акаунта</button></div></section>`;
  if (!window.CafeCloud.username) {
    const heading = document.querySelector(".cloud-server-panel h2");
    fetch("/api/me")
      .then((r) => r.json())
      .then((j) => {
        if (view === "server" && heading.isConnected && j.user?.username) {
          window.CafeCloud.username = j.user.username;
          heading.textContent = "@" + j.user.username;
        }
      })
      .catch(() => {});
  }
};
const cloudRoleOptions = () =>
  ["service", "cash", "bar", "delivery"]
    .map(
      (r) =>
        `<option value="${r}">${r === "service" ? "Каса + видачі" : cloudRoleNames[r]}</option>`,
    )
    .join("");
let cloudRequestRows = [],
  cloudRequestTimer;
let cloudApplicationLink = "",
  cloudBotReady = false;
let cloudStaffSaving = false,
  cloudStaffSerial = 0;
function syncStaffBusy(root = document.querySelector("#cloudStaff")) {
  if (!root?.isConnected) return;
  const f = root.querySelector("#staffForm");
  if (f) {
    f.elements.kind.disabled = cloudStaffSaving || !!f.dataset.editKind;
    f.elements.identifier.readOnly = cloudStaffSaving || !!f.dataset.editKind;
    f.elements.role.disabled = cloudStaffSaving;
    f.querySelector(".primary").disabled = cloudStaffSaving;
    f.querySelector("[data-reset]").disabled = cloudStaffSaving;
  }
  root
    .querySelectorAll("#staffRows button")
    .forEach(
      (b) =>
        (b.disabled =
          cloudStaffSaving ||
          (b.getAttribute("onclick")?.includes("cloudStaffRevoke") &&
            b.dataset.enabled === "0")),
    );
}
let cloudRequestSerial = 0,
  cloudRequestSignature = "",
  cloudRequestRoot;
function cloudStaffKind() {
  const f = document.querySelector("#staffForm");
  if (!f) return;
  const phone = f.elements.kind.value === "phone";
  f.querySelector("[data-identifier-label]").textContent = phone
    ? "Телефон"
    : "Telegram ID";
  f.elements.identifier.placeholder = phone ? "+380…" : "123456789";
  f.elements.identifier.inputMode = phone ? "tel" : "numeric";
}
function cloudStaffEdit(button) {
  if (cloudStaffSaving) return;
  const f = document.querySelector("#staffForm");
  f.elements.kind.value = button.dataset.phone ? "phone" : "id";
  cloudStaffKind();
  f.elements.identifier.value = button.dataset.phone || button.dataset.id;
  f.elements.identifier.readOnly = true;
  f.elements.kind.disabled = true;
  f.elements.role.value = button.dataset.role;
  f.dataset.editKind = f.elements.kind.value;
  f.querySelector(".primary").textContent = "Зберегти";
  f.querySelector("[data-reset]").textContent = "Скасувати";
  f.scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion:reduce)").matches
      ? "auto"
      : "smooth",
    block: "center",
  });
}
function staffIdentity(s) {
  const label = s.username
    ? "@" + s.username
    : s.name || s.phone || "ID " + s.telegram_id;
  const secondary = [s.phone, s.telegram_id ? "ID " + s.telegram_id : ""]
    .filter((v) => v && v !== label)
    .join(" · ");
  return `<div class="staff-person"><b>${esc(label)}</b>${secondary !== label ? `<small>${esc(secondary)}</small>` : ""}</div>`;
}
async function cloudStaff() {
  if (view !== "staff") {
    change("staff");
    return;
  }
  clearTimeout(cloudRequestTimer);
  document.querySelector("#main").innerHTML =
    `<section class="cloud-staff-page" id="cloudStaff"><div class="staff-page-title"><h2>Доступи працівників</h2><button id="requestLink" onclick="copyApplicationLink()">Посилання на заявку</button></div><section class="staff-grant-card"><form id="staffForm" class="staff-grant-grid"><label>Тип<select name="kind" onchange="cloudStaffKind()"><option value="phone">Телефон</option><option value="id">Telegram ID</option></select></label><label><span data-identifier-label>Телефон</span><input name="identifier" placeholder="+380…" inputmode="tel" autocomplete="off" maxlength="40" required></label><label>Роль<select name="role">${cloudRoleOptions()}</select></label><div class="staff-form-actions"><button class="primary">Додати</button><button type="button" data-reset onclick="cloudStaffReset()">Очистити</button></div></form></section><section class="staff-list-panel"><h3>Працівники <span id="staffCount" class="staff-count"></span></h3><div id="staffRows" class="staff-list" aria-live="polite"></div></section><section id="requestPanel" class="staff-list-panel" hidden><h3>Заявки <span id="requestCount" class="staff-count"></span></h3><div id="requestRows" class="staff-list" aria-live="polite"></div></section></section>`;
  const root = document.querySelector("#cloudStaff");
  root.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    if (cloudStaffSaving) return;
    const f = e.target,
      values = new FormData(f),
      button = f.querySelector(".primary");
    cloudStaffSaving = true;
    syncStaffBusy(root);
    try {
      await cloudStaffWrite({
        ...((f.dataset.editKind || values.get("kind")) === "phone"
          ? { phone: values.get("identifier") }
          : { telegram_id: values.get("identifier") }),
        role: values.get("role"),
        enabled: true,
      });
      if (view === "staff" && root.isConnected) {
        cloudStaffReset();
        await loadCloudStaff(root);
      }
      toast("Доступ збережено");
    } catch (error) {
      toast(error.message);
    } finally {
      cloudStaffSaving = false;
      syncStaffBusy();
    }
  };
  syncStaffBusy(root);
  await Promise.all([loadCloudStaff(root), loadCloudRequests(root)]);
}
function cloudStaffReset() {
  const f = document.querySelector("#staffForm");
  if (!f) return;
  f.reset();
  f.elements.kind.disabled = false;
  f.elements.identifier.readOnly = false;
  delete f.dataset.editKind;
  f.querySelector(".primary").textContent = "Додати";
  f.querySelector("[data-reset]").textContent = "Очистити";
  cloudStaffKind();
}
async function loadCloudStaff(root = document.querySelector("#cloudStaff")) {
  const serial = ++cloudStaffSerial;
  try {
    const r = await fetch("/api/staff"),
      j = await r.json();
    if (!r.ok) throw Error(j.error);
    if (serial !== cloudStaffSerial || view !== "staff" || !root?.isConnected)
      return;
    root.querySelector("#staffCount").textContent = j.staff.length;
    root.querySelector("#staffRows").innerHTML = j.staff.length
      ? j.staff
          .map((s) => {
            const attrs = `data-id="${esc(s.telegram_id || "")}" data-phone="${esc(s.phone || "")}" data-role="${esc(s.role)}" data-enabled="${s.enabled ? "1" : "0"}"`;
            return `<article class="staff-entry row">${staffIdentity(s)}<span class="staff-role ${s.enabled ? "" : "is-off"}">${esc(cloudRoleNames[s.role])}${s.enabled ? "" : " · вимкнено"}</span><div class="staff-actions"><button ${attrs} onclick="cloudStaffEdit(this)">Змінити</button><button ${attrs} onclick="cloudStaffRevoke(this)" ${s.enabled ? "" : "disabled"}>Відкликати</button><button class="danger" ${attrs} onclick="cloudStaffDelete(this)">Видалити</button></div></article>`;
          })
          .join("")
      : '<p class="muted staff-empty">Працівників ще немає</p>';
    syncStaffBusy(root);
  } catch (e) {
    if (root?.isConnected) toast(e.message);
  }
}
async function loadCloudRequests(
  root = document.querySelector("#cloudStaff"),
  silent = false,
) {
  const serial = ++cloudRequestSerial;
  clearTimeout(cloudRequestTimer);
  if (view !== "staff" || document.hidden || !root?.isConnected) return;
  try {
    const r = await fetch("/api/staff-requests"),
      j = await r.json();
    if (!r.ok) throw Error(j.error);
    if (serial !== cloudRequestSerial || view !== "staff" || !root.isConnected)
      return;
    cloudRequestRows = j.requests;
    cloudApplicationLink = j.application_url || "";
    cloudBotReady = !!j.bot_ready;
    const signature = JSON.stringify(j.requests);
    if (cloudRequestRoot === root && cloudRequestSignature === signature)
      return;
    cloudRequestRoot = root;
    cloudRequestSignature = signature;
    root.querySelector("#requestPanel").hidden = !j.requests.length;
    root.querySelector("#requestCount").textContent = j.requests.length;
    root.querySelector("#requestRows").innerHTML = j.requests
      .map((q) => {
        const u = q.profile.user || {},
          name = [u.first_name, u.last_name].filter(Boolean).join(" ");
        return `<article class="staff-entry request-entry"><div class="staff-person"><b>${esc(name || u.username || q.telegram_id)}</b><small>${esc([u.username ? "@" + u.username : "", "ID " + q.telegram_id, q.phone].filter(Boolean).join(" · "))}</small></div><time>${esc(new Date(q.submitted * 1000).toLocaleString("uk-UA"))}</time><div class="staff-actions"><button data-request="${q.telegram_id}" onclick="requestDetails(this.dataset.request)">Докладніше</button><button class="primary" data-request="${q.telegram_id}" onclick="requestApprove(this.dataset.request)">Прийняти</button><button data-request="${q.telegram_id}" onclick="requestReject(this.dataset.request)">Відхилити</button></div></article>`;
      })
      .join("");
  } catch (e) {
    if (!silent && root.isConnected) toast(e.message);
  } finally {
    if (serial === cloudRequestSerial && view === "staff" && root.isConnected)
      cloudRequestTimer = setTimeout(
        () => loadCloudRequests(root, true),
        30000,
      );
  }
}
async function copyApplicationLink() {
  if (!cloudBotReady || !cloudApplicationLink)
    return toast("Бот ще налаштовується");
  try {
    await navigator.clipboard.writeText(cloudApplicationLink);
    toast("Посилання на заявку скопійовано");
  } catch (e) {
    const box = requestDialog(
      "Посилання на заявку",
      `<label>Скопіюйте посилання<input readonly value="${esc(cloudApplicationLink)}" onclick="this.select()"></label><div class="row"><button onclick="closeOrderDialog()">Закрити</button></div>`,
    );
    box.querySelector("input").select();
  }
}
function requestDialog(title, content) {
  closeOrderDialog(true);
  const box = document.createElement("div");
  box.id = "orderDialog";
  box.className = "order-dialog";
  box.innerHTML = `<section class="order-dialog-card request-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2>${content}</section>`;
  document.body.append(box);
  openOrderDialog(box);
  return box;
}
function requestDetails(id) {
  const q = cloudRequestRows.find((r) => r.telegram_id === id);
  if (!q) return;
  const u = q.profile.user || {},
    chat = q.profile.chat || {};
  const fields = [
    ["Telegram ID", q.telegram_id],
    ["Ім’я", u.first_name],
    ["Прізвище", u.last_name],
    ["Нік", u.username ? "@" + u.username : ""],
    ["Телефон", q.phone || "Не надано"],
    ["Мова", u.language_code],
    [
      "Telegram Premium",
      u.is_premium === undefined ? "Не надано" : u.is_premium ? "Так" : "Ні",
    ],
    ["Про себе", chat.bio],
    ["Дата народження", chat.birthdate ? JSON.stringify(chat.birthdate) : ""],
  ];
  requestDialog(
    "Заявка на доступ",
    `${chat.photo?.small_file_id ? `<img class="request-photo" src="/api/staff-requests/photo?telegram_id=${encodeURIComponent(id)}" alt="Фото Telegram" onerror="this.hidden=true">` : ""}<dl class="profile-fields">${fields
      .filter(([, v]) => v)
      .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
      .join(
        "",
      )}</dl><details><summary>Усі дані Telegram</summary><pre>${esc(JSON.stringify(q.profile, null, 2))}</pre></details><div class="row"><button onclick="closeOrderDialog()">Закрити</button></div>`,
  );
}
function requestApprove(id) {
  const q = cloudRequestRows.find((r) => r.telegram_id === id);
  if (!q) return;
  const box = requestDialog(
    "Надати доступ",
    `<form id="requestRoleForm"><label>Роль<select name="role">${cloudRoleOptions()}</select></label><div class="staff-form-actions"><button type="button" onclick="closeOrderDialog()">Скасувати</button><button class="primary">Надати доступ</button></div></form>`,
  );
  box.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector(".primary");
    button.disabled = true;
    try {
      await decideRequest(q, "approve", e.target.elements.role.value);
      closeOrderDialog();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  };
}
async function requestReject(id) {
  const q = cloudRequestRows.find((r) => r.telegram_id === id);
  if (!q || !confirm("Відхилити заявку? Людина зможе подати її знову.")) return;
  try {
    await decideRequest(q, "reject");
  } catch (e) {
    toast(e.message);
  }
}
async function decideRequest(q, action, role) {
  const r = await fetch("/api/staff-requests/decision", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        telegram_id: q.telegram_id,
        version: q.version,
        action,
        role,
      }),
    }),
    j = await r.json();
  if (!r.ok) throw Error(j.error);
  if (view === "staff")
    await Promise.all([loadCloudStaff(), loadCloudRequests()]);
  toast(action === "approve" ? "Доступ надано" : "Заявку відхилено");
}
const cloudStaffRefresh = refreshInPlace;
refreshInPlace = async function () {
  await cloudStaffRefresh();
  if (view === "staff")
    await Promise.all([loadCloudStaff(), loadCloudRequests()]);
};
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && view === "staff") loadCloudRequests();
  else clearTimeout(cloudRequestTimer);
});
