window.addEventListener("error", function (e) {
  if (!window.MiniCafeStarted && e.message) {
    var title = document.getElementById("browserNoticeTitle"),
      body = document.getElementById("browserNoticeText");
    if (title) title.textContent = "Не вдалося запустити інтерфейс";
    if (body)
      body.textContent =
        "Оновіть Chrome або Safari й відкрийте посилання у звичайному браузері. Якщо помилка залишиться, повідомте версію браузера.";
  }
});
