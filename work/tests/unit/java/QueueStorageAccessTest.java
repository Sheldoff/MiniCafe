import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class QueueStorageAccessTest {
  static void check(boolean b, String message) {
    if (!b) throw new AssertionError(message);
  }

  static JSONObject order(String request) throws Exception {
    return new JSONObject()
        .put("request", request)
        .put(
            "items",
            new JSONArray()
                .put(new JSONObject().put("id", 1).put("qty", 1))
                .put(new JSONObject().put("id", 5).put("qty", 1)))
        .put("cash_given", 8000)
        .put("card_amount", 0);
  }

  static HttpURLConnection connect(int port, String path, String key, String body)
      throws Exception {
    HttpURLConnection c =
        (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
    c.setRequestProperty("X-Cafe-Key", key);
    c.setReadTimeout(5000);
    if (body != null) {
      c.setRequestMethod("POST");
      c.setDoOutput(true);
      byte[] b = body.getBytes("UTF-8");
      c.setFixedLengthStreamingMode(b.length);
      try (OutputStream out = c.getOutputStream()) {
        out.write(b);
      }
    }
    return c;
  }

  static String body(HttpURLConnection c) throws Exception {
    try (InputStream in = c.getInputStream()) {
      return new String(CafeStore.readBytes(in, 80000000), "UTF-8");
    }
  }

  public static void main(String[] args) throws Exception {
    Path folder = Files.createTempDirectory("cafe-modern-");
    File file = folder.resolve("data.json").toFile();
    CafeStore s = new CafeStore(file);
    s.mutate("/api/order", order("one"));
    JSONObject snapshot = new JSONObject(new String(s.backup(), "UTF-8")),
        template = snapshot.getJSONArray("orders").getJSONObject(0);
    JSONArray orders = new JSONArray();
    for (int n = 1; n <= 305; n++) {
      JSONObject o = new JSONObject(template.toString());
      o.put("id", n).put("request", "queue-" + n);
      JSONArray items = o.getJSONArray("items");
      for (int j = 0; j < 2; j++)
        items
            .getJSONObject(j)
            .put("id", (n - 1) * 2 + j + 1)
            .put("order_id", n)
            .put("status", n == 1 ? "new" : "delivered");
      orders.put(o);
    }
    snapshot.put("orders", orders).put("nextOrder", 306).put("nextItem", 611);
    s.restore(snapshot.toString().getBytes("UTF-8"));
    JSONArray stateOrders = s.state().getJSONArray("orders");
    check(stateOrders.length() == 301, "300 history plus oldest pending");
    check(stateOrders.getJSONObject(300).getInt("id") == 1, "Oldest pending lost");
    check(s.statistics(1, null, 0).getInt("order_count") == 305, "Full history preserved");
    byte[] jpeg = Files.readAllBytes(Paths.get(args[0]));
    JSONObject p = s.state().getJSONArray("products").getJSONObject(0);
    p.put("image", Codec.encode(jpeg)).put("active", true);
    s.mutate("/api/product", p);
    String disk = new String(Files.readAllBytes(file.toPath()), "UTF-8");
    check(!disk.contains("\"image\":"), "Inline image still in runtime database");
    byte[] portable = s.backup();
    File blockedTemporaryFile = new File(file + ".tmp");
    check(blockedTemporaryFile.mkdir(), "Could not prepare failed-write fixture");
    try {
      s.mutate("/api/product", new JSONObject(p.toString()).put("price", 5500));
      throw new AssertionError("Failed disk write was accepted");
    } catch (IOException expected) {
      check(Arrays.equals(portable, s.backup()), "Failed disk write changed in-memory data");
    } finally {
      check(blockedTemporaryFile.delete(), "Could not release failed-write fixture");
    }
    check(new String(portable, "UTF-8").contains("\"image\":"), "Backup missing portable image");
    File migrated = folder.resolve("legacy.json").toFile();
    Files.write(migrated.toPath(), portable);
    CafeStore migratedStore = new CafeStore(migrated);
    check(
        Arrays.equals(jpeg, migratedStore.image(p.getInt("id"))),
        "Legacy inline migration lost image");
    check(
        !new String(Files.readAllBytes(migrated.toPath()), "UTF-8").contains("\"image\":"),
        "Legacy image not externalized");
    CafeStore destination = new CafeStore(folder.resolve("restore.json").toFile());
    destination.restore(portable);
    check(Arrays.equals(jpeg, destination.image(p.getInt("id"))), "Portable restore lost photos");
    int latest = destination.mutate("/api/order", order("photo-repair")).getInt("id");
    byte[] repairBackup = destination.backup();
    JSONObject rawDestination =
        new JSONObject(new String(Files.readAllBytes(folder.resolve("restore.json")), "UTF-8"));
    String imageHash =
        rawDestination.getJSONArray("products").getJSONObject(0).getString("image_file");
    Files.write(
        folder.resolve("restore.json.images").resolve(imageHash + ".jpg"), new byte[] {1, 2, 3});
    CafeStore damagedPhoto = new CafeStore(folder.resolve("restore.json").toFile());
    check(
        damagedPhoto.state().getJSONArray("orders").getJSONObject(0).getInt("id") == latest,
        "Bad photo rolled orders back");
    damagedPhoto.restore(repairBackup);
    check(
        Arrays.equals(jpeg, damagedPhoto.image(p.getInt("id"))),
        "Backup could not repair corrupt photo");
    check(!s.state().toString().contains("image_file"), "Internal file refs leaked to API");
    AccessControl acl = new AccessControl(folder.resolve("access.json").toFile(), "owner");
    String bar = acl.key("bar"), cash = acl.key("cash"), delivery = acl.key("delivery");
    CafeHttpServer server = new CafeHttpServer(0, s, "owner", "<h1>test</h1>", null, acl);
    server.start(5000, false);
    int port = server.getListeningPort();
    try {
      HttpURLConnection first = connect(port, "/api/state", "owner", null);
      JSONObject a = new JSONObject(body(first));
      String etag = first.getHeaderField("ETag");
      first.disconnect();
      check(etag != null, "No ETag");
      HttpURLConnection unchanged = connect(port, "/api/state", "owner", null);
      unchanged.setRequestProperty("If-None-Match", etag);
      check(unchanged.getResponseCode() == 304, "Unchanged state not 304");
      unchanged.disconnect();
      HttpURLConnection barState = connect(port, "/api/state", bar, null);
      JSONObject limited = new JSONObject(body(barState));
      barState.disconnect();
      check(limited.getString("access_role").equals("bar"), "Role missing");
      for (int i = 0; i < limited.getJSONArray("orders").length(); i++) {
        JSONObject o = limited.getJSONArray("orders").getJSONObject(i);
        check(!o.has("payment"), "Payment leaked to barista");
        for (int j = 0; j < o.getJSONArray("items").length(); j++)
          check(
              o.getJSONArray("items").getJSONObject(j).getString("route").equals("bar"),
              "Food leaked to barista");
      }
      for (String key : new String[] {bar, cash, delivery}) {
        HttpURLConnection denied = connect(port, "/api/product", key, p.toString());
        check(denied.getResponseCode() == 403, "Staff edited catalog");
        denied.disconnect();
      }
      HttpURLConnection wrong =
          connect(port, "/api/issue", bar, "{\"id\":1,\"route\":\"instant\"}");
      check(wrong.getResponseCode() == 403, "Cross-route issue allowed");
      wrong.disconnect();
      HttpURLConnection issued = connect(port, "/api/issue", bar, "{\"id\":1,\"route\":\"bar\"}");
      check(issued.getResponseCode() == 200, "Barista cannot issue");
      issued.disconnect();
      HttpURLConnection changed = connect(port, "/api/state", "owner", null);
      changed.setRequestProperty("If-None-Match", etag);
      check(changed.getResponseCode() == 200, "Mutation left stale ETag");
      JSONObject b = new JSONObject(body(changed));
      changed.disconnect();
      check(
          a.getJSONObject("versions").getLong("products")
              == b.getJSONObject("versions").getLong("products"),
          "Issue invalidated product list");
      check(
          a.getJSONObject("versions").getLong("orders")
              != b.getJSONObject("versions").getLong("orders"),
          "Orders version not changed");
      acl.rotate();
      HttpURLConnection revoked = connect(port, "/api/state", bar, null);
      check(revoked.getResponseCode() == 403, "Old staff link still works");
      revoked.disconnect();
      check(
          new AccessControl(folder.resolve("access.json").toFile(), "owner")
              .role(acl.key("bar"))
              .equals("bar"),
          "New staff links not persistent");
      check(acl.role("owner").equals("admin"), "Owner key changed");
    } finally {
      server.stop();
    }
    System.out.println(
        "PASS queue >300, external images/legacy migration/portable restore, state versions/304,"
            + " server-side roles/revocation, owner compatibility");
  }
}
