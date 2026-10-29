function pageMenu(delta) {
  menuPage += delta;
  tiles("");
}

function step(i, d) {
  if (cart[i].qty + d <= 0) cart.splice(i, 1);
  else cart[i].qty = Math.min(99, cart[i].qty + d);
  drawCart();
}

function cash() {
  payMode = "mixed";
  mixedAuto = true;
  document.querySelector("#main").innerHTML =
    `<div class="cash-switch"><button onclick="showCashPanel(false)">Меню</button><button id="cartTab" onclick="showCashPanel(true)">Замовлення</button></div><div class="grid cash-grid"><section class="panel menu-panel"><div id="categories" class="chips"></div><div id="tiles"></div><div id="menuPages"></div></section><section class="panel cart-panel"><input id="guest" aria-label="Ім’я гостя" placeholder="Ім’я гостя"><div id="cart"></div><div class="total" data-gift-hold><span id="totalLabel">Разом</span><b id="sum"></b></div><div class="payment-box"><div class="pay-fields"><label>Готівкою, грн<input data-money id="received" inputmode="decimal" placeholder="0,00" oninput="paymentEdited('cash')"></label><label>Карткою, грн<input data-money id="cardPaid" inputmode="decimal" placeholder="0,00" oninput="paymentEdited('card')"></label></div><div class="paid-line"><span>Внесено разом</span><b id="paidSum">0,00 ₴</b></div><div id="change" role="status" aria-live="polite">До сплати: —</div></div><button id="send" class="primary" onclick="send()">Відправити замовлення</button></section></div>`;
  categoryFilter = "";
  menuPage = 0;
  drawCategories();
  tiles("");
  decorateMoneyFields();
  drawCart();
  showCashPanel(false, true);
  highlightPay();
}

async function toggleItemNote(i) {
  let item = cart[i];
  if (!item) return;
  item.showNote = !item.showNote;
  let field = document.querySelector("#itemNote" + i);
  if (!item.showNote && field) {
    field.blur();
    let a = motion(
      field,
      [
        {
          height: field.getBoundingClientRect().height + "px",
          opacity: 1,
          paddingTop: "7px",
          paddingBottom: "7px",
          marginTop: "6px",
        },
        {
          height: "0px",
          minHeight: "0px",
          opacity: 0,
          paddingTop: "0px",
          paddingBottom: "0px",
          marginTop: "0px",
        },
      ],
      160,
    );
    if (a) await a.finished.catch(() => {});
    if (!item.showNote && view === "cash" && document.querySelector("#cart"))
      drawCart();
  } else {
    drawCart();
    let input = document.querySelector("#itemNote" + i);
    if (input) {
      motion(
        input,
        [
          {
            height: "0px",
            minHeight: "0px",
            opacity: 0,
            paddingTop: "0px",
            paddingBottom: "0px",
            marginTop: "0px",
          },
          {
            height: input.getBoundingClientRect().height + "px",
            opacity: 1,
            paddingTop: "7px",
            paddingBottom: "7px",
            marginTop: "6px",
          },
        ],
        160,
      );
      input.focus();
    }
  }
}

function drawCartContent() {
  document.querySelector("#cart").innerHTML = cart.length
    ? cart
        .map(
          (p, i) =>
            `<div class="cart-compact" data-cart-key="${p._uiKey || (p._uiKey = "cart-" + ++cartMotionSerial)}" data-edit-price="${i}" tabindex="0" aria-label="Змінити ціну позиції" onkeydown="if(event.target===this&&(event.key==='Enter'||event.key===' ')){event.preventDefault();editOrderPrice(${i})}"><div class="cart-compact-main"><b class="cart-name">${esc(p.name)}${p.customPrice ? '<small class="custom-price-label">Змінена ціна</small>' : ""}</b><button class="note-icon ${p.note ? "has-note" : ""}" aria-label="Коментар до ${esc(p.name)}" onclick="toggleItemNote(${i})">✎</button><button class="qty-button ${p.qty === 1 ? "delete-one" : ""}" aria-label="${p.qty === 1 ? "Видалити позицію" : "Зменшити кількість"}" onclick="step(${i},-1)">${p.qty === 1 ? "×" : "−"}</button><button class="qty-button" aria-label="Збільшити кількість" onclick="step(${i},1)">+</button><span class="cart-qty">${p.qty}</span><strong>${money(giftOrder ? 0 : p.price * p.qty)}</strong></div>${p.showNote ? `<input id="itemNote${i}" class="item-note" maxlength="300" placeholder="Коментар до цієї позиції" value="${esc(p.note)}" oninput="cart[${i}].note=this.value">` : p.note ? `<small class="saved-note">${esc(p.note)}</small>` : ""}</div>`,
        )
        .join("")
    : '<p class="empty-cart">Оберіть товари з меню</p>';
  if (!cart.length) giftOrder = false;
  document.querySelector("#sum").textContent = money(orderTotal());
  document.querySelector("#totalLabel").textContent = giftOrder
    ? "🎁 Подарункове"
    : "Разом";
  document
    .querySelector("[data-gift-hold]")
    .classList.toggle("gift-total", giftOrder);
  if (giftOrder) {
    document.querySelector("#received").value = "";
    document.querySelector("#cardPaid").value = "0.00";
  }
  document.querySelector("#received").disabled = giftOrder;
  document.querySelector("#cardPaid").disabled = giftOrder;
  if (payMode === "card") {
    document.querySelector("#cardPaid").value = (orderTotal() / 100).toFixed(2);
    document.querySelector("#received").value = "";
  }
  changeDue();
  let tab = document.querySelector("#cartTab");
  if (tab)
    tab.textContent = "Замовлення · " + cart.reduce((n, p) => n + p.qty, 0);
  updateProductCards();
  if (payMode === "mixed" && mixedAuto) {
    let cash = moneyCents(document.querySelector("#received"));
    document.querySelector("#cardPaid").value = (
      Math.max(0, orderTotal() - (cash || 0)) / 100
    ).toFixed(2);
    changeDue();
  }
}

async function send() {
  if (busy) return;
  if (!cart.length) return toast("Додайте товари до замовлення");
  let payment = paymentValue();
  if (!payment.valid) {
    changeDue();
    document.querySelector(".payment-box").classList.add("payment-blocked");
    showFieldError(
      document.querySelector("#cardPaid"),
      document.querySelector("#change").textContent,
      document.querySelector("#change"),
    );
    document
      .querySelector("#change")
      .scrollIntoView({ behavior: "smooth", block: "center" });
    toast("Перевірте оплату — замовлення залишилося відкритим");
    return;
  }
  let guest = document.querySelector("#guest").value,
    comment = "";
  busy = true;
  document.querySelector("#send").disabled = true;
  try {
    let r = await post("order", {
      request: draft,
      guest,
      comment,
      cash_given: payment.cash,
      card_amount: payment.card,
      gift: giftOrder,
      items: cart.map((p) => ({
        id: p.id,
        qty: p.qty,
        ...(p.customPrice ? { unit_price: p.price } : {}),
        note: p.note || "",
      })),
    });
    if (view === "cash") {
      if (categoryFilter) {
        categoryFilter = "";
        drawCategories();
        tiles("");
      }
      await showCashPanel(false);
    }
    cart = [];
    giftOrder = false;
    chosenProducts.clear();
    draft = String(Date.now()) + Math.random();
    if (view === "cash") {
      payMode = "mixed";
      mixedAuto = true;
      document.querySelector("#guest").value = "";
      document.querySelector("#received").value = "";
      document.querySelector("#cardPaid").value = "0.00";
      drawCart();
    }
    toast("Замовлення №" + r.id + " збережено");
  } catch (e) {
    toast(e.message);
    if (e.missing !== undefined) {
      document.querySelector("#change").textContent =
        e.missing > 0 ? "Не вистачає: " + money(e.missing) : e.message;
      document.querySelector("#change").classList.add("payment-error");
      document.querySelector(".payment-box").classList.add("payment-blocked");
    }
  } finally {
    busy = false;
    let button = document.querySelector("#send");
    if (button) button.disabled = false;
  }
}

function editOrderPrice(index) {
  if (!cart[index]) return;
  closeOrderDialog(true);
  let p = cart[index],
    box = document.createElement("div");
  box.id = "orderDialog";
  box.className = "order-dialog";
  box.innerHTML = `<form class="order-dialog-card" role="dialog" aria-modal="true" aria-label="Ціна позиції"><h2>Ціна в цьому замовленні</h2><p>${esc(p.name)}</p><label>Ціна за одну порцію, грн<input data-money id="orderPrice" type="number" inputmode="decimal" min="0" max="1000000" step="0.01" required value="${(p.price / 100).toFixed(2)}"></label><p class="muted">Зміниться лише цей рядок замовлення. Ціна в меню залишиться без змін.</p><div class="row"><button type="button" onclick="closeOrderDialog()">Скасувати</button><button class="primary">Зберегти</button></div></form>`;
  document.body.appendChild(box);
  openOrderDialog(box);
  decorateMoneyFields();
  box.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    let price = moneyCents(box.querySelector("input"));
    if (price === null || price > 100000000) return toast("Перевірте ціну");
    if (cart[index] !== p) {
      closeOrderDialog();
      return;
    }
    p.price = price;
    p.customPrice = true;
    closeOrderDialog();
    drawCart();
  };
  const focus = () => {
    if (box.isConnected && box.dataset.closing !== "true")
      box.querySelector("input").focus();
  };
  let entry = box.querySelector(".order-dialog-card").dialogMotion;
  if (entry) entry.finished.then(focus, () => {});
  else focus();
}

function menuCategories() {
  return [
    ...new Set(data.products.filter((p) => p.active).map((p) => p.category)),
  ];
}

function drawCategories() {
  let host = document.querySelector("#categories"),
    categories = ["", ...menuCategories()],
    signature = JSON.stringify(categories);
  if (host.dataset.signature !== signature) {
    host.innerHTML = categories
      .map(
        (c, i) =>
          `<button data-category="${esc(c)}" onclick="filterCategory(${i})">${esc(c || "Усе")}</button>`,
      )
      .join("");
    host.dataset.signature = signature;
  }
  host
    .querySelectorAll("button")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.category === categoryFilter),
    );
}

function filterCategory(i) {
  let category = ["", ...menuCategories()][i];
  if (category === categoryFilter) return;
  categoryFilter = category;
  menuPage = 0;
  drawCategories();
  tiles("");
  animateCategory();
}

function countProduct(id) {
  return cart.filter((p) => p.id === id).reduce((sum, p) => sum + p.qty, 0);
}

function cardMarkup(p) {
  let count = countProduct(p.id);
  return `<button class="tile ${p.sold_out ? "sold-out" : ""}" data-product="${p.id}" aria-disabled="${!!p.sold_out}" onclick="tileClick(event,${p.id})" oncontextmenu="return false">${productVisual(p)}<span class="product-copy"><b>${esc(p.name)}</b>${p.stock !== undefined && p.stock !== null ? `<span class="stock-estimate">≈ ${p.stock} шт.</span>` : ""}${p.sold_out ? '<span class="sold-label">Закінчилось</span>' : ""}<span class="tile-price">${money(p.price)}</span><span class="selected-count" ${count > 0 ? "" : "hidden"} aria-label="У замовленні">${count}</span></span></button>`;
}

function tiles(q) {
  let categories = menuCategories(),
    ps = data.products.filter(
      (p) => p.active && (!categoryFilter || p.category === categoryFilter),
    );
  ps.sort(
    (a, b) =>
      categories.indexOf(a.category) - categories.indexOf(b.category) ||
      a.name.localeCompare(b.name, "uk"),
  );
  let host = document.querySelector("#tiles"),
    box = host.querySelector(".tiles");
  if (!box) {
    host.innerHTML = '<div class="tiles compact-tiles"></div>';
    box = host.firstElementChild;
  }
  patchKeyedList(box, ps.map(cardMarkup).join(""), ".tile", "product");
  let empty = host.querySelector(".muted");
  if (!ps.length && !empty) {
    empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "У цій категорії поки немає товарів.";
    host.append(empty);
  } else if (ps.length) empty?.remove();
  document.querySelector("#menuPages").innerHTML = "";
}

function updateProductCards() {
  document.querySelectorAll("[data-product]").forEach((button) => {
    let id = Number(button.dataset.product),
      p = data.products.find((x) => x.id === id);
    if (!p) return;
    button.classList.toggle("sold-out", !!p.sold_out);
    button.setAttribute("aria-disabled", String(!!p.sold_out));
    let count = button.querySelector(".selected-count");
    if (count) {
      let previous = Number(count.textContent),
        next = countProduct(id);
      count.textContent = next;
      count.hidden = next === 0;
      if (next > 0 && previous !== next)
        motion(
          count,
          [
            { transform: "scale(1)" },
            { transform: "scale(1.2)", offset: 0.4 },
            { transform: "scale(1)" },
          ],
          200,
        );
    }
  });
}

function add(id) {
  let p = data.products.find((x) => x.id === id);
  if (!p || !p.active || p.sold_out) return toast("Ця позиція закінчилась");
  productFeedback(id, "tap-feedback");
  chosenProducts.add(id);
  let existing = cart.find(
    (x) => x.id === id && !x.note && !x.customPrice && x.qty < 99,
  );
  if (existing) existing.qty++;
  else cart.push({ ...p, qty: 1, note: "" });
  drawCart();
  updateProductCards();
}

function removeOne(id) {
  let index = -1;
  for (let i = cart.length - 1; i >= 0; i--)
    if (cart[i].id === id) {
      index = i;
      break;
    }
  if (index < 0) return;
  chosenProducts.add(id);
  if (cart[index].qty > 1) cart[index].qty--;
  else cart.splice(index, 1);
  drawCart();
  updateProductCards();
}

function productFeedback(id, kind) {
  let button = document.querySelector('[data-product="' + id + '"]');
  if (!button) return;
  let overlay = button.querySelector(".tile-feedback");
  if (!overlay) {
    overlay = document.createElement("span");
    overlay.className = "tile-feedback";
    overlay.setAttribute("aria-hidden", "true");
    button.appendChild(overlay);
  }
  let opacity = Number(getComputedStyle(overlay).opacity) || 0;
  overlay.feedbackAnimation?.cancel();
  overlay.style.opacity = String(opacity);
  overlay.style.background = kind === "remove-feedback" ? "#d48a64" : "#78aa5d";
  overlay.feedbackAnimation = overlay.animate(
    [{ opacity }, { opacity: 0.24, offset: 0.35 }, { opacity: 0 }],
    { duration: 750, easing: "cubic-bezier(.25,.1,.25,1)", fill: "forwards" },
  );
  overlay.feedbackAnimation.finished.then(
    () => {
      overlay.style.opacity = "0";
    },
    () => {},
  );
}

function tileClick(event, id) {
  if (lastLongPress.id === id && Date.now() < lastLongPress.until) {
    event.preventDefault();
    return;
  }
  add(id);
}

function beginProductPress(target, x, y) {
  if (!target) return;
  clearProductPress();
  let press = { id: Number(target.dataset.product), target, x, y };
  productPress = press;
  target.classList.add("is-pressed");
  press.timer = setTimeout(() => {
    if (productPress !== press) return;
    press.long = true;
    lastLongPress = { id: press.id, until: Date.now() + 1500 };
    removeOne(press.id);
    target.classList.remove("is-pressed");
    productFeedback(press.id, "remove-feedback");
  }, 300);
}

function clearProductPress() {
  if (productPress) {
    clearTimeout(productPress.timer);
    if (productPress.long)
      lastLongPress = { id: productPress.id, until: Date.now() + 1500 };
    productPress.target.classList.remove("is-pressed");
    productPress = null;
  }
}
