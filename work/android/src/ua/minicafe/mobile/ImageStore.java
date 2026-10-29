package ua.minicafe.mobile;

import java.io.*;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;

/** Immutable content-addressed blobs. JSON commits only after every image is durable. */
public final class ImageStore {
  private final File directory;

  public ImageStore(File dataFile) {
    directory =
        new File(dataFile.getAbsoluteFile().getParentFile(), dataFile.getName() + ".images");
  }

  private File file(String hash) throws IOException {
    if (!hash.matches("[a-f0-9]{64}")) throw new IOException("Некоректне посилання зображення");
    return new File(directory, hash + ".jpg");
  }

  public String put(byte[] bytes) throws Exception {
    byte[] hash = MessageDigest.getInstance("SHA-256").digest(bytes);
    StringBuilder name = new StringBuilder();
    for (byte b : hash) name.append(String.format(Locale.US, "%02x", b & 255));
    File target = file(name.toString());
    boolean valid = false;
    if (target.exists()) {
      try {
        valid = Arrays.equals(bytes, get(name.toString()));
      } catch (IOException damaged) {
        valid = false;
      }
    }
    if (!valid) {
      if (!directory.exists() && !directory.mkdirs())
        throw new IOException("Не вдалося створити каталог зображень");
      File tmp = File.createTempFile("image-", ".tmp", directory);
      try {
        try (FileOutputStream out = new FileOutputStream(tmp)) {
          out.write(bytes);
          out.getFD().sync();
        }
        if (target.exists() && !target.delete()) throw new IOException("Не вдалося відновити фото");
        if (!tmp.renameTo(target)) throw new IOException("Не вдалося зберегти фото");
      } finally {
        tmp.delete();
      }
    }
    return name.toString();
  }

  public byte[] get(String hash) throws Exception {
    try (InputStream in = new FileInputStream(file(hash))) {
      byte[] bytes = CafeStore.readBytes(in, 2000000);
      StringBuilder actual = new StringBuilder();
      for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes))
        actual.append(String.format(Locale.US, "%02x", b & 255));
      if (!hash.equals(actual.toString())) throw new IOException("Пошкоджене зображення");
      return bytes;
    }
  }

  public void verify(String hash) throws Exception {
    get(hash);
  }
}
