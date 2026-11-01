import java.io.*;
import java.net.*;
import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class CardPaymentsTest {
  static void check(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }

  static JSONObject order(String id, long card, long cash, boolean gift) throws Exception {
    return new JSONObject()
        .put("request", id)
        .put("guest", "Іван Петренко")
        .put("card_amount", card)
        .put("cash_given", cash)
        .put("gift", gift)
        .put("items", new JSONArray().put(new JSONObject().put("id", 1).put("qty", 1)));
  }

  static int request(int port, String path, String key, JSONObject body) throws Exception {
    HttpURLConnection c =
        (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
    c.setRequestProperty("X-Cafe-Key", key);
    c.setReadTimeout(5000);
    if (body != null) {
      c.setRequestMethod("POST");
      c.setDoOutput(true);
      try (OutputStream out = c.getOutputStream()) {
        out.write(body.toString().getBytes("UTF-8"));
      }
    }
    int code = c.getResponseCode();
    c.disconnect();
    return code;
  }

  public static void main(String[] args) throws Exception {
    File folder = Files.createTempDirectory("minicafe-card-history-").toFile(),
        file = new File(folder, "data.json");
    CafeStore store = new CafeStore(file);
    int cash = store.mutate("/api/order", order("cash", 0, 5000, false)).getInt("id");
    store.mutate("/api/order", order("gift", 0, 0, true));
    for (int i = 0; i < 55; i++) store.mutate("/api/order", order("mixed-" + i, 2000, 3000, false));
    JSONObject first = store.cardPayments(Long.MAX_VALUE);
    JSONArray rows = first.getJSONArray("payments");
    check(rows.length() == 50, "First page size");
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = rows.getJSONObject(i);
      check(row.length() == 2, "Extra financial fields exposed");
      check(row.getLong("amount") == 2000, "Included cash portion");
      check(row.getInt("id") != cash, "Included cash-only order");
    }
    JSONObject second = store.cardPayments(first.getLong("next_before"));
    check(second.getJSONArray("payments").length() == 5, "Missing old payments");
    check(second.isNull("next_before"), "Unexpected next page");
    int id = rows.getJSONObject(0).getInt("id");
    JSONObject stats = store.statistics(1, null, 0);
    String original =
        store.state().getJSONArray("orders").getJSONObject(0).getJSONObject("payment").toString();
    String version = store.version();
    store.mutate("/api/card-payment/hide", new JSONObject().put("id", id));
    check(!version.equals(store.version()), "Hidden change did not invalidate state");
    version = store.version();
    store.mutate("/api/card-payment/hide", new JSONObject().put("id", id));
    check(version.equals(store.version()), "Retry changed state");
    check(
        store.statistics(1, null, 0).toString().equals(stats.toString()),
        "Hide changed statistics");
    check(
        store
            .state()
            .getJSONArray("orders")
            .getJSONObject(0)
            .getJSONObject("payment")
            .toString()
            .equals(original),
        "Hide changed payment");
    store = new CafeStore(file);
    check(
        store.cardPayments(Long.MAX_VALUE).getJSONArray("payments").getJSONObject(0).getInt("id")
            != id,
        "Hide lost after restart");
    CafeStore restored = new CafeStore(new File(folder, "restored.json"));
    restored.restore(store.backup());
    check(
        restored.cardPayments(Long.MAX_VALUE).getJSONArray("payments").getJSONObject(0).getInt("id")
            != id,
        "Hide lost in backup");
    try {
      store.mutate("/api/card-payment/hide", new JSONObject().put("id", cash));
      throw new AssertionError("Cash-only hide accepted");
    } catch (IllegalArgumentException expected) {
    }
    AccessControl access = new AccessControl("owner");
    CafeHttpServer server = new CafeHttpServer(0, store, "owner", "test", null, access);
    server.start(5000, false);
    try {
      int port = server.getListeningPort();
      for (String role : new String[] {"cash", "service"}) {
        check(
            request(port, "/api/card-payments", access.key(role), null) == 200,
            "Cash role cannot read");
        check(
            request(
                    port,
                    "/api/card-payment/hide",
                    access.key(role),
                    new JSONObject().put("id", id))
                == 200,
            "Cash role cannot hide");
      }
      for (String role : new String[] {"bar", "delivery"}) {
        check(
            request(port, "/api/card-payments", access.key(role), null) == 403,
            "Serving role read payments");
        check(
            request(
                    port,
                    "/api/card-payment/hide",
                    access.key(role),
                    new JSONObject().put("id", id))
                == 403,
            "Serving role hid payments");
      }
      check(request(port, "/api/card-payments", "wrong", null) == 403, "Anonymous read payments");
    } finally {
      server.stop();
    }
    System.out.println(
        "PASS card payments: mixed/card-only projection, pagination, persistence, backup,"
            + " permissions and unchanged financial history");
  }
}
