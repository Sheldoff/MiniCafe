package ua.minicafe.mobile;

import java.io.*;
import java.nio.*;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.zip.DeflaterOutputStream;
import org.json.*;

/** Portable, Unicode PDF report; the same generator runs in Android and tests. */
public final class PdfReport {
  private final byte[] font;
  private final int units, metrics, hmtx, cmap;
  private final int[] glyph = new int[65536];
  private final Set<Integer> used = new TreeSet<>();
  private final List<StringBuilder> pages = new ArrayList<>();
  private StringBuilder page;
  private float y;

  private PdfReport(byte[] font) throws Exception {
    this.font = font;
    int head = table("head"), hhea = table("hhea");
    units = u16(head + 18);
    metrics = u16(hhea + 34);
    hmtx = table("hmtx");
    int map = table("cmap"), found = 0;
    for (int i = 0; i < u16(map + 2); i++) {
      int entry = map + 4 + i * 8, offset = map + i32(entry + 4);
      if (u16(offset) == 4) {
        found = offset;
        if (u16(entry) == 3) break;
      }
    }
    if (found == 0) throw new IOException("Шрифт не підтримує Unicode");
    cmap = found;
    int seg = u16(cmap + 6) / 2,
        end = cmap + 14,
        start = end + seg * 2 + 2,
        delta = start + seg * 2,
        range = delta + seg * 2;
    for (int i = 0; i < seg; i++)
      for (int cp = u16(start + i * 2); cp <= u16(end + i * 2) && cp < 65536; cp++) {
        int r = u16(range + i * 2), g;
        if (r == 0) g = (cp + s16(delta + i * 2)) & 65535;
        else {
          int at = range + i * 2 + r + (cp - u16(start + i * 2)) * 2;
          g = at + 1 < font.length ? u16(at) : 0;
          if (g != 0) g = (g + s16(delta + i * 2)) & 65535;
        }
        glyph[cp] = g;
      }
  }

  private int u16(int p) {
    return ((font[p] & 255) << 8) | (font[p + 1] & 255);
  }

  private int s16(int p) {
    return (short) u16(p);
  }

  private int i32(int p) {
    return ByteBuffer.wrap(font, p, 4).getInt();
  }

  private int table(String name) throws Exception {
    for (int i = 0; i < u16(4); i++) {
      int p = 12 + i * 16;
      if (new String(font, p, 4, "US-ASCII").equals(name)) return i32(p + 8);
    }
    throw new IOException("Неповний шрифт");
  }

  private int width(int cp) {
    int gid = glyph[cp];
    return Math.round(u16(hmtx + Math.min(gid, metrics - 1) * 4) * 1000f / units);
  }

  private String clean(String value) {
    StringBuilder result = new StringBuilder();
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      if (Character.isHighSurrogate(c)) {
        result.append('?');
        if (i + 1 < value.length() && Character.isLowSurrogate(value.charAt(i + 1))) i++;
      } else if (Character.isLowSurrogate(c)) result.append('?');
      else result.append(Character.isISOControl(c) && c != '\n' ? ' ' : c);
    }
    return result.toString();
  }

  private float measure(String value, int size) {
    float w = 0;
    for (int i = 0; i < value.length(); i++) w += width(value.charAt(i)) * size / 1000f;
    return w;
  }

  private void text(String value, float x, float top, int size, String color) {
    value = clean(value);
    StringBuilder hex = new StringBuilder();
    for (int i = 0; i < value.length(); i++) {
      int cp = value.charAt(i);
      used.add(cp);
      hex.append(String.format(Locale.US, "%04X", cp));
    }
    page.append(color)
        .append(" rg BT /F1 ")
        .append(size)
        .append(" Tf 1 0 0 1 ")
        .append(x)
        .append(' ')
        .append(842 - top)
        .append(" Tm <")
        .append(hex)
        .append("> Tj ET\n");
  }

  private void newPage() {
    page = new StringBuilder();
    pages.add(page);
    page.append("0.09 0.24 0.19 rg 0 790 595 52 re f\n");
    text("МініКафе", 40, 33, 17, "1 1 1");
    text("Звіт · сторінка " + pages.size(), 390, 31, 10, "0.8 0.87 0.8");
    y = 81;
  }

  private void room(float needed) {
    if (page == null || y + needed > 788) newPage();
  }

  private List<String> wrap(String value, float max, int size) {
    List<String> lines = new ArrayList<>();
    StringBuilder line = new StringBuilder();
    for (char c : clean(value).toCharArray()) {
      if (c == '\n') {
        lines.add(line.toString());
        line.setLength(0);
        continue;
      }
      if (measure(line.toString() + c, size) > max) {
        int cut = line.lastIndexOf(" ");
        if (cut > 0) {
          lines.add(line.substring(0, cut));
          String tail = line.substring(cut + 1);
          line.setLength(0);
          line.append(tail);
        } else {
          lines.add(line.toString());
          line.setLength(0);
        }
      }
      if (c != ' ' || line.length() > 0) line.append(c);
    }
    if (line.length() > 0 || lines.isEmpty()) lines.add(line.toString());
    return lines;
  }

  private void paragraph(String value, int size, String color) {
    for (String line : wrap(value, 515, size)) {
      room(size + 8);
      text(line, 40, y, size, color);
      y += size + 6;
    }
    y += 5;
  }

  private void heading(String value) {
    room(70);
    y += 10;
    paragraph(value, 14, "0.12 0.33 0.24");
  }

  private void pair(String name, String value) {
    List<String> lines = wrap(name, 345, 11);
    room(lines.size() * 17 + 11);
    for (int i = 0; i < lines.size(); i++) {
      text(lines.get(i), 40, y + i * 17, 11, "0.29 0.36 0.27");
    }
    text(value, 555 - measure(value, 12), y, 12, "0.1 0.22 0.15");
    y += lines.size() * 17 + 7;
    page.append("0.9 0.92 0.87 RG 40 ")
        .append(842 - y + 16)
        .append(" m 555 ")
        .append(842 - y + 16)
        .append(" l S\n");
  }

  private static String money(long value) {
    return String.format(Locale.US, "%.2f грн", value / 100.0);
  }

  private static String date(String value) {
    if (value.isEmpty()) return "—";
    try {
      SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US);
      in.setTimeZone(TimeZone.getTimeZone("UTC"));
      return new SimpleDateFormat("dd.MM.yyyy HH:mm:ss", Locale.US).format(in.parse(value));
    } catch (Exception e) {
      return value;
    }
  }

  private void rows(String title, JSONArray rows) throws Exception {
    heading(title);
    if (rows.length() == 0) {
      paragraph("Немає позицій", 11, "0.45 0.5 0.41");
      return;
    }
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = rows.getJSONObject(i);
      pair(
          row.getString("name") + " · " + row.getLong("qty") + " шт.",
          money(row.getLong("amount")));
    }
  }

  public static byte[] create(JSONObject report, byte[] font) throws Exception {
    PdfReport p = new PdfReport(font);
    p.newPage();
    p.paragraph(report.getString("title"), 20, "0.1 0.24 0.17");
    p.paragraph(
        "Збережено: " + new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.US).format(new Date()),
        10,
        "0.45 0.5 0.41");
    p.heading("Виручка та оплати");
    p.pair("Сума продажів", money(report.getLong("revenue")));
    p.pair("Їжа", money(report.optLong("calculator_expenses", report.optLong("expenses", 0))));
    JSONArray extraRows = report.optJSONArray("expense_groups");
    if (extraRows == null) extraRows = report.optJSONArray("expense_details");
    if (extraRows != null)
      for (int i = 0; i < extraRows.length(); i++) {
        JSONObject e = extraRows.getJSONObject(i);
        String note = e.optString("note", "");
        p.pair(note.isEmpty() ? "Додаткові витрати" : note, money(e.getLong("cost")));
      }
    p.pair("Усього витрачено", money(report.optLong("expenses", 0)));
    p.pair(
        "Виручка після витрат", money(report.getLong("revenue") - report.optLong("expenses", 0)));
    p.pair("Готівкою · оплат: " + report.optLong("cash_count", 0), money(report.getLong("cash")));
    p.pair("Карткою · оплат: " + report.optLong("card_count", 0), money(report.getLong("card")));
    if (report.optLong("unknown", 0) > 0)
      p.pair("Тип оплати невідомий", money(report.getLong("unknown")));
    p.pair("Кількість замовлень", String.valueOf(report.getInt("order_count")));
    p.pair("Подарункових замовлень", String.valueOf(report.optLong("gift_count", 0)));
    p.heading("Чеки та час");
    p.pair(
        "Найменший чек (без подарунків)",
        report.optLong("check_count", report.optLong("order_count", 0)) == 0
            ? "—"
            : money(report.getLong("min_check")));
    p.pair("Найбільший чек", money(report.getLong("max_check")));
    p.pair(
        "Середній чек (без подарунків)",
        report.optLong("check_count", report.optLong("order_count", 0)) == 0
            ? "—"
            : money(report.getLong("avg_check")));
    p.pair("Перше замовлення", date(report.getString("first_order")));
    p.pair("Останнє замовлення", date(report.getString("last_order")));
    long seconds = report.getLong("duration_seconds");
    p.pair(
        "Час від першого до останнього",
        (seconds / 3600) + " год " + (seconds % 3600 / 60) + " хв " + (seconds % 60) + " с");
    p.rows("Кількість кожного напою", report.getJSONArray("drinks"));
    p.pair("Усі напої — разом", money(report.optLong("drinks_amount", 0)));
    p.rows("Кількість кожної страви", report.getJSONArray("food"));
    p.pair("Уся їжа — разом", money(report.optLong("food_amount", 0)));
    if (report.has("categories"))
      p.rows("Підсумки за категоріями", report.getJSONArray("categories"));
    if (report.optLong("cancelled", 0) > 0)
      p.pair("Скасовані позиції", money(report.getLong("cancelled")));
    p.heading("Примітка до обліку");
    p.paragraph(report.getString("note"), 10, "0.4 0.46 0.37");
    return p.finish();
  }

  private static byte[] ascii(String s) throws Exception {
    return s.getBytes("ISO-8859-1");
  }

  private static byte[] stream(byte[] value, String extra) throws Exception {
    ByteArrayOutputStream compressed = new ByteArrayOutputStream();
    try (DeflaterOutputStream d = new DeflaterOutputStream(compressed)) {
      d.write(value);
    }
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    out.write(
        ascii(
            "<< /Length "
                + compressed.size()
                + " /Filter /FlateDecode "
                + extra
                + " >>\nstream\n"));
    out.write(compressed.toByteArray());
    out.write(ascii("\nendstream"));
    return out.toByteArray();
  }

  private byte[] finish() throws Exception {
    List<byte[]> objects = new ArrayList<>();
    objects.add(ascii("<< /Type /Catalog /Pages 2 0 R >>"));
    StringBuilder kids = new StringBuilder();
    for (int i = 0; i < pages.size(); i++) kids.append(9 + i * 2).append(" 0 R ");
    objects.add(ascii("<< /Type /Pages /Count " + pages.size() + " /Kids [" + kids + "] >>"));
    objects.add(
        ascii(
            "<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans /Encoding /Identity-H"
                + " /DescendantFonts [4 0 R] /ToUnicode 8 0 R >>"));
    StringBuilder widths = new StringBuilder();
    for (int cp : used) widths.append(cp).append(" [").append(width(cp)).append("] ");
    objects.add(
        ascii(
            "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /CIDSystemInfo <<"
                + " /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R"
                + " /DW 600 /W ["
                + widths
                + "] /CIDToGIDMap 7 0 R >>"));
    objects.add(
        ascii(
            "<< /Type /FontDescriptor /FontName /DejaVuSans /Flags 32 /FontBBox [-1020 -463 1793"
                + " 1232] /ItalicAngle 0 /Ascent 928 /Descent -236 /CapHeight 928 /StemV 80"
                + " /FontFile2 6 0 R >>"));
    objects.add(stream(font, "/Length1 " + font.length));
    byte[] mapping = new byte[131072];
    for (int i = 0; i < 65536; i++) {
      mapping[i * 2] = (byte) (glyph[i] >> 8);
      mapping[i * 2 + 1] = (byte) glyph[i];
    }
    objects.add(stream(mapping, ""));
    objects.add(
        stream(
            ascii(
                "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo <<"
                    + " /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName"
                    + " /Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF>"
                    + " endcodespacerange 1 beginbfrange <0000> <FFFF> <0000> endbfrange endcmap"
                    + " CMapName currentdict /CMap defineresource pop end end"),
            ""));
    for (int i = 0; i < pages.size(); i++) {
      objects.add(
          ascii(
              "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0"
                  + " R >> >> /Contents "
                  + (10 + i * 2)
                  + " 0 R >>"));
      objects.add(stream(ascii(pages.get(i).toString()), ""));
    }
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    out.write(ascii("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n"));
    List<Integer> offsets = new ArrayList<>();
    for (int i = 0; i < objects.size(); i++) {
      offsets.add(out.size());
      out.write(ascii((i + 1) + " 0 obj\n"));
      out.write(objects.get(i));
      out.write(ascii("\nendobj\n"));
    }
    int xref = out.size();
    out.write(ascii("xref\n0 " + (objects.size() + 1) + "\n0000000000 65535 f \n"));
    for (int offset : offsets)
      out.write(ascii(String.format(Locale.US, "%010d 00000 n \n", offset)));
    out.write(
        ascii(
            "trailer\n<< /Size "
                + (objects.size() + 1)
                + " /Root 1 0 R >>\nstartxref\n"
                + xref
                + "\n%%EOF\n"));
    return out.toByteArray();
  }
}
