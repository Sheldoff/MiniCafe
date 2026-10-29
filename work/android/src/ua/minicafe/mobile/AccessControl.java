package ua.minicafe.mobile;

import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;

/** Owner key stays backwards compatible; staff keys are revocable server-enforced capabilities. */
public final class AccessControl {
  private final String owner;
  private final File file;
  private JSONObject roles;

  public AccessControl(String owner) throws Exception {
    this(null, owner);
  }

  public AccessControl(File file, String owner) throws Exception {
    this.owner = owner;
    this.file = file;
    if (file != null && file.exists()) {
      try (InputStream in = new FileInputStream(file)) {
        roles = new JSONObject(new String(CafeStore.readBytes(in, 10000), "UTF-8"));
      }
    } else {
      roles = new JSONObject();
      rotate();
    }
    // Add the combined staff role without revoking existing employee links.
    if (!roles.has("service")) {
      JSONObject next = new JSONObject(roles.toString());
      next.put("service", UUID.randomUUID().toString().replace("-", ""));
      save(next);
    }
  }

  private boolean equal(String a, String b) throws Exception {
    return b != null && MessageDigest.isEqual(a.getBytes("UTF-8"), b.getBytes("UTF-8"));
  }

  public synchronized String role(String key) throws Exception {
    if (equal(owner, key)) return "admin";
    for (String r : new String[] {"cash", "bar", "delivery", "service"})
      if (equal(roles.getString(r), key)) return r;
    return null;
  }

  public synchronized String key(String role) throws Exception {
    if ("admin".equals(role)) return owner;
    return roles.getString(role);
  }

  public synchronized JSONObject staff() throws Exception {
    return new JSONObject(roles.toString());
  }

  public synchronized void rotate() throws Exception {
    JSONObject next = new JSONObject();
    for (String r : new String[] {"cash", "bar", "delivery"})
      next.put(r, UUID.randomUUID().toString().replace("-", ""));
    next.put("service", UUID.randomUUID().toString().replace("-", ""));
    save(next);
  }

  private void save(JSONObject next) throws Exception {
    if (file != null) {
      File temp = new File(file + ".tmp");
      try (FileOutputStream out = new FileOutputStream(temp)) {
        out.write(next.toString().getBytes("UTF-8"));
        out.getFD().sync();
      }
      File backup = new File(file + ".bak");
      if (backup.exists() && !backup.delete()) throw new IOException("Не вдалося оновити ключі");
      if (file.exists() && !file.renameTo(backup))
        throw new IOException("Не вдалося змінити ключі");
      if (!temp.renameTo(file)) {
        if (backup.exists()) backup.renameTo(file);
        throw new IOException("Не вдалося змінити ключі персоналу");
      }
    }
    roles = next;
  }

  public boolean readAllowed(String role, String path) {
    return "admin".equals(role)
        || path.equals("/api/state")
        || path.equals("/api/ping")
        || path.startsWith("/api/image/");
  }

  public boolean writeAllowed(String role, String path, JSONObject body) {
    if ("admin".equals(role)) return true;
    if ("cash".equals(role)) return path.equals("/api/order");
    if ("service".equals(role))
      return Arrays.asList(
                  "/api/order",
                  "/api/issue",
                  "/api/issue-unit",
                  "/api/issue-item",
                  "/api/undo-issue",
                  "/api/availability")
              .contains(path)
          && (path.equals("/api/order")
              || path.equals("/api/availability")
              || Arrays.asList("bar", "instant").contains(body.optString("route")));
    String route = "bar".equals(role) ? "bar" : "instant";
    return Arrays.asList(
                "/api/issue",
                "/api/issue-unit",
                "/api/issue-item",
                "/api/undo-issue",
                "/api/availability")
            .contains(path)
        && route.equals(body.optString("route", route));
  }

  public JSONObject state(JSONObject state, String role) throws Exception {
    state.put("access_role", role);
    if ("admin".equals(role)) return state;
    state.remove("additional_expenses");
    state.remove("sessions");
    if ("cash".equals(role) || "service".equals(role)) return state;
    String route = "bar".equals(role) ? "bar" : "instant";
    JSONArray products = state.getJSONArray("products"),
        orders = state.getJSONArray("orders"),
        ps = new JSONArray(),
        os = new JSONArray();
    for (int i = 0; i < products.length(); i++)
      if (route.equals(products.getJSONObject(i).getString("route"))) ps.put(products.get(i));
    for (int i = 0; i < orders.length(); i++) {
      JSONObject o = orders.getJSONObject(i);
      JSONArray items = o.getJSONArray("items"), keep = new JSONArray();
      for (int j = 0; j < items.length(); j++)
        if (route.equals(items.getJSONObject(j).getString("route"))) keep.put(items.get(j));
      if (keep.length() > 0) {
        o.put("items", keep);
        o.remove("payment");
        o.remove("events");
        os.put(o);
      }
    }
    state.put("products", ps).put("orders", os);
    return state;
  }
}
