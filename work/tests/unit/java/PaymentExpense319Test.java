import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class PaymentExpense319Test {
  static JSONObject j(String s) throws Exception {
    return new JSONObject(s);
  }

  static void check(boolean b, String m) {
    if (!b) throw new AssertionError(m);
  }

  static void order(CafeStore db, String req, long cash, long card) throws Exception {
    db.mutate(
        "/api/order",
        j(
            "{request:'"
                + req
                + "',cash_given:"
                + cash
                + ",card_amount:"
                + card
                + ",items:[{id:1,qty:1}]}"));
  }

  public static void main(String[] args) throws Exception {
    File f = Files.createTempDirectory("payment319").resolve("db.json").toFile();
    CafeStore db = new CafeStore(f);
    order(db, "cash", 5000, 0);
    order(db, "card", 0, 3500);
    order(db, "mixed", 2000, 2000);
    order(db, "card-over", 0, 5000);
    order(db, "mixed-over", 1000, 5000);
    JSONObject r = db.statistics(1, null, 0);
    check(r.getLong("cash_count") == 3 && r.getLong("card_count") == 4, "counts incl mixed");
    check(
        r.getLong("cash") == 2000 && r.getLong("card") == 15500 && r.getLong("revenue") == 17500,
        "net cash/card totals " + r);
    JSONArray orders = db.state().getJSONArray("orders");
    JSONObject last = orders.getJSONObject(0).getJSONObject("payment");
    check(
        last.getLong("change") == 2500 && last.getLong("cash_amount") == -1500,
        "over-card cash change");
    db = new CafeStore(f);
    check(db.statistics(1, null, 0).getLong("cash") == 2000, "negative cash persistence");
    CafeStore restored =
        new CafeStore(Files.createTempDirectory("restore319").resolve("db.json").toFile());
    restored.restore(db.backup());
    check(restored.statistics(1, null, 0).getLong("card_count") == 4, "payment backup validation");
    db.mutate("/api/expenses", j("{request:'extra-edit',cost:1000,note:'Кава'}"));
    String beforeCreated =
        db.state().getJSONArray("additional_expenses").getJSONObject(0).getString("created");
    db.mutate("/api/expenses/update", j("{id:'extra-edit',cost:2500,note:'Молоко'}"));
    r = db.statistics(1, null, 0);
    check(
        r.getLong("additional_expenses") == 2500
            && r.getJSONArray("expense_details").length() == 1
            && r.getJSONArray("expense_details")
                .getJSONObject(0)
                .getString("note")
                .equals("Молоко"),
        "expense update replaces");
    check(
        db.state()
            .getJSONArray("additional_expenses")
            .getJSONObject(0)
            .getString("created")
            .equals(beforeCreated),
        "expense date moved");
    byte[] before = db.backup();
    for (String invalid :
        new String[] {"{id:'extra-edit',cost:0,note:''}", "{id:'missing',cost:100,note:''}"}) {
      try {
        db.mutate("/api/expenses/update", j(invalid));
        throw new AssertionError("invalid edit accepted");
      } catch (IllegalArgumentException expected) {
      }
    }
    check(Arrays.equals(before, db.backup()), "invalid expense persisted");
    try {
      order(db, "short", 100, 100);
      throw new AssertionError("short accepted");
    } catch (CafeStore.PaymentError expected) {
    }
    System.out.println(
        "PASS payment counts/mixed, card overpayment and cash change, net revenue,"
            + " persistence/backup validation, editable expense date/session preservation, atomic"
            + " invalid rejection");
  }
}
