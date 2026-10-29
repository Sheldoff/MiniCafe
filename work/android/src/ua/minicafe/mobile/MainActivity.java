package ua.minicafe.mobile;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;

public class MainActivity extends Activity {
  private WebView web;
  private final Handler revealHandler = new Handler();
  private boolean pageRevealed = false;
  private boolean settingsOpening = false;
  private int revealChecks = 0;

  private void revealWhenReady(WebView target) {
    if (web != target || isFinishing() || pageRevealed) return;
    target.evaluateJavascript(
        "typeof hasServerState!=='undefined'&&hasServerState",
        ready -> {
          if (web != target || isFinishing() || pageRevealed) return;
          if ("true".equals(ready) || ++revealChecks >= 210) {
            pageRevealed = true;
            target.animate().alpha(1f).translationY(0).setDuration(200).start();
          } else revealHandler.postDelayed(() -> revealWhenReady(target), 60);
        });
  }

  private void installProductHold() {
    web.setLongClickable(false);
  }

  private String server;
  private ValueCallback<Uri[]> fileCallback;
  private byte[] pendingPdf;

  private int px(int n) {
    return (int) (getResources().getDisplayMetrics().density * n);
  }

  @Override
  public void onCreate(Bundle state) {
    CafeUi.applyTheme(this);
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    String remote = getIntent().getStringExtra("connectUrl");
    if (remote != null) {
      try {
        server = CafeLink.connection(remote);
        String route = getIntent().getStringExtra("connectRoute");
        showWeb(
            server
                + "#"
                + ("cash".equals(route) ? "cash" : "delivery".equals(route) ? "delivery" : "bar"));
      } catch (Exception e) {
        settings();
      }
    } else if (getIntent().getBooleanExtra("local", false))
      openLocal(getIntent().getStringExtra("localRoute"));
    else settings();
  }

  private void openLocal(String route) {
    if (!ServerService.running) {
      Toast.makeText(this, "Спочатку запустіть сервер цього телефона", Toast.LENGTH_LONG).show();
      settings();
      return;
    }
    server = "http://127.0.0.1:8765/?key=" + ServerService.key(this);
    showWeb(server + ("menu".equals(route) ? "#menu" : "#cash"));
  }

  private void settings() {
    if (settingsOpening || isFinishing()) return;
    settingsOpening = true;
    // Keep the outgoing WebView alive for Android's cross-fade snapshot.
    // Destroying it here used to expose an empty frame before HostActivity.
    startActivity(
        new Intent(this, HostActivity.class).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
    overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
    finish();
  }

  private void showWeb(String url) {
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    layout.setBackgroundColor(CafeUi.background(this));
    web =
        new WebView(this) {
          @Override
          public android.view.inputmethod.InputConnection onCreateInputConnection(
              android.view.inputmethod.EditorInfo info) {
            android.view.inputmethod.InputConnection connection =
                super.onCreateInputConnection(info);
            if (connection == null) return null;
            if ((info.inputType & android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE) != 0)
              return connection;
            info.imeOptions =
                (info.imeOptions & ~android.view.inputmethod.EditorInfo.IME_MASK_ACTION)
                    | android.view.inputmethod.EditorInfo.IME_ACTION_DONE;
            return new android.view.inputmethod.InputConnectionWrapper(connection, false) {
              @Override
              public boolean performEditorAction(int action) {
                if (action == android.view.inputmethod.EditorInfo.IME_ACTION_DONE
                    || action == android.view.inputmethod.EditorInfo.IME_ACTION_NEXT
                    || action == android.view.inputmethod.EditorInfo.IME_ACTION_GO) {
                  post(
                      () -> {
                        evaluateJavascript(
                            "document.activeElement&&document.activeElement.blur()", null);
                        clearFocus();
                        ((android.view.inputmethod.InputMethodManager)
                                getSystemService(INPUT_METHOD_SERVICE))
                            .hideSoftInputFromWindow(getWindowToken(), 0);
                      });
                  return true;
                }
                return super.performEditorAction(action);
              }
            };
          }
        };
    web.setBackgroundColor(CafeUi.background(this));
    web.setAlpha(0f);
    web.setTranslationY(px(6));
    pageRevealed = false;
    revealChecks = 0;
    web.setLongClickable(false);
    installProductHold();
    layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
    setContentView(layout);
    web.getSettings()
        .setUserAgentString(web.getSettings().getUserAgentString() + " MiniCafeAndroid");
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setAllowFileAccess(false);
    web.getSettings().setAllowContentAccess(true);
    web.getSettings().setMediaPlaybackRequiresUserGesture(true);
    web.setWebViewClient(
        new WebViewClient() {
          @Override
          public void onPageFinished(WebView v, String loaded) {
            Uri current = Uri.parse(loaded), base = Uri.parse(server);
            if (!base.getHost().equals(current.getHost()) || base.getPort() != current.getPort())
              return;
            v.evaluateJavascript(
                "window.CafeNative=true;window.CafeNativeHold=false;document.querySelectorAll('[data-native]').forEach(b=>b.hidden=false);",
                null);
            String savedTheme = getSharedPreferences("appearance", 0).getString("theme", null);
            String initial =
                savedTheme == null
                    ? "document.documentElement.dataset.theme"
                    : org.json.JSONObject.quote(savedTheme);
            v.evaluateJavascript(
                "if(typeof setCafeTheme==='function')setCafeTheme(" + initial + ",false,true)",
                null);
            revealWhenReady(v);
          }

          @Override
          public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
            return navigate(v, request.getUrl());
          }

          @Override
          public boolean shouldOverrideUrlLoading(WebView v, String target) {
            return navigate(v, Uri.parse(target));
          }

          @Override
          public void onReceivedError(
              WebView v, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
              v.setAlpha(1f);
              pageRevealed = true;
            }
            if (request.isForMainFrame())
              new AlertDialog.Builder(MainActivity.this)
                  .setTitle("Немає зв’язку із сервером")
                  .setMessage(
                      "Перевірте Wi-Fi, адресу та запуск сервера на головному телефоні або"
                          + " ноутбуці. Потім натисніть «Оновити» або змініть підключення.")
                  .setPositiveButton("Добре", null)
                  .show();
          }
        });
    web.setWebChromeClient(
        new WebChromeClient() {
          @Override
          public boolean onShowFileChooser(
              WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType("image/*");
            try {
              startActivityForResult(
                  Intent.createChooser(pick, "Оберіть фото товару з галереї або файлів"), 42);
            } catch (ActivityNotFoundException e) {
              fileCallback.onReceiveValue(null);
              fileCallback = null;
              Toast.makeText(
                      MainActivity.this, "Не знайдено програму вибору фото", Toast.LENGTH_LONG)
                  .show();
            }
            return true;
          }

          @Override
          public boolean onJsConfirm(WebView v, String url, String message, JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                .setMessage(message)
                .setPositiveButton("Так", (d, w) -> result.confirm())
                .setNegativeButton("Ні", (d, w) -> result.cancel())
                .setOnCancelListener(d -> result.cancel())
                .show();
            return true;
          }

          @Override
          public boolean onJsPrompt(
              WebView v, String url, String message, String initial, JsPromptResult result) {
            EditText input = new EditText(MainActivity.this);
            input.setText(initial);
            new AlertDialog.Builder(MainActivity.this)
                .setMessage(message)
                .setView(input)
                .setPositiveButton("Зберегти", (d, w) -> result.confirm(input.getText().toString()))
                .setNegativeButton("Скасувати", (d, w) -> result.cancel())
                .setOnCancelListener(d -> result.cancel())
                .show();
            return true;
          }
        });
    web.setDownloadListener((target, agent, disposition, mime, length) -> downloadPdf(target));
    web.loadUrl(url);
  }

  private boolean navigate(WebView view, Uri target) {
    Uri base = Uri.parse(server);
    if ("minicafe".equals(target.getScheme())) {
      if ("theme".equals(target.getHost())) {
        String mode = target.getQueryParameter("mode");
        if ("light".equals(mode) || "dark".equals(mode)) {
          getSharedPreferences("appearance", 0).edit().putString("theme", mode).apply();
          CafeUi.applyTheme(this);
          int color = CafeUi.background(this);
          view.setBackgroundColor(color);
          if (view.getParent() instanceof View) ((View) view.getParent()).setBackgroundColor(color);
          getWindow().setStatusBarColor(Color.rgb(20, 45, 37));
        }
        return true;
      } else if ("copy-support-card".equals(target.getHost())) {
        ((android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE))
            .setPrimaryClip(ClipData.newPlainText("Картка для підтримки", "4441111056584349"));
        Toast.makeText(this, "Номер картки скопійовано", Toast.LENGTH_SHORT).show();
      } else if ("external".equals(target.getHost())) {
        String external = target.getQueryParameter("url");
        if ("https://t.me/AlikPerepelkin".equals(external)
            || "https://send.monobank.ua/jar/7NiVRv4sW5".equals(external)) {
          try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(external)));
          } catch (Exception e) {
            Toast.makeText(this, "Не вдалося відкрити посилання", Toast.LENGTH_SHORT).show();
          }
        }
      } else if ("settings".equals(target.getHost())) settings();
      else if ("reload".equals(target.getHost())) view.reload();
      else if ("pdf".equals(target.getHost())) exportPdf(target);
      else if ("hidekeyboard".equals(target.getHost())) {
        view.clearFocus();
        ((android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE))
            .hideSoftInputFromWindow(view.getWindowToken(), 0);
      }
      return true;
    }
    return !base.getScheme().equals(target.getScheme())
        || !base.getHost().equals(target.getHost())
        || base.getPort() != target.getPort();
  }

  private void downloadPdf(String target) {
    Uri wanted = Uri.parse(target), base = Uri.parse(server);
    if (!base.getScheme().equals(wanted.getScheme())
        || !base.getHost().equals(wanted.getHost())
        || base.getPort() != wanted.getPort()
        || !"/api/report.pdf".equals(wanted.getPath())) return;
    Toast.makeText(this, "Завантажуємо PDF…", Toast.LENGTH_SHORT).show();
    new Thread(
            () -> {
              try {
                java.net.HttpURLConnection c =
                    (java.net.HttpURLConnection) new java.net.URL(target).openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(30000);
                c.setInstanceFollowRedirects(false);
                c.setRequestProperty("X-Cafe-Key", base.getQueryParameter("key"));
                byte[] bytes;
                try {
                  if (c.getResponseCode() != 200)
                    throw new Exception(
                        "Сервер не зміг створити PDF. Оновіть APK на головному телефоні й"
                            + " перезапустіть сервер.");
                  try (java.io.InputStream in = c.getInputStream()) {
                    bytes = CafeStore.readBytes(in, 15000000);
                  }
                } finally {
                  c.disconnect();
                }
                if (bytes.length < 5 || !new String(bytes, 0, 5, "US-ASCII").equals("%PDF-"))
                  throw new Exception("Сервер повернув файл іншого формату");
                savePdf(bytes);
              } catch (Exception e) {
                runOnUiThread(
                    () ->
                        new AlertDialog.Builder(this)
                            .setMessage("Не вдалося завантажити PDF: " + e.getMessage())
                            .setPositiveButton("Добре", null)
                            .show());
              }
            },
            "MiniCafe-download")
        .start();
  }

  private void savePdf(byte[] bytes) {
    String name =
        "MiniCafe-report-"
            + new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.US)
                .format(new java.util.Date())
            + ".pdf";
    if (Build.VERSION.SDK_INT >= 29) {
      Uri uri = null;
      try {
        ContentValues values = new ContentValues();
        values.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
        values.put(
            android.provider.MediaStore.MediaColumns.RELATIVE_PATH,
            android.os.Environment.DIRECTORY_DOWNLOADS + "/MiniCafe");
        values.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1);
        uri =
            getContentResolver()
                .insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new Exception("Не вдалося створити файл");
        try (java.io.OutputStream out = getContentResolver().openOutputStream(uri)) {
          out.write(bytes);
        }
        values.clear();
        values.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0);
        getContentResolver().update(uri, values, null, null);
        final Uri saved = uri;
        runOnUiThread(
            () ->
                new AlertDialog.Builder(this)
                    .setTitle("PDF збережено")
                    .setMessage("Завантаження → MiniCafe → " + name)
                    .setPositiveButton(
                        "Відкрити",
                        (d, w) -> {
                          try {
                            startActivity(
                                new Intent(Intent.ACTION_VIEW)
                                    .setDataAndType(saved, "application/pdf")
                                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
                          } catch (Exception e) {
                            Toast.makeText(
                                    this, "Відкрийте PDF у файловому менеджері", Toast.LENGTH_LONG)
                                .show();
                          }
                        })
                    .setNegativeButton("Добре", null)
                    .show());
        return;
      } catch (Exception e) {
        if (uri != null)
          try {
            getContentResolver().delete(uri, null, null);
          } catch (Exception ignored) {
          }
      }
    }
    try {
      java.io.File file = new java.io.File(getCacheDir(), "pending-report.pdf");
      try (java.io.FileOutputStream out = new java.io.FileOutputStream(file)) {
        out.write(bytes);
        out.getFD().sync();
      }
      getPreferences(0).edit().putString("pendingPdfFile", file.getPath()).commit();
      runOnUiThread(
          () -> {
            pendingPdf = bytes;
            try {
              startActivityForResult(
                  new Intent(Intent.ACTION_CREATE_DOCUMENT)
                      .addCategory(Intent.CATEGORY_OPENABLE)
                      .setType("application/pdf")
                      .putExtra(Intent.EXTRA_TITLE, name),
                  55);
            } catch (Exception e) {
              Toast.makeText(
                      this, "Немає системного вибору папки: " + e.getMessage(), Toast.LENGTH_LONG)
                  .show();
            }
          });
    } catch (Exception e) {
      runOnUiThread(
          () ->
              Toast.makeText(this, "Помилка збереження PDF: " + e.getMessage(), Toast.LENGTH_LONG)
                  .show());
    }
  }

  private void exportPdf(Uri options) {
    Toast.makeText(this, "Формуємо PDF…", Toast.LENGTH_SHORT).show();
    new Thread(
            () -> {
              try {
                Uri base = Uri.parse(server);
                String sid = options.getQueryParameter("session"),
                    day = options.getQueryParameter("day");
                String query;
                if (sid != null && sid.matches("[0-9]+")) query = "session=" + sid;
                else if (day != null && day.matches("\\d{4}-\\d{2}-\\d{2}"))
                  query =
                      "day="
                          + day
                          + "&tz="
                          + (java.util.TimeZone.getDefault().getOffset(System.currentTimeMillis())
                              / 60000);
                else throw new Exception("Оберіть сесію або сьогоднішній день");
                java.net.HttpURLConnection c =
                    (java.net.HttpURLConnection)
                        new java.net.URL(
                                base.getScheme()
                                    + "://"
                                    + base.getEncodedAuthority()
                                    + "/api/stats?"
                                    + query)
                            .openConnection();
                c.setConnectTimeout(7000);
                c.setReadTimeout(15000);
                c.setRequestProperty("X-Cafe-Key", base.getQueryParameter("key"));
                org.json.JSONObject report;
                try {
                  if (c.getResponseCode() != 200)
                    throw new Exception("Оновіть сервер для експорту статистики");
                  try (java.io.InputStream in = c.getInputStream()) {
                    report =
                        new org.json.JSONObject(
                            new String(CafeStore.readBytes(in, 10000000), "UTF-8"));
                  }
                } finally {
                  c.disconnect();
                }
                byte[] font = PdfFont.fromApk(getApplicationInfo().sourceDir);
                byte[] bytes = PdfReport.create(report, font);
                savePdf(bytes);
              } catch (Exception e) {
                runOnUiThread(
                    () ->
                        new AlertDialog.Builder(this)
                            .setMessage("Не вдалося зберегти PDF: " + e.getMessage())
                            .setPositiveButton("Добре", null)
                            .show());
              }
            },
            "MiniCafe-PDF")
        .start();
  }

  @Override
  public void onBackPressed() {
    if (web == null) {
      super.onBackPressed();
      return;
    }
    final WebView current = web;
    current.evaluateJavascript(
        "(function(){try{return typeof handleAppBack==='function'&&handleAppBack()}catch(e){return"
            + " false}})()",
        handled -> {
          if (web != current || isFinishing()) return;
          if (!"true".equals(handled))
            new AlertDialog.Builder(this)
                .setMessage("Повернутися до налаштувань підключення?")
                .setPositiveButton("Так", (d, w) -> settings())
                .setNegativeButton("Ні", null)
                .show();
        });
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request == 55) {
      byte[] memory = pendingPdf;
      pendingPdf = null;
      String cached = getPreferences(0).getString("pendingPdfFile", null);
      getPreferences(0).edit().remove("pendingPdfFile").apply();
      if (result == RESULT_OK && data != null && data.getData() != null) {
        Uri dest = data.getData();
        new Thread(
                () -> {
                  try (java.io.OutputStream out =
                      getContentResolver().openOutputStream(dest, "wt")) {
                    byte[] bytes = memory;
                    if (bytes == null && cached != null)
                      try (java.io.InputStream in = new java.io.FileInputStream(cached)) {
                        bytes = CafeStore.readBytes(in, 15000000);
                      }
                    if (bytes == null) throw new Exception("Повторіть завантаження звіту");
                    out.write(bytes);
                    runOnUiThread(
                        () -> Toast.makeText(this, "PDF збережено", Toast.LENGTH_LONG).show());
                  } catch (Exception e) {
                    runOnUiThread(
                        () ->
                            Toast.makeText(
                                    this,
                                    "Помилка збереження PDF: " + e.getMessage(),
                                    Toast.LENGTH_LONG)
                                .show());
                  } finally {
                    if (cached != null) new java.io.File(cached).delete();
                  }
                })
            .start();
      } else if (cached != null) new java.io.File(cached).delete();
      return;
    }
    if (request == 42 && fileCallback != null) {
      if (result != RESULT_OK || data == null || data.getData() == null) {
        fileCallback.onReceiveValue(null);
        fileCallback = null;
        return;
      }
      final ValueCallback<Uri[]> pending = fileCallback;
      Uri selected = data.getData();
      Toast.makeText(this, "Готуємо фото…", Toast.LENGTH_SHORT).show();
      new Thread(
              () -> {
                try {
                  Uri ready = PhotoFiles.prepare(this, selected);
                  runOnUiThread(
                      () -> {
                        if (fileCallback == pending) {
                          fileCallback = null;
                          pending.onReceiveValue(new Uri[] {ready});
                        }
                      });
                } catch (Exception e) {
                  runOnUiThread(
                      () -> {
                        if (fileCallback == pending) {
                          fileCallback = null;
                          pending.onReceiveValue(null);
                          new AlertDialog.Builder(this)
                              .setMessage(e.getMessage())
                              .setPositiveButton("Добре", null)
                              .show();
                        }
                      });
                }
              },
              "MiniCafe-photo")
          .start();
    }
  }

  @Override
  protected void onDestroy() {
    if (fileCallback != null) {
      fileCallback.onReceiveValue(null);
      fileCallback = null;
    }
    if (web != null) web.destroy();
    revealHandler.removeCallbacksAndMessages(null);
    super.onDestroy();
  }
}
