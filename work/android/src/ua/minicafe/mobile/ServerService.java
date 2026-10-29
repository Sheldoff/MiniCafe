package ua.minicafe.mobile;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.*;
import java.io.*;
import java.util.UUID;

public class ServerService extends Service {
  public static final String ACTION_STATUS = "ua.minicafe.mobile.SERVER_STATUS";

  public static final class Status {
    public final boolean running, starting;
    public final String stage, error;

    private Status(boolean r, boolean s, String t, String e) {
      running = r;
      starting = s;
      stage = t;
      error = e;
    }
  }

  public static Status snapshot() {
    return new Status(running, starting, stage, error);
  }

  private void publish() {
    sendBroadcast(new Intent(ACTION_STATUS).setPackage(getPackageName()));
  }

  private void stage(String value) {
    stage = value;
    publish();
  }

  public static volatile CafeStore store;
  public static volatile boolean running = false, starting = false;
  public static volatile String stage = "";
  public static volatile String error = "";
  public static volatile AccessControl access;

  public static String roleKey(Context c, String route) {
    try {
      AccessControl a = access;
      return a == null ? key(c) : a.key(route);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private CafeHttpServer server;
  private PowerManager.WakeLock wake;
  private WifiManager.WifiLock wifi;
  private volatile boolean stopped;
  private final Handler main = new Handler(Looper.getMainLooper());

  public static String key(Context c) {
    android.content.SharedPreferences p = c.getSharedPreferences("host", 0);
    String key = p.getString("key", null);
    if (key == null) {
      key = UUID.randomUUID().toString().replace("-", "");
      p.edit().putString("key", key).commit();
    }
    return key;
  }

  public static org.json.JSONArray baseMenu(Context context) throws Exception {
    try (InputStream in = context.getAssets().open("default-menu.json")) {
      return new org.json.JSONArray(new String(CafeStore.readBytes(in, 10000000), "UTF-8"));
    }
  }

  @Override
  public void onCreate() {
    super.onCreate();
    stopped = false;
  }

  private void launch() {
    synchronized (this) {
      if (running || starting) return;
      starting = true;
      error = "";
      getSharedPreferences("host", 0).edit().remove("server_error").apply();
      stage("Підготовка служби");
    }
    try {
      NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
      String channel = "cafe-server";
      if (Build.VERSION.SDK_INT >= 26)
        nm.createNotificationChannel(
            new NotificationChannel(
                channel, "Сервер МініКафе", NotificationManager.IMPORTANCE_LOW));
      PendingIntent open =
          PendingIntent.getActivity(
              this,
              0,
              new Intent(this, MainActivity.class).putExtra("host", true),
              PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      PendingIntent stop =
          PendingIntent.getService(
              this,
              1,
              new Intent(this, ServerService.class).setAction("stop"),
              PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      Notification.Builder b =
          Build.VERSION.SDK_INT >= 26
              ? new Notification.Builder(this, channel)
              : new Notification.Builder(this);
      Notification n =
          b.setContentTitle("Сервер МініКафе працює")
              .setContentText("Інші пристрої можуть отримувати замовлення")
              .setSmallIcon(ua.minicafe.mobile.R.drawable.cafe_icon)
              .setContentIntent(open)
              .setOngoing(true)
              .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Зупинити", stop)
              .build();
      if (Build.VERSION.SDK_INT >= 29)
        startForeground(14, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
      else startForeground(14, n);
      main.postDelayed(
          () -> {
            if (starting && !stopped)
              failStart(
                  new IOException("Перевищено час запуску: " + stage + ". Спробуйте ще раз."));
          },
          30000);
      new Thread(
              () -> {
                try {
                  stage("Відкриття меню та замовлень");
                  CafeStore database =
                      new CafeStore(new File(getFilesDir(), "cafe-data.json"), baseMenu(this));
                  database.addTestFood();
                  stage("Оптимізація зображень");
                  try {
                    PhotoFiles.optimizeMenu(database);
                  } catch (Exception imageError) {
                    android.util.Log.w("MiniCafe", "Image optimization skipped", imageError);
                  }
                  String html;
                  stage("Завантаження інтерфейсу");
                  try (InputStream in = getAssets().open("index.html")) {
                    html = new String(CafeStore.readBytes(in, 2000000), "UTF-8");
                  }
                  stage("Завантаження шрифту");
                  byte[] font = null;
                  try (InputStream in = getAssets().open("pdf-font.bin")) {
                    font = CafeStore.readBytes(in, 3000000);
                  } catch (IOException assetError) {
                    try {
                      font = PdfFont.fromApk(getApplicationInfo().sourceDir);
                    } catch (IOException fontError) {
                      android.util.Log.w(
                          "MiniCafe",
                          "PDF font unavailable; order server remains available",
                          fontError);
                    }
                  }
                  AccessControl permissions =
                      new AccessControl(new File(getFilesDir(), "staff-access.json"), key(this));
                  CafeHttpServer http =
                      new CafeHttpServer(8765, database, key(this), html, font, permissions);
                  synchronized (this) {
                    if (stopped) return;
                    stage("Відкриття порту 8765");
                    server = http;
                    http.start(10000, false);
                    store = database;
                    access = permissions;
                    try {
                      PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
                      wake = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MiniCafe:server");
                      wake.acquire();
                      WifiManager wm =
                          (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
                      if (wm != null) {
                        wifi =
                            wm.createWifiLock(
                                WifiManager.WIFI_MODE_FULL_HIGH_PERF, "MiniCafe:network");
                        wifi.acquire();
                      }
                    } catch (SecurityException lockError) {
                      android.util.Log.w("MiniCafe", "Power locks unavailable", lockError);
                    }
                    running = true;
                    starting = false;
                    stage = "";
                    publish();
                  }
                } catch (Throwable e) {
                  failStart(e);
                }
              },
              "MiniCafe-start")
          .start();
    } catch (Throwable e) {
      failStart(e);
    }
  }

  private void failStart(Throwable cause) {
    String detail = cause.getMessage();
    error =
        (stage.isEmpty() ? "Запуск сервера" : stage)
            + ": "
            + cause.getClass().getSimpleName()
            + (detail == null ? "" : " — " + detail);
    android.util.Log.e("MiniCafe", error, cause);
    starting = false;
    publish();
    getSharedPreferences("host", 0).edit().putString("server_error", error).apply();
    stopSelf();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int id) {
    if (intent != null && "stop".equals(intent.getAction())) {
      stopSelf();
      return START_NOT_STICKY;
    }
    launch();
    return START_STICKY;
  }

  @Override
  public synchronized void onDestroy() {
    stopped = true;
    running = false;
    starting = false;
    main.removeCallbacksAndMessages(null);
    store = null;
    access = null;
    if (server != null) server.stop();
    if (wake != null && wake.isHeld()) wake.release();
    if (wifi != null && wifi.isHeld()) wifi.release();
    stopForeground(true);
    publish();
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent i) {
    return null;
  }
}
