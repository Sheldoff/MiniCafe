import { locationById } from "./locations.js";
export const cashIds = (rows = []) => [
  "cash",
  ...rows.filter((l) => l.kind === "cash" && l.id !== "cash").map((l) => l.id),
];
export const stockForCash = (p, id = "cash") =>
  p.stock_by_cash ? p.stock_by_cash[id] || 0 : p.stock;
export function validateCashStock(p, rows) {
  const map = p.stock_by_cash;
  if (map === undefined) return;
  if (
    !map ||
    typeof map !== "object" ||
    Array.isArray(map) ||
    Object.keys(map).length > 51 ||
    !Number.isSafeInteger(p.stock) ||
    p.stock < 0
  )
    throw Error("Вкажіть загальну кількість для розподілу");
  let sum = 0;
  for (const [id, value] of Object.entries(map)) {
    if (
      !/^(cash|loc-[a-f0-9]{32})$/.test(id) ||
      (rows && locationById(rows, id)?.kind !== "cash") ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 1000000
    )
      throw Error("Перевірте кількості по касах");
    sum += value;
  }
  if (sum !== p.stock)
    throw Error("Сума по касах має дорівнювати загальному залишку");
}
export function reconcileCashStock(p, rows = []) {
  if (!p.stock_by_cash) return;
  if (p.stock == null || p.stock < 0) {
    delete p.stock_by_cash;
    return;
  }
  const ids = cashIds(rows),
    result = {};
  let remaining = p.stock;
  for (const id of ids) {
    const n = Math.min(remaining, Math.max(0, p.stock_by_cash[id] || 0));
    result[id] = n;
    remaining -= n;
  }
  result[ids[ids.length - 1]] += remaining;
  p.stock_by_cash = result;
}
export function changeStock(p, id, delta, rows = []) {
  if (p.stock_by_cash) {
    const target =
      delta > 0 && locationById(rows, id)?.kind !== "cash" ? "cash" : id;
    const available = p.stock_by_cash[target] || 0;
    if (available + delta < 0) throw Error("Недостатній залишок на цій касі");
    p.stock_by_cash[target] = available + delta;
  }
  if (p.stock != null) {
    if (!p.stock_estimated && p.stock + delta < 0)
      throw Error("Недостатній залишок");
    p.stock += delta;
  }
}

export function checkStockBasis(p, basis) {
  if (!basis) return;
  const canonical = (m) =>
    m == null
      ? ""
      : JSON.stringify(
          Object.entries(m).sort(([a], [b]) => a.localeCompare(b)),
        );
  if (
    (p.stock ?? null) !== basis.stock ||
    canonical(p.stock_by_cash) !== canonical(basis.stock_by_cash)
  )
    throw Error(
      "Залишок змінився. Закрийте й відкрийте товар повторно перед розподілом.",
    );
}
