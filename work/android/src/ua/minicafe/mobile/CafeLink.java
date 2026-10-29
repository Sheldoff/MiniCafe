package ua.minicafe.mobile;

import java.net.*;
import java.util.Locale;

public final class CafeLink {
  public static String connection(String input) throws Exception {
    URI u = new URI(input.trim());
    String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.US);
    String query = u.getRawQuery();
    if ((!scheme.equals("http") && !scheme.equals("https"))
        || u.getHost() == null
        || u.getUserInfo() != null
        || u.getPort() > 65535
        || query == null
        || !query.matches("key=[A-Za-z0-9_-]{1,200}")
        || (u.getRawPath() != null && !u.getRawPath().isEmpty() && !u.getRawPath().equals("/")))
      throw new IllegalArgumentException("Вставте повне HTTP або HTTPS посилання з ключем");
    return scheme + "://" + u.getRawAuthority() + "/?" + query;
  }

  public static String tunnelOrigin(String input) throws Exception {
    URI u = new URI(input.trim());
    String host = u.getHost();
    if (!"https".equalsIgnoreCase(u.getScheme())
        || host == null
        || !host.toLowerCase(Locale.US).matches("[a-z0-9]+(?:-[a-z0-9]+)*\\.trycloudflare\\.com")
        || u.getUserInfo() != null
        || (u.getPort() != -1 && u.getPort() != 443)
        || (u.getRawPath() != null && !u.getRawPath().isEmpty() && !u.getRawPath().equals("/"))
        || u.getRawQuery() != null
        || u.getRawFragment() != null)
      throw new IllegalArgumentException(
          "Вставте лише адресу https://…trycloudflare.com з Termux, без ключа й додаткового шляху");
    return "https://" + host.toLowerCase(Locale.US);
  }
}
