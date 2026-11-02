const kinds = ["cash", "bar", "delivery"];
export const fulfillmentRoute = (i) => i.fulfillment_route || i.route;
export const baseLocation = (route) => (route === "bar" ? "bar" : "delivery");
export const undoKey = (route, id) =>
  id && id !== baseLocation(route) ? route + "@" + id : route;
export function locationById(rows, id) {
  return (
    rows.find((l) => l.id === id) ||
    (["cash", "bar", "delivery"].includes(id)
      ? { id, kind: id, name: id }
      : null)
  );
}
export function validateLocation(input, rows = []) {
  const { id, name, kind, color } = input;
  if (
    typeof id !== "string" ||
    !/^(loc-[a-f0-9]{32}|cash)$/.test(id) ||
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 80 ||
    !kinds.includes(kind) ||
    !/^#[a-fA-F0-9]{6}$/.test(color || "")
  )
    throw Error("Перевірте назву, тип та колір локації");
  if (id === "cash" && kind !== "cash")
    throw Error("Тип основної каси незмінний");
  const old = rows.find((l) => l.id === id);
  if (old && old.kind !== kind)
    throw Error("Тип створеної локації змінювати не можна");
  if (!old && rows.length >= 50) throw Error("До 50 додаткових локацій");
  const out = { id, name: name.trim(), kind, color };
  if (kind === "cash") {
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
  for (const item of order.items) {
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
  fulfillmentRoute(item) === route &&
  (item.location_id || baseLocation(route)) === (id || baseLocation(route));
