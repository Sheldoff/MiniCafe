// Available before the first render, so Android does not animate its first page twice.
window.CafeNative =
  window.CafeNative || /MiniCafeAndroid/.test(navigator.userAgent);
const token = new URLSearchParams(location.search).get("key") || "",
  auth = { "X-Cafe-Key": token };

let menuPage = 0,
  mobileCart = false;

let imageDraft = undefined,
  imageLoading = false,
  imageGeneration = 0;

let categoryFilter = "",
  data = { products: [], orders: [] },
  view = location.hash.slice(1) || "cash",
  cart = [],
  draft =
    window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : String(Date.now()) + Math.random(),
  busy = false,
  sound = false,
  seen = null;

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const money = (n) =>
  (n / 100).toLocaleString("uk-UA", { minimumFractionDigits: 2 }) + " ₴";

const labels = {
  new: "Нове",
  making: "Готується",
  ready: "Готове до доставки",
  delivered: "Видано",
  cancelled: "Скасовано",
};

let issuingOrder = false;

let editorDraft = null;

let refreshSerial = 0,
  refreshing = 0,
  hasServerState = false;

let historyPage = 0,
  historyRequest = 0;

let giftOrder = false;

let payMode = "mixed",
  statsTab = "orders",
  statsSelection = "",
  statsCurrent = null,
  statsRequest = 0;

const orderTotal = () =>
  giftOrder ? 0 : cart.reduce((sum, p) => sum + p.price * p.qty, 0);

let chosenProducts = new Set(),
  productPress = null,
  lastLongPress = { id: 0, until: 0 },
  mixedAuto = true;

let orderHold = null;

let drawerAnimation = 0;

let tileTouch = null;

const fieldObserver = new MutationObserver((records) => {
  for (let record of records)
    for (let node of record.addedNodes)
      if (node.nodeType === 1) initializeFields(node);
});

let additionalExpenseBusy = false;

let cartMotionSerial = 0,
  productSaving = false;

const queueMotionSeen = { bar: null, instant: null };

let calculatorDraft = freshCalculator(),
  calculatorBusy = false;

try {
  let saved = JSON.parse(
    localStorage.getItem("minicafe-calculator-v1") || "null",
  );
  if (
    saved &&
    Array.isArray(saved.rows) &&
    saved.rows.length > 0 &&
    saved.rows.length <= 100
  )
    calculatorDraft = {
      defaultsVersion: 1,
      extraIds: Array.isArray(saved.extraIds)
        ? saved.extraIds.filter((x) => typeof x === "string").slice(0, 1000)
        : [],
      batchId:
        typeof saved.batchId === "string"
          ? saved.batchId
          : calculatorDraft.batchId,
      cost: String(saved.cost || ""),
      markup: String(saved.markup ?? "200"),
      rows: saved.rows.map((r) => ({
        name: String(r.name || "").slice(0, 100),
        qty: String(r.qty || ""),
        price:
          r.price !== null &&
          Number.isFinite(Number(r.price)) &&
          Number(r.price) >= 0
            ? Number(r.price)
            : null,
        id: Number(r.id) || null,
      })),
    };
  if (
    saved &&
    !saved.defaultsVersion &&
    saved.markup === "" &&
    !saved.cost &&
    !calculatorDraft.extraIds.length &&
    calculatorDraft.rows.every((r) => !r.name && !r.qty && r.price === null)
  )
    calculatorDraft.markup = "200";
} catch (e) {}

const calculatorName = (s) =>
  s.trim().replace(/\s+/g, " ").toLocaleLowerCase("uk");

let calcMotionSerial = 0;

let calculatorRemoving = false;

let startupNoticeTimer = setTimeout(() => {
  if (!hasServerState)
    connectionNotice("Завантаження МініКафе…", "Очікуємо відповідь сервера…");
}, 2500);
