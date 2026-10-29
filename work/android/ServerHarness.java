import ua.minicafe.mobile.*;
import java.io.*;
public class ServerHarness {
 public static void main(String[] args)throws Exception{
  File file=new File(args[0]);CafeStore store=new CafeStore(file);
  String html=new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(args[1])),"UTF-8");
  byte[] font=java.nio.file.Files.readAllBytes(java.nio.file.Paths.get("work/android/assets/fonts/DejaVuSans.ttf"));CafeHttpServer server=new CafeHttpServer(8768,store,"phone-test-key",html,font);server.start(10000,false);
  System.out.println("READY: Android server core, port 8768");Thread.currentThread().join();
 }
}
