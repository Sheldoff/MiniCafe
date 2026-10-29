package ua.minicafe.mobile;

import java.io.*;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.*;
import org.json.*;

/** All mutations are serialized and committed by atomic file replacement. */
public final class CafeStore {
  private final File file;
  private final ImageStore images;
  private JSONObject data;

  public CafeStore(File file) throws Exception {
    this.file = file;
    this.images = new ImageStore(file);
    File bak = new File(file + ".bak");
    if (file.exists()) {
      try {
        data = read(file);
        validate(data);
      } catch (Exception e) {
        if (!bak.exists()) throw e;
        data = read(bak);
        validate(data);
      }
    } else if (bak.exists()) {
      data = read(bak);
      validate(data);
    } else {
      data =
          new JSONObject()
              .put("format", "minicafe-android-1")
              .put("nextProduct", 6)
              .put("nextOrder", 1)
              .put("nextItem", 1)
              .put("products", new JSONArray())
              .put("orders", new JSONArray());
      String[] names = {"Еспресо", "Капучино 250 мл", "Капучино 350 мл", "Чай", "Круасан"};
      int[] prices = {3500, 5500, 6500, 3000, 4500};
      for (int i = 0; i < 5; i++)
        data.getJSONArray("products")
            .put(
                new JSONObject()
                    .put("id", i + 1)
                    .put("name", names[i])
                    .put("category", i == 4 ? "Їжа" : "Напої")
                    .put("price", prices[i])
                    .put("route", i == 4 ? "instant" : "bar")
                    .put("active", 1));
      persist(data);
    }
    if (upgrade(data)) persist(data);
    if (hasInlineImages(data)) persist(data);
  }

  /** Packaged defaults are used only for a new database; upgrades preserve edited menus. */
  public CafeStore(File file, JSONArray defaults) throws Exception {
    this(file);
    if (!data.has("base_menu_version")
        && data.getJSONArray("orders").length() == 0
        && isLegacyDemo()) {
      importMenu(defaults);
      JSONObject work = new JSONObject(data.toString());
      work.put("base_menu_version", 1);
      persist(work);
      data = work;
    }
  }

  private boolean isLegacyDemo() throws Exception {
    JSONArray ps = data.getJSONArray("products");
    String[] names = {"Еспресо", "Капучино 250 мл", "Капучино 350 мл", "Чай", "Круасан"};
    int[] prices = {3500, 5500, 6500, 3000, 4500};
    if (ps.length() != 5) return false;
    for (int i = 0; i < 5; i++) {
      JSONObject p = ps.getJSONObject(i);
      if (!p.getString("name").equals(names[i])
          || p.getInt("price") != prices[i]
          || p.has("image")
          || p.has("stock")
          || p.optBoolean("sold_out")
          || p.optInt("active", 1) != 1
          || !p.getString("category").equals(i == 4 ? "Їжа" : "Напої")
          || !p.getString("route").equals(i == 4 ? "instant" : "bar")) return false;
    }
    return true;
  }

  public synchronized void addTestFood() throws Exception {
    if (data.optBoolean("test_food_added")) return;
    JSONObject work = new JSONObject(data.toString());
    JSONArray ps = work.getJSONArray("products");
    String[] names = {"Круасан (тест)", "Сендвіч (тест)", "Мафін (тест)"};
    for (String name : names) {
      boolean exists = false;
      for (int i = 0; i < ps.length(); i++)
        if (ps.getJSONObject(i).getString("name").equals(name)) exists = true;
      if (!exists)
        ps.put(
            new JSONObject()
                .put("id", next(work, "nextProduct"))
                .put("name", name)
                .put("category", "Їжа")
                .put("price", 5000)
                .put("route", "instant")
                .put("active", 1));
    }
    work.put("test_food_added", true);
    persist(work);
    data = work;
  }

  public synchronized void applyBaseDrinks(JSONArray defaults) throws Exception {
    JSONObject work = new JSONObject(data.toString());
    JSONArray keep = new JSONArray(), ps = work.getJSONArray("products");
    for (int i = 0; i < ps.length(); i++)
      if (!ps.getJSONObject(i).getString("route").equals("bar")) keep.put(ps.getJSONObject(i));
    for (int i = 0; i < defaults.length(); i++) {
      JSONObject p = new JSONObject(defaults.getJSONObject(i).toString());
      p.put("id", next(work, "nextProduct"));
      checkProduct(p);
      keep.put(p);
    }
    work.put("products", keep).put("base_menu_version", 1);
    persist(work);
    data = work;
  }

  private static boolean upgrade(JSONObject d) throws Exception {
    if (d.has("sessions")) return false;
    JSONArray sessions = new JSONArray(), orders = d.getJSONArray("orders");
    if (orders.length() > 0) {
      String first = orders.getJSONObject(0).getString("created"), last = first;
      for (int i = 0; i < orders.length(); i++) {
        JSONObject o = orders.getJSONObject(i);
        o.put("session_id", 0);
        String t = o.getString("created");
        if (t.compareTo(first) < 0) first = t;
        if (t.compareTo(last) > 0) last = t;
      }
      sessions.put(
          new JSONObject()
              .put("id", 0)
              .put("name", "Історія до оновлення")
              .put("started", first)
              .put("ended", last)
              .put("legacy", true));
    }
    d.put("sessions", sessions)
        .put("nextSession", 1)
        .put("active_session", 0)
        .put("require_session_start", false);
    return true;
  }

  private static int createSession(JSONObject d, String name) throws Exception {
    int id = next(d, "nextSession");
    String title = name.trim().isEmpty() ? "Сесія №" + id : shortText(name.trim(), 100);
    d.getJSONArray("sessions")
        .put(
            new JSONObject()
                .put("id", id)
                .put("name", title)
                .put("started", now())
                .put("ended", JSONObject.NULL));
    d.put("active_session", id).put("require_session_start", false);
    JSONArray costs = d.optJSONArray("calculator_expenses");
    if (costs != null)
      for (int i = 0; i < costs.length(); i++) {
        JSONObject expense = costs.getJSONObject(i);
        if (expense.optBoolean("pending_session"))
          expense.put("session_id", id).put("pending_session", false);
      }
    return id;
  }

  public static final class PaymentError extends IllegalArgumentException {
    public final long missing;

    public PaymentError(String message, long missing) {
      super(message);
      this.missing = missing;
    }
  }

  private static JSONObject read(File f) throws Exception {
    try (InputStream in = new FileInputStream(f)) {
      return new JSONObject(new String(readBytes(in, 80000000), "UTF-8"));
    }
  }

  public static byte[] readBytes(InputStream in, int max) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buf = new byte[8192];
    int n;
    while ((n = in.read(buf)) != -1) {
      if (out.size() + n > max) throw new IOException("Файл або запит завеликий");
      out.write(buf, 0, n);
    }
    return out.toByteArray();
  }

  private boolean hasInlineImages(JSONObject value) throws Exception {
    JSONArray ps = value.getJSONArray("products");
    for (int i = 0; i < ps.length(); i++) if (ps.getJSONObject(i).has("image")) return true;
    return false;
  }

  private void verifyImages(JSONObject value) throws Exception {
    JSONArray ps = value.getJSONArray("products");
    for (int i = 0; i < ps.length(); i++) {
      JSONObject p = ps.getJSONObject(i);
      if (p.has("image_file") && !p.has("image")) images.verify(p.getString("image_file"));
    }
  }

  private void persist(JSONObject value) throws Exception {
    persist(value, "products", "orders", "sessions", "expenses");
  }

  private void persist(JSONObject value, String... domains) throws Exception {
    JSONArray products = value.getJSONArray("products");
    for (int i = 0; i < products.length(); i++) {
      JSONObject product = products.getJSONObject(i);
      if (product.has("image") && !product.isNull("image")) {
        String hash = images.put(checkImage(product.getString("image")));
        product.put("image_file", hash).put("image_version", hash.substring(0, 16));
        product.remove("image");
      }
    }
    value.put(
        "state_version",
        Math.max(
                value.optLong("state_version", 0),
                data == null ? 0 : data.optLong("state_version", 0))
            + 1);
    for (String domain : domains)
      value.put(
          domain + "_revision",
          Math.max(
                  value.optLong(domain + "_revision", 0),
                  data == null ? 0 : data.optLong(domain + "_revision", 0))
              + 1);
    File tmp = new File(file + ".tmp"), bak = new File(file + ".bak");
    File parent = file.getParentFile();
    if (parent != null) parent.mkdirs();
    try (FileOutputStream out = new FileOutputStream(tmp)) {
      out.write(value.toString().getBytes("UTF-8"));
      out.getFD().sync();
    }
    if (bak.exists() && !bak.delete()) throw new IOException("Не вдалося оновити резервну копію");
    if (file.exists() && !file.renameTo(bak))
      throw new IOException("Не вдалося зберегти попередні дані");
    if (!tmp.renameTo(file)) {
      if (bak.exists()) bak.renameTo(file);
      throw new IOException("Не вдалося записати дані. Перевірте пам’ять телефона.");
    }
  }

  private static void validate(JSONObject d) throws Exception {
    if (!"minicafe-android-1".equals(d.getString("format")))
      throw new IllegalArgumentException("Це не резервна копія сервера Android МініКафе");
    JSONArray ps = d.getJSONArray("products"), os = d.getJSONArray("orders");
    Set<Integer> ids = new HashSet<>();
    int maxP = 0, maxO = 0, maxI = 0;
    for (int i = 0; i < ps.length(); i++) {
      JSONObject p = ps.getJSONObject(i);
      int id = p.getInt("id");
      if (id < 1 || !ids.add(id)) throw new IllegalArgumentException("Повторні номери товарів");
      checkProduct(p);
      maxP = Math.max(maxP, id);
    }
    ids.clear();
    Set<Integer> itemIds = new HashSet<>();
    Set<String> requests = new HashSet<>();
    for (int i = 0; i < os.length(); i++) {
      JSONObject o = os.getJSONObject(i);
      int id = o.getInt("id");
      if (id < 1 || !ids.add(id) || !requests.add(o.getString("request")))
        throw new IllegalArgumentException("Некоректні замовлення");
      maxO = Math.max(maxO, id);
      o.getString("created");
      JSONArray its = o.getJSONArray("items");
      o.getJSONArray("events");
      for (int j = 0; j < its.length(); j++) {
        JSONObject it = its.getJSONObject(j);
        int iid = it.getInt("id");
        if (iid < 1
            || !itemIds.add(iid)
            || it.getInt("qty") < 1
            || it.getInt("qty") > 99
            || it.getLong("price") < 0) throw new IllegalArgumentException("Некоректна позиція");
        checkRoute(it.getString("route"));
        checkStatus(it.getString("status"));
        if (it.has("unit_issued")) {
          JSONArray flags = it.getJSONArray("unit_issued");
          if (flags.length() != it.getInt("qty"))
            throw new IllegalArgumentException("Некоректні порції");
          for (int k = 0; k < flags.length(); k++) flags.getBoolean(k);
        }
        it.getString("name");
        maxI = Math.max(maxI, iid);
      }
    }
    if (d.getInt("nextProduct") <= maxP
        || d.getInt("nextOrder") <= maxO
        || d.getInt("nextItem") <= maxI)
      throw new IllegalArgumentException("Некоректні лічильники");
    if (d.has("sessions")) {
      JSONArray sessions = d.getJSONArray("sessions");
      Set<Integer> sessionIds = new HashSet<>();
      int maximum = 0;
      for (int i = 0; i < sessions.length(); i++) {
        JSONObject session = sessions.getJSONObject(i);
        int id = session.getInt("id");
        if (id < 0 || !sessionIds.add(id)) throw new IllegalArgumentException("Некоректні сесії");
        maximum = Math.max(maximum, id);
        session.getString("name");
        session.getString("started");
      }
      if (d.getInt("nextSession") <= maximum)
        throw new IllegalArgumentException("Некоректний лічильник сесій");
      int active = d.optInt("active_session", 0);
      if (active > 0 && !sessionIds.contains(active))
        throw new IllegalArgumentException("Активну сесію не знайдено");
      for (int i = 0; i < os.length(); i++) {
        JSONObject order = os.getJSONObject(i);
        if (!order.optBoolean("stats_cleared")
            && !sessionIds.contains(order.optInt("session_id", 0)))
          throw new IllegalArgumentException("Не знайдено сесію замовлення");
        JSONObject pay = order.optJSONObject("payment");
        if (pay != null) {
          long total = CafeStats.total(order),
              cash = pay.getLong("cash_amount"),
              card = pay.getLong("card_amount"),
              given = pay.getLong("cash_given"),
              change = pay.getLong("change");
          if (card < 0
              || given < 0
              || change < 0
              || cash + card != total
              || given - change != cash
              || pay.getLong("total") != total)
            throw new IllegalArgumentException("Некоректні суми оплати у копії");
        }
      }
    }
    JSONArray costs = d.optJSONArray("calculator_expenses");
    if (d.has("calculator_expenses") && costs == null)
      throw new IllegalArgumentException("Некоректні витрати");
    if (costs != null) {
      Set<String> expenseIds = new HashSet<>();
      Set<Integer> sessionIds = new HashSet<>();
      JSONArray sessions = d.optJSONArray("sessions");
      if (sessions != null)
        for (int i = 0; i < sessions.length(); i++)
          sessionIds.add(sessions.getJSONObject(i).getInt("id"));
      for (int i = 0; i < costs.length(); i++) {
        JSONObject expense = costs.getJSONObject(i);
        String id = expense.getString("id");
        if (!id.matches("[A-Za-z0-9_-]{1,100}") || !expenseIds.add(id))
          throw new IllegalArgumentException("Некоректний номер витрат");
        exactNumber(expense, "cost", 1, 100000000000L);
        String kind = expense.optString("kind", "calculator");
        if (!kind.equals("calculator") && !kind.equals("additional"))
          throw new IllegalArgumentException("Некоректний тип витрат");
        if (expense.optString("note", "").length() > 200)
          throw new IllegalArgumentException("Опис витрат завеликий");
        CafeStats.utc(expense.getString("created"));
        CafeStats.utc(expense.getString("updated"));
        int session = expense.getInt("session_id");
        if (expense.optBoolean("pending_session") ? session != 0 : !sessionIds.contains(session))
          throw new IllegalArgumentException("Не знайдено сесію витрат");
      }
    }
  }

  private static void checkProduct(JSONObject p) throws Exception {
    if (p.getString("name").trim().isEmpty()
        || p.getString("category").trim().isEmpty()
        || p.getLong("price") < 0
        || p.getLong("price") > 100000000)
      throw new IllegalArgumentException("Перевірте назву, категорію та ціну");
    checkRoute(p.getString("route"));
    if (p.has("image") && !p.isNull("image")) checkImage(p.getString("image"));
  }

  private static void checkRoute(String route) {
    if (!route.equals("bar") && !route.equals("instant"))
      throw new IllegalArgumentException("Невідома черга");
  }

  private static void checkStatus(String s) {
    if (!Arrays.asList("new", "making", "ready", "delivered", "cancelled").contains(s))
      throw new IllegalArgumentException("Невідомий статус");
  }

  private static byte[] checkImage(String value) {
    byte[] bytes = Codec.decode(value);
    if (bytes.length > 2000000
        || bytes.length < 4
        || (bytes[0] & 255) != 255
        || (bytes[1] & 255) != 216
        || (bytes[bytes.length - 2] & 255) != 255
        || (bytes[bytes.length - 1] & 255) != 217)
      throw new IllegalArgumentException("Некоректне зображення. Завантажте його ще раз.");
    return bytes;
  }

  private static String now() {
    SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US);
    f.setTimeZone(TimeZone.getTimeZone("UTC"));
    return f.format(new Date());
  }

  private static JSONObject find(JSONArray list, int id) throws Exception {
    for (int i = 0; i < list.length(); i++)
      if (list.getJSONObject(i).getInt("id") == id) return list.getJSONObject(i);
    throw new IllegalArgumentException("Позицію не знайдено");
  }

  private static String shortText(String s, int max) {
    return s.length() > max ? s.substring(0, max) : s;
  }

  private static int next(JSONObject d, String key) throws Exception {
    int id = d.getInt(key);
    d.put(key, id + 1);
    return id;
  }

  private static void event(JSONObject o, String msg) throws Exception {
    o.getJSONArray("events").put(new JSONObject().put("message", msg).put("created", now()));
  }

  private static JSONArray undoHistory(JSONObject d, String route) throws Exception {
    JSONObject all = d.optJSONObject("issue_undo");
    if (all == null) {
      all = new JSONObject();
      d.put("issue_undo", all);
    }
    JSONArray list = all.optJSONArray(route);
    if (list == null) {
      list = new JSONArray();
      all.put(route, list);
    }
    return list;
  }

  private static void rememberIssue(JSONObject d, String route, int order, JSONArray ids)
      throws Exception {
    if (ids.length() == 0) return;
    JSONArray old = undoHistory(d, route), keep = new JSONArray();
    for (int i = Math.max(0, old.length() - 63); i < old.length(); i++) keep.put(old.get(i));
    keep.put(new JSONObject().put("order", order).put("items", ids));
    d.getJSONObject("issue_undo").put(route, keep);
  }

  private static JSONArray unitFlags(JSONObject item) throws Exception {
    JSONArray old = item.optJSONArray("unit_issued"), flags = new JSONArray();
    for (int n = 0; n < item.getInt("qty"); n++)
      flags.put(
          old != null && old.length() == item.getInt("qty")
              ? old.getBoolean(n)
              : "delivered".equals(item.getString("status")));
    return flags;
  }

  private static void applyUnits(JSONObject item, JSONArray flags) throws Exception {
    boolean all = true;
    for (int i = 0; i < flags.length(); i++) if (!flags.getBoolean(i)) all = false;
    item.put("unit_issued", flags).put("status", all ? "delivered" : "new");
  }

  private static void rememberUnits(JSONObject d, String route, int order, JSONArray changes)
      throws Exception {
    if (changes.length() == 0) return;
    JSONArray ids = new JSONArray();
    for (int i = 0; i < changes.length(); i++) ids.put(changes.getJSONObject(i).getInt("id"));
    rememberIssue(d, route, order, ids);
    JSONArray history = undoHistory(d, route);
    history.getJSONObject(history.length() - 1).put("units", changes);
  }

  private static boolean undoAvailable(JSONObject d, String route) throws Exception {
    JSONObject all = d.optJSONObject("issue_undo");
    JSONArray list = all == null ? null : all.optJSONArray(route);
    if (list == null) return false;
    for (int n = list.length() - 1; n >= 0; n--) {
      JSONObject action = list.getJSONObject(n), o;
      try {
        o = find(d.getJSONArray("orders"), action.getInt("order"));
      } catch (IllegalArgumentException e) {
        continue;
      }
      JSONArray units = action.optJSONArray("units");
      if (units != null) {
        for (int j = 0; j < units.length(); j++) {
          JSONObject u = units.getJSONObject(j), it;
          try {
            it = find(o.getJSONArray("items"), u.getInt("id"));
          } catch (IllegalArgumentException e) {
            continue;
          }
          if (!"cancelled".equals(it.getString("status"))
              && route.equals(it.getString("route"))
              && unitFlags(it).optBoolean(u.getInt("unit"), false)) return true;
        }
      } else {
        JSONArray ids = action.getJSONArray("items"), items = o.getJSONArray("items");
        for (int i = 0; i < items.length(); i++) {
          JSONObject it = items.getJSONObject(i);
          for (int j = 0; j < ids.length(); j++)
            if (it.getInt("id") == ids.getInt(j)
                && route.equals(it.getString("route"))
                && "delivered".equals(it.getString("status"))) return true;
        }
      }
    }
    return false;
  }

  private static JSONArray additionalExpenses(JSONObject d) throws Exception {
    JSONArray rows = new JSONArray(), costs = d.optJSONArray("calculator_expenses");
    if (costs != null)
      for (int i = 0; i < costs.length(); i++) {
        JSONObject e = costs.getJSONObject(i);
        if ("additional".equals(e.optString("kind"))) rows.put(new JSONObject(e.toString()));
      }
    return rows;
  }

  public synchronized JSONObject state() throws Exception {
    JSONArray ps = new JSONArray(),
        os = new JSONArray(),
        products = data.getJSONArray("products"),
        orders = data.getJSONArray("orders");
    for (int i = 0; i < products.length(); i++) {
      JSONObject source = products.getJSONObject(i), p = new JSONObject();
      Iterator<String> keys = source.keys();
      while (keys.hasNext()) {
        String k = keys.next();
        if (!k.equals("image") && !k.equals("image_file")) p.put(k, source.get(k));
      }
      ps.put(p);
    }
    for (int i = orders.length() - 1; i >= 0; i--) {
      JSONObject original = orders.getJSONObject(i);
      boolean pending = false;
      JSONArray its = original.getJSONArray("items");
      for (int j = 0; j < its.length(); j++)
        if (!Arrays.asList("delivered", "cancelled")
            .contains(its.getJSONObject(j).getString("status"))) pending = true;
      if (i < orders.length() - 300 && !pending) continue;
      JSONObject o = new JSONObject(orders.getJSONObject(i).toString());
      JSONArray events = o.getJSONArray("events"), latest = new JSONArray();
      for (int j = events.length() - 1; j >= Math.max(0, events.length() - 8); j--)
        latest.put(events.get(j));
      o.put("events", latest);
      os.put(o);
    }
    return new JSONObject()
        .put(
            "versions",
            new JSONObject()
                .put("products", data.optLong("products_revision", 0))
                .put("orders", data.optLong("orders_revision", 0))
                .put("sessions", data.optLong("sessions_revision", 0))
                .put("expenses", data.optLong("expenses_revision", 0)))
        .put(
            "can_undo_issue",
            new JSONObject()
                .put("bar", undoAvailable(data, "bar"))
                .put("instant", undoAvailable(data, "instant")))
        .put("additional_expenses", additionalExpenses(data))
        .put("expenses_version", data.optLong("expenses_version", 0))
        .put("products", ps)
        .put("orders", os)
        .put("sessions", new JSONArray(data.getJSONArray("sessions").toString()))
        .put("active_session", data.optInt("active_session", 0))
        .put("require_session_start", data.optBoolean("require_session_start", false));
  }

  public synchronized String productRoute(int id) throws Exception {
    return find(data.getJSONArray("products"), id).getString("route");
  }

  public synchronized String version() {
    return "\"" + data.optLong("state_version", 0) + "\"";
  }

  private JSONObject reportSnapshot(Integer session, String day, int offset) throws Exception {
    synchronized (this) {
      if (offset < -840 || offset > 840)
        throw new IllegalArgumentException("Некоректний часовий пояс");
      if (session == null && (day == null || !day.matches("\\d{4}-\\d{2}-\\d{2}")))
        throw new IllegalArgumentException("Некоректна дата");
      if (session != null) find(data.getJSONArray("sessions"), session);
      JSONObject snap =
          new JSONObject()
              .put("sessions", new JSONArray(data.getJSONArray("sessions").toString()))
              .put("orders", new JSONArray(data.getJSONArray("orders").toString()));
      JSONArray costs = data.optJSONArray("calculator_expenses");
      if (costs != null) snap.put("calculator_expenses", new JSONArray(costs.toString()));
      return snap;
    }
  }

  public JSONObject statistics(Integer session, String day, int offset) throws Exception {
    return CafeStats.report(reportSnapshot(session, day, offset), session, day, offset);
  }

  public JSONObject history(Integer session, String day, int offset, int page) throws Exception {
    if (page < 0 || page > 100000) throw new IllegalArgumentException("Некоректна сторінка");
    JSONObject snapshot = reportSnapshot(session, day, offset);
    JSONArray all = snapshot.getJSONArray("orders"),
        matching = new JSONArray(),
        result = new JSONArray();
    SimpleDateFormat date = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
    date.setTimeZone(new SimpleTimeZone(offset * 60000, "history"));
    for (int i = all.length() - 1; i >= 0; i--) {
      JSONObject o = all.getJSONObject(i);
      if (o.optBoolean("stats_cleared")) continue;
      if (session != null
          ? o.optInt("session_id", 0) == session
          : date.format(new Date(CafeStats.utc(o.getString("created")))).equals(day))
        matching.put(o);
    }
    for (int i = page * 50; i < Math.min(matching.length(), page * 50 + 50); i++)
      result.put(matching.getJSONObject(i));
    return new JSONObject()
        .put("orders", result)
        .put("total", matching.length())
        .put("page", page)
        .put("has_next", page * 50 + 50 < matching.length());
  }

  public synchronized byte[] image(int id) throws Exception {
    JSONObject p = find(data.getJSONArray("products"), id);
    if (p.has("image_file")) return images.get(p.getString("image_file"));
    if (!p.has("image")) return null;
    return Codec.decode(p.getString("image"));
  }

  public synchronized byte[] backup() throws Exception {
    JSONObject copy = new JSONObject(data.toString());
    copy.remove("state_version");
    for (String domain : new String[] {"products", "orders", "sessions", "expenses"})
      copy.remove(domain + "_revision");
    JSONArray ps = copy.getJSONArray("products");
    for (int i = 0; i < ps.length(); i++) {
      JSONObject p = ps.getJSONObject(i);
      if (p.has("image_file")) {
        p.put("image", Codec.encode(images.get(p.getString("image_file"))));
        p.remove("image_file");
      }
    }
    return copy.toString().getBytes("UTF-8");
  }

  public synchronized void importMenu(JSONArray input) throws Exception {
    if (input.length() > 2000) throw new IllegalArgumentException("Забагато товарів");
    JSONObject work = new JSONObject(data.toString());
    JSONArray ps = new JSONArray();
    for (int i = 0; i < input.length(); i++) {
      JSONObject source = input.getJSONObject(i);
      JSONObject p =
          new JSONObject()
              .put("id", next(work, "nextProduct"))
              .put("name", source.getString("name"))
              .put("category", source.getString("category"))
              .put("price", source.getLong("price"))
              .put("route", source.getString("route"))
              .put("active", source.optInt("active", 1));
      if (source.has("stock") && !source.isNull("stock")) p.put("stock", source.getLong("stock"));
      p.put("sold_out", source.optBoolean("sold_out", false));
      p.put("stock_estimated", source.optBoolean("stock_estimated", false));
      if (source.has("image") && !source.isNull("image")) {
        byte[] bytes = checkImage(source.getString("image"));
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder v = new StringBuilder();
        for (int j = 0; j < 8; j++) v.append(String.format(Locale.US, "%02x", hash[j] & 255));
        p.put("image", source.getString("image")).put("image_version", v.toString());
      }
      checkProduct(p);
      ps.put(p);
    }
    work.remove("image_optimization");
    work.put("products", ps);
    persist(work);
    data = work;
  }

  public synchronized byte[] exportMenu() throws Exception {
    JSONArray products = new JSONArray(data.getJSONArray("products").toString());
    for (int i = 0; i < products.length(); i++) {
      JSONObject p = products.getJSONObject(i);
      if (p.has("image_file")) {
        p.put("image", Codec.encode(images.get(p.getString("image_file"))));
        p.remove("image_file");
      }
    }
    return new JSONObject()
        .put("format", "minicafe-menu-1")
        .put("products", products)
        .put("confirm", true)
        .toString()
        .getBytes("UTF-8");
  }

  public synchronized long menuVersion() {
    return data.optLong("products_revision", 0);
  }

  public synchronized void importMenu(JSONArray input, long expectedVersion) throws Exception {
    if (menuVersion() != expectedVersion)
      throw new IllegalArgumentException(
          "Меню або залишки телефона змінилися. Створіть новий код і повторіть перенесення.");
    importMenu(input);
  }

  public synchronized void restore(byte[] bytes) throws Exception {
    JSONObject incoming = new JSONObject(new String(bytes, "UTF-8"));
    validate(incoming);
    verifyImages(incoming);
    upgrade(incoming);
    persist(incoming);
    data = incoming;
  }

  private static String menuName(String name) {
    return name.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
  }

  private static long exactNumber(JSONObject d, String field, long min, long max) throws Exception {
    Object value = d.get(field);
    if (!(value instanceof Number)) throw new IllegalArgumentException("Некоректне поле: " + field);
    Number n = (Number) value;
    long integer = n.longValue();
    if (n.doubleValue() != integer || integer < min || integer > max)
      throw new IllegalArgumentException("Некоректне поле: " + field);
    return integer;
  }

  public synchronized JSONObject mutate(String path, JSONObject d) throws Exception {
    JSONObject work = new JSONObject(data.toString()), result = new JSONObject().put("ok", true);
    JSONArray ps = work.getJSONArray("products"), orders = work.getJSONArray("orders");
    if (path.equals("/api/session/start")) {
      if (work.optInt("active_session", 0) > 0)
        throw new IllegalArgumentException("Спочатку завершіть поточну сесію");
      result.put("id", createSession(work, d.optString("name", "")));
    } else if (path.equals("/api/session/end")) {
      int sid = work.optInt("active_session", 0);
      if (sid > 0) {
        find(work.getJSONArray("sessions"), sid).put("ended", now());
        work.put("active_session", 0).put("require_session_start", false);
      }
    } else if (path.equals("/api/stats/clear")) {
      if (!d.optBoolean("confirm", false))
        throw new IllegalArgumentException("Підтвердьте очищення статистики");
      JSONArray keep = new JSONArray();
      for (int i = 0; i < orders.length(); i++) {
        JSONObject o = orders.getJSONObject(i);
        boolean pending = false;
        JSONArray items = o.getJSONArray("items");
        for (int j = 0; j < items.length(); j++)
          if (!Arrays.asList("delivered", "cancelled")
              .contains(items.getJSONObject(j).getString("status"))) pending = true;
        if (pending) {
          o.put("stats_cleared", true).put("session_id", 0);
          keep.put(o);
        }
      }
      JSONArray sessions = new JSONArray();
      work.remove("issue_undo");
      work.remove("calculator_expenses");
      work.put("expenses_version", work.optLong("expenses_version", 0) + 1);
      work.put("orders", keep)
          .put("sessions", sessions)
          .put("active_session", 0)
          .put("require_session_start", false);
    } else if (path.equals("/api/expenses/update")) {
      String id = d.getString("id");
      long cost = exactNumber(d, "cost", 1, 100000000000L);
      String note = d.optString("note", "").trim();
      if (note.length() > 200)
        throw new IllegalArgumentException("Опис витрат має містити до 200 символів");
      JSONArray costs = work.optJSONArray("calculator_expenses");
      JSONObject expense = null;
      if (costs != null)
        for (int i = 0; i < costs.length(); i++)
          if (id.equals(costs.getJSONObject(i).getString("id"))) expense = costs.getJSONObject(i);
      if (expense == null || !"additional".equals(expense.optString("kind")))
        throw new IllegalArgumentException("Додаткові витрати не знайдено");
      expense.put("cost", cost).put("note", note).put("updated", now());
      work.put("expenses_version", work.optLong("expenses_version", 0) + 1);
      result.put("id", id);
    } else if (path.equals("/api/expenses")) {
      String id = d.getString("request");
      if (!id.matches("[A-Za-z0-9_-]{1,100}"))
        throw new IllegalArgumentException("Некоректний номер витрат");
      long cost = exactNumber(d, "cost", 1, 100000000000L);
      String note = d.optString("note", "").trim();
      if (note.length() > 200)
        throw new IllegalArgumentException("Опис витрат має містити до 200 символів");
      boolean explicit = d.has("session_id") && !d.isNull("session_id");
      int sid =
          explicit
              ? (int) exactNumber(d, "session_id", 0, Integer.MAX_VALUE)
              : work.optInt("active_session", 0);
      if (explicit || sid > 0) find(work.getJSONArray("sessions"), sid);
      JSONArray costs = work.optJSONArray("calculator_expenses");
      if (costs == null) {
        costs = new JSONArray();
        work.put("calculator_expenses", costs);
      }
      for (int i = 0; i < costs.length(); i++) {
        JSONObject existing = costs.getJSONObject(i);
        if (id.equals(existing.getString("id"))) {
          if (!"additional".equals(existing.optString("kind"))
              || existing.getLong("cost") != cost
              || !existing.optString("note", "").equals(note))
            throw new IllegalArgumentException("Номер витрат уже використано");
          return new JSONObject().put("ok", true).put("id", id);
        }
      }
      costs.put(
          new JSONObject()
              .put("id", id)
              .put("kind", "additional")
              .put("note", note)
              .put("cost", cost)
              .put("created", now())
              .put("updated", now())
              .put("session_id", sid)
              .put("pending_session", !explicit && sid == 0));
      work.put("expenses_version", work.optLong("expenses_version", 0) + 1);
      result.put("id", id);
    } else if (path.equals("/api/calculate-menu")) {
      if (!d.optBoolean("confirm", false))
        throw new IllegalArgumentException("Підтвердьте додавання до меню");
      JSONArray input = d.getJSONArray("items"), ids = new JSONArray();
      if (input.length() < 1 || input.length() > 100)
        throw new IllegalArgumentException("Додайте від 1 до 100 позицій");
      Set<String> names = new HashSet<>();
      Set<Integer> touched = new HashSet<>();
      int created = 0, updated = 0;
      for (int i = 0; i < input.length(); i++) {
        JSONObject row = input.getJSONObject(i);
        String name = row.getString("name").trim().replaceAll("\\s+", " ");
        if (name.isEmpty() || name.length() > 100 || !names.add(name.toLowerCase(Locale.ROOT)))
          throw new IllegalArgumentException(
              "Перевірте назви: порожні й повторні позиції не дозволені");
        long price = exactNumber(row, "price", 0, 100000000),
            stock = exactNumber(row, "stock", 1, 1000000);
        if (price % 500 != 0) throw new IllegalArgumentException("Ціна має бути кратна 5 грн");
        JSONObject product = null;
        int id =
            row.has("id") && !row.isNull("id")
                ? (int) exactNumber(row, "id", 0, Integer.MAX_VALUE)
                : 0;
        if (id > 0) {
          product = find(ps, id);
          if (!"instant".equals(product.getString("route")))
            throw new IllegalArgumentException("Калькулятор призначений для їжі");
          if (!menuName(name).equals(menuName(product.getString("name"))))
            throw new IllegalArgumentException("Назва товару змінилася. Виберіть позицію знову.");
        } else
          for (int j = 0; j < ps.length(); j++) {
            JSONObject candidate = ps.getJSONObject(j);
            if ("instant".equals(candidate.getString("route"))
                && menuName(name).equals(menuName(candidate.getString("name")))) {
              product = candidate;
              break;
            }
          }
        if (product == null) {
          product =
              new JSONObject()
                  .put("id", next(work, "nextProduct"))
                  .put("name", name)
                  .put("category", "Їжа")
                  .put("route", "instant")
                  .put("active", 1)
                  .put("sold_out", false);
          ps.put(product);
          created++;
        } else updated++;
        if (!touched.add(product.getInt("id")))
          throw new IllegalArgumentException("Позицію вказано двічі");
        product.put("price", price).put("stock", stock);
        checkProduct(product);
        ids.put(product.getInt("id"));
      }
      if (d.has("calculation_id") || d.has("cost")) {
        String calculation = d.getString("calculation_id");
        if (!calculation.matches("[A-Za-z0-9_-]{1,100}"))
          throw new IllegalArgumentException("Некоректний номер розрахунку");
        long cost = exactNumber(d, "cost", 1, 100000000000L);
        JSONArray costs = work.optJSONArray("calculator_expenses");
        if (costs == null) {
          costs = new JSONArray();
          work.put("calculator_expenses", costs);
        }
        JSONObject expense = null;
        for (int i = 0; i < costs.length(); i++)
          if (calculation.equals(costs.getJSONObject(i).getString("id")))
            expense = costs.getJSONObject(i);
        if (expense == null) {
          int session = work.optInt("active_session", 0);
          expense =
              new JSONObject()
                  .put("id", calculation)
                  .put("created", now())
                  .put("session_id", session)
                  .put("pending_session", session == 0);
          costs.put(expense);
        }
        if ("additional".equals(expense.optString("kind")))
          throw new IllegalArgumentException("Номер розрахунку належить додатковим витратам");
        expense.put("cost", cost).put("updated", now());
        work.put("expenses_version", work.optLong("expenses_version", 0) + 1);
      }
      result.put("created", created).put("updated", updated).put("ids", ids);
    } else if (path.equals("/api/product")) {
      JSONObject p;
      if (d.optInt("id", 0) > 0) p = find(ps, d.getInt("id"));
      else {
        p = new JSONObject().put("id", next(work, "nextProduct"));
        ps.put(p);
      }
      p.put("name", d.getString("name").trim())
          .put("category", d.getString("category").trim())
          .put("price", d.getLong("price"))
          .put("route", d.getString("route"))
          .put("active", d.optBoolean("active", true) ? 1 : 0);
      if (d.has("image")) {
        if (d.isNull("image")) {
          p.remove("image");
          p.remove("image_file");
          p.remove("image_version");
        } else {
          byte[] bytes = checkImage(d.getString("image"));
          byte[] hash = MessageDigest.getInstance("SHA-256").digest(bytes);
          StringBuilder version = new StringBuilder();
          for (int i = 0; i < 8; i++)
            version.append(String.format(Locale.US, "%02x", hash[i] & 255));
          p.put("image", d.getString("image")).put("image_version", version.toString());
        }
      }
      checkProduct(p);
      if (d.has("stock_estimated")) p.put("stock_estimated", d.getBoolean("stock_estimated"));
      if (d.has("stock")) {
        if (d.isNull("stock")) p.remove("stock");
        else {
          long stock = d.getLong("stock");
          if (stock < (p.optBoolean("stock_estimated", false) ? -1000000 : 0) || stock > 1000000)
            throw new IllegalArgumentException("Перевірте кількість і режим залишку (до 1000000)");
          p.put("stock", stock);
        }
      }
    } else if (path.equals("/api/availability")) {
      JSONObject product = find(ps, d.getInt("id"));
      product.put("sold_out", d.getBoolean("sold_out"));
    } else if (path.equals("/api/delete-product")) {
      int id = d.getInt("id");
      JSONArray keep = new JSONArray();
      for (int i = 0; i < ps.length(); i++)
        if (ps.getJSONObject(i).getInt("id") != id) keep.put(ps.getJSONObject(i));
      work.put("products", keep);
    } else if (path.equals("/api/order")) {
      String req = d.getString("request");
      if (req.isEmpty() || req.length() > 200)
        throw new IllegalArgumentException("Некоректний номер запиту");
      for (int i = 0; i < orders.length(); i++)
        if (req.equals(orders.getJSONObject(i).getString("request")))
          return new JSONObject().put("id", orders.getJSONObject(i).getInt("id"));
      JSONArray inputs = d.getJSONArray("items"), items = new JSONArray();
      if (inputs.length() < 1 || inputs.length() > 300)
        throw new IllegalArgumentException("Додайте товари до замовлення");
      int oid = next(work, "nextOrder");
      for (int i = 0; i < inputs.length(); i++) {
        JSONObject input = inputs.getJSONObject(i), p = find(ps, input.getInt("id"));
        int qty = input.getInt("qty");
        long requested = p.getLong("price");
        if (input.has("unit_price")) {
          Object value = input.get("unit_price");
          if (!(value instanceof Number)
              || ((Number) value).doubleValue() != ((Number) value).longValue())
            throw new IllegalArgumentException("Некоректна ціна позиції");
          requested = ((Number) value).longValue();
          if (requested < 0 || requested > 100000000)
            throw new IllegalArgumentException("Некоректна ціна позиції");
        }
        long charged = d.optBoolean("gift", false) ? 0 : requested;
        if (p.getInt("active") != 1 || p.optBoolean("sold_out", false) || qty < 1 || qty > 99)
          throw new IllegalArgumentException(
              "Товар закінчився, недоступний або неправильна кількість");
        items.put(
            new JSONObject()
                .put("id", next(work, "nextItem"))
                .put("product_id", p.getInt("id"))
                .put("order_id", oid)
                .put("name", p.getString("name"))
                .put("category", p.getString("category"))
                .put("price", charged)
                .put("catalog_price", p.getLong("price"))
                .put("requested_price", requested)
                .put("qty", qty)
                .put("route", p.getString("route"))
                .put("status", "new")
                .put("note", shortText(input.optString("note", ""), 300)));
        if (p.has("stock") && !p.isNull("stock")) {
          if (!p.optBoolean("stock_estimated", false) && p.getLong("stock") < qty)
            throw new IllegalArgumentException("Недостатній залишок");
          p.put("stock", p.getLong("stock") - qty);
        }
      }
      long total = 0;
      for (int i = 0; i < items.length(); i++) {
        JSONObject it = items.getJSONObject(i);
        total += it.getLong("price") * it.getInt("qty");
      }
      if (!d.has("cash_given") || !d.has("card_amount"))
        throw new PaymentError("Вкажіть оплату готівкою або карткою", total);
      long given = d.getLong("cash_given"), card = d.getLong("card_amount");
      if (d.optBoolean("gift", false) && (given != 0 || card != 0))
        throw new IllegalArgumentException("Подарункове замовлення має нульову оплату");
      if (given < 0 || card < 0 || given > 100000000000L || card > 100000000000L)
        throw new IllegalArgumentException("Некоректна сума оплати");
      if (given + card < total)
        throw new PaymentError(
            "Недостатня оплата. Не вистачає "
                + String.format(Locale.US, "%.2f", (total - given - card) / 100.0)
                + " грн",
            total - given - card);
      int sid = work.optInt("active_session", 0);
      if (sid == 0) {
        sid = createSession(work, "");
      }
      JSONObject payment =
          new JSONObject()
              .put("cash_given", given)
              .put("cash_amount", total - card)
              .put("card_amount", card)
              .put("change", given - (total - card))
              .put("total", total);
      orders.put(
          new JSONObject()
              .put("id", oid)
              .put("request", req)
              .put("session_id", sid)
              .put("payment", payment)
              .put("gift", d.optBoolean("gift", false))
              .put("comment", shortText(d.optString("comment", ""), 500))
              .put("guest", shortText(d.optString("guest", ""), 100))
              .put("place", "")
              .put("created", now())
              .put("items", items)
              .put("events", new JSONArray()));
      result = new JSONObject().put("id", oid);
    } else if (path.equals("/api/issue")) {
      JSONObject o = find(orders, d.getInt("id"));
      String route = d.getString("route");
      checkRoute(route);
      JSONArray items = o.getJSONArray("items"), changes = new JSONArray();
      for (int i = 0; i < items.length(); i++) {
        JSONObject it = items.getJSONObject(i);
        if (route.equals(it.getString("route")) && !"cancelled".equals(it.getString("status"))) {
          JSONArray flags = unitFlags(it);
          for (int n = 0; n < flags.length(); n++)
            if (!flags.getBoolean(n)) {
              changes.put(new JSONObject().put("id", it.getInt("id")).put("unit", n));
              flags.put(n, true);
            }
          applyUnits(it, flags);
        }
      }
      rememberUnits(work, route, o.getInt("id"), changes);
      if (changes.length() > 0) event(o, route.equals("bar") ? "Напої видано" : "Їжу видано");
    } else if (path.equals("/api/issue-unit") || path.equals("/api/issue-item")) {
      JSONObject o = find(orders, d.getInt("order"));
      String route = d.getString("route");
      checkRoute(route);
      JSONObject it = find(o.getJSONArray("items"), d.getInt("id"));
      if (!route.equals(it.getString("route")) || "cancelled".equals(it.getString("status")))
        throw new IllegalArgumentException("Позиція недоступна для цієї видачі");
      boolean delivered = d.getBoolean("delivered");
      JSONArray flags = unitFlags(it), changes = new JSONArray();
      int first = 0, last = flags.length();
      if (path.equals("/api/issue-unit")) {
        first = d.getInt("unit");
        last = first + 1;
        if (first < 0 || first >= flags.length())
          throw new IllegalArgumentException("Некоректна порція");
      }
      for (int n = first; n < last; n++) {
        if (delivered && !flags.getBoolean(n))
          changes.put(new JSONObject().put("id", it.getInt("id")).put("unit", n));
        flags.put(n, delivered);
      }
      rememberUnits(work, route, o.getInt("id"), changes);
      applyUnits(it, flags);
      event(o, it.getString("name") + (delivered ? " → Порцію видано" : " → Порцію повернуто"));
    } else if (path.equals("/api/undo-issue")) {
      String route = d.getString("route");
      checkRoute(route);
      JSONArray history = undoHistory(work, route);
      boolean restored = false;
      for (int n = history.length() - 1; n >= 0 && !restored; n--) {
        JSONObject action = history.getJSONObject(n), o;
        JSONArray keep = new JSONArray();
        for (int j = 0; j < n; j++) keep.put(history.get(j));
        work.getJSONObject("issue_undo").put(route, keep);
        try {
          o = find(orders, action.getInt("order"));
        } catch (IllegalArgumentException e) {
          continue;
        }
        JSONArray units = action.optJSONArray("units");
        if (units != null) {
          for (int j = 0; j < units.length(); j++) {
            JSONObject u = units.getJSONObject(j), it;
            try {
              it = find(o.getJSONArray("items"), u.getInt("id"));
            } catch (IllegalArgumentException e) {
              continue;
            }
            if ("cancelled".equals(it.getString("status")) || !route.equals(it.getString("route")))
              continue;
            JSONArray flags = unitFlags(it);
            int index = u.getInt("unit");
            if (flags.optBoolean(index, false)) {
              flags.put(index, false);
              applyUnits(it, flags);
              restored = true;
            }
          }
        } else {
          JSONArray ids = action.getJSONArray("items"), items = o.getJSONArray("items");
          for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.getJSONObject(i);
            for (int j = 0; j < ids.length(); j++)
              if (it.getInt("id") == ids.getInt(j)
                  && route.equals(it.getString("route"))
                  && "delivered".equals(it.getString("status"))) {
                it.remove("unit_issued");
                it.put("status", "new");
                restored = true;
              }
          }
        }
        if (restored) event(o, "Останню видачу повернуто");
      }
      if (!restored) throw new IllegalArgumentException("Немає виданих позицій для повернення");
    } else if (path.equals("/api/status")) {
      String status = d.getString("status");
      checkStatus(status);
      boolean found = false;
      for (int i = 0; i < orders.length(); i++) {
        JSONObject o = orders.getJSONObject(i);
        JSONArray its = o.getJSONArray("items");
        for (int j = 0; j < its.length(); j++) {
          JSONObject it = its.getJSONObject(j);
          if (it.getInt("id") == d.getInt("id")) {
            String previous = it.getString("status");
            if (!previous.equals(status)
                && (previous.equals("cancelled") || status.equals("cancelled"))) {
              for (int k = 0; k < ps.length(); k++) {
                JSONObject product = ps.getJSONObject(k);
                if (product.getInt("id") == it.optInt("product_id", 0)
                    && product.has("stock")
                    && !product.isNull("stock")) {
                  if (!status.equals("cancelled")
                      && !product.optBoolean("stock_estimated", false)
                      && product.getLong("stock") < it.getInt("qty"))
                    throw new IllegalArgumentException("Недостатній залишок");
                  product.put(
                      "stock",
                      product.getLong("stock")
                          + (status.equals("cancelled") ? it.getInt("qty") : -it.getInt("qty")));
                }
              }
            }
            it.remove("unit_issued");
            it.put("status", status);
            event(
                o,
                it.getString("name")
                    + " → "
                    + (status.equals("new")
                        ? "Повернуто до черги"
                        : status.equals("cancelled")
                            ? "Скасовано"
                            : status.equals("delivered") ? "Видано" : status));
            found = true;
          }
        }
      }
      if (!found) throw new IllegalArgumentException("Позицію не знайдено");
    } else throw new IllegalArgumentException("Невідома дія");
    List<String> domains = new ArrayList<>();
    if (path.equals("/api/product")
        || path.equals("/api/delete-product")
        || path.equals("/api/availability")
        || ((path.equals("/api/order") || path.equals("/api/status"))
            && !ps.toString().equals(data.getJSONArray("products").toString()))
        || path.equals("/api/calculate-menu")) domains.add("products");
    if (path.startsWith("/api/issue")
        || path.equals("/api/undo-issue")
        || path.equals("/api/order")
        || path.equals("/api/status")
        || path.equals("/api/stats/clear")) domains.add("orders");
    if (path.contains("session") || path.equals("/api/order") || path.equals("/api/stats/clear"))
      domains.add("sessions");
    if (path.contains("expenses")
        || path.equals("/api/calculate-menu")
        || path.equals("/api/stats/clear")) domains.add("expenses");
    persist(work, domains.toArray(new String[0]));
    data = work;
    return result;
  }
}
