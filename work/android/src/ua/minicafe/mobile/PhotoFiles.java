package ua.minicafe.mobile;

import android.content.Context;
import android.graphics.*;
import android.media.ExifInterface;
import android.net.Uri;
import java.io.*;
import java.util.UUID;

/** Copy a user-selected photo, orient it and return a small JPEG for WebView. */
public final class PhotoFiles {
  public static void optimizeMenu(CafeStore store) throws Exception {
    synchronized (store) {
      org.json.JSONObject data = new org.json.JSONObject(new String(store.backup(), "UTF-8"));
      if (data.optInt("image_optimization", 0) >= 1) return;
      org.json.JSONArray products = data.getJSONArray("products");
      for (int i = 0; i < products.length(); i++) {
        org.json.JSONObject p = products.getJSONObject(i);
        if (!p.has("image") || p.isNull("image")) continue;
        byte[] old = Codec.decode(p.getString("image"));
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(old, 0, old.length, bounds);
        bounds.inJustDecodeBounds = false;
        bounds.inSampleSize = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / bounds.inSampleSize > 960)
          bounds.inSampleSize *= 2;
        Bitmap image = BitmapFactory.decodeByteArray(old, 0, old.length, bounds);
        if (image == null) continue;
        Bitmap small = null;
        try {
          float ratio = Math.min(1f, 480f / Math.max(image.getWidth(), image.getHeight()));
          small =
              Bitmap.createScaledBitmap(
                  image,
                  Math.max(1, Math.round(image.getWidth() * ratio)),
                  Math.max(1, Math.round(image.getHeight() * ratio)),
                  true);
          ByteArrayOutputStream out = new ByteArrayOutputStream();
          small.compress(Bitmap.CompressFormat.JPEG, 78, out);
          byte[] bytes = out.toByteArray();
          if (bytes.length < old.length) {
            p.put("image", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
            byte[] hash = java.security.MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder version = new StringBuilder();
            for (int j = 0; j < 8; j++)
              version.append(String.format(java.util.Locale.US, "%02x", hash[j] & 255));
            p.put("image_version", version.toString());
          }
        } finally {
          if (small != null && small != image) small.recycle();
          image.recycle();
        }
      }
      data.put("image_optimization", 1);
      store.restore(data.toString().getBytes("UTF-8"));
    }
  }

  public static Uri prepare(Context context, Uri source) throws Exception {
    File dir = new File(context.getCacheDir(), "menu-pictures");
    dir.mkdirs();
    File[] old = dir.listFiles();
    if (old != null)
      for (File f : old) if (System.currentTimeMillis() - f.lastModified() > 86400000) f.delete();
    File input = File.createTempFile("selected-", ".tmp", context.getCacheDir());
    Bitmap bitmap = null, transformed = null, scaled = null;
    try {
      try (InputStream in = context.getContentResolver().openInputStream(source);
          FileOutputStream out = new FileOutputStream(input)) {
        byte[] buffer = new byte[8192];
        int count, total = 0;
        while ((count = in.read(buffer)) != -1) {
          total += count;
          if (total > 25 * 1024 * 1024) throw new IOException("Оберіть фото до 25 МБ");
          out.write(buffer, 0, count);
        }
      }
      BitmapFactory.Options options = new BitmapFactory.Options();
      options.inJustDecodeBounds = true;
      BitmapFactory.decodeFile(input.getPath(), options);
      if (options.outWidth <= 0 || options.outHeight <= 0)
        throw new IOException("Телефон не зміг відкрити фото. Оберіть JPG, PNG або WebP.");
      options.inSampleSize = 1;
      while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 1440)
        options.inSampleSize *= 2;
      options.inJustDecodeBounds = false;
      bitmap = BitmapFactory.decodeFile(input.getPath(), options);
      if (bitmap == null) throw new IOException("Не вдалося прочитати фото");
      int orientation = 1;
      try {
        orientation =
            new ExifInterface(input.getPath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1);
      } catch (IOException ignored) {
      }
      Matrix matrix = new Matrix();
      switch (orientation) {
        case 2:
          matrix.setScale(-1, 1);
          break;
        case 3:
          matrix.setRotate(180);
          break;
        case 4:
          matrix.setRotate(180);
          matrix.postScale(-1, 1);
          break;
        case 5:
          matrix.setRotate(90);
          matrix.postScale(-1, 1);
          break;
        case 6:
          matrix.setRotate(90);
          break;
        case 7:
          matrix.setRotate(-90);
          matrix.postScale(-1, 1);
          break;
        case 8:
          matrix.setRotate(-90);
          break;
      }
      transformed =
          Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
      float ratio = Math.min(1f, 480f / Math.max(transformed.getWidth(), transformed.getHeight()));
      int w = Math.max(1, Math.round(transformed.getWidth() * ratio)),
          h = Math.max(1, Math.round(transformed.getHeight() * ratio));
      scaled = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
      Canvas canvas = new Canvas(scaled);
      canvas.drawColor(Color.WHITE);
      Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
      canvas.drawBitmap(transformed, null, new Rect(0, 0, w, h), paint);
      String name = UUID.randomUUID().toString() + ".jpg";
      File output = new File(dir, name);
      try (FileOutputStream stream = new FileOutputStream(output)) {
        if (!scaled.compress(Bitmap.CompressFormat.JPEG, 78, stream))
          throw new IOException("Не вдалося підготувати фото");
      }
      return Uri.parse("content://" + context.getPackageName() + ".pictures/" + name);
    } finally {
      input.delete();
      if (scaled != null) scaled.recycle();
      if (transformed != null && transformed != bitmap) transformed.recycle();
      if (bitmap != null) bitmap.recycle();
    }
  }
}
