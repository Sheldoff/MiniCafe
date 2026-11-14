import java.io.*;
import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;
public class CashWorkspaceTest {
 static final String TWO="loc-abababababababababababababababab";
 static void check(boolean b,String message){if(!b)throw new AssertionError(message);}
 static JSONObject sale(String req,String cash,String guest)throws Exception{return new JSONObject().put("request",req).put("location_id",cash).put("guest",guest).put("cash_given",0).put("card_amount",3500).put("items",new JSONArray().put(new JSONObject().put("id",1).put("qty",1)));}
 static JSONObject loc(String prefix)throws Exception{return new JSONObject().put("id",TWO).put("name","Каса 2").put("kind","cash").put("color","#456789").put("guest_prefix",prefix);}
 public static void main(String[] args)throws Exception{
  File f=new File(Files.createTempDirectory("cash-workspace-").toFile(),"data.json");CafeStore s=new CafeStore(f);
  s.mutate("/api/location/save",loc("низ "));s.mutate("/api/order",sale("base","cash",""));s.mutate("/api/order",sale("other",TWO,""));s.mutate("/api/order",sale("named",TWO,"Олена"));s.mutate("/api/order",sale("other",TWO,""));
  s=new CafeStore(f);s.mutate("/api/order",sale("next",TWO,""));check(s.state().getJSONArray("orders").getJSONObject(0).getString("guest").equals("низ 2"),"Exact prefix or sequence lost");
  check(s.state().getJSONObject("next_guest_numbers").getInt("cash")==2,"Other cash changed main number");
  s.mutate("/api/location/save",loc("Н"));s.mutate("/api/order",sale("third",TWO,""));check(s.state().getJSONArray("orders").getJSONObject(0).getString("guest").equals("Н3"),"Prefix rename reset counter");
  check(s.cardPayments(Long.MAX_VALUE,false,"cash").getJSONArray("payments").length()==1,"Main cash ledger leaked");check(s.cardPayments(Long.MAX_VALUE,false,TWO).getJSONArray("payments").length()==4,"Second cash ledger wrong");
  int sid=s.state().getInt("active_session");s.mutate("/api/session/rename",new JSONObject().put("id",sid).put("name","Ранкова зміна"));check(s.state().getJSONArray("sessions").getJSONObject(0).getString("name").equals("Ранкова зміна"),"Session rename lost");
  s.mutate("/api/transaction/clear",new JSONObject());check(s.cardPayments(Long.MAX_VALUE,true).getJSONArray("payments").length()==0,"History not cleared");check(s.cardPayments(Long.MAX_VALUE,false,TWO).getJSONArray("payments").length()==4,"Clearing log changed cash ledger");
  System.out.println("PASS cash-specific numbering/prefixes, names/retries/restart, isolated card histories, session rename and non-financial history clear");
 }
}
