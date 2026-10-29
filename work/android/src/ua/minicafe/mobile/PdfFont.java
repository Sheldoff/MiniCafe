package ua.minicafe.mobile;

import java.io.*;
import java.util.zip.*;

/** A fallback for devices whose AssetManager cannot open the bundled font. */
public final class PdfFont {
  public static byte[] fromApk(String apk) throws IOException {
    try (ZipFile zip = new ZipFile(apk)) {
      for (String path : new String[] {"assets/pdf-font.bin", "assets/fonts/DejaVuSans.ttf"}) {
        ZipEntry entry = zip.getEntry(path);
        if (entry == null) continue;
        try (InputStream in = zip.getInputStream(entry)) {
          byte[] bytes = CafeStore.readBytes(in, 3000000);
          if (bytes.length < 12 || bytes[0] != 0 || bytes[1] != 1 || bytes[2] != 0 || bytes[3] != 0)
            throw new IOException("Некоректний шрифт PDF");
          return bytes;
        }
      }
      throw new FileNotFoundException("Шрифт PDF відсутній у пакеті застосунку");
    }
  }
}
