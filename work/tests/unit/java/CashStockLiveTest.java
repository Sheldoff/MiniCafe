import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class CashStockLiveTest {
  static void check(boolean b, String message) {
    if (!b) throw new AssertionError(message);
  }

  static String cash2 = "loc-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      cash3 = "loc-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      bar2 = "loc-cccccccccccccccccccccccccccccccc";

  static JSONObject loc(String id, String kind) throws Exception {
    return new JSONObject().put("id", id).put("name", id).put("kind", kind).put("color", "#4b2e1f");
  }

  static JSONObject p(CafeStore s, int id) throws Exception {
    JSONArray ps = s.state().getJSONArray("products");
    for (int n = 0; n < ps.length(); n++)
      if (ps.getJSONObject(n).getInt("id") == id) return ps.getJSONObject(n);
    throw new AssertionError("Missing product");
  }

  static JSONObject map(long a, long b, long c) throws Exception {
    return new JSONObject().put("cash", a).put(cash2, b).put(cash3, c);
  }

  static JSONObject sale(String req, String cash, int id, int qty) throws Exception {
    return new JSONObject()
        .put("request", req)
        .put("location_id", cash)
        .put("cash_given", 100000)
        .put("card_amount", 0)
        .put("items", new JSONArray().put(new JSONObject().put("id", id).put("qty", qty)));
  }

  static JSONObject snapshot(CafeStore s) throws Exception {
    return new JSONObject(new String(s.backup(), "UTF-8"));
  }

  static JSONObject order(CafeStore s, int id) throws Exception {
    JSONArray rows = snapshot(s).getJSONArray("orders");
    for (int n = 0; n < rows.length(); n++)
      if (rows.getJSONObject(n).getInt("id") == id) return rows.getJSONObject(n);
    throw new AssertionError("Missing order");
  }

  static void rejected(CafeStore s, String path, JSONObject input) throws Exception {
    byte[] before = s.backup();
    try {
      s.mutate(path, input);
      throw new AssertionError("Accepted invalid mutation");
    } catch (IllegalArgumentException expected) {
    }
    check(Arrays.equals(before, s.backup()), "Rejected request changed state");
  }

  public static void main(String[] args) throws Exception {
    File folder = Files.createTempDirectory("minicafe-cash-live-").toFile(),
        file = new File(folder, "data.json");
    CafeStore s = new CafeStore(file);
    s.mutate(
        "/api/location/save",
        loc(cash2, "cash").put("targets", new JSONArray().put("bar").put("delivery")));
    s.mutate(
        "/api/location/save",
        loc(cash3, "cash").put("targets", new JSONArray().put("bar").put("delivery")));
    s.mutate("/api/location/save", loc(bar2, "bar"));
    int food = snapshot(s).getInt("nextProduct");
    JSONObject input =
        new JSONObject()
            .put("name", "Пиріг")
            .put("category", "Їжа")
            .put("route", "instant")
            .put("price", 5000)
            .put("active", true)
            .put("stock", 20)
            .put("stock_by_cash", map(7, 5, 8));
    s.mutate("/api/product", input);
    check(p(s, food).getJSONObject("stock_by_cash").getLong(cash2) == 5, "Allocation lost");
    rejected(
        s,
        "/api/product",
        new JSONObject(input.toString()).put("id", food).put("stock_by_cash", map(7, 5, 9)));
    rejected(
        s,
        "/api/product",
        new JSONObject(input.toString()).put("id", food).put("stock_by_cash", map(-1, 13, 8)));
    rejected(s, "/api/order", sale("too-many", cash2, food, 6));
    int id = s.mutate("/api/order", sale("sale", cash2, food, 2)).getInt("id");
    check(
        p(s, food).getLong("stock") == 18
            && p(s, food).getJSONObject("stock_by_cash").getLong(cash2) == 3,
        "Sale not deducted from source");
    byte[] once = s.backup();
    s.mutate("/api/order", sale("sale", cash2, food, 2));
    check(Arrays.equals(once, s.backup()), "Retry double deducted");
    rejected(
        s,
        "/api/product",
        new JSONObject(input.toString())
            .put("id", food)
            .put(
                "stock_basis",
                new JSONObject().put("stock", 20).put("stock_by_cash", map(7, 5, 8))));
    JSONObject basis = new JSONObject().put("stock", 18).put("stock_by_cash", map(7, 3, 8));
    s.mutate(
        "/api/product",
        new JSONObject(input.toString())
            .put("id", food)
            .put("stock", 18)
            .put("stock_by_cash", map(7, 3, 8))
            .put("stock_basis", basis));
    int item = order(s, id).getJSONArray("items").getJSONObject(0).getInt("id");
    s.mutate("/api/status", new JSONObject().put("id", item).put("status", "cancelled"));
    check(
        p(s, food).getLong("stock") == 20
            && p(s, food).getJSONObject("stock_by_cash").getLong(cash2) == 5,
        "Refund not returned to source");
    s.mutate("/api/status", new JSONObject().put("id", item).put("status", "new"));
    check(p(s, food).getLong("stock") == 18, "Uncancel not consumed");
    s.mutate(
        "/api/calculate-menu",
        new JSONObject()
            .put("confirm", true)
            .put(
                "items",
                new JSONArray()
                    .put(
                        new JSONObject()
                            .put("id", food)
                            .put("name", "Пиріг")
                            .put("price", 5000)
                            .put("stock", 30))));
    check(
        p(s, food).getJSONObject("stock_by_cash").getLong(cash3) == 20,
        "Calculator remainder not allocated");
    CafeStore restored = new CafeStore(new File(folder, "restored.json"));
    restored.restore(s.backup());
    check(
        p(restored, food).getJSONObject("stock_by_cash").getLong(cash3) == 20,
        "Backup lost allocation");
    s = new CafeStore(file);
    check(p(s, food).getLong("stock") == 30, "Restart lost allocation");
    String delivery2 = "loc-dddddddddddddddddddddddddddddddd";
    s.mutate("/api/location/save", loc(delivery2, "delivery"));
    s.mutate(
        "/api/location/save",
        loc(cash2, "cash")
            .put("targets", new JSONArray().put("bar").put(bar2).put("delivery").put(delivery2)));
    JSONObject mixed = sale("mixed", cash2, 1, 2);
    mixed.getJSONArray("items").put(new JSONObject().put("id", food).put("qty", 1));
    int joint = s.mutate("/api/order", mixed).getInt("id");
    JSONObject ticket = order(s, joint),
        drink = ticket.getJSONArray("items").getJSONObject(0),
        meal = ticket.getJSONArray("items").getJSONObject(1);
    check(
        drink.getJSONArray("destinations").length() == 2
            && meal.getJSONArray("destinations").length() == 2,
        "Mixed types duplicated");
    check(!CafeStore.hasFulfillment(drink, "instant"), "Drink exposed at delivery");
    rejected(
        s,
        "/api/issue-unit",
        new JSONObject()
            .put("order", joint)
            .put("id", drink.getInt("id"))
            .put("route", "instant")
            .put("location_id", "delivery")
            .put("unit", 0)
            .put("delivered", true));
    s.mutate(
        "/api/issue-unit",
        new JSONObject()
            .put("order", joint)
            .put("id", drink.getInt("id"))
            .put("route", "bar")
            .put("location_id", bar2)
            .put("unit", 0)
            .put("delivered", true));
    JSONObject stats = s.statistics(s.state().getInt("active_session"), null, 0, true),
        live = stats.getJSONObject("live");
    long revenue = 0, count = 0;
    JSONArray timeline = live.getJSONArray("timeline");
    for (int n = 0; n < timeline.length(); n++) {
      revenue += timeline.getJSONObject(n).getLong("revenue");
      count += timeline.getJSONObject(n).getLong("orders");
    }
    check(
        revenue == stats.getLong("revenue") && count == stats.getLong("order_count"),
        "Graph totals differ from ledger");
    check(timeline.length() <= 50, "Unbounded timeline");
    check(live.getInt("pending_units") == 4, "Partial queue units incorrect");
    s.mutate(
        "/api/issue",
        new JSONObject().put("id", joint).put("route", "bar").put("location_id", "bar"));
    check(
        order(s, joint)
            .getJSONArray("items")
            .getJSONObject(0)
            .getString("status")
            .equals("delivered"),
        "Shared bar completion missing");
    check(
        order(s, joint).getJSONArray("items").getJSONObject(1).getString("status").equals("new"),
        "Food issued with drink");
    check(
        order(s, joint)
            .getJSONObject("payment")
            .toString()
            .equals(ticket.getJSONObject("payment").toString()),
        "Issue changed finance");
    System.out.println(
        "PASS cash partitions, strict atomic checkout/idempotency, source refunds, calculator"
            + " reconciliation, stale editor rejection, backup/restart, type routing/shared bars"
            + " and live chart totals");
  }
}
