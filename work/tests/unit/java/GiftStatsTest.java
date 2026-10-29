import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class GiftStatsTest {
  static JSONObject j(String s) throws Exception {
    return new JSONObject(s);
  }

  static void check(boolean v, String m) {
    if (!v) throw new AssertionError(m);
  }

  public static void main(String[] a) throws Exception {
    CafeStore db = new CafeStore(Files.createTempDirectory("gift-min").resolve("db.json").toFile());
    db.mutate(
        "/api/order",
        j("{request:'gift',gift:true,cash_given:0,card_amount:0,items:[{id:1,qty:2}]}"));
    JSONObject r = db.statistics(1, null, 0);
    check(
        r.getLong("check_count") == 0
            && r.getLong("gift_count") == 1
            && r.getLong("min_check") == 0,
        "gift-only report");
    db.mutate(
        "/api/order", j("{request:'paid',cash_given:3500,card_amount:0,items:[{id:1,qty:1}]}"));
    r = db.statistics(1, null, 0);
    check(
        r.getLong("min_check") == 3500
            && r.getLong("order_count") == 2
            && r.getLong("gift_count") == 1
            && r.getLong("revenue") == 3500
            && r.getLong("avg_check") == 3500,
        "gift min exclusion only");
    db.mutate(
        "/api/order",
        j("{request:'zero',cash_given:0,card_amount:0,items:[{id:1,qty:1,unit_price:0}]}"));
    check(
        db.statistics(1, null, 0).getLong("min_check") == 0, "non-gift zero excluded incorrectly");
    System.out.println(
        "PASS gifted minimum excluded, gift-only empty minimum, normal zero receipt preserved,"
            + " other metrics unchanged");
  }
}
