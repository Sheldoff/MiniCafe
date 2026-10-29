import java.io.*;
import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

/** Desktop runs the same store, validation, statistics, PDF and HTTP API as Android. */
public final class DesktopServer {
  public static void main(String[] args) throws Exception {
    File folder = new File(args[0]);
    folder.mkdirs();
    int port = Integer.parseInt(args[1]);
    String key = args[2];
    Path assets = Paths.get(args[3]);
    CafeStore store =
        new CafeStore(
            new File(folder, "cafe-data.json"),
            new JSONArray(
                new String(Files.readAllBytes(assets.resolve("default-menu.json")), "UTF-8")));
    store.addTestFood();
    AccessControl access = new AccessControl(new File(folder, "staff-access.json"), key);
    CafeHttpServer server =
        new CafeHttpServer(
            port,
            store,
            key,
            new String(Files.readAllBytes(assets.resolve("index.html")), "UTF-8"),
            Files.readAllBytes(assets.resolve("pdf-font.bin")),
            access);
    server.start(10000, false);
    Runtime.getRuntime().addShutdownHook(new Thread(() -> server.stop()));
    System.out.println("READY " + port);
    System.out.flush();
    try {
      while (System.in.read() != -1) {}
    } finally {
      server.stop();
    }
  }
}
