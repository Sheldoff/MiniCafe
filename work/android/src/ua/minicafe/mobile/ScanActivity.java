package ua.minicafe.mobile;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.Camera;
import android.os.*;
import android.view.*;
import android.widget.*;
import com.google.zxing.*;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.util.*;

@SuppressWarnings("deprecation")
public class ScanActivity extends Activity
    implements SurfaceHolder.Callback, Camera.PreviewCallback {
  private Camera camera;
  private SurfaceView preview;
  private boolean surface = false, finished = false;
  private long last = 0;

  @Override
  public void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(1);
    layout.setBackgroundColor(Color.rgb(24, 61, 48));
    TextView title = new TextView(this);
    title.setText("Наведіть камеру на QR-код\nу вікні МініКафе на ноутбуці");
    title.setTextColor(Color.WHITE);
    title.setTextSize(19);
    title.setGravity(17);
    title.setPadding(20, 24, 20, 24);
    layout.addView(title);
    preview = new SurfaceView(this);
    layout.addView(preview, new LinearLayout.LayoutParams(-1, 0, 1));
    Button cancel = new Button(this);
    cancel.setText("Скасувати");
    cancel.setOnClickListener(v -> finish());
    layout.addView(cancel);
    setContentView(layout);
    preview.getHolder().addCallback(this);
    if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
      requestPermissions(new String[] {Manifest.permission.CAMERA}, 7);
  }

  @Override
  public void onRequestPermissionsResult(int code, String[] p, int[] r) {
    super.onRequestPermissionsResult(code, p, r);
    if (code == 7) {
      if (r.length > 0 && r[0] == PackageManager.PERMISSION_GRANTED) open();
      else
        new AlertDialog.Builder(this)
            .setMessage(
                "Для сканування потрібен доступ до камери. Ви також можете ввести посилання"
                    + " вручну.")
            .setPositiveButton("Добре", (d, w) -> finish())
            .setOnCancelListener(d -> finish())
            .show();
    }
  }

  private void open() {
    if (!surface
        || camera != null
        || finished
        || checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
      return;
    try {
      int index = -1;
      Camera.CameraInfo info = new Camera.CameraInfo();
      for (int i = 0; i < Camera.getNumberOfCameras(); i++) {
        Camera.getCameraInfo(i, info);
        if (info.facing == Camera.CameraInfo.CAMERA_FACING_BACK) {
          index = i;
          break;
        }
      }
      if (index < 0) throw new Exception("Немає задньої камери");
      camera = Camera.open(index);
      Camera.getCameraInfo(index, info);
      camera.setDisplayOrientation(
          (info.orientation + 360 - getWindowManager().getDefaultDisplay().getRotation() * 90)
              % 360);
      Camera.Parameters params = camera.getParameters();
      Camera.Size best = params.getPreviewSize();
      int distance = Integer.MAX_VALUE;
      for (Camera.Size size : params.getSupportedPreviewSizes()) {
        int d = Math.abs(size.width - 1280) + Math.abs(size.height - 720);
        if (d < distance) {
          best = size;
          distance = d;
        }
      }
      params.setPreviewSize(best.width, best.height);
      List<String> modes = params.getSupportedFocusModes();
      if (modes != null && modes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE))
        params.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
      camera.setParameters(params);
      camera.setPreviewDisplay(preview.getHolder());
      camera.setPreviewCallback(this);
      camera.startPreview();
    } catch (Exception e) {
      release();
      new AlertDialog.Builder(this)
          .setMessage(
              "Не вдалося відкрити камеру. Закрийте інші програми з камерою або введіть посилання"
                  + " вручну.")
          .setPositiveButton("Добре", (d, w) -> finish())
          .setOnCancelListener(d -> finish())
          .show();
    }
  }

  @Override
  public void onPreviewFrame(byte[] bytes, Camera c) {
    if (finished || System.currentTimeMillis() - last < 350) return;
    last = System.currentTimeMillis();
    try {
      Camera.Size size = c.getParameters().getPreviewSize();
      PlanarYUVLuminanceSource source =
          new PlanarYUVLuminanceSource(
              bytes, size.width, size.height, 0, 0, size.width, size.height, false);
      QRCodeReader reader = new QRCodeReader();
      Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
      hints.put(DecodeHintType.TRY_HARDER, true);
      Result result = reader.decode(new BinaryBitmap(new HybridBinarizer(source)), hints);
      finished = true;
      setResult(RESULT_OK, new Intent().putExtra("url", result.getText()));
      release();
      finish();
    } catch (Exception ignored) {
    }
  }

  private void release() {
    if (camera != null) {
      camera.setPreviewCallback(null);
      try {
        camera.stopPreview();
      } catch (Exception ignored) {
      }
      camera.release();
      camera = null;
    }
  }

  @Override
  public void surfaceCreated(SurfaceHolder h) {
    surface = true;
    open();
  }

  @Override
  public void surfaceChanged(SurfaceHolder h, int f, int w, int z) {}

  @Override
  public void surfaceDestroyed(SurfaceHolder h) {
    surface = false;
    release();
  }

  @Override
  protected void onPause() {
    release();
    super.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    open();
  }
}
