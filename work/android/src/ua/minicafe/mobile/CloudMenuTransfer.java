package ua.minicafe.mobile;

import android.app.*;
import android.webkit.CookieManager;
import android.widget.Toast;
import java.io.*;
import java.net.*;
import org.json.*;

/** Only the authenticated online administrator UI can invoke this bridge. */
final class CloudMenuTransfer {
  private final Activity activity;
  private boolean busy;

  CloudMenuTransfer(Activity activity) {
    this.activity = activity;
  }

  void request(String direction, String code) {
    if (busy
        || activity.isFinishing()
        || !("upload".equals(direction) || "download".equals(direction))
        || code == null
        || !code.matches("[a-f0-9]{64}")) return;
    busy = true;
    String cookies = CookieManager.getInstance().getCookie(OnlineActivity.ORIGIN);
    new Thread(
            () -> {
              try {
                JSONObject me = call("/api/me", null, cookies, null);
                if (!"admin".equals(me.getJSONObject("user").optString("role")))
                  throw new Exception("Перенесення доступне лише адміністратору");
                activity.runOnUiThread(
                    () -> {
                      if (activity.isFinishing()) {
                        busy = false;
                        return;
                      }
                      new AlertDialog.Builder(activity)
                          .setTitle("Замінити меню?")
                          .setMessage(
                              ("upload".equals(direction)
                                      ? "Меню сайту буде замінене меню телефона."
                                      : "Меню телефона буде замінене меню сайту.")
                                  + " Замовлення, статистика та доступи не змінюються.")
                          .setNegativeButton("Скасувати", (d, w) -> busy = false)
                          .setOnCancelListener(d -> busy = false)
                          .setPositiveButton("Замінити меню", (d, w) -> transfer(direction, code))
                          .show();
                    });
              } catch (Exception e) {
                error(e);
              }
            },
            "MiniCafe-transfer-auth")
        .start();
  }

  private void transfer(String direction, String code) {
    Toast.makeText(activity, "Перенесення меню…", Toast.LENGTH_SHORT).show();
    new Thread(
            () -> {
              try {
                CafeStore db = ServerService.store;
                if (db == null || !ServerService.running)
                  throw new Exception(
                      "Спочатку запустіть локальний сервер телефона, потім увійдіть онлайн");
                long version = db.menuVersion();
                byte[] body = "upload".equals(direction) ? db.exportMenu() : "{}".getBytes("UTF-8");
                JSONObject result = call("/api/menu-transfer/" + direction, body, null, code);
                if ("download".equals(direction)) {
                  if (!"minicafe-menu-1".equals(result.optString("format")))
                    throw new Exception("Невідомий формат меню");
                  if (ServerService.store != db || !ServerService.running)
                    throw new Exception("Сервер телефона змінився. Повторіть дію.");
                  db.importMenu(result.getJSONArray("products"), version);
                }
                activity.runOnUiThread(
                    () -> {
                      busy = false;
                      if (!activity.isFinishing())
                        new AlertDialog.Builder(activity)
                            .setMessage("Меню перенесено. Оновіть касу.")
                            .setPositiveButton("Добре", null)
                            .show();
                    });
              } catch (Exception e) {
                error(e);
              }
            },
            "MiniCafe-menu-transfer")
        .start();
  }

  private JSONObject call(String path, byte[] body, String cookies, String code) throws Exception {
    if (body != null && body.length > 8000000) throw new Exception("Меню завелике: до 8 МБ");
    HttpURLConnection c =
        (HttpURLConnection) new URL(OnlineActivity.ORIGIN + path).openConnection();
    try {
      c.setConnectTimeout(10000);
      c.setReadTimeout(30000);
      c.setInstanceFollowRedirects(false);
      if (cookies != null) c.setRequestProperty("Cookie", cookies);
      if (code != null) c.setRequestProperty("X-Menu-Transfer", code);
      if (body != null) {
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setFixedLengthStreamingMode(body.length);
        try (OutputStream out = c.getOutputStream()) {
          out.write(body);
        }
      }
      int status = c.getResponseCode();
      if (status != 200)
        throw new Exception(
            "Перенесення не дозволено або зв’язок втрачено. Оновіть дані й повторіть дію.");
      try (InputStream in = c.getInputStream()) {
        return new JSONObject(new String(CafeStore.readBytes(in, 8000000), "UTF-8"));
      }
    } finally {
      c.disconnect();
    }
  }

  private void error(Exception e) {
    activity.runOnUiThread(
        () -> {
          busy = false;
          if (!activity.isFinishing())
            new AlertDialog.Builder(activity)
                .setMessage(e.getMessage())
                .setPositiveButton("Добре", null)
                .show();
        });
  }
}
