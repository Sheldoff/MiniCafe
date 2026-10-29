package ua.minicafe.mobile;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.util.LruCache;
import android.widget.ImageView;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** QR encoding and pixel allocation never block an expanding Android panel. */
public final class CafeQr {
  private static final class Request {
    volatile boolean cancelled;
  }

  private static final LruCache<String, Bitmap> cache = new LruCache<>(4);
  private static final ExecutorService worker =
      Executors.newSingleThreadExecutor(
          r -> {
            Thread t = new Thread(r, "MiniCafe-QR");
            t.setDaemon(true);
            return t;
          });

  public static void show(ImageView target, String value, int size, Runnable failure) {
    Object previous = target.getTag();
    if (previous instanceof Request) ((Request) previous).cancelled = true;
    Request token = new Request();
    target.setTag(token);
    target.animate().cancel();
    target.setAlpha(1f);
    String key = size + ":" + value;
    Bitmap existing = cache.get(key);
    if (existing != null) {
      target.setImageBitmap(existing);
      return;
    }
    target.setImageDrawable(null);
    worker.execute(
        () -> {
          if (token.cancelled) return;
          Bitmap bitmap = null;
          try {
            BitMatrix matrix = new QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, size, size);
            int[] pixels = new int[size * size];
            for (int y = 0; y < size; y++)
              for (int x = 0; x < size; x++)
                pixels[y * size + x] = matrix.get(x, y) ? Color.rgb(23, 63, 53) : Color.WHITE;
            bitmap = Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888);
            cache.put(key, bitmap);
          } catch (Exception ignored) {
          }
          final Bitmap ready = bitmap;
          target.post(
              () -> {
                if (target.getTag() != token || !target.isAttachedToWindow()) return;
                if (ready == null) {
                  failure.run();
                  return;
                }
                target.setImageBitmap(ready);
                target.setAlpha(0f);
                target.animate().alpha(1f).setDuration(120).start();
              });
        });
  }
}
