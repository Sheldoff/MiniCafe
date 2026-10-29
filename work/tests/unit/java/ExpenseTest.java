import java.io.*;
import java.nio.file.*;
import java.text.*;
import java.util.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class ExpenseTest {
  static JSONObject j(String s) throws Exception {
    return new JSONObject(s);
  }

  static void check(boolean v, String m) {
    if (!v) throw new AssertionError(m);
  }

  static JSONObject batch(String id, long cost) throws Exception {
    return j(
        "{confirm:true,calculation_id:'"
            + id
            + "',cost:"
            + cost
            + ",items:[{id:5,name:'Круасан',price:5000,stock:10}]}");
  }

  static void order(CafeStore db, String req) throws Exception {
    db.mutate(
        "/api/order",
        j("{request:'" + req + "',items:[{id:5,qty:2}],cash_given:0,card_amount:10000}"));
  }

  public static void main(String[] args) throws Exception {
    File f = Files.createTempDirectory("expense-test").resolve("db.json").toFile();
    CafeStore db = new CafeStore(f);
    String day = new SimpleDateFormat("yyyy-MM-dd").format(new Date());
    int offset = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60000;
    db.mutate("/api/calculate-menu", batch("batch-1", 6000));
    check(db.state().getInt("active_session") == 0, "expense starts session prematurely");
    check(db.statistics(null, day, offset).getLong("expenses") == 6000, "pending daily expense");
    db.mutate("/api/calculate-menu", batch("batch-1", 7000));
    check(db.statistics(null, day, offset).getLong("expenses") == 7000, "double counting");
    order(db, "a");
    int sid = db.state().getInt("active_session");
    JSONObject report = db.statistics(sid, null, offset);
    check(
        report.getLong("expenses") == 7000
            && report.getLong("revenue") == 10000
            && report.getLong("net_revenue") == 3000,
        "session assignment/net");
    db.mutate("/api/calculate-menu", batch("batch-2", 5000));
    check(db.statistics(sid, null, 0).getLong("net_revenue") == -2000, "negative net/second batch");
    db.mutate("/api/session/end", j("{}"));
    db.mutate("/api/calculate-menu", batch("batch-3", 2000));
    order(db, "b");
    int second = db.state().getInt("active_session");
    check(
        second != sid && db.statistics(second, null, 0).getLong("expenses") == 2000,
        "next session");
    db.mutate("/api/calculate-menu", batch("batch-1", 6000));
    check(
        db.statistics(sid, null, 0).getLong("expenses") == 11000
            && db.statistics(second, null, 0).getLong("expenses") == 2000,
        "existing batch moved sessions");
    byte[] before = db.backup();
    try {
      db.mutate("/api/calculate-menu", batch("bad", -1));
      throw new AssertionError("invalid cost accepted");
    } catch (IllegalArgumentException expected) {
    }
    check(Arrays.equals(before, db.backup()), "invalid cost partial write");
    JSONObject invalid = new JSONObject(new String(before, "UTF-8"));
    invalid
        .getJSONArray("calculator_expenses")
        .put(invalid.getJSONArray("calculator_expenses").getJSONObject(0));
    try {
      db.restore(invalid.toString().getBytes("UTF-8"));
      throw new AssertionError("duplicate expense restored");
    } catch (IllegalArgumentException expected) {
    }
    db = new CafeStore(f);
    check(db.statistics(sid, null, 0).getLong("expenses") == 11000, "persisted expense");
    CafeStore restored =
        new CafeStore(Files.createTempDirectory("expense-restore").resolve("db.json").toFile());
    restored.restore(db.backup());
    check(restored.statistics(second, null, 0).getLong("expenses") == 2000, "backup restore");
    db.mutate("/api/stats/clear", j("{confirm:true}"));
    check(db.statistics(null, day, offset).getLong("expenses") == 0, "clear expenses");
    System.out.println(
        "PASS expense upsert/no duplicates, pending/active/closed session assignment, daily totals,"
            + " net/loss, atomic invalid rejection, backup validation/restore, persistence, stats"
            + " clear");
  }
}
