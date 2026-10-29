import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class GroupExpenses320Test {
  static JSONObject j(String s) throws Exception {
    return new JSONObject(s);
  }

  static void check(boolean v, String m) {
    if (!v) throw new AssertionError(m);
  }

  public static void main(String[] a) throws Exception {
    CafeStore db =
        new CafeStore(Files.createTempDirectory("groups320").resolve("db.json").toFile());
    db.mutate(
        "/api/order", j("{request:'paid',cash_given:3500,card_amount:0,items:[{id:1,qty:1}]}"));
    db.mutate("/api/expenses", j("{request:'a',cost:2000,note:'Кава'}"));
    db.mutate("/api/expenses", j("{request:'b',cost:3000,note:'  кава  '}"));
    db.mutate("/api/expenses", j("{request:'c',cost:500,note:''}"));
    db.mutate("/api/expenses", j("{request:'d',cost:500,note:'Додаткові витрати'}"));
    JSONObject r = db.statistics(1, null, 0);
    JSONArray groups = r.getJSONArray("expense_groups");
    check(
        groups.length() == 2
            && groups.getJSONObject(0).getLong("cost") == 5000
            && groups.getJSONObject(1).getLong("cost") == 1000,
        "normalized sums");
    check(
        r.getJSONArray("expense_details").length() == 4 && r.getLong("expenses") == 6000,
        "source entries/totals");
    db.mutate("/api/expenses/update", j("{id:'a',cost:2500,note:'Молоко'}"));
    r = db.statistics(1, null, 0);
    check(
        r.getJSONArray("expense_groups").length() == 3 && r.getLong("expenses") == 6500,
        "editing regroup");
    db.mutate("/api/session/end", j("{}"));
    db.mutate(
        "/api/order", j("{request:'next',cash_given:3500,card_amount:0,items:[{id:1,qty:1}]}"));
    db.mutate("/api/expenses", j("{request:'e',cost:1000,note:'Кава'}"));
    check(
        db.statistics(2, null, 0).getJSONArray("expense_groups").getJSONObject(0).getLong("cost")
            == 1000,
        "session isolation");
    System.out.println(
        "PASS grouped expense sums, whitespace/case/default label, preserved editable source"
            + " records, regroup after editing, session isolation");
  }
}
