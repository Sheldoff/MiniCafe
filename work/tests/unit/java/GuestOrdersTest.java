import java.io.*;
import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class GuestOrdersTest {
  static void check(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }

  static void reject(RunnableTest call) throws Exception {
    try {
      call.run();
    } catch (IllegalArgumentException e) {
      return;
    }
    throw new AssertionError("Request should be rejected");
  }

  interface RunnableTest {
    void run() throws Exception;
  }

  public static void main(String[] args) throws Exception {
    File file = Files.createTempDirectory("minicafe-guest-test").resolve("db.json").toFile();
    CafeStore db = new CafeStore(file);
    JSONObject draft = new JSONObject("{guest:'Олена Тестова',items:[{id:1,qty:2}]}");
    reject(() -> db.createGuestCode(draft));
    db.publicSettings(true);
    reject(() -> db.createGuestCode(new JSONObject("{guest:'Олена',items:[{id:1,qty:1}]}")));
    reject(
        () -> db.createGuestCode(new JSONObject("{guest:'Олена Тестова',items:[{id:1,qty:0}]}")));
    check(!db.publicMenu().toString().contains("orders"), "public privacy");
    String code = db.createGuestCode(draft).getString("code");
    check(code.matches("[1-9][0-9]{2}"), "three digits");
    check(db.state().getJSONArray("orders").length() == 0, "draft must not create an order");
    check(
        !db.state().toString().contains("guest_codes"), "private drafts omitted from staff state");
    check(db.pendingGuestCodes().getJSONArray("codes").length() == 1, "pending list");
    db.guestCode(code);
    db.guestCode(code);
    check(db.pendingGuestCodes().getJSONArray("codes").length() == 1, "loading is not consumption");
    JSONObject order =
        new JSONObject(
                "{request:'guest-test',guest:'Олена"
                    + " Тестова',items:[{id:1,qty:2}],cash_given:0,card_amount:0}")
            .put("public_code", code);
    try {
      db.mutate("/api/order", order);
      throw new AssertionError("Payment must fail");
    } catch (CafeStore.PaymentError expected) {
    }
    check(
        db.pendingGuestCodes().getJSONArray("codes").length() == 1,
        "failed payment preserves code");
    order.put("card_amount", 7000);
    int id = db.mutate("/api/order", order).getInt("id");
    check(db.pendingGuestCodes().getJSONArray("codes").length() == 0, "paid code removed");
    check(db.mutate("/api/order", order).getInt("id") == id, "payment retry");
    reject(() -> db.mutate("/api/order", new JSONObject(order.toString()).put("request", "other")));
    reject(() -> db.guestCode(code));
    String next = db.createGuestCode(draft).getString("code");
    check(!next.equals(code), "no early code reuse");
    CafeStore reopened = new CafeStore(file);
    check(
        reopened.guestCode(next).getString("guest").equals("Олена Тестова"), "restart persistence");
    reopened.publicSettings(false);
    check(reopened.publicMenu().getJSONArray("products").length() == 0, "closed public projection");
    check(
        reopened.guestCode(next).getJSONArray("items").length() == 1,
        "already issued code survives closure");
    JSONObject raw = new JSONObject(new String(Files.readAllBytes(file.toPath()), "UTF-8"));
    raw.getJSONArray("guest_codes").getJSONObject(1).put("expires", 0);
    File expired = new File(file.getParentFile(), "expired.json");
    Files.write(expired.toPath(), raw.toString().getBytes("UTF-8"));
    reject(() -> new CafeStore(expired).guestCode(next));
    System.out.println(
        "PASS guest codes: privacy, validation, three digits, unpaid loading, atomic"
            + " payment/rollback/retry, no reuse, persistence and expiry");
  }
}
