# MiniCafe Local — Android

Робочий локальний напрям: телефон-сервер, клієнт APK/браузер, Wi-Fi/точка доступу,
інтернет через окремий cloudflared у Termux. Без обов’язкового хмарного входу.

Канонічні джерела: ../../work/android, спільний UI: ../../work/frontend.
Не копіювати їх у цей каталог і не редагувати згенерований assets/index.html.

Підготовка: work/scripts/setup_dev.ps1 за START-HERE-UA.md.
Перевірка з кореня: `python -X utf8 work/scripts/checks.py`.
Реліз після повного прогону: `python -X utf8 work/scripts/release.py --version <версія>`.
Потрібний оригінальний приватний підпис APK, збережений окремо.

Windows не входить до перевірок і випуску цього напряму.
Політика: ../../docs/PROJECT-TRACKS-UA.md.
