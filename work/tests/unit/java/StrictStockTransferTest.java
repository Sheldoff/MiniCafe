import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class StrictStockTransferTest {
  static JSONObject j(String s) throws Exception {
    return new JSONObject(s);
  }

  static void check(boolean b, String s) {
    if (!b) throw new AssertionError(s);
  }

  public static void main(String[] args) throws Exception {
    CafeStore db =
        new CafeStore(Files.createTempDirectory("strict-stock").resolve("data.json").toFile());
    db.mutate(
        "/api/product",
        j(
            "{id:5,name:'Їжа',category:'Їжа',route:'instant',price:5000,stock:1,stock_estimated:false}"));
    String before = new String(db.backup(), "UTF-8");
    for (String items : new String[] {"[{id:5,qty:2}]", "[{id:5,qty:1},{id:5,qty:1}]"}) {
      try {
        db.mutate(
            "/api/order",
            j("{request:'excess',card_amount:10000,cash_given:0,items:" + items + "}"));
        throw new AssertionError("Excess stock accepted");
      } catch (IllegalArgumentException expected) {
      }
      check(before.equals(new String(db.backup(), "UTF-8")), "Rejected stock mutated data");
    }
    db.mutate(
        "/api/order", j("{request:'one',card_amount:5000,cash_given:0,items:[{id:5,qty:1}]}"));
    try {
      db.mutate(
          "/api/order", j("{request:'zero',card_amount:5000,cash_given:0,items:[{id:5,qty:1}]}"));
      throw new AssertionError("Zero accepted");
    } catch (IllegalArgumentException expected) {
    }
    db.mutate(
        "/api/product",
        j(
            "{id:5,name:'Їжа',category:'Їжа',route:'instant',price:5000,stock:0,stock_estimated:true}"));
    db.mutate(
        "/api/order",
        j("{request:'estimated',card_amount:5000,cash_given:0,items:[{id:5,qty:1}]}"));
    JSONObject menu = new JSONObject(new String(db.exportMenu(), "UTF-8"));
    JSONObject old = new JSONObject(new String(db.backup(), "UTF-8"));
    db.importMenu(menu.getJSONArray("products"));
    JSONObject after = new JSONObject(new String(db.backup(), "UTF-8"));
    check(
        old.getJSONArray("orders").toString().equals(after.getJSONArray("orders").toString()),
        "Menu import touched orders");
    check(
        old.getJSONArray("sessions").toString().equals(after.getJSONArray("sessions").toString()),
        "Menu import touched sessions");
    boolean found = false;
    JSONArray ps = after.getJSONArray("products");
    for (int n = 0; n < ps.length(); n++) {
      JSONObject p = ps.getJSONObject(n);
      check(p.getInt("id") >= old.getInt("nextProduct"), "Reused product ID");
      if (p.getString("name").equals("Їжа")) {
        found = true;
        check(
            p.getLong("stock") == -1 && p.getBoolean("stock_estimated"),
            "Estimate lost on transfer");
      }
    }
    check(found, "Menu missing");
    System.out.println(
        "PASS strict stock, duplicate lines, atomic rejection, negative estimate and menu-only"
            + " transfer history");
  }
}
