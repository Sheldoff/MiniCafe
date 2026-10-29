package ua.minicafe.mobile;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.*;
import android.transition.*;
import android.view.*;
import android.widget.*;
import com.google.zxing.*;
import java.io.*;
import java.net.*;
import java.util.*;

public class HostActivity extends Activity {
  private boolean nativeDark;
  private String page = "";
  private EditText remoteAddress;
  private Spinner remoteRole;
  private String remoteDraft;
  private int remoteRoleDraft = -1;
  private final String[] routes = CafeRoles.VIEWS;
  private Button primaryAction;
  private LinearLayout controls;
  private TextView serverStatus;
  private String controlsState = "";
  private String shareRoute = "bar";

  private void transition(ViewGroup box) {
    TransitionManager.endTransitions(box);
    TransitionSet t = new TransitionSet().setOrdering(TransitionSet.ORDERING_TOGETHER);
    t.addTransition(new ChangeBounds()).addTransition(new Fade());
    t.setDuration(180);
    TransitionManager.beginDelayedTransition(box, t);
  }

  private LinearLayout root;
  private final Handler handler = new Handler();
  private String screen = "", url = "";
  private boolean alive = true;
  private byte[] exportData;

  private int px(int n) {
    return (int) (getResources().getDisplayMetrics().density * n);
  }

  private TextView text(String value, int size) {
    TextView t = new TextView(this);
    t.setText(value);
    t.setTextSize(size);
    t.setTextColor(CafeUi.text(this));
    t.setPadding(0, px(9), 0, px(9));
    return t;
  }

  private Button button(String name, Runnable action) {
    Button b = CafeUi.button(this, name, false);
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.topMargin = px(8);
    root.addView(b, p);
    b.setOnClickListener(v -> action.run());
    return b;
  }

  private void accent(Button b, boolean gold) {
    GradientDrawable bg = new GradientDrawable();
    bg.setColor(gold ? Color.rgb(228, 193, 118) : CafeUi.accent(this));
    bg.setCornerRadius(px(11));
    b.setBackground(bg);
    b.setTextColor(gold ? Color.rgb(23, 54, 43) : CafeUi.onAccent(this));
    b.setTypeface(null, Typeface.BOLD);
  }

  private void navigate(String target) {
    if (remoteAddress != null) {
      remoteDraft = remoteAddress.getText().toString();
      remoteRoleDraft = remoteRole.getSelectedItemPosition();
    }
    page = target;
    root = null;
    primaryAction = null;
    serverStatus = null;
    remoteAddress = null;
    remoteRole = null;
    controlsState = "";
    render();
    root.setAlpha(0f);
    root.animate().alpha(1f).setDuration(180).start();
  }

  private Button navigationButton(String title, Runnable action) {
    Button b = button(title + "  →", action);
    b.getLayoutParams().height = px(64);
    b.setMaxLines(2);
    return b;
  }

  private void group(String title, Runnable content) {
    if (page.isEmpty()) {
      navigationButton(title, () -> navigate(title));
    } else if (page.equals(title)) {
      LinearLayout parent = root;
      root = CafeUi.card(parent);
      content.run();
      root = parent;
    }
  }

  @Override
  public void onBackPressed() {
    if (!page.isEmpty()) navigate("");
    else super.onBackPressed();
  }

  private void remoteConnection() {
    root.addView(text("Вставте повне посилання з ?key=… або відскануйте QR-код сервера.", 13));
    remoteAddress = new EditText(this);
    remoteAddress.setSingleLine(true);
    remoteAddress.setInputType(17);
    remoteAddress.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_DONE);
    remoteAddress.setHint("https://…/?key=…");
    remoteAddress.setText(
        remoteDraft != null
            ? remoteDraft
            : getSharedPreferences("MainActivity", 0).getString("server", ""));
    CafeUi.field(remoteAddress);
    root.addView(remoteAddress);
    remoteRole = new Spinner(this);
    remoteRole.setAdapter(
        new ArrayAdapter<String>(
            this, android.R.layout.simple_spinner_dropdown_item, CafeRoles.LABELS));
    int saved =
        remoteRoleDraft >= 0
            ? remoteRoleDraft
            : getSharedPreferences("MainActivity", 0)
                .getInt(
                    "role_v2",
                    CafeRoles.legacy(getSharedPreferences("MainActivity", 0).getInt("role", 0)));
    remoteRole.setSelection(Math.max(0, Math.min(4, saved)));
    remoteRole.setMinimumHeight(px(48));
    root.addView(text("Відкрити як", 13));
    root.addView(remoteRole);
    Button scan =
        button(
            "Сканувати QR-код",
            () -> startActivityForResult(new Intent(this, ScanActivity.class), 41));
    Button connect = button("Підключитися", () -> connectRemote());
    accent(connect, false);
    root.removeView(scan);
    root.removeView(connect);
    CafeUi.actions(root, connect, scan);
  }

  private void connectRemote() {
    try {
      String server = CafeLink.connection(remoteAddress.getText().toString());
      int selected = remoteRole.getSelectedItemPosition();
      getSharedPreferences("MainActivity", 0)
          .edit()
          .putString("server", server)
          .putInt("role_v2", selected)
          .apply();
      startActivity(
          new Intent(this, MainActivity.class)
              .putExtra("connectUrl", server)
              .putExtra("connectRoute", routes[selected]));
    } catch (Exception e) {
      new AlertDialog.Builder(this)
          .setTitle("Перевірте посилання")
          .setMessage("Потрібне повне HTTP або HTTPS посилання з ключем ?key=…")
          .setPositiveButton("Добре", null)
          .show();
    }
  }

  public static List<String> addresses() {
    List<String> ips = new ArrayList<>();
    try {
      Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
      while (interfaces.hasMoreElements()) {
        NetworkInterface net = interfaces.nextElement();
        if (!net.isUp() || net.isLoopback()) continue;
        Enumeration<InetAddress> addrs = net.getInetAddresses();
        while (addrs.hasMoreElements()) {
          InetAddress ip = addrs.nextElement();
          if (ip instanceof Inet4Address && !ip.isLoopbackAddress() && !ip.isLinkLocalAddress())
            ips.add(ip.getHostAddress());
        }
      }
    } catch (Exception ignored) {
    }
    Collections.sort(ips);
    return ips;
  }

  @Override
  public void onCreate(Bundle b) {
    nativeDark = CafeUi.applyTheme(this);
    super.onCreate(b);
    if (b != null) {
      page = b.getString("page", "");
      remoteDraft = b.getString("remote_address");
      remoteRoleDraft = b.getInt("remote_role", -1);
    }
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    if (ServerService.error.isEmpty() && !ServerService.running && !ServerService.starting)
      ServerService.error = getSharedPreferences("host", 0).getString("server_error", "");
    render();
    if (Build.VERSION.SDK_INT >= 33)
      registerReceiver(
          serviceChanges,
          new IntentFilter(ServerService.ACTION_STATUS),
          Context.RECEIVER_NOT_EXPORTED);
    else registerReceiver(serviceChanges, new IntentFilter(ServerService.ACTION_STATUS));
    handler.post(tick);
  }

  private final BroadcastReceiver serviceChanges =
      new BroadcastReceiver() {
        public void onReceive(Context c, Intent i) {
          if (alive) render();
        }
      };
  private final Runnable tick =
      new Runnable() {
        public void run() {
          if (!alive) return;
          String state =
              ServerService.running
                  + "|"
                  + ServerService.starting
                  + "|"
                  + ServerService.stage
                  + "|"
                  + ServerService.error
                  + "|"
                  + addresses();
          if (!state.equals(screen)) {
            screen = state;
            render();
          }
          handler.postDelayed(this, 1500);
        }
      };

  private void render() {
    ServerService.Status state = ServerService.snapshot();
    if (!state.running && !page.isEmpty() && !page.equals("Підключитися до іншого сервера")) {
      navigate("");
      return;
    }
    if (remoteAddress != null) {
      remoteDraft = remoteAddress.getText().toString();
      remoteRoleDraft = remoteRole.getSelectedItemPosition();
    }
    boolean fresh = root == null;
    if (fresh) {
      root = CafeUi.screen(this, 840);
      if (!page.isEmpty()) {
        button("← Назад до сервера", () -> navigate(""));
        CafeUi.label(root, page, 24, false);
      }
      if (page.isEmpty()) {
        root.addView(text("☕ МініКафе", 16));
        CafeUi.label(root, "Підключення", 28, false);
        CafeUi.label(root, "Оберіть сервер для роботи каси та видачі.", 14, true);
        LinearLayout page = root;
        root = CafeUi.card(page);
        CafeUi.label(root, "Сервер на цьому пристрої", 19, false);
        serverStatus = text("", 14);
        root.addView(serverStatus);
        primaryAction =
            button(
                "",
                () -> {
                  if (ServerService.snapshot().running) {
                    startActivity(new Intent(this, MainActivity.class).putExtra("local", true));
                    overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
                  } else start();
                });
        root = page;
      }
      controls = new LinearLayout(this);
      controls.setOrientation(1);
      root.addView(controls);
    }
    if (serverStatus != null)
      serverStatus.setText(
          state.running
              ? "● Сервер цього телефона працює"
              : state.starting ? "◌ Сервер запускається…" : "○ Сервер цього телефона зупинено");
    String title =
        state.running
            ? "Почати роботу"
            : state.starting ? "Сервер запускається…" : "Запустити сервер цього телефона";
    if (primaryAction != null && !title.contentEquals(primaryAction.getText())) {
      primaryAction.setText(title);
      accent(primaryAction, state.running);
      if (!fresh) {
        primaryAction.setAlpha(.55f);
        primaryAction.animate().alpha(1f).setDuration(180).start();
      }
    }
    if (primaryAction != null) primaryAction.setEnabled(!state.starting);
    String next =
        state.running + "|" + state.starting + "|" + state.error + "|" + addresses() + "|" + page;
    if (!fresh && next.equals(controlsState)) return;
    controlsState = next;
    LinearLayout outer = root;
    if (!fresh) transition(outer);
    controls.removeAllViews();
    root = controls;
    if (state.running) {
      group(
          "Підключити інший пристрій",
          () -> {
            Spinner shareRole = new Spinner(this);
            String[] sharedRoutes = CafeRoles.KEYS;
            shareRole.setAdapter(
                new ArrayAdapter<String>(
                    this, android.R.layout.simple_spinner_dropdown_item, CafeRoles.LABELS));
            shareRoute =
                getSharedPreferences("connection_ui", 0).getString("share_role", "service");
            int chosenRole = java.util.Arrays.asList(sharedRoutes).indexOf(shareRoute);
            shareRole.setSelection(Math.max(0, chosenRole));
            root.addView(text("Хто підключається", 13));
            shareRole.setMinimumHeight(px(48));
            root.addView(shareRole);
            shareRole.setOnItemSelectedListener(
                new AdapterView.OnItemSelectedListener() {
                  public void onNothingSelected(AdapterView<?> p) {}

                  public void onItemSelected(AdapterView<?> p, View v, int i, long id) {
                    if (!shareRoute.equals(sharedRoutes[i])) {
                      shareRoute = sharedRoutes[i];
                      getSharedPreferences("connection_ui", 0)
                          .edit()
                          .putString("share_role", shareRoute)
                          .apply();
                      controlsState = "";
                      render();
                    }
                  }
                });
            root.addView(
                text(
                    "Для Wi-Fi пристрої мають бути в одній мережі. QR і посилання передавайте лише"
                        + " персоналу.",
                    13));
            List<String> ips = addresses();
            if (ips.isEmpty())
              root.addView(
                  text(
                      "Увімкніть Wi-Fi або точку доступу. На цьому телефоні каса вже працює.", 13));
            else {
              Spinner picker = new Spinner(this);
              picker.setMinimumHeight(px(48));
              picker.setAdapter(
                  new ArrayAdapter<String>(
                      this, android.R.layout.simple_spinner_dropdown_item, ips));
              String chosen = getSharedPreferences("connection_ui", 0).getString("local_ip", "");
              int selected = ips.indexOf(chosen);
              if (selected >= 0) picker.setSelection(selected);
              root.addView(picker);
              ImageView qr = new ImageView(this);
              qr.setBackgroundColor(Color.WHITE);
              LinearLayout.LayoutParams qrSize = new LinearLayout.LayoutParams(px(220), px(220));
              qrSize.gravity = Gravity.CENTER_HORIZONTAL;
              qrSize.topMargin = px(10);
              qrSize.bottomMargin = px(8);
              qr.setContentDescription("QR-код підключення через Wi-Fi");
              root.addView(qr, qrSize);
              TextView link = text("", 12);
              link.setTextIsSelectable(true);
              root.addView(link);
              picker.setOnItemSelectedListener(
                  new AdapterView.OnItemSelectedListener() {
                    public void onNothingSelected(AdapterView<?> p) {}

                    public void onItemSelected(AdapterView<?> p, View v, int i, long id) {
                      getSharedPreferences("connection_ui", 0)
                          .edit()
                          .putString("local_ip", ips.get(i))
                          .apply();
                      url =
                          "http://"
                              + ips.get(i)
                              + ":8765/?key="
                              + ServerService.roleKey(HostActivity.this, shareRoute)
                              + "#"
                              + CafeRoles.VIEWS[CafeRoles.index(shareRoute)];
                      link.setText(url);
                      CafeQr.show(
                          qr,
                          url,
                          480,
                          () -> link.setText("Не вдалося створити QR. Скопіюйте посилання."));
                    }
                  });
              button(
                  "Скопіювати Wi-Fi посилання",
                  () -> {
                    if (url.isEmpty()) return;
                    ((ClipboardManager) getSystemService(CLIPBOARD_SERVICE))
                        .setPrimaryClip(ClipData.newPlainText("МініКафе", url));
                    Toast.makeText(this, "Посилання скопійовано", Toast.LENGTH_SHORT).show();
                  });
            }
            button(
                "Відкликати посилання персоналу",
                () ->
                    new AlertDialog.Builder(this)
                        .setMessage(
                            "Старі посилання бариста, каси та видачі перестануть працювати."
                                + " Посилання власника залишиться чинним. Створити нові ключі?")
                        .setNegativeButton("Скасувати", null)
                        .setPositiveButton(
                            "Відкликати",
                            (d, w) -> {
                              try {
                                ServerService.access.rotate();
                                controlsState = "";
                                render();
                              } catch (Exception e) {
                                fail(e);
                              }
                            })
                        .show());
          });
    } else if (page.isEmpty()) {
      root.addView(
          text(
              "Цей телефон може зберігати меню та замовлення або підключитися до іншого сервера.",
              14));
      if (state.starting) root.addView(text(state.stage, 13));
      if (!state.error.isEmpty()) root.addView(text("Не вдалося запустити: " + state.error, 13));
    }
    if (state.running && page.isEmpty()) {
      navigationButton(
          "Налаштувати Termux", () -> startActivity(new Intent(this, InternetActivity.class)));
    }
    group("Підключитися до іншого сервера", () -> remoteConnection());
    if (state.running) {
      group(
          "Меню та резервні копії",
          () -> {
            button("Перенести меню з іншого сервера", () -> copyMenu());
            Button save = button("Зберегти копію", () -> exportBackup());
            Button restore = button("Відновити копію", () -> chooseRestore());
            root.removeView(save);
            root.removeView(restore);
            CafeUi.actions(root, save, restore);
          });
      if (page.isEmpty()) {
        Button stop =
            button(
                "Зупинити сервер",
                () ->
                    new AlertDialog.Builder(this)
                        .setMessage(
                            "Інші пристрої втратять з’єднання. Замовлення збережуться. Зупинити"
                                + " сервер?")
                        .setPositiveButton(
                            "Зупинити",
                            (d, w) -> {
                              stopService(new Intent(this, ServerService.class));
                              handler.postDelayed(() -> render(), 300);
                            })
                        .setNegativeButton("Ні", null)
                        .show());
        stop.setTextColor(CafeUi.dark(this) ? Color.rgb(255, 185, 168) : Color.rgb(154, 63, 49));
        root.addView(
            text(
                "Тримайте серверний телефон на зарядці та дозвольте фонову роботу. Перед видаленням"
                    + " застосунку збережіть резервну копію.",
                12));
      }
    }
    root = outer;
  }

  private void start() {
    if (ServerService.starting || ServerService.running) return;
    try {
      Intent i = new Intent(this, ServerService.class);
      if (Build.VERSION.SDK_INT >= 26) startForegroundService(i);
      else startService(i);
      primaryAction.setText("Сервер запускається…");
      primaryAction.setEnabled(false);
      Toast.makeText(this, "Сервер запускається…", Toast.LENGTH_SHORT).show();
      handler.postDelayed(
          () -> {
            if (alive
                && !ServerService.running
                && !ServerService.starting
                && ServerService.error.isEmpty()) {
              ServerService.error =
                  "Android не запустив службу сервера. Відкрийте налаштування застосунку й"
                      + " дозвольте роботу у фоні, потім повторіть запуск.";
              render();
            }
          },
          7000);
    } catch (Exception e) {
      render();
      new AlertDialog.Builder(this)
          .setMessage("Не вдалося запустити сервер: " + e.getMessage())
          .setPositiveButton("Добре", null)
          .show();
    }
  }

  private void fail(Exception e) {
    runOnUiThread(
        () ->
            new AlertDialog.Builder(this)
                .setMessage("Не вдалося виконати дію: " + e.getMessage())
                .setPositiveButton("Добре", null)
                .show());
  }

  private byte[] download(String target, String key, int max) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(target).openConnection();
    c.setConnectTimeout(7000);
    c.setReadTimeout(15000);
    c.setInstanceFollowRedirects(false);
    c.setRequestProperty("X-Cafe-Key", key);
    try {
      if (c.getResponseCode() != 200)
        throw new Exception("Сервер не відповів або ключ доступу неправильний");
      try (InputStream in = c.getInputStream()) {
        return CafeStore.readBytes(in, max);
      }
    } finally {
      c.disconnect();
    }
  }

  private void copyMenu() {
    EditText field = new EditText(this);
    field.setSingleLine(true);
    field.setInputType(17);
    field.setHint("http://192.168.…:8765/?key=…");
    new AlertDialog.Builder(this)
        .setTitle("Перенести меню")
        .setMessage(
            "Вставте посилання попереднього сервера. Поточне меню телефона буде замінено, а"
                + " замовлення залишаться. Спочатку збережіть резервну копію.")
        .setView(field)
        .setNegativeButton("Скасувати", null)
        .setPositiveButton(
            "Перенести",
            (dialog, which) -> {
              String value = field.getText().toString().trim();
              new Thread(
                      () -> {
                        try {
                          URI parsed = new URI(value);
                          Uri address = Uri.parse(value);
                          String key = address.getQueryParameter("key");
                          if ((!"http".equalsIgnoreCase(parsed.getScheme())
                                  && !"https".equalsIgnoreCase(parsed.getScheme()))
                              || parsed.getHost() == null
                              || parsed.getUserInfo() != null
                              || key == null
                              || !key.matches("[A-Za-z0-9_-]+"))
                            throw new Exception("Вставте повне посилання з ключем");
                          String base = parsed.getScheme() + "://" + parsed.getRawAuthority();
                          org.json.JSONArray products =
                              new org.json.JSONObject(
                                      new String(
                                          download(base + "/api/state", key, 10000000), "UTF-8"))
                                  .getJSONArray("products");
                          for (int i = 0; i < products.length(); i++) {
                            org.json.JSONObject p = products.getJSONObject(i);
                            if (p.has("image_version") && !p.isNull("image_version")) {
                              byte[] bytes =
                                  download(
                                      base + "/api/image/" + p.getInt("id") + "?key=" + key,
                                      key,
                                      2000000);
                              p.put(
                                  "image",
                                  android.util.Base64.encodeToString(
                                      bytes, android.util.Base64.NO_WRAP));
                            }
                          }
                          CafeStore db = ServerService.store;
                          if (db == null) throw new Exception("Спочатку запустіть сервер телефона");
                          db.importMenu(products);
                          try {
                            PhotoFiles.optimizeMenu(db);
                          } catch (Exception imageError) {
                            android.util.Log.w(
                                "MiniCafe", "Imported images left unchanged", imageError);
                          }
                          runOnUiThread(
                              () ->
                                  Toast.makeText(
                                          this,
                                          "Меню й картинки перенесено. Оновіть касу.",
                                          Toast.LENGTH_LONG)
                                      .show());
                        } catch (Exception e) {
                          fail(e);
                        }
                      },
                      "MiniCafe-menu-import")
                  .start();
              Toast.makeText(this, "Перенесення меню…", Toast.LENGTH_SHORT).show();
            })
        .show();
  }

  private void exportBackup() {
    try {
      CafeStore db = ServerService.store;
      if (db == null) throw new Exception("Спочатку запустіть сервер");
      exportData = db.backup();
      Intent i =
          new Intent(Intent.ACTION_CREATE_DOCUMENT)
              .addCategory(Intent.CATEGORY_OPENABLE)
              .setType("application/json")
              .putExtra(Intent.EXTRA_TITLE, "MiniCafe-backup.json");
      startActivityForResult(i, 50);
    } catch (Exception e) {
      fail(e);
    }
  }

  private void chooseRestore() {
    new AlertDialog.Builder(this)
        .setMessage(
            "Відновлення замінить меню й замовлення цього сервера. Спочатку збережіть поточну"
                + " резервну копію. Продовжити?")
        .setPositiveButton(
            "Обрати копію",
            (d, w) -> {
              try {
                startActivityForResult(
                    new Intent(Intent.ACTION_OPEN_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("*/*"),
                    51);
              } catch (Exception e) {
                fail(e);
              }
            })
        .setNegativeButton("Скасувати", null)
        .show();
  }

  @Override
  protected void onActivityResult(int req, int result, Intent value) {
    super.onActivityResult(req, result, value);
    if (req == 41) {
      if (result == RESULT_OK && value != null) {
        String scanned = value.getStringExtra("url");
        if (scanned != null) {
          remoteAddress.setText(scanned);
          String fragment = Uri.parse(scanned).getFragment();
          for (int i = 0; i < routes.length; i++)
            if (routes[i].equals(fragment)) remoteRole.setSelection(i);
          connectRemote();
        }
      }
      return;
    }
    if (result != RESULT_OK || value == null || value.getData() == null) {
      exportData = null;
      return;
    }
    Uri uri = value.getData();
    if (req == 50) {
      byte[] bytes = exportData;
      exportData = null;
      new Thread(
              () -> {
                try {
                  if (bytes == null) throw new Exception("Повторіть збереження копії");
                  try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                    out.write(bytes);
                  }
                  runOnUiThread(
                      () ->
                          Toast.makeText(this, "Резервну копію збережено", Toast.LENGTH_LONG)
                              .show());
                } catch (Exception e) {
                  fail(e);
                }
              })
          .start();
    } else if (req == 51)
      new Thread(
              () -> {
                try {
                  CafeStore db = ServerService.store;
                  if (db == null) throw new Exception("Спочатку запустіть сервер");
                  try (InputStream in = getContentResolver().openInputStream(uri)) {
                    db.restore(CafeStore.readBytes(in, 80000000));
                  }
                  runOnUiThread(
                      () ->
                          Toast.makeText(
                                  this,
                                  "Дані відновлено. Оновіть екрани каси та інших пристроїв.",
                                  Toast.LENGTH_LONG)
                              .show());
                } catch (Exception e) {
                  fail(e);
                }
              })
          .start();
  }

  @Override
  protected void onSaveInstanceState(Bundle out) {
    out.putString("page", page);
    if (remoteAddress != null) {
      out.putString("remote_address", remoteAddress.getText().toString());
      out.putInt("remote_role", remoteRole.getSelectedItemPosition());
    }
    super.onSaveInstanceState(out);
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (nativeDark != CafeUi.dark(this)) recreate();
  }

  @Override
  protected void onDestroy() {
    alive = false;
    try {
      unregisterReceiver(serviceChanges);
    } catch (Exception ignored) {
    }
    handler.removeCallbacks(tick);
    super.onDestroy();
  }
}
