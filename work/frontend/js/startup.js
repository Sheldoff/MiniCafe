try {
  render();
  window.MiniCafeStarted = true;
  refresh();
} catch (e) {
  connectionNotice(
    "Не вдалося відкрити інтерфейс",
    "Оновіть браузер і перезавантажте сторінку. Якщо помилка повториться, повідомте версію браузера.",
  );
}

scheduleRefresh();

window.addEventListener("online", () => scheduleRefresh(true));

document.addEventListener("visibilitychange", () => scheduleRefresh(true));
