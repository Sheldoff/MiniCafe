package ua.minicafe.mobile;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.webkit.CookieManager;
import android.widget.*;
import java.net.*;
import java.security.*;
import org.json.*;

/** Browser authorizes only; the device redeems its private proof over HTTPS. */
public class OnlineActivity extends Activity {
  public static final String ORIGIN = "https://minicafe.minicafe.workers.dev";
  private final Handler handler = new Handler();
  private boolean active, checking, opening;
  private TextView status;
  private String secret;
  private long started;

  private String hex(byte[] bytes) {
    StringBuilder b = new StringBuilder();
    for (byte x : bytes) b.append(String.format(java.util.Locale.US, "%02x", x & 255));
    return b.toString();
  }

  @Override
  public void onCreate(Bundle state) {
    CafeUi.applyTheme(this);
    super.onCreate(state);
    secret = getPreferences(0).getString("proof", null);
    started = getPreferences(0).getLong("started", 0);
    LinearLayout root = CafeUi.screen(this, 600);
    CafeUi.label(root, "Онлайн · Telegram", 26, false);
    status = CafeUi.label(root, "Підтвердьте вхід у браузері, потім поверніться сюди.", 16, true);
    Button login = CafeUi.button(this, "Увійти через Telegram", true);
    root.addView(login);
    login.setOnClickListener(v -> begin());
    Button check = CafeUi.button(this, "Перевірити вхід", false);
    root.addView(check);
    check.setOnClickListener(v -> poll());
    Button back = CafeUi.button(this, "Локальна робота", false);
    root.addView(back);
    back.setOnClickListener(
        v -> {
          startActivity(
              new Intent(this, HostActivity.class).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
          finish();
        });
    if (secret == null) {
      String cookies = CookieManager.getInstance().getCookie(ORIGIN);
      if (!getIntent().getBooleanExtra("reauth", false)
          && cookies != null
          && cookies.contains("__Host-minicafe_session=")) {
        openApp();
        return;
      }
      if (getIntent().getData() == null) begin();
    }
  }

  private void begin() {
    try {
      byte[] bytes = new byte[32];
      new SecureRandom().nextBytes(bytes);
      secret = hex(bytes);
      started = System.currentTimeMillis();
      getPreferences(0).edit().putString("proof", secret).putLong("started", started).apply();
      String challenge = hex(MessageDigest.getInstance("SHA-256").digest(secret.getBytes("UTF-8")));
      startActivity(
          new Intent(
              Intent.ACTION_VIEW, Uri.parse(ORIGIN + "/auth/app/start?challenge=" + challenge)));
      status.setText("Підтвердьте вхід у браузері й поверніться до застосунку.");
    } catch (Exception e) {
      status.setText("Не вдалося відкрити вхід. Перевірте наявність браузера.");
    }
  }

  @Override
  protected void onResume() {
    super.onResume();
    active = true;
    poll();
  }

  @Override
  protected void onPause() {
    active = false;
    handler.removeCallbacksAndMessages(null);
    super.onPause();
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    poll();
  }

  private void poll() {
    if (!active || checking || opening || secret == null) return;
    if (System.currentTimeMillis() - started > 600000) {
      secret = null;
      getPreferences(0).edit().clear().apply();
      status.setText("Вхід прострочений. Натисніть «Увійти через Telegram».");
      return;
    }
    checking = true;
    final String proof = secret;
    new Thread(
            () -> {
              try {
                HttpURLConnection c =
                    (HttpURLConnection) new URL(ORIGIN + "/api/app/poll").openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(10000);
                c.setInstanceFollowRedirects(false);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                int code;
                JSONObject data;
                try {
                  try (java.io.OutputStream out = c.getOutputStream()) {
                    out.write(new JSONObject().put("secret", proof).toString().getBytes("UTF-8"));
                  }
                  code = c.getResponseCode();
                  java.io.InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
                  try (java.io.InputStream stream = in) {
                    data = new JSONObject(new String(CafeStore.readBytes(stream, 4096), "UTF-8"));
                  }
                } finally {
                  c.disconnect();
                }
                final int result = code;
                final JSONObject response = data;
                runOnUiThread(
                    () -> {
                      checking = false;
                      if (isFinishing() || !proof.equals(secret)) return;
                      if (result == 200) {
                        String token = response.optString("session");
                        if (!token.matches("[a-f0-9]{64}")) {
                          status.setText("Некоректна відповідь сервера");
                          return;
                        }
                        CookieManager cookies = CookieManager.getInstance();
                        cookies.setAcceptCookie(true);
                        cookies.setCookie(
                            ORIGIN,
                            "__Host-minicafe_session="
                                + token
                                + "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800",
                            ok -> {
                              if (ok) {
                                cookies.flush();
                                getPreferences(0).edit().clear().apply();
                                openApp();
                              } else
                                status.setText("Не вдалося зберегти сеанс. Почніть вхід заново.");
                            });
                      } else if (result == 202) {
                        status.setText("Очікуємо підтвердження Telegram…");
                        if (active) handler.postDelayed(() -> poll(), 3000);
                      } else {
                        status.setText(response.optString("error", "Не вдалося увійти"));
                        secret = null;
                        getPreferences(0).edit().clear().apply();
                      }
                    });
              } catch (Exception e) {
                runOnUiThread(
                    () -> {
                      checking = false;
                      if (!isFinishing()) {
                        status.setText(
                            "Немає з’єднання. Перевірте інтернет і натисніть «Перевірити вхід».");
                      }
                    });
              }
            },
            "MiniCafe-online-login")
        .start();
  }

  private void openApp() {
    if (opening) return;
    opening = true;
    startActivity(new Intent(this, MainActivity.class).putExtra("online", true));
    finish();
  }

  @Override
  protected void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    super.onDestroy();
  }
}
