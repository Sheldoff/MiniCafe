export function liveSession(orders, active = false) {
  const time = (s) => Date.parse(s.replace(" ", "T") + "Z");
  const moments = orders.map((o) => time(o.created));
  const end = active ? Date.now() : Math.max(0, ...moments);
  const start = moments.length ? Math.min(...moments) : end;
  const interval =
    [900, 3600, 21600, 86400, 604800, 2592000].find(
      (n) => (end - start) / (n * 1000) <= 48,
    ) || 31536000;
  const buckets = new Map(),
    cashiers = new Map();
  let pendingUnits = 0,
    pendingOrders = 0,
    oldest = Infinity;
  for (const o of orders) {
    const key =
      Math.floor(time(o.created) / (interval * 1000)) * interval * 1000;
    const bucket = buckets.get(key) || {
      time: new Date(key).toISOString(),
      revenue: 0,
      orders: 0,
    };
    const total = o.items.reduce((n, i) => n + i.price * i.qty, 0);
    bucket.revenue += total;
    bucket.orders++;
    buckets.set(key, bucket);
    const id = o.cash_location || "cash",
      cash = cashiers.get(id) || {
        id,
        name: o.cash_location_name || "Каса",
        revenue: 0,
        orders: 0,
        pending_units: 0,
      };
    cash.revenue += total;
    cash.orders++;
    let pending = 0;
    for (const i of o.items)
      if (!["delivered", "cancelled"].includes(i.status))
        pending +=
          Array.isArray(i.unit_issued) && i.unit_issued.length === i.qty
            ? i.unit_issued.filter((v) => !v).length
            : i.qty;
    if (pending) {
      pendingOrders++;
      pendingUnits += pending;
      oldest = Math.min(oldest, time(o.created));
    }
    cash.pending_units += pending;
    cashiers.set(id, cash);
  }
  const timeline = [];
  if (orders.length)
    for (
      let at = Math.floor(start / (interval * 1000)) * interval * 1000;
      at <= end;
      at += interval * 1000
    )
      timeline.push(
        buckets.get(at) || {
          time: new Date(at).toISOString(),
          revenue: 0,
          orders: 0,
        },
      );
  return {
    events: [...orders]
      .sort((a, b) => a.created.localeCompare(b.created))
      .slice(-500)
      .map((o) => ({
        id: o.id,
        created: o.created,
        cash_location: o.cash_location || "cash",
        items: o.items.map((i) => ({
          name: i.name,
          qty: i.qty,
          status: i.status,
        })),
      })),
    generated_at: new Date().toISOString(),
    interval_seconds: interval,
    timeline,
    cashiers: [...cashiers.values()],
    pending_units: pendingUnits,
    pending_orders: pendingOrders,
    oldest_wait_seconds: Number.isFinite(oldest)
      ? Math.max(0, Math.floor((Date.now() - oldest) / 1000))
      : 0,
  };
}
