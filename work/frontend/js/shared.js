function toast(s, success = false) {
  let e = document.querySelector("#toast");
  clearTimeout(e.hideTimer);
  let visible = e.style.display === "block";
  e.toastMotion?.cancel();
  e.setAttribute("role", "status");
  e.setAttribute("aria-live", "polite");
  e.innerHTML = success
    ? '<span class="save-check" aria-hidden="true">✓</span><span>' +
      esc(s) +
      "</span>"
    : esc(s);
  e.style.display = "block";
  if (!visible) e.toastMotion = appear(e, 140);
  if (success)
    motion(
      e.querySelector(".save-check"),
      [
        { opacity: 0, transform: "scale(.7)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      180,
    );
  e.hideTimer = setTimeout(() => {
    let a = (e.toastMotion = motion(e, [{ opacity: 1 }, { opacity: 0 }], 120));
    a?.finished.then(
      () => {
        if (e.toastMotion === a) e.style.display = "none";
      },
      () => {},
    );
  }, 5000);
}

function cancelItem(id) {
  if (confirm("Скасувати цю позицію? Бариста побачить зміну."))
    setItemStatus(id, "cancelled");
}

async function place(id) {
  let o = data.orders.find((x) => x.id === id),
    p = prompt("Столик або номерок", o.place);
  if (p)
    try {
      await post("place", { id, place: p });
    } catch (e) {
      toast(e.message);
    }
}

function editPhoto(id) {
  editProduct(id);
  document
    .querySelector(".image-editor")
    .scrollIntoView({ behavior: "smooth", block: "center" });
}

async function deleteProduct(id) {
  let p = data.products.find((p) => p.id === id);
  if (
    !p ||
    !confirm("Видалити «" + p.name + "» з меню? Історія замовлень збережеться.")
  )
    return;
  try {
    await post("delete-product", { id });
    cart = cart.filter((p) => p.id !== id);
    menu();
    toast("Товар видалено з меню");
  } catch (e) {
    toast(e.message);
  }
}

function toggleOrderComment() {
  const field = document.querySelector("#orderComment");
  field.hidden = !field.hidden;
  if (!field.hidden) field.focus();
}

function selectedOrders() {
  return data.orders.filter((o) =>
    statsSelection.startsWith("day:")
      ? new Date(o.created.replace(" ", "T") + "Z").toLocaleDateString(
          "sv-SE",
        ) === statsSelection.slice(4)
      : Number(o.session_id || 0) === Number(statsSelection),
  );
}

function timeText(value) {
  return value
    ? new Date(value.replace(" ", "T") + "Z").toLocaleString("uk-UA")
    : "—";
}

function durationText(sec) {
  return (
    Math.floor(sec / 3600) +
    " год " +
    Math.floor((sec % 3600) / 60) +
    " хв " +
    (sec % 60) +
    " с"
  );
}

function tableReport(title, rows, total) {
  return `<h3>${title}</h3><table class="report-table"><thead><tr><th>Назва</th><th>Кількість</th><th>Сума</th></tr></thead><tbody>${rows.length ? rows.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.qty}</td><td>${money(p.amount)}</td></tr>`).join("") : '<tr><td colspan="3">Немає позицій</td></tr>'}${total === undefined ? "" : `<tr class="report-total-row"><td colspan="2">Разом</td><td>${money(total)}</td></tr>`}</tbody></table>`;
}

async function startSession() {
  let name = prompt("Назва нової сесії (можна залишити порожньою)", "");
  if (name === null) return;
  try {
    let r = await post("session/start", { name });
    historyPage = 0;
    statsSelection = String(r.id);
    statistics();
  } catch (e) {
    toast(e.message);
  }
}

function giftOrderDialog() {
  if (!cart.length) return toast("Спочатку додайте товари");
  closeOrderDialog(true);
  let box = document.createElement("div");
  box.id = "orderDialog";
  box.className = "order-dialog";
  box.innerHTML = `<section class="order-dialog-card" role="dialog" aria-modal="true" aria-label="Подарункове замовлення"><h2>${giftOrder ? "Повернути звичайну оплату?" : "Подарункове замовлення"}</h2><p>${giftOrder ? "Сума буде розрахована за цінами позицій." : "Усі позиції цього замовлення будуть безкоштовними. До оплати — 0 грн."}</p><div class="row"><button onclick="closeOrderDialog()">Скасувати</button><button class="primary" id="confirmGift">Підтвердити</button></div></section>`;
  document.body.appendChild(box);
  openOrderDialog(box);
  decorateMoneyFields();
  box.querySelector("#confirmGift").onclick = () => {
    giftOrder = !giftOrder;
    mixedAuto = true;
    document.querySelector("#received").value = "";
    closeOrderDialog();
    drawCart();
  };
}

function startOrderHold(target, x, y) {
  if (target.closest("button,input,textarea,select,a")) return false;
  let price = target.closest("[data-edit-price]"),
    total = target.closest("[data-gift-hold]");
  if (!price && !total) return false;
  clearOrderHold();
  orderHold = {
    x,
    y,
    lastY: y,
    target: price || total,
    moved: false,
    fired: false,
  };
  let hold = orderHold,
    index = price ? Number(price.dataset.editPrice) : -1,
    item = cart[index];
  hold.timer = setTimeout(
    () => {
      if (orderHold !== hold || hold.moved) return;
      hold.fired = true;
      if (price) {
        if (cart[index] === item) editOrderPrice(index);
      } else giftOrderDialog();
    },
    price ? 300 : 400,
  );
  return true;
}

function clearOrderHold() {
  if (orderHold) clearTimeout(orderHold.timer);
  orderHold = null;
}

function nativeProductHold(id) {
  lastLongPress = { id, until: Date.now() + 1600 };
  removeOne(id);
  let target = document.querySelector('[data-product="' + id + '"]');
  target?.classList.add("remove-feedback");
  setTimeout(() => target?.classList.remove("remove-feedback"), 250);
}

async function availability(id) {
  let p = data.products.find((p) => p.id === id);
  if (!p) return;
  try {
    await post("availability", { id, sold_out: !p.sold_out });
    orders();
  } catch (e) {
    toast(e.message);
  }
}

function saveCalculatorDraft() {
  try {
    localStorage.setItem(
      "minicafe-calculator-v1",
      JSON.stringify(calculatorDraft),
    );
  } catch (e) {}
}

/** Reuse unchanged keyed elements, preserving focus and animation state. */
function patchKeyedList(box, html, selector, key) {
  let template = document.createElement("template");
  template.innerHTML = html;
  let old = new Map(
    [...box.querySelectorAll(selector)].map((e) => [e.dataset[key], e]),
  );
  let desired = [...template.content.children];
  for (let fresh of desired) {
    fresh.className = fresh.className.trim();
    let previous = old.get(fresh.dataset[key]);
    let node =
      previous && previous.outerHTML === fresh.outerHTML ? previous : fresh;
    box.append(node);
    if (previous && previous !== node) previous.remove();
    old.delete(fresh.dataset[key]);
  }
  for (let node of old.values()) node.remove();
  let wanted = new Set(desired.map((e) => e.dataset[key]));
  for (let node of [...box.children])
    if (
      !node.matches(selector) &&
      node !== desired[0] &&
      !wanted.has(node.dataset[key])
    )
      node.remove();
}
