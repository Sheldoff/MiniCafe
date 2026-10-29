package ua.minicafe.mobile;

import java.io.ByteArrayOutputStream;

public final class Codec {
  public static String encode(byte[] bytes) {
    StringBuilder out = new StringBuilder((bytes.length + 2) / 3 * 4);
    for (int i = 0; i < bytes.length; i += 3) {
      int a = bytes[i] & 255,
          b = i + 1 < bytes.length ? bytes[i + 1] & 255 : 0,
          c = i + 2 < bytes.length ? bytes[i + 2] & 255 : 0;
      out.append(ALPHABET.charAt(a >> 2))
          .append(ALPHABET.charAt((a & 3) * 16 + (b >> 4)))
          .append(i + 1 < bytes.length ? ALPHABET.charAt((b & 15) * 4 + (c >> 6)) : '=')
          .append(i + 2 < bytes.length ? ALPHABET.charAt(c & 63) : '=');
    }
    return out.toString();
  }

  private static final String ALPHABET =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  public static byte[] decode(String text) {
    if (text.length() > 7000000 || text.length() % 4 != 0)
      throw new IllegalArgumentException("Некоректне зображення");
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    int buffer = 0, bits = 0;
    boolean ended = false;
    for (int i = 0; i < text.length(); i++) {
      char ch = text.charAt(i);
      if (ch == '=') {
        ended = true;
        continue;
      }
      int n = ALPHABET.indexOf(ch);
      if (n < 0 || ended) throw new IllegalArgumentException("Некоректне зображення");
      buffer = (buffer << 6) | n;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.write((buffer >> bits) & 255);
      }
    }
    return out.toByteArray();
  }
}
