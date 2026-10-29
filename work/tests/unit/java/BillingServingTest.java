import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class BillingServingTest {
  static void check(boolean b, String m) {
    if (!b) throw new AssertionError(m);
  }

  static JSONObject j(String s) throws Exception {
    return new JSONObject(s);
  }

  static JSONObject item(CafeStore db, int order) throws Exception {
    JSONArray os = db.state().getJSONArray("orders");
    for (int i = 0; i < os.length(); i++)
      if (os.getJSONObject(i).getInt("id") == order)
        return os.getJSONObject(i).getJSONArray("items").getJSONObject(0);
    throw new AssertionError();
  }

  public static void main(String[] a) throws Exception {
    File file = Files.createTempDirectory("billing-serving").resolve("data.json").toFile();
    CafeStore db = new CafeStore(file);
    JSONObject input =
        j("{request:'price',cash_given:2400,card_amount:0,items:[{id:1,qty:2,unit_price:1200}]}");
    int order = db.mutate("/api/order", input).getInt("id");
    JSONObject it = item(db, order);
    check(it.getLong("price") == 1200 && it.getLong("catalog_price") == 3500, "price snapshot");
    check(
        db.state().getJSONArray("products").getJSONObject(0).getLong("price") == 3500,
        "catalog mutated");
    int iid = it.getInt("id");
    JSONObject issue =
        new JSONObject()
            .put("order", order)
            .put("id", iid)
            .put("route", "bar")
            .put("unit", 0)
            .put("delivered", true);
    db.mutate("/api/issue-unit", issue);
    check(
        item(db, order).getString("status").equals("new")
            && item(db, order).getJSONArray("unit_issued").getBoolean(0)
            && !item(db, order).getJSONArray("unit_issued").getBoolean(1),
        "partial unit");
    db = new CafeStore(file);
    check(
        db.state().getJSONObject("can_undo_issue").getBoolean("bar"), "partial undo not available");
    db.mutate("/api/issue", new JSONObject().put("id", order).put("route", "bar"));
    db.mutate("/api/undo-issue", j("{route:'bar'}"));
    check(
        item(db, order).getJSONArray("unit_issued").getBoolean(0)
            && !item(db, order).getJSONArray("unit_issued").getBoolean(1),
        "full undo lost partial");
    db.mutate("/api/undo-issue", j("{route:'bar'}"));
    check(!item(db, order).getJSONArray("unit_issued").getBoolean(0), "single unit undo");
    byte[] before = db.backup();
    for (String bad :
        new String[] {
          "{request:'bad-negative',cash_given:0,card_amount:0,items:[{id:1,qty:1,unit_price:-1}]}",
          "{request:'bad-fraction',cash_given:10,card_amount:0,items:[{id:1,qty:1,unit_price:1.5}]}",
          "{request:'gift-paid',gift:true,cash_given:1,card_amount:0,items:[{id:1,qty:1}]}"
        }) {
      try {
        db.mutate("/api/order", j(bad));
        throw new AssertionError("bad billing accepted");
      } catch (IllegalArgumentException expected) {
      }
    }
    check(Arrays.equals(before, db.backup()), "invalid billing persisted");
    int gift =
        db.mutate(
                "/api/order",
                j(
                    "{request:'gift',gift:true,cash_given:0,card_amount:0,items:[{id:1,qty:3,unit_price:1250}]}"))
            .getInt("id");
    check(
        item(db, gift).getLong("price") == 0 && item(db, gift).getLong("requested_price") == 1250,
        "gift snapshot");
    JSONObject report = db.statistics(1, null, 0);
    check(
        report.getLong("revenue") == 2400
            && report.getLong("cash") == 2400
            && report.getLong("min_check") == 2400
            && report.getInt("order_count") == 2,
        "gift revenue");
    check(report.getJSONArray("drinks").getJSONObject(0).getInt("qty") == 5, "gift quantities");
    db = new CafeStore(file);
    check(item(db, gift).getInt("qty") == 3, "gift persistence");
    System.out.println(
        "PASS custom prices, unchanged menu, gifts zero revenue with quantities, validation"
            + " rollback, per-serving issue and persistent precise undo");
  }
}
