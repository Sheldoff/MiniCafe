function imageUrl(p) {
  return (
    "/api/image/" +
    p.id +
    "?v=" +
    p.image_version +
    "&key=" +
    encodeURIComponent(token)
  );
}

function productVisual(p) {
  return p.image_version
    ? `<span class="product-visual"><img loading="lazy" src="${esc(imageUrl(p))}" alt=""></span>`
    : `<span class="product-visual placeholder" aria-hidden="true">${p.route === "bar" ? "☕" : "🥐"}</span>`;
}

function picturePreview(src) {
  let preview = document.querySelector("#picturePreview");
  preview.classList.toggle("has-image", !!src);
  preview.innerHTML = src
    ? `<img src="${esc(src)}" alt="Попередній перегляд">`
    : "Зображення ще не додано";
  appear(preview, 140, false);
}

async function choosePicture(input) {
  let file = input.files[0];
  if (!file) return;
  const generation = ++imageGeneration;
  imageLoading = true;
  try {
    if (file.size > 15 * 1024 * 1024)
      throw Error("Оберіть зображення до 15 МБ");
    let img = await new Promise((resolve, reject) => {
      let i = new Image(),
        url = URL.createObjectURL(file);
      i.onload = () => {
        URL.revokeObjectURL(url);
        resolve(i);
      };
      i.onerror = () => {
        URL.revokeObjectURL(url);
        reject(Error("Оберіть JPG, PNG або WebP"));
      };
      i.src = url;
    });
    let scale = Math.min(1, 480 / img.naturalWidth, 480 / img.naturalHeight),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    let ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (generation !== imageGeneration) return;
    let uri = canvas.toDataURL("image/jpeg", 0.78);
    imageDraft = uri.split(",")[1];
    picturePreview(uri);
  } catch (e) {
    if (generation === imageGeneration) toast(e.message);
  } finally {
    if (generation === imageGeneration) imageLoading = false;
  }
}

function removePicture() {
  imageGeneration++;
  imageLoading = false;
  imageDraft = null;
  document.querySelector("#pimage").value = "";
  picturePreview(null);
}

function menu(reset = false) {
  let main = document.querySelector("#main");
  if (reset) editorDraft = null;
  else captureEditorDraft();
  imageGeneration++;
  imageLoading = false;
  imageDraft = undefined;
  document.querySelector("#main").innerHTML =
    `<div class="grid menu-editor-grid"><section class="panel product-form-panel" hidden><h2>Редактор меню</h2><p class="muted">Додавайте товари, змінюйте ціни та доступність.</p><form id="form" onsubmit="saveProduct(event)"><input id="pid" type="hidden"><label>Назва</label><input id="pname" required><label>Категорія</label><input id="pcategory" required value="Їжа" autocomplete="off" oninput="suggestCategories(this.value)" onfocus="suggestCategories(this.value)"><div id="categorySuggestions" class="category-suggestions"></div><label>Обробка</label><select id="proute"><option value="bar">Передати бариста</option><option value="instant" selected>Передати на видачу їжі</option></select><label>Ціна, грн</label><input data-money id="pprice" type="number" min="0" step="0.01" required><label for="pstock">Орієнтовна кількість, необов’язково</label><input id="pstock" type="number" min="0" max="1000000" step="1" inputmode="numeric" placeholder="Кількість"><label>Зображення товару</label><div class="image-editor"><div id="picturePreview" class="image-preview">Зображення ще не додано</div><input id="pimage" aria-label="Зображення товару" type="file" accept="image/*" style="display:none" onchange="choosePicture(this)"><div class="row photo-actions"><button type="button" class="primary" onclick="document.querySelector('#pimage').value='';document.querySelector('#pimage').click()">Обрати фото</button><button type="submit">Зберегти фото</button><button type="button" onclick="removePicture()">Прибрати</button></div></div><input id="pactive" type="checkbox" checked hidden><button id="activeToggle" type="button" class="active-toggle" aria-pressed="true" onclick="toggleProductActive()">● Показувати товар у меню</button><div class="row"><button class="primary">Зберегти</button></div></form></section><section class="panel product-list-panel"><div class="row" style="margin:0 0 10px"><h2 class="grow" style="margin:0">Товари</h2><button id="editorToggle" onclick="toggleProductEditor()" aria-expanded="false">＋ Новий товар</button></div><input id="productSearch" type="search" placeholder="Пошук за назвою" aria-label="Пошук товарів" oninput="filterEditorProducts(this.value)"><div id="editorProducts">${editorProductRows("")}</div></section></div>`;
  restoreEditorDraft();
  decorateMoneyFields();
}

function editorProductRows(q) {
  let ps = data.products.filter((p) =>
    p.name.toLocaleLowerCase("uk").includes(q.trim().toLocaleLowerCase("uk")),
  );
  return (
    ps
      .map(
        (p) =>
          `<div class="editor-product" data-product-id="${p.id}" role="button" tabindex="0" aria-label="Редагувати ${esc(p.name)}" onclick="editProduct(${p.id})" onkeydown="if(event.target===this&&(event.key==='Enter'||event.key===' ')){event.preventDefault();editProduct(${p.id})}">${p.image_version ? `<img class="product-thumb" loading="lazy" src="${esc(imageUrl(p))}" alt="">` : '<span class="editor-placeholder">' + (p.route === "bar" ? "☕" : "🥐") + "</span>"}<span class="grow"><b>${esc(p.name)}</b><small>${esc(p.category)} · ${money(p.price)}${p.active ? "" : " · Приховано"}</small></span><button class="remove" onclick="event.stopPropagation();deleteProduct(${p.id})">Видалити</button></div>`,
      )
      .join("") || '<p class="muted">Нічого не знайдено</p>'
  );
}

function updateEditorToggle(open) {
  let button = document.querySelector("#editorToggle");
  if (button) {
    button.textContent = open ? "Закрити редактор" : "＋ Новий товар";
    button.setAttribute("aria-expanded", String(open));
  }
}

function toggleProductEditor() {
  let panel = document.querySelector(".product-form-panel");
  if (panel.hidden || panel.dataset.closing === "true") openProductEditor();
  else closeProductEditor();
}

function animateEditorGap(grid, open) {
  let gap = getComputedStyle(grid).rowGap;
  grid.gapMotion?.cancel();
  grid.style.rowGap = open ? "20px" : "0px";
  grid.gapMotion = motion(
    grid,
    [{ rowGap: gap }, { rowGap: grid.style.rowGap }],
    400,
    "cubic-bezier(.4,0,.2,1)",
  );
}
function openProductEditor(fromHistory = false) {
  let panel = document.querySelector(".product-form-panel");
  if (!panel) return;
  let fresh = panel.hidden || panel.dataset.closing === "true",
    grid = panel.closest(".menu-editor-grid");
  panel.dataset.closing = "false";
  grid.classList.add("editing");
  updateEditorToggle(true);
  if (fresh) {
    animateEditorGap(grid, true);
    let a = disclosure(panel, true, 400);
    panel.editorMotion = a;
    const finished = () => {
      if (panel.editorMotion !== a) return;
      let bounds = panel.getBoundingClientRect();
      if (bounds.top < 60 || bounds.top > innerHeight - 100)
        panel.scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion:reduce)").matches
            ? "auto"
            : "smooth",
          block: "start",
        });
    };
    if (a) a.finished.then(finished, () => {});
    else finished();
    if (!window.CafeNative && !fromHistory && !history.state?.cafeEditor)
      history.pushState(
        { ...history.state, cafeEditor: true },
        "",
        location.href,
      );
  }
}
function closeProductEditor(fromHistory = false) {
  captureEditorDraft();
  if (editorDraft) editorDraft.open = false;
  let panel = document.querySelector(".product-form-panel");
  if (!panel || panel.hidden || panel.dataset.closing === "true") return;
  document.activeElement?.blur();
  panel.dataset.closing = "true";
  updateEditorToggle(false);
  let grid = panel.closest(".menu-editor-grid");
  animateEditorGap(grid, false);
  let a = disclosure(panel, false, 400);
  panel.editorMotion = a;
  const done = () => {
    if (panel.editorMotion !== a) return;
    panel.dataset.closing = "false";
    grid.classList.remove("editing");
  };
  if (a) a.finished.then(done, () => {});
  else done();
  if (!window.CafeNative && !fromHistory && history.state?.cafeEditor)
    history.back();
}

function filterEditorProducts(q) {
  animateList(
    document.querySelector("#editorProducts"),
    () => {
      patchKeyedList(
        document.querySelector("#editorProducts"),
        editorProductRows(q),
        ".editor-product",
        "productId",
      );
    },
    ".editor-product",
    "productId",
  );
}

function toggleProductActive() {
  let field = document.querySelector("#pactive");
  field.checked = !field.checked;
  updateActiveToggle();
}

function updateActiveToggle() {
  let on = document.querySelector("#pactive").checked,
    b = document.querySelector("#activeToggle");
  b.setAttribute("aria-pressed", String(on));
  b.textContent = on ? "● Показувати товар у меню" : "○ Товар приховано";
}

function editProduct(id) {
  imageGeneration++;
  imageLoading = false;
  imageDraft = undefined;
  document.querySelector("#pimage").value = "";
  let p = data.products.find((x) => x.id === id);
  for (let [k, v] of Object.entries({
    pid: p.id,
    pname: p.name,
    pcategory: p.category,
    pprice: (p.price / 100).toFixed(2),
    proute: p.route,
    pstock: p.stock == null ? "" : Math.max(0, p.stock),
  }))
    document.getElementById(k).value = v;
  document.querySelector("#pactive").checked = !!p.active;
  updateActiveToggle();
  picturePreview(p.image_version ? imageUrl(p) : null);
  suggestCategories(p.category);
  openProductEditor();
}

async function saveProduct(e) {
  e.preventDefault();
  if (productSaving) return;
  if (imageLoading) return toast("Зачекайте, зображення обробляється");
  let d = {
    id: Number(document.querySelector("#pid").value) || null,
    name: document.querySelector("#pname").value,
    category: document.querySelector("#pcategory").value,
    price: moneyCents(document.querySelector("#pprice")),
    route: document.querySelector("#proute").value,
    active: document.querySelector("#pactive").checked,
  };
  d.stock =
    document.querySelector("#pstock").value.trim() === ""
      ? null
      : Number(document.querySelector("#pstock").value);
  if (imageDraft !== undefined) d.image = imageDraft;
  let saveButton =
    e.submitter ||
    document.querySelector("#form > .row:last-child button.primary");
  productSaving = true;
  try {
    await post("product", d);
    await savedFeedback(saveButton);
    if (view === "menu") menu(true);
    toast("Меню збережено", true);
  } catch (e) {
    toast(e.message);
  } finally {
    productSaving = false;
  }
}

function suggestCategories(value) {
  let categories = [...new Set(data.products.map((p) => p.category))];
  let panel = document.querySelector("#categorySuggestions");
  if (!panel) return;
  let query = value.trim().toLowerCase(),
    matches = categories.filter(
      (c) => !query || c.toLowerCase().includes(query),
    );
  if (!matches.length) {
    hideSuggestions(panel);
    return;
  }
  let opening =
    panel.hidden ||
    !panel.children.length ||
    panel.dataset.hiding === "true" ||
    panel.popupMotion?.playState === "running";
  if (!panel.children.length) panel.hidden = true;
  panel.dataset.hiding = "false";
  panel.innerHTML = matches
    .map(
      (c) =>
        `<button type="button" class="${c.toLowerCase() === query ? "exact-category" : ""}" data-category="${esc(c)}" onclick="document.querySelector('#pcategory').value=this.dataset.category;suggestCategories(this.dataset.category)">${esc(c)}</button>`,
    )
    .join("");
  if (opening) panel.popupMotion = disclosure(panel, true, 140);
}

function captureEditorDraft() {
  let form = document.querySelector("#form");
  if (!form) return;
  editorDraft = {
    fields: {},
    active: document.querySelector("#pactive").checked,
    hasImageDraft: imageDraft !== undefined,
    imageDraft,
    preview: document.querySelector("#picturePreview").innerHTML,
    open:
      !form.closest(".product-form-panel").hidden &&
      form.closest(".product-form-panel").dataset.closing !== "true",
    search: document.querySelector("#productSearch").value,
  };
  for (let id of ["pid", "pname", "pcategory", "proute", "pprice", "pstock"]) {
    let field = document.getElementById(id);
    editorDraft.fields[id] = id === "pprice" ? moneyRaw(field) : field.value;
  }
}
function restoreEditorDraft() {
  if (!editorDraft) return;
  for (let [id, value] of Object.entries(editorDraft.fields))
    document.getElementById(id).value = value;
  document.querySelector("#pactive").checked = editorDraft.active;
  updateActiveToggle();
  imageDraft = editorDraft.hasImageDraft ? editorDraft.imageDraft : undefined;
  let preview = document.querySelector("#picturePreview");
  preview.innerHTML = editorDraft.preview;
  preview.classList.toggle("has-image", !!preview.querySelector("img"));
  document.querySelector("#productSearch").value = editorDraft.search;
  filterEditorProducts(editorDraft.search);
  if (editorDraft.open) openProductEditor(true);
}
