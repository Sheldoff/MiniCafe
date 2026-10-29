package ua.minicafe.mobile;

import android.content.*;
import android.database.*;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;

public class PhotoProvider extends ContentProvider {
  @Override
  public boolean onCreate() {
    return true;
  }

  private File file(Uri uri) throws FileNotFoundException {
    String name = uri.getLastPathSegment();
    if (name == null || !name.matches("[a-fA-F0-9-]{36}\\.jpg")) throw new FileNotFoundException();
    File f = new File(new File(getContext().getCacheDir(), "menu-pictures"), name);
    if (!f.isFile()) throw new FileNotFoundException();
    return f;
  }

  @Override
  public String getType(Uri uri) {
    return "image/jpeg";
  }

  @Override
  public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
    if (!"r".equals(mode)) throw new FileNotFoundException();
    return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
  }

  @Override
  public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
    try {
      File f = file(uri);
      String[] cols =
          projection == null
              ? new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}
              : projection;
      MatrixCursor c = new MatrixCursor(cols);
      Object[] values = new Object[cols.length];
      for (int i = 0; i < cols.length; i++)
        values[i] =
            OpenableColumns.DISPLAY_NAME.equals(cols[i])
                ? f.getName()
                : OpenableColumns.SIZE.equals(cols[i]) ? f.length() : null;
      c.addRow(values);
      return c;
    } catch (FileNotFoundException e) {
      return null;
    }
  }

  @Override
  public Uri insert(Uri uri, ContentValues values) {
    throw new UnsupportedOperationException();
  }

  @Override
  public int update(Uri uri, ContentValues values, String s, String[] args) {
    throw new UnsupportedOperationException();
  }

  @Override
  public int delete(Uri uri, String s, String[] args) {
    throw new UnsupportedOperationException();
  }
}
