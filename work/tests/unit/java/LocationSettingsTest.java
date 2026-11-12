import java.io.*;
import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class LocationSettingsTest {
  static void check(boolean b, String message) {
    if (!b) throw new AssertionError(message);
  }

  static JSONObject loc(String id, String name, String kind) throws Exception {
    return new JSONObject()
        .put("id", id)
        .put("name", name)
        .put("kind", kind)
        .put("color", "#228844");
  }

  static JSONObject snap(CafeStore s) throws Exception {
    return new JSONObject(new String(s.backup(), "UTF-8"));
  }

  static JSONObject order(CafeStore s, int id) throws Exception {
    JSONArray a = snap(s).getJSONArray("orders");
    for (int i = 0; i < a.length(); i++)
      if (a.getJSONObject(i).getInt("id") == id) return a.getJSONObject(i);
    throw new AssertionError("Order absent");
  }

  public static void main(String[] args) throws Exception {
    File folder = Files.createTempDirectory("minicafe-locations-").toFile(),
        file = new File(folder, "data.json");
    CafeStore s = new CafeStore(file);
    String destination = "loc-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        bar = "loc-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        cash = "loc-cccccccccccccccccccccccccccccccc";
    s.mutate("/api/location/save", loc(destination, "Видача низ", "delivery"));
    s.mutate("/api/location/save", loc(bar, "Бариста низ", "bar"));
    s.mutate(
        "/api/location/save",
        loc(cash, "Каса низ", "cash").put("mode", "single").put("single_target", destination));
    int food = snap(s).getInt("nextProduct");
    s.mutate(
        "/api/product",
        new JSONObject()
            .put("name", "Їжа")
            .put("category", "Їжа")
            .put("route", "instant")
            .put("price", 5000)
            .put("active", 1));
    int id =
        s.mutate(
                "/api/order",
                new JSONObject()
                    .put("request", "located")
                    .put("location_id", cash)
                    .put("guest", "Іван Петренко")
                    .put("card_amount", 4000)
                    .put("cash_given", 6000)
                    .put(
                        "items",
                        new JSONArray()
                            .put(new JSONObject().put("id", 1).put("qty", 1))
                            .put(new JSONObject().put("id", food).put("qty", 1))))
            .getInt("id");
    JSONObject o = order(s, id);
    JSONArray items = o.getJSONArray("items");
    for (int i = 0; i < items.length(); i++) {
      JSONObject item = items.getJSONObject(i);
      check(item.getString("location_id").equals(destination), "Wrong target");
      check(item.getString("fulfillment_route").equals("instant"), "Whole order not routed");
    }
    check(items.getJSONObject(0).getString("route").equals("bar"), "Catalog type changed");
    try {
      s.mutate(
          "/api/issue-unit",
          new JSONObject()
              .put("order", id)
              .put("id", items.getJSONObject(0).getInt("id"))
              .put("route", "instant")
              .put("unit", 0)
              .put("delivered", true));
      throw new AssertionError("Other location issued item");
    } catch (IllegalArgumentException expected) {
    }
    s.mutate(
        "/api/issue",
        new JSONObject().put("id", id).put("route", "instant").put("location_id", destination));
    check(
        order(s, id).getJSONArray("items").getJSONObject(0).getString("status").equals("delivered"),
        "Issue failed");
    check(
        s.state().getJSONObject("can_undo_issue").getBoolean("instant@" + destination),
        "Scoped undo absent");
    s.mutate(
        "/api/undo-issue",
        new JSONObject().put("route", "instant").put("location_id", destination));
    check(
        order(s, id).getJSONArray("items").getJSONObject(0).getString("status").equals("new"),
        "Undo failed");

    s.mutate(
        "/api/location/save",
        loc(cash, "Каса низ", "cash")
            .put("mode", "split")
            .put("bar_target", bar)
            .put("delivery_target", destination));
    int splitId =
        s.mutate(
                "/api/order",
                new JSONObject()
                    .put("request", "split")
                    .put("location_id", cash)
                    .put("card_amount", 0)
                    .put("cash_given", 10000)
                    .put(
                        "items",
                        new JSONArray()
                            .put(new JSONObject().put("id", 1).put("qty", 1))
                            .put(new JSONObject().put("id", food).put("qty", 1))))
            .getInt("id");
    JSONArray splitItems = order(s, splitId).getJSONArray("items");
    check(
        splitItems.getJSONObject(0).getString("location_id").equals(bar),
        "Split drink target wrong");
    check(
        splitItems.getJSONObject(1).getString("location_id").equals(destination),
        "Split food target wrong");
    check(
        order(s, id)
            .getJSONArray("items")
            .getJSONObject(0)
            .getString("location_id")
            .equals(destination),
        "Existing order rerouted after config edit");
    JSONObject payment = order(s, id).getJSONObject("payment");
    check(
        s.cardPayments(Long.MAX_VALUE)
            .getJSONArray("payments")
            .getJSONObject(0)
            .getString("guest")
            .equals("Іван Петренко"),
        "Card owner name absent");
    s.mutate("/api/transaction/hide", new JSONObject().put("id", id));
    check(
        s.cardPayments(Long.MAX_VALUE, true).getJSONArray("payments").length() == 0,
        "Transaction not hidden");
    check(
        s.cardPayments(Long.MAX_VALUE).getJSONArray("payments").length() == 1,
        "Cashier list wrongly removed");
    check(
        order(s, id).getJSONObject("payment").toString().equals(payment.toString()),
        "Financial record changed");
    s.mutate(
        "/api/expenses",
        new JSONObject().put("request", "extra-delete").put("cost", 1234).put("note", "Помилка"));
    s.mutate("/api/expenses/delete", new JSONObject().put("id", "extra-delete"));
    check(s.state().getJSONArray("additional_expenses").length() == 0, "Expense not deleted");
    s.mutate("/api/settings/update", new JSONObject().put("online_payment_enabled", false));
    s = new CafeStore(file);
    check(s.state().getJSONArray("locations").length() == 3, "Locations lost on restart");
    check(!s.state().getBoolean("online_payment_enabled"), "Payment toggle lost");
    CafeStore restored = new CafeStore(new File(folder, "restored.json"));
    restored.restore(s.backup());
    check(restored.state().getJSONArray("locations").length() == 3, "Locations lost on restore");
    AccessControl acl = new AccessControl("owner");
    for (String role : new String[] {"cash", "bar", "delivery", "service"}) {
      check(
          !acl.writeAllowed(role, "/api/location/save", new JSONObject()),
          "Staff changed locations");
      check(!acl.readAllowed(role, "/api/transactions"), "Staff saw admin ledger");
      check(
          !acl.writeAllowed(role, "/api/expenses/delete", new JSONObject()),
          "Staff deleted expenses");
    }
    s.publicSettings(true);
    JSONObject menu = s.publicMenu();
    check(!menu.getBoolean("online_payment"), "Local server advertised nonexistent bank service");
    check(
        menu.getJSONArray("products").getJSONObject(0).has("image_url"),
        "Public image field missing");

    s.mutate("/api/location/save", loc("bar", "Бариста головний", "bar").put("color", "#eecc44"));
    s.mutate(
        "/api/location/save",
        loc(cash, "Спільна каса", "cash")
            .put("targets", new JSONArray().put(bar).put(destination)));
    int joint =
        s.mutate(
                "/api/order",
                new JSONObject()
                    .put("request", "joint")
                    .put("card_amount", 0)
                    .put("location_id", cash)
                    .put("cash_given", 100000)
                    .put("items", new JSONArray().put(new JSONObject().put("id", 1).put("qty", 2))))
            .getInt("id");
    JSONObject shared = order(s, joint),
        originalPayment = new JSONObject(shared.getJSONObject("payment").toString());
    JSONObject sharedItem = shared.getJSONArray("items").getJSONObject(0);
    check(
        shared.getJSONArray("items").length() == 1
            && sharedItem.getJSONArray("destinations").length() == 2,
        "Duplicated shared order");
    check(shared.getString("cash_location_name").equals("Спільна каса"), "Source snapshot missing");
    for (String role : new String[] {"bar", "delivery"}) {
      JSONObject projection = acl.state(s.state(), role);
      boolean present = false;
      JSONArray rows = projection.getJSONArray("orders");
      for (int n = 0; n < rows.length(); n++)
        if (rows.getJSONObject(n).getInt("id") == joint) present = true;
      check(present, "Shared order absent for role " + role);
    }
    s.mutate(
        "/api/issue-unit",
        new JSONObject()
            .put("order", joint)
            .put("id", sharedItem.getInt("id"))
            .put("route", "bar")
            .put("location_id", bar)
            .put("unit", 0)
            .put("delivered", true));
    check(
        order(s, joint)
            .getJSONArray("items")
            .getJSONObject(0)
            .getJSONArray("unit_issued")
            .getBoolean(0),
        "Shared unit not issued");
    s.mutate(
        "/api/issue",
        new JSONObject().put("id", joint).put("route", "instant").put("location_id", destination));
    check(
        order(s, joint)
            .getJSONArray("items")
            .getJSONObject(0)
            .getString("status")
            .equals("delivered"),
        "Shared completion missing");
    check(
        order(s, joint).getJSONObject("payment").toString().equals(originalPayment.toString()),
        "Shared issue changed finances");
    s.mutate(
        "/api/undo-issue",
        new JSONObject().put("route", "instant").put("location_id", destination));
    JSONArray issued =
        order(s, joint).getJSONArray("items").getJSONObject(0).getJSONArray("unit_issued");
    check(issued.getBoolean(0) && !issued.getBoolean(1), "Shared undo restored wrong units");
    String temporary = "loc-dddddddddddddddddddddddddddddddd";
    s.mutate("/api/location/save", loc(temporary, "Тимчасова", "delivery"));
    s.mutate("/api/location/save", loc(temporary, "Тимчасова", "bar"));
    s.mutate("/api/location/delete", new JSONObject().put("id", temporary));
    for (String protectedId : new String[] {"cash", "bar", "delivery", cash, destination}) {
      try {
        s.mutate("/api/location/delete", new JSONObject().put("id", protectedId));
        throw new AssertionError("Deleted protected/busy/referenced location");
      } catch (IllegalArgumentException expected) {
      }
    }
    try {
      s.mutate("/api/location/save", loc(cash, "X", "cash").put("targets", new JSONArray()));
      throw new AssertionError("Empty destinations accepted");
    } catch (IllegalArgumentException expected) {
    }
    restored.restore(s.backup());
    check(
        order(restored, joint)
                .getJSONArray("items")
                .getJSONObject(0)
                .getJSONArray("destinations")
                .length()
            == 2,
        "Destinations lost on restore");
    System.out.println(
        "PASS locations/settings: whole-order routing, catalog preservation, scoped issue/undo,"
            + " names, transaction hiding, expense deletion, permissions and persistence");
  }
}
