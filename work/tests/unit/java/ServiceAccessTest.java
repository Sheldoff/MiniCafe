import java.io.*;
import java.net.*;
import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class ServiceAccessTest {
  static void check(boolean ok, String message) {
    if (!ok) throw new AssertionError(message);
  }

  static JSONObject call(int port, String path, String key, JSONObject payload, int status)
      throws Exception {
    HttpURLConnection c =
        (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
    c.setRequestProperty("X-Cafe-Key", key);
    c.setConnectTimeout(5000);
    c.setReadTimeout(5000);
    if (payload != null) {
      c.setRequestMethod("POST");
      c.setDoOutput(true);
      c.setRequestProperty("Content-Type", "application/json");
      try (OutputStream o = c.getOutputStream()) {
        o.write(payload.toString().getBytes("UTF-8"));
      }
    }
    check(c.getResponseCode() == status, path + ": " + c.getResponseCode() + " expected " + status);
    try (InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream()) {
      return new JSONObject(new String(CafeStore.readBytes(in, 1000000), "UTF-8"));
    } finally {
      c.disconnect();
    }
  }

  public static void main(String[] args) throws Exception {
    Path folder = Files.createTempDirectory("minicafe-service-role");
    File roles = folder.resolve("roles.json").toFile();
    Files.write(
        roles.toPath(),
        "{\"cash\":\"old-cash\",\"bar\":\"old-bar\",\"delivery\":\"old-food\"}".getBytes("UTF-8"));
    AccessControl access = new AccessControl(roles, "owner");
    String service = access.key("service");
    check(
        access.role("old-cash").equals("cash")
            && access.role("old-bar").equals("bar")
            && access.role("old-food").equals("delivery"),
        "migration revoked legacy keys");
    check(
        new AccessControl(roles, "owner").key("service").equals(service), "new key not persistent");
    CafeStore store = new CafeStore(folder.resolve("data.json").toFile());
    CafeHttpServer server = new CafeHttpServer(0, store, "owner", "<html></html>", null, access);
    server.start(5000, false);
    int port = server.getListeningPort();
    try {
      JSONObject state = call(port, "/api/state", service, null, 200);
      check(state.getString("access_role").equals("service"), "role missing");
      check(
          !state.has("additional_expenses") && !state.has("sessions"),
          "restricted metadata leaked");
      int drink = 0, food = 0, total = 0;
      JSONArray ps = state.getJSONArray("products");
      for (int i = 0; i < ps.length(); i++) {
        JSONObject p = ps.getJSONObject(i);
        if (drink == 0 && p.getString("route").equals("bar")) {
          drink = p.getInt("id");
          total += p.getInt("price");
        } else if (food == 0 && p.getString("route").equals("instant")) {
          food = p.getInt("id");
          total += p.getInt("price");
        }
      }
      check(drink > 0 && food > 0, "combined menu missing a route");
      JSONArray items =
          new JSONArray()
              .put(new JSONObject().put("id", drink).put("qty", 1))
              .put(new JSONObject().put("id", food).put("qty", 1));
      int order =
          call(
                  port,
                  "/api/order",
                  service,
                  new JSONObject()
                      .put("request", "service-order")
                      .put("cash_given", total)
                      .put("card_amount", 0)
                      .put("items", items),
                  200)
              .getInt("id");
      for (String route : new String[] {"bar", "instant"}) {
        call(
            port,
            "/api/issue",
            service,
            new JSONObject().put("id", order).put("route", route),
            200);
        call(port, "/api/undo-issue", service, new JSONObject().put("route", route), 200);
      }
      for (int id : new int[] {drink, food})
        call(
            port,
            "/api/availability",
            service,
            new JSONObject().put("id", id).put("sold_out", true),
            200);
      call(
          port,
          "/api/issue",
          service,
          new JSONObject().put("id", order).put("route", "wrong"),
          403);
      for (String path : new String[] {"/api/stats", "/api/access", "/api/backup", "/api/history"})
        call(port, path, service, null, 403);
      for (String path :
          new String[] {
            "/api/product",
            "/api/delete-product",
            "/api/clear-stats",
            "/api/access/rotate",
            "/api/expense",
            "/api/import-menu"
          }) call(port, path, service, new JSONObject(), 403);
      call(
          port,
          "/api/issue",
          "old-cash",
          new JSONObject().put("id", order).put("route", "bar"),
          403);
      call(
          port,
          "/api/issue",
          "old-bar",
          new JSONObject().put("id", order).put("route", "instant"),
          403);
      access.rotate();
      call(port, "/api/state", service, null, 403);
      check(access.role("owner").equals("admin"), "owner revoked");
    } finally {
      server.stop();
    }
    System.out.println(
        "PASS combined staff role: legacy-key migration, persistence, cashier/both"
            + " queues/undo/availability, protected finance/menu/settings and revocation");
  }
}
