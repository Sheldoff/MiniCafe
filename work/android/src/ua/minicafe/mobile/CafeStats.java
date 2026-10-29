package ua.minicafe.mobile;

import java.text.SimpleDateFormat;
import java.util.*;
import org.json.*;

public final class CafeStats {
  public static long total(JSONObject o) throws Exception {
    long sum = 0;
    JSONArray items = o.getJSONArray("items");
    for (int i = 0; i < items.length(); i++) {
      JSONObject it = items.getJSONObject(i);
      sum += it.getLong("price") * it.getInt("qty");
    }
    return sum;
  }

  public static long utc(String value) throws Exception {
    SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US);
    f.setTimeZone(TimeZone.getTimeZone("UTC"));
    return f.parse(value).getTime();
  }

  public static JSONObject report(JSONObject data, Integer session, String day, int offset)
      throws Exception {
    JSONArray all = data.getJSONArray("orders"),
        chosen = new JSONArray(),
        sessions = data.getJSONArray("sessions");
    String title = "Сьогодні · " + day;
    if (session != null) {
      title = "Сесія №" + session;
      for (int i = 0; i < sessions.length(); i++)
        if (sessions.getJSONObject(i).getInt("id") == session)
          title = sessions.getJSONObject(i).getString("name");
    }
    SimpleDateFormat date = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
    date.setTimeZone(new SimpleTimeZone(offset * 60000, "report"));
    long cashCount = 0, cardCount = 0;
    long giftCount = 0, checkCount = 0, checkRevenue = 0;
    long revenue = 0,
        cash = 0,
        card = 0,
        unknown = 0,
        cancelled = 0,
        min = Long.MAX_VALUE,
        max = 0,
        foodQty = 0,
        foodOrders = 0;
    String first = "", last = "";
    Map<String, long[]> drinks = new TreeMap<>(),
        food = new TreeMap<>(),
        categories = new TreeMap<>();
    long drinksAmount = 0, foodAmount = 0;
    for (int n = 0; n < all.length(); n++) {
      JSONObject o = all.getJSONObject(n);
      if (o.optBoolean("stats_cleared")) continue;
      if (session != null
          ? o.optInt("session_id", 0) != session
          : !date.format(new Date(utc(o.getString("created")))).equals(day)) continue;
      chosen.put(o);
      long amount = total(o);
      revenue += amount;
      if (o.optBoolean("gift")) giftCount++;
      else {
        min = Math.min(min, amount);
        checkCount++;
        checkRevenue += amount;
      }
      max = Math.max(max, amount);
      String created = o.getString("created");
      if (first.isEmpty() || created.compareTo(first) < 0) first = created;
      if (last.isEmpty() || created.compareTo(last) > 0) last = created;
      JSONObject payment = o.optJSONObject("payment");
      if (payment == null) unknown += amount;
      else {
        cash += payment.getLong("cash_amount");
        card += payment.getLong("card_amount");
        if (payment.optLong("cash_given", Math.max(0, payment.getLong("cash_amount"))) > 0)
          cashCount++;
        if (payment.getLong("card_amount") > 0) cardCount++;
      }
      boolean hasFood = false;
      JSONArray its = o.getJSONArray("items");
      for (int j = 0; j < its.length(); j++) {
        JSONObject it = its.getJSONObject(j);
        long value = it.getLong("price") * it.getInt("qty");
        if (it.getString("status").equals("cancelled")) {
          cancelled += value;
          continue;
        }
        String category =
            it.optString("category", it.getString("route").equals("bar") ? "Напої" : "Їжа");
        long[] categorySum = categories.get(category);
        if (categorySum == null) {
          categorySum = new long[2];
          categories.put(category, categorySum);
        }
        categorySum[0] += it.getInt("qty");
        categorySum[1] += value;
        if (it.getString("route").equals("bar")) drinksAmount += value;
        else foodAmount += value;
        Map<String, long[]> bucket = it.getString("route").equals("bar") ? drinks : food;
        String name = it.getString("name");
        long[] sums = bucket.get(name);
        if (sums == null) {
          sums = new long[2];
          bucket.put(name, sums);
        }
        sums[0] += it.getInt("qty");
        sums[1] += value;
        if (it.getString("route").equals("instant")) {
          foodQty += it.getInt("qty");
          hasFood = true;
        }
      }
      if (hasFood) foodOrders++;
    }
    long expenses = 0, calculatorExpenses = 0, additionalExpenses = 0;
    JSONArray details = new JSONArray(), costs = data.optJSONArray("calculator_expenses");
    if (costs != null)
      for (int i = 0; i < costs.length(); i++) {
        JSONObject expense = costs.getJSONObject(i);
        if (session != null
            ? (!expense.optBoolean("pending_session") && expense.optInt("session_id", 0) == session)
            : date.format(new Date(utc(expense.getString("created")))).equals(day)) {
          long cost = expense.getLong("cost");
          expenses += cost;
          if ("additional".equals(expense.optString("kind"))) {
            additionalExpenses += cost;
            details.put(
                new JSONObject()
                    .put("id", expense.getString("id"))
                    .put("cost", cost)
                    .put("note", expense.optString("note", ""))
                    .put("created", expense.getString("created")));
          } else calculatorExpenses += cost;
        }
      }
    Map<String, JSONObject> grouped = new LinkedHashMap<>();
    for (int i = 0; i < details.length(); i++) {
      JSONObject e = details.getJSONObject(i);
      String label = e.optString("note", "").trim().replaceAll("\\s+", " ");
      if (label.isEmpty()) label = "Додаткові витрати";
      String key = label.toLowerCase(Locale.ROOT);
      JSONObject group = grouped.get(key);
      if (group == null) {
        group = new JSONObject().put("note", label).put("cost", 0L);
        grouped.put(key, group);
      }
      group.put("cost", group.getLong("cost") + e.getLong("cost"));
    }
    JSONArray expenseGroups = new JSONArray();
    for (JSONObject group : grouped.values()) expenseGroups.put(group);
    JSONArray categoryRows = new JSONArray();
    for (Map.Entry<String, long[]> e : categories.entrySet())
      categoryRows.put(
          new JSONObject()
              .put("name", e.getKey())
              .put("qty", e.getValue()[0])
              .put("amount", e.getValue()[1]));
    JSONArray beverages = new JSONArray(), foods = new JSONArray();
    for (Map.Entry<String, long[]> e : drinks.entrySet())
      beverages.put(
          new JSONObject()
              .put("name", e.getKey())
              .put("qty", e.getValue()[0])
              .put("amount", e.getValue()[1]));
    for (Map.Entry<String, long[]> e : food.entrySet())
      foods.put(
          new JSONObject()
              .put("name", e.getKey())
              .put("qty", e.getValue()[0])
              .put("amount", e.getValue()[1]));
    return new JSONObject()
        .put("title", title)
        .put("session_id", session == null ? JSONObject.NULL : session)
        .put("day", day == null ? JSONObject.NULL : day)
        .put("revenue", revenue)
        .put("expenses", expenses)
        .put("calculator_expenses", calculatorExpenses)
        .put("additional_expenses", additionalExpenses)
        .put("expense_details", details)
        .put("expense_groups", expenseGroups)
        .put("net_revenue", revenue - expenses)
        .put("cash_count", cashCount)
        .put("card_count", cardCount)
        .put("cash", cash)
        .put("card", card)
        .put("unknown", unknown)
        .put("cancelled", cancelled)
        .put("order_count", chosen.length())
        .put("food_qty", foodQty)
        .put("food_orders", foodOrders)
        .put("gift_count", giftCount)
        .put("check_count", checkCount)
        .put("min_check", checkCount == 0 ? 0 : min)
        .put("max_check", max)
        .put("avg_check", checkCount == 0 ? 0 : Math.round((double) checkRevenue / checkCount))
        .put("first_order", first)
        .put("last_order", last)
        .put("duration_seconds", first.isEmpty() ? 0 : (utc(last) - utc(first)) / 1000)
        .put("drinks_amount", drinksAmount)
        .put("food_amount", foodAmount)
        .put("categories", categoryRows)
        .put("drinks", beverages)
        .put("food", foods)
        .put(
            "note",
            "Подарункові замовлення не враховуються в найменшому та середньому чеку. Виручка та"
                + " оплати — за оформленими чеками. Змішана оплата враховується в обох лічильниках."
                + " Решта, включно з переплатою карткою, віднімається від готівки. Витрати — із"
                + " підтверджених розрахунків калькулятора та окремих додаткових витрат; повторне"
                + " збереження оновлює той самий розрахунок. Виручка після витрат = сума продажів"
                + " мінус усі записані витрати. Скасовані позиції показано окремо; повернення"
                + " коштів не реєструються автоматично. Кількості страв і напоїв не включають"
                + " скасовані позиції.");
  }
}
