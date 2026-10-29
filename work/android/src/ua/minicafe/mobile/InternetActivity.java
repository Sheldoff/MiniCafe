package ua.minicafe.mobile;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.os.*;
import android.text.*;
import android.view.*;
import android.widget.*;
import com.google.zxing.*;
import java.io.*;
import java.net.*;
import org.json.*;

/** Manual Termux integration; no shell access permission is requested. */
public class InternetActivity extends Activity {
  private boolean nativeDark;
  public static final String INSTALL = "pkg update -y && pkg install cloudflared -y";
  public static final String START =
      "termux-wake-lock\n"
          + "cloudflared tunnel --url http://127.0.0.1:8765 --protocol http2 2>&1 | grep"
          + " --line-buffered -oE 'https://[a-z0-9-]+\\.trycloudflare\\.com|.*ERR.*'";
  private LinearLayout root, sharing;
  private EditText address;
  private TextView status, link;
  private ImageView qr;
  private Spinner role;
  private Button verify;
  private String verified = "", shareUrl = "";
  private boolean alive = true;
  private int request = 0;

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

  private Button button(LinearLayout parent, String title, Runnable action) {
    Button b = CafeUi.button(this, title, true);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
    lp.topMargin = px(8);
    parent.addView(b, lp);
    b.setOnClickListener(v -> action.run());
    return b;
  }

  private void copy(String value) {
    ((android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE))
        .setPrimaryClip(ClipData.newPlainText("МініКафе", value));
    Toast.makeText(this, "Скопійовано", Toast.LENGTH_SHORT).show();
  }

  private Button action(String title, boolean primary, Runnable click) {
    Button b = CafeUi.button(this, title, primary);
    b.setOnClickListener(v -> click.run());
    return b;
  }

  private void localCash() {
    if (!ServerService.running) {
      showError("Спочатку запустіть сервер МініКафе");
      return;
    }
    startActivity(
        new Intent(this, MainActivity.class)
            .putExtra("local", true)
            .putExtra("localRoute", "cash"));
  }

  private void fold(LinearLayout parent, String title, Runnable contents) {
    LinearLayout card = CafeUi.card(parent), body = new LinearLayout(this);
    body.setOrientation(1);
    Button toggle = action(title + "  ▾", false, () -> {});
    toggle.setGravity(Gravity.LEFT | Gravity.CENTER_VERTICAL);
    toggle.setTypeface(null, Typeface.BOLD);
    toggle.setBackgroundColor(Color.TRANSPARENT);
    card.addView(toggle, new LinearLayout.LayoutParams(-1, -2));
    card.addView(body);
    LinearLayout previous = root;
    root = body;
    contents.run();
    root = previous;
    new CafeDisclosure(toggle, body, title);
  }

  private void sharingVisible(boolean visible) {
    if (sharing == null || (sharing.getVisibility() == View.VISIBLE) == visible) return;
    android.transition.TransitionManager.endTransitions(root);
    android.transition.TransitionSet transition = new android.transition.TransitionSet();
    transition
        .addTransition(new android.transition.ChangeBounds())
        .addTransition(new android.transition.Fade());
    transition.setDuration(180);
    android.transition.TransitionManager.beginDelayedTransition(root, transition);
    sharing.setVisibility(visible ? View.VISIBLE : View.GONE);
  }

  @Override
  public void onCreate(Bundle saved) {
    nativeDark = CafeUi.applyTheme(this);
    super.onCreate(saved);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    root = CafeUi.screen(this, 840);
    button(root, "← Назад до сервера", () -> finish());
    fold(
        root,
        "Перше налаштування Termux",
        () -> {
          CafeUi.label(
              root,
              "Потрібне лише один раз. Вставте команду в Termux, натисніть Enter і дочекайтеся"
                  + " рядка ~ $.",
              14,
              true);
          button(
              root,
              "Завантажити Termux з F-Droid",
              () ->
                  startActivity(
                      new Intent(
                          Intent.ACTION_VIEW,
                          android.net.Uri.parse("https://f-droid.org/packages/com.termux/"))));
          CafeUi.actions(
              root,
              action(
                  "Скопіювати та відкрити Termux",
                  true,
                  () -> {
                    copy(INSTALL);
                    openTermux();
                  }),
              action("Лише скопіювати команду", false, () -> copy(INSTALL)));
        });
    LinearLayout launch = CafeUi.card(root);
    CafeUi.label(launch, "1   Запустіть тунель", 20, false);
    CafeUi.label(
        launch,
        "Вставте команду в Termux та натисніть Enter. Вона покаже лише адресу"
            + " https://…trycloudflare.com або помилку.",
        14,
        true);
    CafeUi.actions(
        launch,
        action(
            "Скопіювати та відкрити Termux",
            true,
            () -> {
              copy(START);
              openTermux();
            }),
        action("Лише скопіювати команду", false, () -> copy(START)));
    CafeUi.label(
        launch,
        "Скопіюйте отриману адресу й поверніться сюди. Termux залиште працювати.",
        13,
        true);
    LinearLayout connection = CafeUi.card(root);
    CafeUi.label(connection, "2   Перевірте адресу", 20, false);
    CafeUi.label(connection, "Адреса тунелю з Termux", 13, true);
    address = new EditText(this);
    address.setSingleLine(true);
    address.setInputType(17);
    CafeUi.field(address);
    address.setHint("https://…trycloudflare.com");
    address.setText(
        saved != null
            ? saved.getString("address", "")
            : getSharedPreferences("host", 0).getString("tunnel_origin", ""));
    connection.addView(address, new LinearLayout.LayoutParams(-1, -2));
    LinearLayout editActions = new LinearLayout(this);
    editActions.setOrientation(0);
    connection.addView(editActions);
    Button paste =
        action(
            "Вставити",
            false,
            () -> {
              android.content.ClipboardManager clipboard =
                  (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
              if (!clipboard.hasPrimaryClip() || clipboard.getPrimaryClip().getItemCount() == 0) {
                Toast.makeText(this, "Буфер обміну порожній", Toast.LENGTH_SHORT).show();
                return;
              }
              String value =
                  clipboard.getPrimaryClip().getItemAt(0).coerceToText(this).toString().trim();
              java.util.regex.Matcher match =
                  java.util.regex.Pattern.compile("https://[a-z0-9-]+\\.trycloudflare\\.com")
                      .matcher(value);
              address.setText(match.find() ? match.group() : value);
              address.setSelection(address.length());
            });
    Button clear = action("Очистити", false, () -> address.setText(""));
    for (Button b : new Button[] {paste, clear}) {
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1);
      lp.topMargin = px(8);
      if (b == clear) lp.leftMargin = px(8);
      editActions.addView(b, lp);
    }
    status = CafeUi.label(connection, "Адреса ще не перевірена", 14, true);
    verify = action("Перевірити адресу", true, () -> checkTunnel());
    LinearLayout.LayoutParams vp = new LinearLayout.LayoutParams(-1, -2);
    vp.topMargin = px(8);
    connection.addView(verify, vp);
    sharing = CafeUi.card(root);
    sharing.setVisibility(View.GONE);
    CafeUi.label(sharing, "3   Підключіть працівника", 20, false);
    CafeUi.label(sharing, "Хто підключається", 13, true);
    role = new Spinner(this);
    role.setMinimumHeight(px(48));
    role.setAdapter(
        new ArrayAdapter<String>(
            this, android.R.layout.simple_spinner_dropdown_item, CafeRoles.LABELS));
    sharing.addView(role);
    role.setSelection(
        CafeRoles.index(saved != null ? saved.getString("share_role", "service") : "service"));
    qr = new ImageView(this);
    qr.setBackgroundColor(Color.WHITE);
    qr.setContentDescription("QR-код підключення працівника");
    LinearLayout.LayoutParams qp =
        new LinearLayout.LayoutParams(
            px(Math.min(240, getResources().getConfiguration().screenWidthDp - 72)),
            px(Math.min(240, getResources().getConfiguration().screenWidthDp - 72)));
    qp.gravity = Gravity.CENTER_HORIZONTAL;
    qp.topMargin = px(12);
    qp.bottomMargin = px(12);
    sharing.addView(qr, qp);
    link = CafeUi.label(sharing, "", 13, true);
    link.setTextIsSelectable(true);
    CafeUi.actions(
        sharing,
        action(
            "Скопіювати посилання",
            true,
            () -> {
              if (ServerService.running && !shareUrl.isEmpty()) copy(shareUrl);
              else showError("Запустіть сервер і перевірте адресу");
            }),
        action(
            "Поділитися",
            false,
            () -> {
              if (!shareUrl.isEmpty())
                startActivity(
                    Intent.createChooser(
                        new Intent(Intent.ACTION_SEND)
                            .setType("text/plain")
                            .putExtra(Intent.EXTRA_TEXT, shareUrl),
                        "Передати посилання"));
            }));
    CafeUi.label(
        sharing,
        "Відскануйте QR або відкрийте повне посилання на іншому пристрої. Передавайте лише"
            + " персоналу.",
        13,
        true);
    Button begin = action("Почати роботу", true, () -> localCash());
    android.graphics.drawable.GradientDrawable beginBackground =
        new android.graphics.drawable.GradientDrawable();
    beginBackground.setColor(Color.rgb(228, 193, 118));
    beginBackground.setCornerRadius(px(11));
    begin.setBackground(beginBackground);
    begin.setTextColor(Color.rgb(23, 54, 43));
    LinearLayout.LayoutParams beginParams = new LinearLayout.LayoutParams(-1, px(56));
    beginParams.topMargin = px(12);
    sharing.addView(begin, beginParams);
    role.setOnItemSelectedListener(
        new AdapterView.OnItemSelectedListener() {
          public void onNothingSelected(AdapterView<?> p) {}

          public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
            drawQr();
          }
        });
    address.addTextChangedListener(
        new TextWatcher() {
          public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

          public void onTextChanged(CharSequence s, int start, int before, int count) {
            ++request;
            verified = "";
            shareUrl = "";
            sharingVisible(false);
            status.setText("Адреса ще не перевірена");
            verify.setEnabled(true);
          }

          public void afterTextChanged(Editable e) {}
        });
    fold(
        root,
        "Допомога та зупинка тунелю",
        () -> {
          CafeUi.label(
              root,
              "Новий запуск тунелю створює нову адресу — вставте її та перевірте знову. Якщо тунель"
                  + " уже запущений, перед повторним запуском натисніть Ctrl+C у Termux.",
              14,
              true);
          CafeUi.label(
              root,
              "Щоб зупинити інтернет-доступ, натисніть Ctrl+C у сесії тунелю. Wi-Fi та локальна"
                  + " каса продовжать працювати. Ctrl можна затиснути на панелі Termux або кнопкою"
                  + " зменшення гучності.",
              14,
              true);
          CafeUi.actions(root, action("Відкрити Termux", false, () -> openTermux()));
          CafeUi.label(
              root,
              "Дозвольте МініКафе та Termux фонову роботу без обмежень батареї. Quick Tunnel не"
                  + " гарантує постійної доступності.",
              13,
              true);
        });
  }

  @Override
  protected void onSaveInstanceState(Bundle out) {
    out.putString("address", address.getText().toString());
    out.putString("share_role", CafeRoles.KEYS[role.getSelectedItemPosition()]);
    super.onSaveInstanceState(out);
  }

  private void openTermux() {
    try {
      Intent intent = getPackageManager().getLaunchIntentForPackage("com.termux");
      if (intent == null)
        throw new Exception("Termux не знайдено. Відкрийте встановлений Termux вручну.");
      startActivity(intent);
    } catch (Exception e) {
      showError(e.getMessage());
    }
  }

  private void showError(String value) {
    new AlertDialog.Builder(this).setMessage(value).setPositiveButton("Добре", null).show();
  }

  private void checkTunnel() {
    if (!ServerService.running) {
      showError("Спочатку запустіть сервер МініКафе");
      return;
    }
    final String origin;
    try {
      origin = CafeLink.tunnelOrigin(address.getText().toString());
    } catch (Exception e) {
      showError(e.getMessage());
      return;
    }
    int serial = ++request;
    address.clearFocus();
    ((android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE))
        .hideSoftInputFromWindow(address.getWindowToken(), 0);
    sharingVisible(false);
    verified = "";
    shareUrl = "";
    verify.setEnabled(false);
    status.setText("Перевіряємо доступ через інтернет…");
    String key = ServerService.roleKey(this, CafeRoles.KEYS[role.getSelectedItemPosition()]);
    new Thread(
            () -> {
              String problem = null;
              try {
                HttpURLConnection c =
                    (HttpURLConnection) new URL(origin + "/api/ping").openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(10000);
                c.setInstanceFollowRedirects(false);
                c.setRequestProperty("X-Cafe-Key", key);
                c.setRequestProperty("Cache-Control", "no-cache");
                try {
                  int code = c.getResponseCode();
                  if (code != 200)
                    throw new IOException(
                        "HTTP "
                            + code
                            + ". Переконайтеся, що сервер і тунель працюють; після появи адреси"
                            + " зачекайте кілька секунд.");
                  JSONObject reply;
                  try (InputStream in = c.getInputStream()) {
                    reply = new JSONObject(new String(CafeStore.readBytes(in, 10000), "UTF-8"));
                  }
                  if (!reply.optBoolean("ok") || !"minicafe".equals(reply.optString("app")))
                    throw new IOException("Адреса не веде до сервера МініКафе");
                } finally {
                  c.disconnect();
                }
              } catch (Exception e) {
                problem = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
              }
              final String error = problem;
              runOnUiThread(
                  () -> {
                    if (!alive || serial != request) return;
                    verify.setEnabled(true);
                    if (error != null) {
                      status.setText("Не вдалося підключитися: " + error);
                      return;
                    }
                    if (!ServerService.running) {
                      status.setText(
                          "Локальний сервер зупинено. Запустіть його та повторіть перевірку.");
                      return;
                    }
                    verified = origin;
                    getSharedPreferences("host", 0)
                        .edit()
                        .putString("tunnel_origin", origin)
                        .apply();
                    status.setText("● Інтернет-з’єднання перевірено");
                    sharingVisible(true);
                    drawQr();
                  });
            },
            "MiniCafe-tunnel-check")
        .start();
  }

  private void drawQr() {
    if (verified.isEmpty()) return;
    String[] routes = CafeRoles.VIEWS;
    shareUrl =
        verified
            + "/?key="
            + ServerService.roleKey(this, CafeRoles.KEYS[role.getSelectedItemPosition()])
            + "#"
            + routes[role.getSelectedItemPosition()];
    link.setText(shareUrl);
    CafeQr.show(
        qr,
        shareUrl,
        640,
        () -> status.setText("Посилання готове, але QR створити не вдалося. Скопіюйте посилання."));
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (nativeDark != CafeUi.dark(this)) recreate();
  }

  @Override
  protected void onDestroy() {
    alive = false;
    ++request;
    super.onDestroy();
  }
}
