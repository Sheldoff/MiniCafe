import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;
public class BackupInterop {
 public static void main(String[] args)throws Exception{
  Path root=Paths.get(args[1]);Files.createDirectories(root);
  CafeStore store=new CafeStore(root.resolve(args[0]+"-data.json").toFile());
  if(args[0].equals("create")){
   store.mutate("/api/product",new JSONObject().put("id",1).put("name","Кава").put("category","Напої").put("route","bar").put("price",5000).put("stock",3).put("stock_estimated",true).put("image",Codec.encode(Files.readAllBytes(Paths.get(args[2])))));
   store.mutate("/api/order",new JSONObject("{request:'legacy.1700000000.25',guest:'Гість',cash_given:6000,card_amount:5000,items:[{id:1,qty:2,note:'Без цукру'}]}"));
   JSONObject order=store.state().getJSONArray("orders").getJSONObject(0);int item=order.getJSONArray("items").getJSONObject(0).getInt("id");
   store.mutate("/api/issue-unit",new JSONObject().put("order",order.getInt("id")).put("id",item).put("route","bar").put("unit",0).put("delivered",true));
   store.mutate("/api/expenses",new JSONObject("{request:'interop-extra',note:'Кава',cost:1500}"));
   JSONObject backup=new JSONObject(new String(store.backup(),"UTF-8"));
   backup.put("nextProduct",100).put("nextOrder",100).put("nextItem",100).put("nextSession",100);
   Files.write(root.resolve("android.json"),backup.toString().getBytes("UTF-8"));
  }else{
   store.restore(Files.readAllBytes(root.resolve("web.json")));
   Files.write(root.resolve("android-roundtrip.json"),store.backup());
   JSONObject data=new JSONObject(new String(store.backup(),"UTF-8"));
   if(data.getJSONArray("orders").length()<1||!data.getJSONArray("products").getJSONObject(0).has("image"))throw new AssertionError("Data or photos lost");
  }
 }
}
