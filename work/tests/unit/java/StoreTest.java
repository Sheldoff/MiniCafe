import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class StoreTest {
  static void check(boolean value, String msg) {
    if (!value) throw new AssertionError(msg);
  }

  static JSONObject input(String text) throws Exception {
    JSONObject value = new JSONObject(text);
    if (value.has("request") && value.has("items")) {
      value.put("cash_given", 1000000).put("card_amount", 0);
    }
    return value;
  }

  public static void main(String[] args) throws Exception {
    File file = Files.createTempDirectory("minicafe-test").resolve("data.json").toFile();
    CafeStore store = new CafeStore(file);
    JSONObject order =
        input("{request:'repeat',guest:'Олена',items:[{id:1,qty:2},{id:2,qty:1},{id:5,qty:1}]}");
    int id = store.mutate("/api/order", order).getInt("id");
    check(store.mutate("/api/order", order).getInt("id") == id, "duplicate request");
    check(store.state().getJSONArray("orders").length() == 1, "duplicate order");
    store.mutate("/api/issue", new JSONObject().put("id", id).put("route", "bar"));
    JSONArray items = store.state().getJSONArray("orders").getJSONObject(0).getJSONArray("items");
    check(items.getJSONObject(0).getString("status").equals("delivered"), "drinks pending");
    check(items.getJSONObject(2).getString("status").equals("new"), "food disappeared");
    store.mutate("/api/issue", new JSONObject().put("id", id).put("route", "bar"));
    check(
        store.state().getJSONArray("orders").getJSONObject(0).getJSONArray("events").length() == 1,
        "issue not idempotent");
    store.mutate("/api/delete-product", new JSONObject().put("id", 1));
    check(
        store
            .state()
            .getJSONArray("orders")
            .getJSONObject(0)
            .getJSONArray("items")
            .getJSONObject(0)
            .getString("name")
            .equals("Еспресо"),
        "history lost");
    byte[] before = store.backup();
    try {
      store.mutate("/api/order", input("{request:'invalid',items:[{id:2,qty:1},{id:999,qty:1}]}"));
      throw new AssertionError("invalid accepted");
    } catch (IllegalArgumentException expected) {
    }
    check(Arrays.equals(before, store.backup()), "partial order saved");
    CafeStore reopened = new CafeStore(file);
    check(Arrays.equals(store.backup(), reopened.backup()), "restart lost data");
    for (int i = 2; i <= 5; i++) store.mutate("/api/delete-product", new JSONObject().put("id", i));
    check(
        new CafeStore(file).state().getJSONArray("products").length() == 0, "empty menu reseeded");
    store.restore(before);
    check(store.state().getJSONArray("products").length() == 4, "restore failed");
    try {
      store.restore("{}".getBytes("UTF-8"));
      throw new AssertionError("invalid backup accepted");
    } catch (Exception expected) {
    }
    check(Arrays.equals(before, store.backup()), "bad restore corrupted data");
    final CafeStore parallel = store;
    List<Thread> workers = new ArrayList<>();
    for (int i = 0; i < 8; i++) {
      Thread thread =
          new Thread(
              () -> {
                try {
                  parallel.mutate("/api/order", input("{request:'parallel',items:[{id:2,qty:1}]}"));
                } catch (Exception e) {
                  throw new RuntimeException(e);
                }
              });
      workers.add(thread);
      thread.start();
    }
    for (Thread thread : workers) thread.join();
    check(store.state().getJSONArray("orders").length() == 2, "concurrent duplicates");
    byte[] jpeg = Files.readAllBytes(Paths.get(args[0]));
    String encoded = Base64.getEncoder().encodeToString(jpeg);
    store.mutate(
        "/api/product",
        new JSONObject()
            .put("id", 2)
            .put("name", "Капучино")
            .put("category", "Напої")
            .put("price", 5500)
            .put("route", "bar")
            .put("image", encoded));
    check(Arrays.equals(jpeg, store.image(2)), "image mismatch");
    check(
        !store.state().getJSONArray("products").getJSONObject(0).has("image"),
        "state includes image payload");
    JSONArray imported =
        new JSONArray()
            .put(
                new JSONObject()
                    .put("name", "Лате імпорт")
                    .put("category", "Напої")
                    .put("price", 7000)
                    .put("route", "bar")
                    .put("active", 1)
                    .put("image", encoded));
    int oldOrders = store.state().getJSONArray("orders").length();
    store.importMenu(imported);
    check(store.state().getJSONArray("products").length() == 1, "menu not replaced");
    check(store.state().getJSONArray("orders").length() == oldOrders, "import deleted history");
    check(
        Arrays.equals(
            jpeg,
            store.image(store.state().getJSONArray("products").getJSONObject(0).getInt("id"))),
        "import image mismatch");
    check(
        new CafeStore(file)
            .state()
            .getJSONArray("products")
            .getJSONObject(0)
            .getString("name")
            .equals("Лате імпорт"),
        "import persistence");
    System.out.println(
        "PASS: persistence, backup/restore, atomic rollback, idempotent and concurrent orders,"
            + " separate queues, image storage, empty menu, history snapshots, menu import with"
            + " photos");
  }
}
