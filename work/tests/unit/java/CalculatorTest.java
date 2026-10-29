import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.json.*;
import ua.minicafe.mobile.*;

public class CalculatorTest {
  static JSONObject j(String s) throws Exception {
    return new JSONObject(s);
  }

  static void check(boolean b, String m) {
    if (!b) throw new AssertionError(m);
  }

  static JSONObject product(CafeStore db, int id) throws Exception {
    JSONArray ps = db.state().getJSONArray("products");
    for (int i = 0; i < ps.length(); i++)
      if (ps.getJSONObject(i).getInt("id") == id) return ps.getJSONObject(i);
    throw new AssertionError();
  }

  public static void main(String[] a) throws Exception {
    File f = Files.createTempDirectory("calculator-test").resolve("data.json").toFile();
    CafeStore db = new CafeStore(f);
    db.mutate(
        "/api/product",
        j(
            "{id:5,name:'Круасан',category:'Випічка',price:4500,route:'instant',active:false,stock:3}"));
    JSONObject batch =
        j(
            "{confirm:true,items:[{id:5,name:'Круасан',price:5000,stock:10},{name:'Мафін',price:3500,stock:20}]}");
    JSONObject result = db.mutate("/api/calculate-menu", batch);
    check(result.getInt("created") == 1 && result.getInt("updated") == 1, "counts");
    int id = result.getJSONArray("ids").getInt(1);
    check(
        product(db, 5).getInt("price") == 5000
            && product(db, 5).getInt("stock") == 10
            && product(db, 5).getInt("active") == 0
            && product(db, 5).getString("category").equals("Випічка"),
        "existing fields");
    check(
        product(db, id).getString("route").equals("instant")
            && product(db, id).getString("category").equals("Їжа")
            && product(db, id).getInt("stock") == 20,
        "new defaults");
    db.mutate(
        "/api/calculate-menu", j("{confirm:true,items:[{name:'  мафін  ',price:4000,stock:12}]}"));
    check(
        db.state().getJSONArray("products").length() == 6 && product(db, id).getInt("stock") == 12,
        "name upsert");
    byte[] before = db.backup();
    for (String invalid :
        new String[] {
          "{items:[{name:'Новий',price:500,stock:1}]}",
          "{confirm:true,items:[{name:'Новий',price:500,stock:1},{id:1,name:'Еспресо',price:500,stock:1}]}",
          "{confirm:true,items:[{name:'Новий',price:1250,stock:1}]}",
          "{confirm:true,items:[{name:'Новий',price:500,stock:0}]}",
          "{confirm:true,items:[{name:'Мафін',price:500,stock:1},{name:'мафін',price:500,stock:1}]}",
          "{confirm:true,items:[{id:5.5,name:'Круасан',price:500,stock:1}]}"
        }) {
      try {
        db.mutate("/api/calculate-menu", j(invalid));
        throw new AssertionError("accepted invalid batch");
      } catch (IllegalArgumentException expected) {
      }
    }
    check(Arrays.equals(before, db.backup()), "partial batch persisted");
    db = new CafeStore(f);
    check(
        product(db, id).getInt("price") == 4000 && product(db, 1).getInt("price") == 3500,
        "persisted/untouched drink");
    System.out.println(
        "PASS atomic calculator upsert, food defaults, price/stock, preserved category/visibility,"
            + " duplicates and invalid rows rollback, persistence");
  }
}
