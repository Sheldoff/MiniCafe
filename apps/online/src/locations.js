const kinds = ["cash", "bar", "delivery"];
// Catalog route remains authoritative, including older cross-routed snapshots.
export const fulfillmentRoute = (i) => i.route;
export function itemDestinations(i) {
  const route = i.route;
  const matching = (i.destinations || []).filter((d) => d.route === route);
  if (matching.length) return matching;
  return [
    {
      id:
        (!i.destinations &&
          (!i.fulfillment_route || i.fulfillment_route === route) &&
          i.location_id) ||
        (route === "bar" ? "bar" : "delivery"),
      route,
    },
  ];
}
export const hasFulfillment = (i, route) => i.route === route;
export const baseLocation = (route) => (route === "bar" ? "bar" : "delivery");
export const undoKey = (route, id) =>
  id && id !== baseLocation(route) ? route + "@" + id : route;
export function locationById(rows, id) {
  return (
    rows.find((l) => l.id === id) ||
    (["cash", "bar", "delivery"].includes(id)
      ? {
          id,
          kind: id,
          name: { cash: "Каса", bar: "Бариста", delivery: "Видача" }[id],
        }
      : null)
  );
}
export function validateLocation(input, rows = []) {
  const { id, name, kind, color } = input;
  if (
    typeof id !== "string" ||
    !/^(loc-[a-f0-9]{32}|cash|bar|delivery)$/.test(id) ||
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 80 ||
    !kinds.includes(kind) ||
    !/^#[a-fA-F0-9]{6}$/.test(color || "")
  )
    throw Error("Перевірте назву, тип та колір локації");
  if (kinds.includes(id) && kind !== id)
    throw Error("Тип основної локації незмінний");
  const old = rows.find((l) => l.id === id);
  if (!old && rows.length >= 50) throw Error("До 50 додаткових локацій");
  const out = { id, name: name.trim(), kind, color };
  if (kind !== "cash" && input.linked_cash) {
    if (locationById(rows, input.linked_cash)?.kind !== "cash")
      throw Error("Оберіть дійсну касу");
    out.linked_cash = input.linked_cash;
  }
  if (kind === "cash") {
    if (
      input.guest_name_required !== undefined &&
      typeof input.guest_name_required !== "boolean"
    )
      throw Error("Некоректне налаштування імені гостя");
    out.guest_name_required = input.guest_name_required === true;
    if (input.targets !== undefined) {
      if (
        !Array.isArray(input.targets) ||
        !input.targets.length ||
        input.targets.length > 50 ||
        new Set(input.targets).size !== input.targets.length
      )
        throw Error("Оберіть хоча б одну видачу");
      for (const target of input.targets) {
        const l = locationById(rows, target);
        if (!l || l.kind === "cash" || target === id)
          throw Error("Оберіть дійсну видачу");
      }
      out.targets = [...input.targets];
      return out;
    }
    out.mode = input.mode === "single" ? "single" : "split";
    for (const [key, expected, fallback] of [
      ["bar_target", "bar", "bar"],
      ["delivery_target", "delivery", "delivery"],
      ["single_target", null, "delivery"],
    ]) {
      const target = input[key] || fallback,
        l = locationById(rows, target);
      if (
        !l ||
        l.kind === "cash" ||
        (out.mode === "split" && key !== "single_target" && l.kind !== expected)
      )
        throw Error("Оберіть дійсну локацію видачі");
      out[key] = target;
    }
  }
  return out;
}
export function applyRouting(order, input, locations = []) {
  const id = input.location_id || "cash";
  const cash = locationById(locations, id);
  if (!cash || cash.kind !== "cash") throw Error("Касу не знайдено");
  if (!locations.length && !input.location_id) return;
  order.cash_location = id;
  order.cash_location_name = cash.name;
  order.cash_location_color = cash.color || "#27634f";
  for (const item of order.items) {
    const kind = item.route === "bar" ? "bar" : "delivery";
    let targets = cash.targets || [
      cash.mode === "single"
        ? cash.single_target || "delivery"
        : item.route === "bar"
          ? cash.bar_target || "bar"
          : cash.delivery_target || "delivery",
    ];
    targets = targets.filter(
      (target) => locationById(locations, target)?.kind === kind,
    );
    if (!targets.length) targets = [baseLocation(item.route)];
    item.destinations = targets.map((target) => ({
      id: target,
      route: item.route,
    }));
    item.location_id = targets[0];
    item.fulfillment_route = item.route;
  }
}
export const inLocation = (item, route, id) =>
  itemDestinations(item).some(
    (d) => d.route === route && d.id === (id || baseLocation(route)),
  );

export function checkLocationChange(id, rows, orders) {
  if (
    orders.some((o) =>
      o.items.some(
        (i) =>
          !["delivered", "cancelled"].includes(i.status) &&
          (o.cash_location === id ||
            itemDestinations(i).some((d) => d.id === id)),
      ),
    )
  )
    throw Error("Спочатку завершіть активні замовлення цієї локації");
  if (
    rows.some(
      (l) =>
        l.id !== id &&
        (l.linked_cash === id ||
          (l.kind === "cash" &&
            (l.targets
              ? l.targets.includes(id)
              : (l.mode === "single"
                  ? [l.single_target || "delivery"]
                  : [l.bar_target || "bar", l.delivery_target || "delivery"]
                ).includes(id)))),
    )
  )
    throw Error(
      "Спочатку змініть напрямки кас, які надсилають сюди замовлення",
    );
}

export function availabilityCash(rows, id) {
  if (!id) return "";
  const l = locationById(rows || [], id);
  if (!l || l.kind === "cash") throw Error("Локацію видачі не знайдено");
  return l.linked_cash || "";
}
