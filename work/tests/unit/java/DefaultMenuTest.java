import java.io.*;
import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class DefaultMenuTest {
  static void check(boolean b, String m) {
    if (!b) throw new AssertionError(m);
  }

  public static void main(String[] args) throws Exception {
    JSONArray base =
        new JSONArray(
            new String(
                Files.readAllBytes(Paths.get("work/android/assets/default-menu.json")), "UTF-8"));
    File f = Files.createTempDirectory("cafe-base").resolve("data.json").toFile();
    CafeStore s = new CafeStore(f, base);
    JSONArray ps = s.state().getJSONArray("products");
    check(ps.length() == 8, "eight drinks");
    for (int i = 0; i < 8; i++) {
      JSONObject p = ps.getJSONObject(i);
      check(p.getInt("price") == 5000 && p.getString("route").equals("bar"), "price and route");
      check(s.image(p.getInt("id")).length > 1000, "image");
    }
    int id = ps.getJSONObject(0).getInt("id");
    JSONObject edited = new JSONObject(ps.getJSONObject(0).toString()).put("price", 7500);
    s.mutate("/api/product", edited);
    s = new CafeStore(f, base);
    check(
        s.state().getJSONArray("products").getJSONObject(0).getInt("price") == 7500,
        "edited price survived update");
    s.mutate(
        "/api/product",
        new JSONObject()
            .put("name", "Їжа")
            .put("category", "Їжа")
            .put("price", 2500)
            .put("route", "instant")
            .put("active", 1));
    s.mutate(
        "/api/order",
        new JSONObject()
            .put("request", "base-test")
            .put("guest", "Гість")
            .put("cash_given", 10000)
            .put("card_amount", 0)
            .put("items", new JSONArray().put(new JSONObject().put("id", id).put("qty", 1))));
    s.applyBaseDrinks(base);
    check(s.state().getJSONArray("products").length() == 9, "food preserved");
    check(s.state().getJSONArray("orders").length() == 1, "history preserved");
    s.addTestFood();
    check(s.state().getJSONArray("products").length() == 12, "test food added");
    s.addTestFood();
    check(s.state().getJSONArray("products").length() == 12, "test food must not duplicate");
    JSONArray list = s.state().getJSONArray("products");
    int testId = 0;
    for (int i = 0; i < list.length(); i++)
      if (list.getJSONObject(i).getString("name").equals("Мафін (тест)"))
        testId = list.getJSONObject(i).getInt("id");
    s.mutate("/api/delete-product", new JSONObject().put("id", testId));
    s = new CafeStore(f, base);
    s.addTestFood();
    check(s.state().getJSONArray("products").length() == 11, "deleted food must stay deleted");
    System.out.println("Default menu PASS: eight photos, prices, edits, food, history");
  }
}
