import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.json.*;
import ua.minicafe.mobile.*;
public class GuestNamesTest {
 static void check(boolean value,String message) { if(!value) throw new AssertionError(message); }
 static JSONObject sale(String request,String guest) throws Exception {
  return new JSONObject().put("request",request).put("guest",guest).put("items",new JSONArray().put(new JSONObject().put("id",1).put("qty",1))).put("cash_given",100000).put("card_amount",0);
 }
 static JSONObject loc(boolean required) throws Exception {return new JSONObject().put("id","cash").put("kind","cash").put("name","Каса").put("color","#333333").put("guest_name_required",required);}
 static void guest(CafeStore store,String expected) throws Exception {
  JSONArray orders=store.state().getJSONArray("orders");check(orders.getJSONObject(0).getString("guest").equals(expected),"Wrong anonymous guest");
 }
 public static void main(String[] args) throws Exception {
  File file=new File(Files.createTempDirectory("guest-names-").toFile(),"data.json");CafeStore s=new CafeStore(file);
  s.mutate("/api/order",sale("one",""));guest(s,"Гість №1");
  s.mutate("/api/order",sale("one",""));check(s.state().getInt("next_guest_number")==2,"Retry consumed number");
  s.mutate("/api/order",sale("named","Олена"));check(s.state().getInt("next_guest_number")==2,"Name consumed number");
  byte[] before=s.backup();
  try {s.mutate("/api/order",sale("unpaid","").put("cash_given",0));throw new AssertionError("Unpaid accepted");}catch(IllegalArgumentException expected){}
  check(Arrays.equals(before,s.backup()),"Failure consumed number");
  s=new CafeStore(file);s.mutate("/api/order",sale("two","  "));guest(s,"Гість №2");
  s.mutate("/api/location/save",loc(true));before=s.backup();
  try{s.mutate("/api/order",sale("required",""));throw new AssertionError("Required name missing");}catch(IllegalArgumentException expected){}
  check(Arrays.equals(before,s.backup()),"Required rejection changed state");
  s.mutate("/api/order",sale("required","Іван"));check(s.state().getInt("next_guest_number")==3,"Required named sale consumed number");
  s.mutate("/api/location/save",loc(false));s.mutate("/api/order",sale("three",""));guest(s,"Гість №3");
  System.out.println("PASS anonymous guest sequence, named sales, atomic failures/retries, restart and required cash setting");
 }
}
