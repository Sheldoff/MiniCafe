const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const bars = [],
  charts = [];
const context = {
  analyticsGroup: "cash",
  analyticsMetric: "qty",
  analyticsSource: "all",
  paymentMetric: "amount",
  esc: String,
  locationInfo: (id) => ({ name: id }),
  allLocations: () => [
    { id: "cash", kind: "cash", name: "Cash" },
    { id: "extra", kind: "cash", name: "Extra" },
  ],
  liveBars: (name, rows) => {
    bars.push({ name, rows });
    return "";
  },
  liveChart: (name, rows, key) => {
    charts.push({ name, rows, key });
    return "";
  },
};
const source = fs.readFileSync(
  path.join(__dirname, "../../frontend/js/cash-session.js"),
  "utf8",
);
vm.createContext(context);
vm.runInContext(
  source.slice(source.indexOf("function interactiveAnalytics(")),
  context,
);
const item = (qty, price) => ({
  name: "Coffee",
  route: "bar",
  qty,
  price,
  status: "new",
  destinations: [{ id: "bar", route: "bar" }],
});
const r = {
  cash: 100,
  card: 400,
  cash_count: 1,
  card_count: 1,
  live: {
    generated_at: "2026-11-14T10:03:00Z",
    events: [
      {
        id: 1,
        created: "2026-11-14 10:00:00",
        cash_location: "cash",
        items: [item(1, 100)],
        payment: { cash_amount: 100, card_amount: 0 },
      },
      {
        id: 2,
        created: "2026-11-14 10:02:00",
        cash_location: "extra",
        items: [item(2, 200)],
        payment: { cash_amount: 0, card_amount: 400 },
      },
    ],
  },
};
context.interactiveAnalytics(r);
assert.equal(bars[0].rows[0].value, 1);
assert.equal(bars[0].rows[1].value, 2);
assert.equal(charts[0].rows.length, 4);
assert.equal(charts[0].rows[1].qty, 0);
assert.equal(charts[0].rows[1].amount, 0);
context.analyticsSource = "extra";
context.analyticsMetric = "price";
bars.length = 0;
charts.length = 0;
context.interactiveAnalytics(r);
assert.equal(bars[0].rows.length, 1);
assert.equal(bars[0].rows[0].value, 200);
assert.equal(bars[2].rows[0].value, 0);
assert.equal(bars[2].rows[1].value, 400);
for (const row of charts[0].rows) assert(Number.isFinite(row.price));
context.analyticsGroup = "delivery";
context.analyticsMetric = "orders";
bars.length = 0;
context.interactiveAnalytics(r);
assert.equal(bars[0].rows[0].name, "bar");
assert.equal(bars[0].rows[0].value, 1);
console.log(
  "PASS analytics math: isolated cash/fulfillment counts, weighted prices, scoped payments and quiet minute zeroes",
);
