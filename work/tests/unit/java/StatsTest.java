import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class StatsTest {
  static void check(boolean b, String message) {
    if (!b) throw new AssertionError(message);
  }

  static JSONObject json(String s) throws Exception {
    return new JSONObject(s);
  }

  static JSONObject order(CafeStore db, String req, String items, long cash, long card)
      throws Exception {
    return db.mutate(
        "/api/order",
        json(
            "{request:'"
                + req
                + "',guest:'Олена',comment:'Тестовий коментар',cash_given:"
                + cash
                + ",card_amount:"
                + card
                + ",items:"
                + items
                + "}"));
  }

  public static void main(String[] args) throws Exception {
    File file = Files.createTempDirectory("cafe-stats").resolve("data.json").toFile();
    CafeStore db = new CafeStore(file);
    byte[] before = db.backup();
    try {
      order(db, "short", "[{id:1,qty:1}]", 1000, 0);
      throw new AssertionError("Short payment accepted");
    } catch (CafeStore.PaymentError e) {
      check(e.missing == 2500, "Wrong shortfall");
    }
    check(Arrays.equals(before, db.backup()), "Insufficient payment persisted");
    int sid = db.mutate("/api/session/start", json("{name:'Ярмарок'}")).getInt("id");
    order(db, "cash", "[{id:1,qty:2,note:'Без цукру'},{id:5,qty:1}]", 15000, 0);
    order(db, "card", "[{id:2,qty:1}]", 0, 5500);
    order(db, "mixed", "[{id:4,qty:1},{id:5,qty:1}]", 5000, 4000);
    JSONObject report = db.statistics(sid, null, 180);
    check(report.getLong("revenue") == 24500, "Revenue");
    check(report.getLong("cash") == 15000, "Cash incorrectly includes change");
    check(report.getLong("card") == 9500, "Card");
    check(report.getInt("order_count") == 3, "Count");
    check(
        report.getLong("min_check") == 5500
            && report.getLong("max_check") == 11500
            && report.getLong("avg_check") == 8167,
        "Checks");
    check(report.getLong("food_qty") == 2 && report.getLong("food_orders") == 2, "Food quantities");
    check(report.getJSONArray("drinks").length() == 3, "Drink types");
    check(
        db.state()
            .getJSONArray("orders")
            .getJSONObject(2)
            .getJSONArray("items")
            .getJSONObject(0)
            .getString("note")
            .equals("Без цукру"),
        "Comment lost");
    CafeStore reopened = new CafeStore(file);
    check(reopened.state().getInt("active_session") == sid, "Restart closes session");
    db.mutate("/api/session/end", json("{}"));
    order(db, "evening", "[{id:1,qty:1}]", 3500, 0);
    check(db.state().getInt("active_session") > sid, "Automatic next session");
    check(db.statistics(sid, null, 0).getInt("order_count") == 3, "Session isolation");
    JSONObject snapshot = new JSONObject(new String(db.backup(), "UTF-8"));
    String[] times = {
      "2026-10-18 22:00:00", "2026-10-18 22:15:00", "2026-10-18 23:00:00", "2026-10-19 00:00:00"
    };
    for (int i = 0; i < 4; i++)
      snapshot.getJSONArray("orders").getJSONObject(i).put("created", times[i]);
    db.restore(snapshot.toString().getBytes("UTF-8"));
    report = db.statistics(sid, null, 180);
    check(report.getLong("duration_seconds") == 3600, "Elapsed time");
    check(db.statistics(null, "2026-10-19", 180).getInt("order_count") == 4, "Local day");
    JSONObject legacy = new JSONObject(snapshot.toString());
    legacy.remove("sessions");
    legacy.remove("nextSession");
    legacy.remove("active_session");
    legacy.remove("require_session_start");
    for (int i = 0; i < 4; i++) legacy.getJSONArray("orders").getJSONObject(i).remove("payment");
    File old = Files.createTempDirectory("cafe-old").resolve("old.json").toFile();
    Files.write(old.toPath(), legacy.toString().getBytes("UTF-8"));
    CafeStore migrated = new CafeStore(old);
    check(migrated.statistics(0, null, 0).getLong("unknown") == 28000, "Legacy payment invented");
    check(migrated.state().getJSONArray("orders").length() == 4, "Migration dropped orders");
    byte[] font = Files.readAllBytes(Paths.get(args[0]));
    Files.write(Paths.get(args[1]), PdfReport.create(report, font));
    JSONArray many = new JSONArray();
    for (int i = 0; i < 55; i++)
      many.put(
          json(
              "{name:'Капучино з дуже довгою назвою та додатковою порцією еспресо №"
                  + i
                  + "',qty:3,amount:19500}"));
    report.put("drinks", many);
    Files.write(Paths.get(args[2]), PdfReport.create(report, font));
    File largeFile = Files.createTempDirectory("cafe-large").resolve("data.json").toFile();
    CafeStore large = new CafeStore(largeFile);
    for (int i = 0; i < 305; i++) order(large, "history-" + i, "[{id:1,qty:1}]", 3500, 0);
    check(
        large.state().getJSONArray("orders").length() == 305, "All pending orders remain visible");
    check(
        large.statistics(1, null, 0).getInt("order_count") == 305,
        "Report truncated to recent 300");
    JSONObject lastPage = large.history(1, null, 0, 6);
    check(
        lastPage.getInt("total") == 305
            && lastPage.getJSONArray("orders").length() == 5
            && !lastPage.getBoolean("has_next"),
        "Full session history paging");
    System.out.println(
        "PASS: cash/card/mixed, change excluded, insufficient payment atomic rejection, comments,"
            + " session lifecycle/isolation/persistence, legacy migration, local day, receipt"
            + " metrics, duration, >300 orders, PDFs");
  }
}
