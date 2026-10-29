package ua.minicafe.mobile;

import fi.iki.elonen.NanoHTTPD;
import java.io.*;
import java.util.*;
import org.json.*;

public final class CafeHttpServer extends NanoHTTPD {
  @Override
  protected boolean useGzipWhenAccepted(Response response) {
    return response.getStatus() != Response.Status.NOT_MODIFIED
        && super.useGzipWhenAccepted(response);
  }

  private final CafeStore store;
  private final String key, html, htmlETag;
  private final byte[] pdfFont;
  private final AccessControl access;

  public CafeHttpServer(int port, CafeStore store, String key, String html) {
    this(port, store, key, html, null);
  }

  public CafeHttpServer(int port, CafeStore store, String key, String html, byte[] font) {
    this(port, store, key, html, font, null);
  }

  public CafeHttpServer(
      int port, CafeStore store, String key, String html, byte[] font, AccessControl control) {
    super("0.0.0.0", port);
    try {
      this.access = control == null ? new AccessControl(key) : control;
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
    this.store = store;
    this.key = key;
    this.html = html;
    try {
      this.htmlETag =
          "W/\"ui-"
              + Codec.encode(
                  java.security.MessageDigest.getInstance("SHA-256").digest(html.getBytes("UTF-8")))
              + "\"";
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
    this.pdfFont = font;
  }

  private Response json(Response.Status status, Object value) {
    Response r =
        newFixedLengthResponse(status, "application/json; charset=utf-8", value.toString());
    r.addHeader("Cache-Control", "no-store");
    return r;
  }

  @Override
  public Response serve(IHTTPSession s) {
    try {
      String path = s.getUri();
      if (s.getMethod() == Method.GET && path.equals("/")) {
        Response r =
            htmlETag.equals(s.getHeaders().get("if-none-match"))
                ? newFixedLengthResponse(
                    Response.Status.NOT_MODIFIED, "text/html; charset=utf-8", "")
                : newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", html);
        r.addHeader("ETag", htmlETag);
        r.addHeader("Cache-Control", "private, no-cache");
        r.addHeader("Vary", "Accept-Encoding");
        return r;
      }
      boolean image = path.startsWith("/api/image/");
      String auth =
          (image || path.equals("/api/report.pdf"))
              ? s.getParms().get("key")
              : s.getHeaders().get("x-cafe-key");
      String role = access.role(auth);
      if (role == null)
        return json(
            Response.Status.FORBIDDEN,
            new JSONObject().put("error", "Немає доступу. Перевірте QR-код або посилання."));
      if (s.getMethod() == Method.GET) {
        if (!access.readAllowed(role, path))
          return json(
              Response.Status.FORBIDDEN,
              new JSONObject().put("error", "Ця дія доступна лише власнику"));
        if (path.equals("/api/backup")) {
          byte[] backup = store.backup();
          Response response =
              newFixedLengthResponse(
                  Response.Status.OK,
                  "application/json; charset=utf-8",
                  new ByteArrayInputStream(backup),
                  backup.length);
          response.addHeader("Cache-Control", "no-store");
          return response;
        }
        if (path.equals("/api/access")) return json(Response.Status.OK, access.staff());
        if (path.equals("/api/ping"))
          return json(Response.Status.OK, new JSONObject().put("ok", true).put("app", "minicafe"));
        if (path.equals("/api/state")) {
          synchronized (store) {
            String etag = store.version();
            if (etag.equals(s.getHeaders().get("if-none-match"))) {
              Response r =
                  newFixedLengthResponse(Response.Status.NOT_MODIFIED, "application/json", "");
              r.addHeader("ETag", etag);
              r.addHeader("Cache-Control", "private, no-cache");
              r.addHeader("Vary", "X-Cafe-Key, Accept-Encoding");
              return r;
            }
            Response r = json(Response.Status.OK, access.state(store.state(), role));
            r.addHeader("ETag", etag);
            r.addHeader("Vary", "X-Cafe-Key, Accept-Encoding");
            return r;
          }
        }
        if (path.equals("/api/stats")) {
          String sid = s.getParms().get("session"),
              day = s.getParms().get("day"),
              zone = s.getParms().get("tz");
          return json(
              Response.Status.OK,
              store.statistics(
                  sid == null ? null : Integer.valueOf(sid),
                  day,
                  zone == null ? 0 : Integer.parseInt(zone)));
        }
        if (path.equals("/api/report.pdf")) {
          if (pdfFont == null)
            throw new IllegalArgumentException(
                "Не вдалося завантажити шрифт PDF. Перезапустіть сервер або оновіть застосунок.");
          String sid = s.getParms().get("session"),
              day = s.getParms().get("day"),
              zone = s.getParms().get("tz");
          byte[] bytes =
              PdfReport.create(
                  store.statistics(
                      sid == null ? null : Integer.valueOf(sid),
                      day,
                      zone == null ? 0 : Integer.parseInt(zone)),
                  pdfFont);
          Response response =
              newFixedLengthResponse(
                  Response.Status.OK,
                  "application/pdf",
                  new ByteArrayInputStream(bytes),
                  bytes.length);
          response.addHeader("Content-Disposition", "attachment; filename=MiniCafe-report.pdf");
          response.addHeader("Cache-Control", "no-store");
          return response;
        }
        if (path.equals("/api/history")) {
          String sid = s.getParms().get("session"),
              day = s.getParms().get("day"),
              zone = s.getParms().get("tz"),
              page = s.getParms().get("page");
          return json(
              Response.Status.OK,
              store.history(
                  sid == null ? null : Integer.valueOf(sid),
                  day,
                  zone == null ? 0 : Integer.parseInt(zone),
                  page == null ? 0 : Integer.parseInt(page)));
        }
        if (image) {
          byte[] content = store.image(Integer.parseInt(path.substring(path.lastIndexOf('/') + 1)));
          if (content != null) {
            Response r =
                newFixedLengthResponse(
                    Response.Status.OK,
                    "image/jpeg",
                    new ByteArrayInputStream(content),
                    content.length);
            r.addHeader("Cache-Control", "private, max-age=86400");
            return r;
          }
        }
      } else if (s.getMethod() == Method.POST) {
        long size =
            Long.parseLong(
                s.getHeaders().containsKey("content-length")
                    ? s.getHeaders().get("content-length")
                    : "0");
        if (size < 1 || size > (path.equals("/api/restore") ? 80000000 : 7000000))
          return json(
              Response.Status.BAD_REQUEST,
              new JSONObject().put("error", "Запит завеликий або порожній"));
        byte[] body = new byte[(int) size];
        int offset = 0;
        while (offset < body.length) {
          int count = s.getInputStream().read(body, offset, body.length - offset);
          if (count < 0) throw new IOException("Неповний запит");
          offset += count;
        }
        JSONObject input = new JSONObject(new String(body, "UTF-8"));
        if (!access.writeAllowed(role, path, input))
          return json(
              Response.Status.FORBIDDEN,
              new JSONObject().put("error", "Недостатньо прав для цієї дії"));
        if (path.equals("/api/restore")) {
          store.restore(input.toString().getBytes("UTF-8"));
          return json(Response.Status.OK, new JSONObject().put("ok", true));
        }
        if (path.equals("/api/import-menu")) {
          store.importMenu(input.getJSONArray("products"));
          return json(Response.Status.OK, new JSONObject().put("ok", true));
        }
        if (path.equals("/api/access/rotate")) {
          access.rotate();
          return json(Response.Status.OK, new JSONObject().put("ok", true));
        }
        if (!"admin".equals(role) && !"service".equals(role) && path.equals("/api/availability")) {
          String route = "bar".equals(role) ? "bar" : "instant";
          if (!route.equals(store.productRoute(input.getInt("id"))))
            return json(
                Response.Status.FORBIDDEN, new JSONObject().put("error", "Інша черга видачі"));
        }
        return json(Response.Status.OK, store.mutate(path, input));
      }
      return json(Response.Status.NOT_FOUND, new JSONObject().put("error", "Не знайдено"));
    } catch (Exception e) {
      try {
        JSONObject error =
            new JSONObject()
                .put("error", e.getMessage() == null ? "Помилка обробки запиту" : e.getMessage());
        if (e instanceof CafeStore.PaymentError)
          error.put("missing", ((CafeStore.PaymentError) e).missing);
        return json(Response.Status.BAD_REQUEST, error);
      } catch (Exception ignored) {
        return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Помилка");
      }
    }
  }
}
