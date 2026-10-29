function isCalculatorProduct(product) {
  return (
    product.route === "instant" &&
    !["напої", "напій", "drinks", "beverages"].includes(
      calculatorName(product.category),
    )
  );
}
function freshCalculator() {
  return {
    batchId:
      "calc-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2),
    defaultsVersion: 1,
    cost: "",
    markup: "200",
    extraIds: [],
    rows: [{ name: "", qty: "", price: null, id: null }],
  };
}

function calculatorMatch(row) {
  return data.products.find(
    (p) =>
      isCalculatorProduct(p) &&
      calculatorName(p.name) === calculatorName(row.name),
  );
}

function calculatorModel() {
  let cost = cents(calculatorDraft.cost),
    markup =
      calculatorDraft.markup.trim() === "" ? 0 : Number(calculatorDraft.markup),
    error = "";
  if (cost === null || cost <= 0 || cost > 100000000000)
    error = "Вкажіть загальну суму витрат";
  if (!Number.isFinite(markup) || markup < 0 || markup > 10000)
    error = "Перевірте відсоток націнки";
  let target =
      ((cost || 0) / 100) * (1 + (Number.isFinite(markup) ? markup : 0) / 100),
    fixed = 0,
    autoQty = 0,
    totalQty = 0,
    names = new Set();
  let rows = calculatorDraft.rows.map((row) => {
    let qty = Number(row.qty),
      validQty = Number.isInteger(qty) && qty > 0 && qty <= 1000000,
      manual = row.price !== null ? Math.round(row.price / 5) * 5 : null,
      name = row.name.trim().replace(/\s+/g, " "),
      match = calculatorMatch(row);
    if (!name && !error) error = "Вкажіть назву кожної позиції";
    if (!validQty && !error) error = "Вкажіть кількість кожної позиції";
    let normalized = calculatorName(name);
    if (names.has(normalized) && !error)
      error = "Однакові позиції об’єднайте в один рядок";
    names.add(normalized);
    if (validQty) {
      totalQty += qty;
      if (manual === null) autoQty += qty;
      else fixed += qty * manual;
    }
    return {
      id: match?.id || null,
      name,
      qty: validQty ? qty : 0,
      manual,
      match,
    };
  });
  let remaining = target - fixed,
    autoPrice =
      remaining > 0 && autoQty > 0
        ? Math.max(5, Math.round(remaining / autoQty / 5) * 5)
        : 0;
  if (remaining < -0.01 && autoQty > 0 && !error)
    error =
      "Зафіксовані ціни перевищують ціль. Зменште їх або збільште суму/націнку.";
  let actual = 0;
  rows.forEach((row) => {
    row.price = row.manual === null ? autoPrice : row.manual;
    if (!Number.isFinite(row.price) || row.price < 0 || row.price > 1000000) {
      if (!error) error = "Ціна має бути від 0 до 1 000 000 грн";
    }
    actual += row.qty * row.price;
  });
  return {
    target,
    actual,
    difference: actual - target,
    totalQty,
    rows,
    error,
    rangeMax:
      Math.ceil(
        Math.max(
          100,
          totalQty ? (target / totalQty) * 3 : 100,
          ...rows.map((r) => r.price),
        ) / 5,
      ) * 5,
  };
}

function calculator() {
  document.querySelector("#main").innerHTML =
    `<section class="panel calculator-panel"><div class="calc-title"><h2>Калькулятор</h2><div class="calc-title-actions"><button class="calc-new calc-extra-add" aria-label="Додаткові витрати" title="Додаткові витрати" onclick="additionalExpenseDialog()">+</button><button class="calc-new" onclick="calculatorNew()">Новий розрахунок</button></div></div><div id="calcExtraRows"></div><div class="calc-budget"><label>Витрачено всього, грн<input data-money id="calcCost" type="number" min="0" step="0.01" inputmode="decimal" enterkeyhint="done" placeholder="Сума витрат" value="${esc(calculatorDraft.cost)}" oninput="calculatorDraft.cost=moneyRaw(this);calculatorUpdate()"></label><label>Націнка, %<input id="calcMarkup" type="number" min="0" max="10000" step="1" inputmode="decimal" enterkeyhint="done" placeholder="0" value="${esc(calculatorDraft.markup)}" oninput="calculatorDraft.markup=this.value;calculatorUpdate()"></label></div><div id="calcRows"></div><button class="calc-add" onclick="calculatorAddRow()">＋ Додати позицію</button><div id="calcSummary" class="calc-summary"></div><p id="calcProblem" class="calc-problem" role="status"></p><button id="calcApply" class="primary" onclick="calculatorConfirm()">Додати до меню</button><p id="calcSaved" class="muted" role="status"></p></section>`;
  calculatorRows();
  decorateMoneyFields();
  calculatorUpdate();
}

function calculatorRows() {
  calculatorDraft.rows.forEach(
    (r) => (r._motionKey ||= ++calcMotionSerial + ""),
  );
  animateList(
    document.querySelector("#calcRows"),
    () => {
      document.querySelector("#calcRows").innerHTML = calculatorDraft.rows
        .map(
          (row, i) =>
            `<section class="calc-row" data-motion-key="${row._motionKey}"><div class="calc-name-line"><label><input aria-label="Назва позиції ${i + 1}" id="calcName-${i}" autocomplete="off" maxlength="100" placeholder="Оберіть їжу або введіть нову назву" value="${esc(row.name)}" oninput="calculatorNameInput(${i},this.value)" onfocus="calculatorSuggestions(${i})" onblur="setTimeout(()=>{let s=document.querySelector('#calcSuggestions-${i}');if(s)hideSuggestions(s)},150)"></label><button type="button" class="remove calc-remove" aria-label="Прибрати позицію ${i + 1}" onclick="calculatorRemoveRow(${i})" ${calculatorDraft.rows.length === 1 && !row.name.trim() && !row.qty && row.price === null ? "hidden" : ""}>×</button></div><div id="calcSuggestions-${i}" class="calc-suggestions" hidden></div><small id="calcMatch-${i}" class="calc-match"></small><div class="calc-row-fields"><label>Кількість, шт.<input id="calcQty-${i}" type="number" min="1" max="1000000" step="1" inputmode="numeric" enterkeyhint="done" placeholder="Кількість" value="${esc(row.qty)}" oninput="calculatorDraft.rows[${i}].qty=this.value;calculatorUpdate()"></label><label>Ціна за 1 шт., грн<div class="calc-price-input"><button type="button" aria-label="Зменшити ціну позиції ${i + 1} на 5 грн" onclick="calculatorStep(${i},-5)">−</button><input data-money id="calcPrice-${i}" type="number" min="0" max="1000000" step="5" inputmode="decimal" enterkeyhint="done" value="${row.price === null ? "" : row.price}" oninput="calculatorPrice(${i},moneyRaw(this))" onblur="calculatorNormalize(${i})"><button type="button" aria-label="Збільшити ціну позиції ${i + 1} на 5 грн" onclick="calculatorStep(${i},5)">+</button></div></label></div><div class="calc-value-tools"><button type="button" id="calcAuto-${i}" onclick="calculatorAuto(${i})">Авто</button><small id="calcRowTotal-${i}" class="calc-row-total"></small></div></section>`,
        )
        .join("");
      decorateMoneyFields();
    },
    ".calc-row",
  );
}

function calculatorUpdate() {
  saveCalculatorDraft();
  calculatorExtras();
  if (!document.querySelector("#calcRows")) return;
  let summaryBefore = [...document.querySelectorAll("#calcSummary b")].map(
      (e) => e.textContent,
    ),
    model = calculatorModel();
  model.rows.forEach((row, i) => {
    let input = document.querySelector("#calcPrice-" + i);
    input.placeholder = row.qty ? row.price + " грн" : "Авто";
    document
      .querySelector("#calcName-" + i)
      .closest(".calc-name-line")
      .querySelector("button").hidden =
      calculatorDraft.rows.length === 1 &&
      !calculatorDraft.rows[i].name.trim() &&
      !calculatorDraft.rows[i].qty &&
      calculatorDraft.rows[i].price === null;
    document.querySelector("#calcAuto-" + i).disabled = row.manual === null;
    document.querySelector("#calcMatch-" + i).textContent = row.match
      ? "Оновиться: " +
        row.match.name +
        " · " +
        row.match.category +
        (!row.match.active ? " · Приховано" : "") +
        (row.match.sold_out ? " · Немає в наявності" : "")
      : "Нова позиція · Їжа · Видача їжі";
    document.querySelector("#calcRowTotal-" + i).textContent =
      "Разом за позицію: " + money(Math.round(row.price * row.qty * 100));
  });
  let estimated =
    model.rows.every((r) => r.name && r.qty) && model.target > 0
      ? Math.round(
          (model.actual / (cents(calculatorDraft.cost) / 100) - 1) * 1000,
        ) / 10
      : null;
  document.querySelector("#calcMarkup").placeholder =
    estimated !== null ? String(estimated) : "0";
  document.querySelector("#calcSummary").innerHTML =
    `<div><span>Сума з націнкою</span><b>${money(Math.round(model.target * 100))}</b></div><div><span>За округленими цінами</span><b>${money(Math.round(model.actual * 100))}</b></div><div><span>Виручка після витрат (план)</span><b>${money(Math.round(model.actual * 100) - (cents(calculatorDraft.cost) || 0))}</b></div><div class="muted"><span>Різниця після округлення</span><b>${model.difference > 0 ? "+" : ""}${money(Math.round(model.difference * 100))}</b></div>`;
  let problemWasHidden = document.querySelector("#calcProblem").hidden;
  document.querySelector("#calcProblem").textContent = model.error || "";
  document.querySelector("#calcProblem").hidden = !model.error;
  if (problemWasHidden && model.error)
    appear(document.querySelector("#calcProblem"), 120, false);
  document
    .querySelector("#calcProblem")
    .classList.toggle("calc-invalid", !!model.error && !!calculatorDraft.cost);
  document.querySelector("#calcApply").disabled =
    !!model.error || calculatorBusy;
  let saved = document.querySelector("#calcSaved");
  if (saved) saved.textContent = "";
}

function calculatorExtras() {
  let box = document.querySelector("#calcExtraRows");
  if (!box) return;
  let rows = (data.additional_expenses || []).filter((e) =>
    (calculatorDraft.extraIds || []).includes(e.id),
  );
  animateList(
    box,
    () => {
      box.innerHTML = rows
        .map(
          (e) =>
            `<div class="calc-extra-row" role="button" tabindex="0" data-expense="${esc(e.id)}" aria-label="Редагувати ${esc(e.note || "додаткові витрати")}" onclick="additionalExpenseDialog(undefined,this.dataset.expense)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();additionalExpenseDialog(undefined,this.dataset.expense)}"><span>${esc(e.note || "Додаткові витрати")}</span><b>${money(e.cost)}</b></div>`,
        )
        .join("");
    },
    ".calc-extra-row",
    "expense",
  );
}

function calculatorPrice(i, value, fromRange = false) {
  let number = Number(value);
  calculatorDraft.rows[i].price =
    value.trim() === "" ? null : Number.isFinite(number) ? number : null;
  if (fromRange)
    document.querySelector("#calcPrice-" + i).value =
      Math.round(number / 5) * 5;
  calculatorUpdate();
}

function calculatorNormalize(i) {
  let row = calculatorDraft.rows[i];
  if (row.price !== null) {
    row.price = Math.round(row.price / 5) * 5;
    document.querySelector("#calcPrice-" + i).value = row.price;
  }
  calculatorUpdate();
}

function calculatorAuto(i) {
  calculatorDraft.rows[i].price = null;
  document.querySelector("#calcPrice-" + i).value = "";
  calculatorUpdate();
}

function calculatorNameInput(i, value) {
  calculatorDraft.rows[i].name = value;
  calculatorDraft.rows[i].id = null;
  calculatorSuggestions(i);
  calculatorUpdate();
}

function calculatorSuggestions(i) {
  let box = document.querySelector("#calcSuggestions-" + i),
    q = calculatorName(calculatorDraft.rows[i].name),
    ps = data.products
      .filter(
        (p) =>
          isCalculatorProduct(p) &&
          !calculatorDraft.rows.some(
            (r, j) =>
              j !== i && calculatorName(r.name) === calculatorName(p.name),
          ) &&
          (!q || calculatorName(p.name).includes(q)),
      )
      .sort(
        (a, b) =>
          a.category.localeCompare(b.category, "uk") ||
          a.name.localeCompare(b.name, "uk"),
      );
  if (!ps.length) {
    hideSuggestions(box);
    return;
  }
  let wasHidden =
    box.hidden ||
    box.dataset.hiding === "true" ||
    box.popupMotion?.playState === "running";
  box.dataset.hiding = "false";
  box.innerHTML = ps
    .map(
      (p) =>
        `<button type="button" onclick="calculatorChoose(${i},${p.id})"><span>${esc(p.name)}</span><small>${esc(p.category)} · ${money(p.price)}</small></button>`,
    )
    .join("");
  if (wasHidden) box.popupMotion = disclosure(box, true, 140);
}

function calculatorChoose(i, id) {
  let p = data.products.find((p) => p.id === id && isCalculatorProduct(p));
  if (!p) return;
  calculatorDraft.rows[i].name = p.name;
  calculatorDraft.rows[i].id = id;
  document.querySelector("#calcName-" + i).value = p.name;
  hideSuggestions(document.querySelector("#calcSuggestions-" + i));
  calculatorUpdate();
  document.activeElement?.blur();
  if (window.CafeNative) location.href = "minicafe://hidekeyboard";
}

function calculatorAddRow() {
  document.activeElement?.blur();
  if (window.CafeNative) location.href = "minicafe://hidekeyboard";
  let empty = calculatorDraft.rows.findIndex((row) => !row.name.trim());
  if (empty >= 0) {
    let input = document.querySelector("#calcName-" + empty);
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.classList.remove("calc-attention");
    void input.offsetWidth;
    input.classList.add("calc-attention");
    setTimeout(() => input.classList.remove("calc-attention"), 800);
    return;
  }
  if (calculatorDraft.rows.length >= 100) return toast("Максимум 100 позицій");
  calculatorDraft.rows.push({ name: "", qty: "", price: null, id: null });
  calculatorRows();
  calculatorUpdate();
  document
    .querySelector("#calcName-" + (calculatorDraft.rows.length - 1))
    .scrollIntoView({ behavior: "smooth", block: "center" });
}

async function calculatorRemoveRow(i) {
  if (calculatorRemoving) return;
  calculatorRemoving = true;
  let box = document.querySelector("#calcRows"),
    row = box.children[i];
  box.style.pointerEvents = "none";
  try {
    if (row) {
      let h = row.getBoundingClientRect().height;
      row.style.overflow = "hidden";
      let a = motion(
        row,
        [
          { height: h + "px", opacity: 1, transform: "translateY(0)" },
          {
            height: "0px",
            opacity: 0,
            transform: "translateY(8px)",
            paddingTop: "0px",
            paddingBottom: "0px",
            marginTop: "0px",
            marginBottom: "0px",
            borderWidth: "0px",
          },
        ],
        220,
      );
      if (a) await a.finished.catch(() => {});
      row.remove();
    }
    calculatorDraft.rows.splice(i, 1);
    let empty = !calculatorDraft.rows.length;
    if (empty)
      calculatorDraft.rows.push({ name: "", qty: "", price: null, id: null });
    if (view === "calculator") {
      calculatorRows();
      calculatorUpdate();
      if (empty) document.querySelector("#calcName-0").focus();
    } else saveCalculatorDraft();
  } finally {
    calculatorRemoving = false;
    box.style.removeProperty("pointer-events");
  }
}

function calculatorStep(i, amount) {
  let price = calculatorModel().rows[i].price;
  calculatorPrice(
    i,
    String(Math.max(0, Math.min(1000000, price + amount))),
    true,
  );
}

function calculatorNew() {
  if (
    !confirm(
      "Почати новий розрахунок? Поточні збережені витрати залишаться у статистиці.",
    )
  )
    return;
  calculatorDraft = freshCalculator();
  calculator();
  document.querySelector("#calcCost").focus();
}

function calculatorConfirm() {
  if (calculatorBusy) return;
  let model = calculatorModel();
  if (model.error) return toast(model.error);
  closeOrderDialog(true);
  let box = document.createElement("div");
  box.id = "orderDialog";
  box.className = "order-dialog";
  box.innerHTML = `<section class="order-dialog-card" role="dialog" aria-modal="true" aria-label="Додати позиції до меню"><h2>Додати до меню?</h2><p class="muted">Існуючі позиції отримають нову ціну та орієнтовну кількість. Нові з’являться в категорії «Їжа» на видачі їжі.</p><div class="calc-confirm-list">${model.rows.map((row) => `<div><b>${esc(row.name)}</b><small>${row.id ? "Оновити" : "Створити"}${row.match && !row.match.active ? " · Приховано" : ""}${row.match?.sold_out ? " · Немає в наявності" : ""} · ${row.qty} шт. · ${money(row.price * 100)} / шт.</small></div>`).join("")}</div><p id="calcConfirmError" class="calc-invalid" role="status"></p><div class="row"><button onclick="closeOrderDialog()">Скасувати</button><button id="calcConfirmApply" class="primary">Підтвердити</button></div></section>`;
  document.body.appendChild(box);
  openOrderDialog(box);
  box.querySelector("#calcConfirmApply").onclick = async () => {
    if (calculatorBusy) return;
    calculatorBusy = true;
    box.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      let result = await post("calculate-menu", {
        confirm: true,
        calculation_id: calculatorDraft.batchId,
        cost: cents(calculatorDraft.cost),
        items: model.rows.map((row) => ({
          id: row.id,
          name: row.name,
          stock: row.qty,
          price: row.price * 100,
        })),
      });
      await savedFeedback(box.querySelector("#calcConfirmApply"));
      calculatorDraft = freshCalculator();
      saveCalculatorDraft();
      closeOrderDialog();
      calculatorBusy = false;
      if (view === "calculator") change("cash");
      let saved = document.querySelector("#calcSaved");
      if (saved)
        saved.textContent =
          "Збережено: нових " + result.created + ", оновлено " + result.updated;
      toast("Позиції додано до меню", true);
    } catch (e) {
      if (box.isConnected) {
        box.querySelector("#calcConfirmError").textContent = e.message;
        box.querySelectorAll("button").forEach((b) => (b.disabled = false));
      }
      calculatorBusy = false;
      calculatorUpdate();
    }
  };
}
