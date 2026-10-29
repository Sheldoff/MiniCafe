import java.io.*;
import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class ClearStatsTest {
  static void check(boolean b, String m) {
    if (!b) throw new AssertionError(m);
  }

  static int order(CafeStore s, String key) throws Exception {
    return s.mutate(
            "/api/order",
            new JSONObject()
                .put("request", key)
                .put("cash_given", 3500)
                .put("card_amount", 0)
                .put("items", new JSONArray().put(new JSONObject().put("id", 1).put("qty", 1))))
        .getInt("id");
  }

  public static void main(String[] a) throws Exception {
    File f = Files.createTempDirectory("clear-test").resolve("data.json").toFile();
    CafeStore s = new CafeStore(f);
    int first = order(s, "a"), sid = s.state().getInt("active_session");
    s.mutate("/api/issue", new JSONObject().put("id", first).put("route", "bar"));
    int pending = order(s, "b");
    s.mutate("/api/session/end", new JSONObject());
    int after = order(s, "c");
    check(s.state().getInt("active_session") > sid, "auto session");
    byte[] before = s.backup();
    try {
      s.mutate("/api/stats/clear", new JSONObject());
      throw new AssertionError("confirmation missing");
    } catch (IllegalArgumentException ok) {
    }
    check(java.util.Arrays.equals(before, s.backup()), "failed clear mutated");
    s.mutate("/api/stats/clear", new JSONObject().put("confirm", true));
    check(s.state().getJSONArray("orders").length() == 2, "pending queues lost");
    check(s.state().getJSONArray("sessions").length() == 0, "sessions remain");
    check(s.state().getJSONArray("products").length() == 5, "menu removed");
    check(
        s.statistics(
                    null,
                    new java.text.SimpleDateFormat("yyyy-MM-dd").format(new java.util.Date()),
                    0)
                .getLong("revenue")
            == 0,
        "revenue remains");
    s = new CafeStore(f);
    check(s.state().getJSONArray("orders").length() == 2, "restart/validation");
    int next = order(s, "d");
    check(next > after, "counter reused");
    int active = s.state().getInt("active_session");
    check(s.statistics(active, null, 0).getInt("order_count") == 1, "new stats");
    check(s.history(active, null, 0, 0).getInt("total") == 1, "history");
    System.out.println(
        "PASS auto sessions; confirmed clear removes reports, preserves pending"
            + " queues/menu/counters, restart and new stats");
  }
}
