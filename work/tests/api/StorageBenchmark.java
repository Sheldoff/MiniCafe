import java.io.*;
import java.nio.file.*;
import org.json.*;
import ua.minicafe.mobile.*;

public final class StorageBenchmark {
  public static void main(String[] args) throws Exception {
    Path directory = Files.createTempDirectory("cafe-benchmark-");
    File file = directory.resolve("data.json").toFile();
    CafeStore s =
        new CafeStore(
            file, new JSONArray(new String(Files.readAllBytes(Paths.get(args[0])), "UTF-8")));
    int id = s.state().getJSONArray("products").getJSONObject(0).getInt("id");
    s.mutate(
        "/api/order",
        new JSONObject()
            .put("request", "benchmark")
            .put("cash_given", 5000)
            .put("card_amount", 0)
            .put("items", new JSONArray().put(new JSONObject().put("id", id).put("qty", 1))));
    long begin = System.nanoTime();
    for (int i = 0; i < 30; i++) {
      s.mutate("/api/issue", new JSONObject().put("id", 1).put("route", "bar"));
      s.mutate("/api/undo-issue", new JSONObject().put("route", "bar"));
    }
    long milliseconds = (System.nanoTime() - begin) / 1000000;
    JSONObject report =
        new JSONObject()
            .put("portable_backup_bytes", s.backup().length)
            .put("runtime_json_bytes", Files.size(file.toPath()))
            .put("mutations", 60)
            .put("mutation_loop_ms", milliseconds)
            .put("environment", "Windows development machine; not an Android benchmark");
    Files.write(Paths.get(args[1]), report.toString(2).getBytes("UTF-8"));
    System.out.println(report.toString());
  }
}
