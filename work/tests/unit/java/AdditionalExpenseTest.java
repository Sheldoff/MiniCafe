import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class AdditionalExpenseTest {
  static JSONObject j(String s) throws Exception {
    return new JSONObject(s);
  }

  static void check(boolean v, String m) {
    if (!v) throw new AssertionError(m);
  }

  static JSONObject extra(String req, long amount, String note) throws Exception {
    return new JSONObject().put("request", req).put("cost", amount).put("note", note);
  }

  static void paid(CafeStore db, String req) throws Exception {
    db.mutate(
        "/api/order",
        j("{request:'" + req + "',cash_given:3500,card_amount:0,items:[{id:1,qty:1}]}"));
  }

  public static void main(String[] a) throws Exception {
    File f = Files.createTempDirectory("extra-expense").resolve("db.json").toFile();
    CafeStore db = new CafeStore(f);
    db.mutate("/api/expenses", extra("extra-1", 2500, "Кава"));
    check(db.state().getInt("active_session") == 0, "premature session");
    db.mutate("/api/expenses", extra("extra-1", 2500, "Кава"));
    paid(db, "paid");
    int sid = db.state().getInt("active_session");
    db.mutate(
        "/api/calculate-menu",
        j(
            "{confirm:true,calculation_id:'calc-1',cost:1000,items:[{name:'Булка',price:500,stock:2}]}"));
    JSONObject r = db.statistics(sid, null, 0);
    check(
        r.getLong("expenses") == 3500
            && r.getLong("additional_expenses") == 2500
            && r.getLong("calculator_expenses") == 1000
            && r.getLong("net_revenue") == 0,
        "split totals");
    check(
        r.getJSONArray("expense_details").length() == 1
            && r.getJSONArray("expense_details").getJSONObject(0).getString("note").equals("Кава"),
        "detail/dedup");
    db.mutate("/api/session/end", j("{}"));
    paid(db, "next");
    int next = db.state().getInt("active_session");
    db.mutate("/api/expenses", extra("historical", 500, "").put("session_id", sid));
    check(
        db.statistics(sid, null, 0).getLong("additional_expenses") == 3000
            && db.statistics(next, null, 0).getLong("additional_expenses") == 0,
        "selected session");
    byte[] before = db.backup();
    for (JSONObject invalid :
        new JSONObject[] {
          extra("bad", 0, ""),
          extra("bad", -1, ""),
          extra("bad", 100, "").put("session_id", 9999),
          extra("extra-1", 3000, "Кава"),
          extra("calc-1", 1000, "")
        }) {
      try {
        db.mutate("/api/expenses", invalid);
        throw new AssertionError("invalid extra accepted");
      } catch (IllegalArgumentException expected) {
      }
    }
    try {
      db.mutate(
          "/api/calculate-menu",
          j(
              "{confirm:true,calculation_id:'extra-1',cost:1000,items:[{name:'Булка',price:1000,stock:4}]}"));
      throw new AssertionError("overwrite extra by calculator");
    } catch (IllegalArgumentException expected) {
    }
    check(Arrays.equals(before, db.backup()), "invalid requests changed data");
    db = new CafeStore(f);
    check(db.statistics(sid, null, 0).getLong("expenses") == 4000, "persistence");
    CafeStore restored =
        new CafeStore(Files.createTempDirectory("extra-restore").resolve("db.json").toFile());
    restored.restore(db.backup());
    check(
        restored.statistics(sid, null, 0).getLong("additional_expenses") == 3000, "backup restore");
    db.mutate("/api/stats/clear", j("{confirm:true}"));
    check(
        !new JSONObject(new String(db.backup(), "UTF-8")).has("calculator_expenses"),
        "clear expenses");
    System.out.println(
        "PASS additional expenses: pending/selected sessions, no duplicate retries, optional"
            + " descriptions, separate/total/net amounts, calculator isolation, atomic invalid"
            + " rejection, persistence, backup/restore, clear");
  }
}
