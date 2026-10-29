import java.io.*;
import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class IssueTest {
  static JSONObject j(String s) throws Exception {
    return new JSONObject(s);
  }

  static void check(boolean b, String m) {
    if (!b) throw new AssertionError(m);
  }

  static String status(CafeStore s, int index) throws Exception {
    return s.state()
        .getJSONArray("orders")
        .getJSONObject(0)
        .getJSONArray("items")
        .getJSONObject(index)
        .getString("status");
  }

  public static void main(String[] a) throws Exception {
    File f = Files.createTempDirectory("issue-test").resolve("data.json").toFile();
    CafeStore s = new CafeStore(f);
    s.mutate(
        "/api/order",
        j(
            "{request:'issue-test',cash_given:100000,card_amount:0,items:[{id:1,qty:2},{id:2,qty:1},{id:5,qty:1}]}"));
    JSONObject o = s.state().getJSONArray("orders").getJSONObject(0);
    int order = o.getInt("id"),
        one = o.getJSONArray("items").getJSONObject(0).getInt("id"),
        two = o.getJSONArray("items").getJSONObject(1).getInt("id");
    long revenue = s.statistics(1, null, 0).getLong("revenue");
    s.mutate(
        "/api/issue-item",
        new JSONObject()
            .put("order", order)
            .put("id", one)
            .put("route", "bar")
            .put("delivered", true));
    check(status(s, 0).equals("delivered") && status(s, 1).equals("new"), "partial issue");
    check(s.state().getJSONObject("can_undo_issue").getBoolean("bar"), "undo availability");
    s = new CafeStore(f);
    s.mutate("/api/undo-issue", j("{route:'bar'}"));
    check(status(s, 0).equals("new"), "persisted undo");
    check(!s.state().getJSONObject("can_undo_issue").getBoolean("bar"), "undo consumed");
    try {
      s.mutate(
          "/api/issue-item",
          new JSONObject()
              .put("order", order)
              .put("id", one)
              .put("route", "instant")
              .put("delivered", true));
      throw new AssertionError("wrong route");
    } catch (IllegalArgumentException expected) {
    }
    s.mutate("/api/issue", new JSONObject().put("id", order).put("route", "bar"));
    s.mutate("/api/issue", new JSONObject().put("id", order).put("route", "bar"));
    check(
        status(s, 0).equals("delivered")
            && status(s, 1).equals("delivered")
            && status(s, 2).equals("new"),
        "route separation");
    s.mutate("/api/issue", new JSONObject().put("id", order).put("route", "instant"));
    s.mutate("/api/undo-issue", j("{route:'bar'}"));
    check(
        status(s, 0).equals("new")
            && status(s, 1).equals("new")
            && status(s, 2).equals("delivered"),
        "route undo separation");
    check(
        !s.state().getJSONObject("can_undo_issue").getBoolean("bar"),
        "duplicate issue created undo");
    s.mutate(
        "/api/issue-item",
        new JSONObject()
            .put("order", order)
            .put("id", two)
            .put("route", "bar")
            .put("delivered", true));
    s.mutate(
        "/api/issue-item",
        new JSONObject()
            .put("order", order)
            .put("id", two)
            .put("route", "bar")
            .put("delivered", false));
    check(status(s, 1).equals("new"), "toggle unchecked");
    check(s.statistics(1, null, 0).getLong("revenue") == revenue, "revenue changed");
    s.mutate("/api/undo-issue", j("{route:'instant'}"));
    check(status(s, 2).equals("new"), "food undo");
    System.out.println(
        "PASS partial issue, toggle, persistent undo, route isolation, full issue, duplicate"
            + " request, unchanged revenue");
  }
}
