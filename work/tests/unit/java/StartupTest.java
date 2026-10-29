import java.io.*;
import java.net.*;
import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class StartupTest {
  static byte[] get(int port, String path) throws Exception {
    HttpURLConnection c =
        (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
    c.setConnectTimeout(3000);
    c.setReadTimeout(3000);
    c.setRequestProperty("X-Cafe-Key", "test");
    try {
      if (c.getResponseCode() != 200) throw new AssertionError("HTTP " + c.getResponseCode());
      return CafeStore.readBytes(c.getInputStream(), 2000000);
    } finally {
      c.disconnect();
    }
  }

  public static void main(String[] args) throws Exception {
    Path assets = Paths.get("work/android/assets");
    JSONArray defaults =
        new JSONArray(new String(Files.readAllBytes(assets.resolve("default-menu.json")), "UTF-8"));
    File db = Files.createTempDirectory("cafe-startup").resolve("data.json").toFile();
    String html = new String(Files.readAllBytes(assets.resolve("index.html")), "UTF-8");
    byte[] font = PdfFont.fromApk("outputs/MiniCafe.apk");
    for (int run = 0; run < 3; run++) {
      CafeStore store = new CafeStore(db, defaults);
      CafeHttpServer server =
          new CafeHttpServer(18765, store, "test", html, run == 1 ? null : font);
      server.start(3000, false);
      try {
        JSONObject state = new JSONObject(new String(get(18765, "/api/state"), "UTF-8"));
        JSONArray ps = state.getJSONArray("products");
        if (ps.length() != 8) throw new AssertionError("menu");
        get(18765, "/");
        JSONObject ping = new JSONObject(new String(get(18765, "/api/ping"), "UTF-8"));
        if (!ping.getBoolean("ok") || !ping.getString("app").equals("minicafe"))
          throw new AssertionError("tunnel probe");
        HttpURLConnection denied =
            (HttpURLConnection) new URL("http://127.0.0.1:18765/api/ping").openConnection();
        try {
          if (denied.getResponseCode() != 403) throw new AssertionError("unauthenticated probe");
        } finally {
          denied.disconnect();
        }
        if (run != 1) {
          byte[] pdf = get(18765, "/api/report.pdf?day=2026-10-19&tz=180&key=test");
          if (pdf.length < 10000) throw new AssertionError("PDF font missing");
        }
        for (int i = 0; i < 8; i++)
          get(18765, "/api/image/" + ps.getJSONObject(i).getInt("id") + "?key=test");
        System.out.println("PASS startup/restart " + run + ": state, UI and 8 photos over HTTP");
      } finally {
        server.stop();
      }
    }
  }
}
