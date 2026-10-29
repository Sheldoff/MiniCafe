import ua.minicafe.mobile.*;

public class LinkTest {
  static void check(boolean b, String m) {
    if (!b) throw new AssertionError(m);
  }

  public static void main(String[] a) throws Exception {
    check(
        CafeLink.connection("http://192.168.1.2:8765/?key=abc_123#bar")
            .equals("http://192.168.1.2:8765/?key=abc_123"),
        "Wi-Fi");
    check(
        CafeLink.connection("https://blue-cafe.trycloudflare.com/?key=abc#cash")
            .equals("https://blue-cafe.trycloudflare.com/?key=abc"),
        "HTTPS");
    check(
        CafeLink.tunnelOrigin("https://blue-cafe.trycloudflare.com/")
            .equals("https://blue-cafe.trycloudflare.com"),
        "tunnel normalization");
    for (String u :
        new String[] {
          "http://blue-cafe.trycloudflare.com",
          "https://blue-cafe.trycloudflare.com.evil.test",
          "https://evil.trycloudflare.com@evil.test",
          "https://blue-cafe.trycloudflare.com/path",
          "https://blue-cafe.trycloudflare.com?key=secret",
          "https://blue-cafe.trycloudflare.com:1234",
          "javascript:alert(1)"
        }) {
      try {
        CafeLink.tunnelOrigin(u);
        throw new AssertionError("accepted " + u);
      } catch (IllegalArgumentException | java.net.URISyntaxException expected) {
      }
    }
    for (String u :
        new String[] {
          "file:///tmp/foo?key=abc",
          "https://user:pass@cafe.test/?key=abc",
          "https://cafe.test/",
          "https://cafe.test/?key=abc&key=def",
          "https://cafe.test/path?key=abc"
        }) {
      try {
        CafeLink.connection(u);
        throw new AssertionError("accepted connection " + u);
      } catch (IllegalArgumentException | java.net.URISyntaxException expected) {
      }
    }
    System.out.println(
        "PASS Wi-Fi/HTTPS links, QR fragments, tunnel validation, invalid"
            + " schemes/hosts/credentials/paths/keys rejected");
  }
}
