import java.io.*;
import java.net.*;
import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class GuestApiTest {
  static int port;

  static JSONObject call(
      String method, String path, String key, String body, String origin, int expected)
      throws Exception {
    HttpURLConnection c =
        (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
    try {
      c.setRequestMethod(method);
      c.setConnectTimeout(5000);
      c.setReadTimeout(5000);
      if (key != null) c.setRequestProperty("X-Cafe-Key", key);
      if (origin != null) c.setRequestProperty("Origin", origin);
      if (body != null) {
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        byte[] bytes = body.getBytes("UTF-8");
        c.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream out = c.getOutputStream()) {
          out.write(bytes);
        }
      }
      int status = c.getResponseCode();
      if (status != expected) {
        String error = "";
        try (InputStream in = c.getErrorStream()) {
          if (in != null) error = new String(CafeStore.readBytes(in, 1000000), "UTF-8");
        }
        throw new AssertionError(path + ": expected " + expected + " got " + status + " " + error);
      }
      try (InputStream in = status < 400 ? c.getInputStream() : c.getErrorStream()) {
        return new JSONObject(new String(CafeStore.readBytes(in, 1000000), "UTF-8"));
      }
    } finally {
      c.disconnect();
    }
  }

  public static void main(String[] args) throws Exception {
    System.setProperty("sun.net.http.allowRestrictedHeaders", "true");
    File file = Files.createTempDirectory("minicafe-guest-api").resolve("data.json").toFile();
    CafeStore db = new CafeStore(file);
    AccessControl access = new AccessControl("owner");
    CafeHttpServer server = new CafeHttpServer(0, db, "owner", "<html></html>", null, access);
    server.start(10000, false);
    port = server.getListeningPort();
    String draft = "{\"guest\":\"Олена Тестова\",\"items\":[{\"id\":1,\"qty\":1}]}";
    try {
      call("GET", "/api/state", null, null, null, 403);
      call("GET", "/api/guest-codes", null, null, null, 403);
      call("GET", "/api/guest-codes", access.key("bar"), null, null, 403);
      call("POST", "/api/public-settings", access.key("cash"), "{\"enabled\":true}", null, 403);
      call("POST", "/api/public-settings", "owner", "{\"enabled\":true}", null, 200);
      JSONObject menu = call("GET", "/api/public/menu", null, null, null, 200);
      if (menu.toString().contains("guest_codes") || menu.toString().contains("payment"))
        throw new AssertionError("Public projection");
      call("POST", "/api/public/code", null, draft, "https://evil.example", 403);
      String code = call("POST", "/api/public/code", null, draft, null, 200).getString("code");
      String cash = access.key("cash");
      call("POST", "/api/guest-code", cash, "{\"code\":\"" + code + "\"}", null, 200);
      if (call("GET", "/api/guest-codes", cash, null, null, 200).getJSONArray("codes").length()
          != 1) throw new AssertionError("Loading consumed draft");
      String order =
          "{\"request\":\"guest-api\",\"public_code\":\""
              + code
              + "\",\"guest\":\"Олена"
              + " Тестова\",\"items\":[{\"id\":1,\"qty\":1}],\"cash_given\":0,\"card_amount\":0}";
      call("POST", "/api/order", cash, order, null, 400);
      call("POST", "/api/guest-code", cash, "{\"code\":\"" + code + "\"}", null, 200);
      call(
          "POST",
          "/api/order",
          cash,
          order.replace("\"card_amount\":0", "\"card_amount\":3500"),
          null,
          200);
      if (call("GET", "/api/guest-codes", cash, null, null, 200).getJSONArray("codes").length()
          != 0) throw new AssertionError("Paid draft remains");
      System.out.println(
          "PASS local guest HTTP: public privacy, roles, cross-site rejection, cashier load and"
              + " paid redemption");
    } finally {
      server.stop();
    }
  }
}
