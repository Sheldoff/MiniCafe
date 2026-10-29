import java.io.*;
import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class InventoryTest {
  static JSONObject j(String value) throws Exception {
    return new JSONObject(value);
  }

  static JSONObject product(CafeStore s, int id) throws Exception {
    JSONArray products = s.state().getJSONArray("products");
    for (int i = 0; i < products.length(); i++)
      if (products.getJSONObject(i).getInt("id") == id) return products.getJSONObject(i);
    throw new AssertionError();
  }

  static void check(boolean value, String text) {
    if (!value) throw new AssertionError(text);
  }

  public static void main(String[] args) throws Exception {
    CafeStore s =
        new CafeStore(Files.createTempDirectory("cafe-inventory").resolve("data.json").toFile());
    s.mutate(
        "/api/product",
        j("{id:5,name:'Круасан',category:'Випічка',price:4500,route:'instant',stock:2}"));
    s.mutate(
        "/api/order", j("{request:'first',cash_given:5000,card_amount:0,items:[{id:5,qty:1}]}"));
    check(product(s, 5).getLong("stock") == 1, "Stock not decremented");
    int item =
        s.state()
            .getJSONArray("orders")
            .getJSONObject(0)
            .getJSONArray("items")
            .getJSONObject(0)
            .getInt("id");
    s.mutate("/api/status", new JSONObject().put("id", item).put("status", "cancelled"));
    check(product(s, 5).getLong("stock") == 2, "Cancelled not returned");
    s.mutate("/api/status", new JSONObject().put("id", item).put("status", "new"));
    check(product(s, 5).getLong("stock") == 1, "Restored stock");
    s.mutate("/api/availability", j("{id:5,sold_out:true}"));
    try {
      s.mutate(
          "/api/order", j("{request:'out',cash_given:5000,card_amount:0,items:[{id:5,qty:1}]}"));
      throw new AssertionError("Sold out accepted");
    } catch (IllegalArgumentException expected) {
    }
    check(product(s, 5).getLong("stock") == 1, "Rejected order changed stock");
    s.mutate("/api/availability", j("{id:5,sold_out:false}"));
    s.mutate(
        "/api/product",
        j(
            "{id:2,name:'Капучино',category:'Напої',price:5500,route:'bar',stock:0,stock_estimated:true}"));
    s.mutate(
        "/api/order",
        j("{request:'estimate-zero',cash_given:0,card_amount:5500,items:[{id:2,qty:1}]}"));
    check(product(s, 2).getLong("stock") == -1, "Estimate incorrectly blocked order");
    JSONObject report = s.statistics(1, null, 0);
    check(
        report.getLong("food_amount") == 4500 && report.getLong("drinks_amount") == 5500,
        "Totals by route");
    check(report.getJSONArray("categories").length() == 2, "Categories snapshot");
    check(
        report.getJSONArray("categories").getJSONObject(0).getString("name").equals("Випічка"),
        "Missing custom category");
    System.out.println(
        "PASS: optional stock, decrement, cancellation, restore, zero estimate nonblocking,"
            + " sold-out rejection, per-category and drink/food sums");
  }
}
