import java.io.*;
import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class ScopedAvailabilityTest {
  static void check(boolean b, String message) {
    if (!b) throw new AssertionError(message);
  }

  static JSONObject loc(String id, String kind) throws Exception {
    return new JSONObject().put("id", id).put("kind", kind).put("name", id).put("color", "#4b2e1f");
  }

  static JSONObject product(CafeStore s) throws Exception {
    return s.state().getJSONArray("products").getJSONObject(0);
  }

  static JSONObject order(String request, String cash) throws Exception {
    return new JSONObject()
        .put("request", request)
        .put("location_id", cash)
        .put("guest", "Гість")
        .put("cash_given", 10000)
        .put("card_amount", 0)
        .put("items", new JSONArray().put(new JSONObject().put("id", 1).put("qty", 1)));
  }

  public static void main(String[] args) throws Exception {
    File folder = Files.createTempDirectory("minicafe-scoped-availability-").toFile(),
        file = new File(folder, "data.json");
    CafeStore s = new CafeStore(file);
    String cash = "loc-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        bar = "loc-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    s.mutate("/api/location/save", loc(cash, "cash").put("targets", new JSONArray().put("bar")));
    s.mutate("/api/location/save", loc(bar, "bar").put("linked_cash", cash));
    s.mutate(
        "/api/availability",
        new JSONObject().put("id", 1).put("sold_out", true).put("location_id", bar));
    check(!product(s).optBoolean("sold_out"), "Global availability changed");
    check(product(s).getJSONArray("unavailable_at").getString(0).equals(cash), "Cash flag absent");
    check(s.availabilityLocationAllowed("bar", bar), "Own role denied");
    check(!s.availabilityLocationAllowed("delivery", bar), "Other role allowed");
    try {
      s.mutate("/api/order", order("blocked", cash));
      throw new AssertionError("Unavailable product paid");
    } catch (IllegalArgumentException expected) {
    }
    s.mutate("/api/order", order("allowed", "cash"));
    try {
      s.mutate("/api/location/delete", new JSONObject().put("id", cash));
      throw new AssertionError("Linked cash deleted");
    } catch (IllegalArgumentException expected) {
    }
    CafeStore restored = new CafeStore(new File(folder, "restored.json"));
    restored.restore(s.backup());
    check(
        product(restored).getJSONArray("unavailable_at").length() == 1,
        "Availability lost on restore");
    s = new CafeStore(file);
    check(product(s).getJSONArray("unavailable_at").length() == 1, "Availability lost on restart");
    s.mutate(
        "/api/availability",
        new JSONObject().put("id", 1).put("sold_out", false).put("location_id", bar));
    check(product(s).getJSONArray("unavailable_at").length() == 0, "Availability not restored");
    s.mutate("/api/order", order("now-allowed", cash));
    s.mutate("/api/location/save", loc("bar", "bar").put("linked_cash", cash));
    s.mutate("/api/availability", new JSONObject().put("id", 1).put("sold_out", true));
    check(
        !product(s).optBoolean("sold_out")
            && product(s).getJSONArray("unavailable_at").length() == 1,
        "Legacy caller bypassed linked cash");
    System.out.println(
        "PASS scoped availability: linked cash only, unchanged global catalog, blocked checkout,"
            + " role isolation, restart/backup and return");
  }
}
