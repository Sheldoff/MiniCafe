const kinds = ["cash", "bar", "delivery"];
export const fulfillmentRoute = (i) => i.fulfillment_route || i.route;
export const hasFulfillment = (i, route) =>
  i.destinations
    ? i.destinations.some((d) => d.route === route)
    : fulfillmentRoute(i) === route;
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
  if (kind === "cash") {
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
    if (cash.targets) {
      item.destinations = cash.targets.map((target) => {
        const l = locationById(locations, target);
        if (!l || l.kind === "cash") throw Error("Локацію видачі не знайдено");
        return { id: target, route: l.kind === "bar" ? "bar" : "instant" };
      });
      item.location_id = item.destinations[0].id;
      item.fulfillment_route = item.destinations[0].route;
      continue;
    }
    const target =
      cash.mode === "single"
        ? cash.single_target || "delivery"
        : item.route === "bar"
          ? cash.bar_target || "bar"
          : cash.delivery_target || "delivery";
    const destination = locationById(locations, target);
    if (!destination || destination.kind === "cash")
      throw Error("Локацію видачі не знайдено");
    item.location_id = target;
    item.fulfillment_route = destination.kind === "bar" ? "bar" : "instant";
  }
}
export const inLocation = (item, route, id) =>
  item.destinations
    ? item.destinations.some(
        (d) => d.route === route && d.id === (id || baseLocation(route)),
      )
    : fulfillmentRoute(item) === route &&
      (item.location_id || baseLocation(route)) === (id || baseLocation(route));

export function checkLocationChange(id, rows, orders) {
  if (
    orders.some((o) =>
      o.items.some(
        (i) =>
          !["delivered", "cancelled"].includes(i.status) &&
          (o.cash_location === id ||
            (
              i.destinations || [
                { id: i.location_id || baseLocation(fulfillmentRoute(i)) },
              ]
            ).some((d) => d.id === id)),
      ),
    )
  )
    throw Error("Спочатку завершіть активні замовлення цієї локації");
  if (
    rows.some(
      (l) =>
        l.id !== id &&
        l.kind === "cash" &&
        (l.targets
          ? l.targets.includes(id)
          : (l.mode === "single"
              ? [l.single_target || "delivery"]
              : [l.bar_target || "bar", l.delivery_target || "delivery"]
            ).includes(id)),
    )
  )
    throw Error(
      "Спочатку змініть напрямки кас, які надсилають сюди замовлення",
    );
}
