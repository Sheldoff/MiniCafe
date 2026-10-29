package ua.minicafe.mobile;

import android.app.Activity;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.view.*;
import android.widget.*;
import android.widget.Button;

/** Shared native controls; screen classes only decide layout and actions. */
public final class CafeUi {
  public static boolean dark(Context c) {
    return "dark".equals(c.getSharedPreferences("appearance", 0).getString("theme", "light"));
  }

  public static int background(Context c) {
    return dark(c) ? Color.rgb(20, 27, 24) : Color.rgb(245, 244, 239);
  }

  public static int surface(Context c) {
    return dark(c) ? Color.rgb(30, 41, 36) : Color.WHITE;
  }

  public static int text(Context c) {
    return dark(c) ? Color.rgb(233, 239, 233) : Color.rgb(23, 63, 53);
  }

  public static int accent(Context c) {
    return dark(c) ? Color.rgb(179, 217, 164) : Color.rgb(33, 89, 67);
  }

  public static int onAccent(Context c) {
    return dark(c) ? Color.rgb(22, 38, 25) : Color.WHITE;
  }

  public static boolean applyTheme(Activity a) {
    boolean dark = dark(a);
    a.setTheme(dark ? R.style.CafeTheme_Dark : R.style.CafeTheme);
    return dark;
  }

  public static int px(Context c, int n) {
    return (int) (c.getResources().getDisplayMetrics().density * n);
  }

  public static LinearLayout screen(Activity a, int maxWidth) {
    ScrollView scroll = new ScrollView(a);
    scroll.setFillViewport(true);
    scroll.setBackgroundColor(background(a));
    FrameLayout frame = new FrameLayout(a);
    scroll.addView(frame, new ScrollView.LayoutParams(-1, -2));
    LinearLayout column = new LinearLayout(a);
    column.setOrientation(1);
    column.setPadding(px(a, 16), px(a, 22), px(a, 16), px(a, 28));
    int width = a.getResources().getConfiguration().screenWidthDp;
    frame.addView(
        column,
        new FrameLayout.LayoutParams(
            width > maxWidth ? px(a, maxWidth) : -1, -2, Gravity.TOP | Gravity.CENTER_HORIZONTAL));
    a.setContentView(scroll);
    return column;
  }

  public static LinearLayout card(LinearLayout parent) {
    Context c = parent.getContext();
    LinearLayout card = new LinearLayout(c);
    card.setOrientation(1);
    card.setPadding(px(c, 16), px(c, 14), px(c, 16), px(c, 16));
    card.setBackground(shape(c, surface(c), true));
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
    lp.topMargin = px(c, 14);
    parent.addView(card, lp);
    return card;
  }

  public static TextView label(LinearLayout parent, String value, int size, boolean muted) {
    Context c = parent.getContext();
    TextView text = new TextView(c);
    text.setText(value);
    text.setTextSize(size);
    text.setTextColor(
        muted ? (dark(c) ? Color.rgb(176, 190, 178) : Color.rgb(93, 112, 99)) : text(c));
    text.setPadding(0, px(c, 3), 0, px(c, 8));
    text.setLineSpacing(px(c, 2), 1f);
    if (size >= 18) text.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
    parent.addView(text);
    return text;
  }

  public static void field(EditText field) {
    Context c = field.getContext();
    field.setTextSize(15);
    field.setTextColor(text(c));
    field.setHintTextColor(dark(c) ? Color.rgb(176, 190, 178) : Color.rgb(106, 122, 109));
    field.setBackground(shape(c, dark(c) ? Color.rgb(23, 34, 29) : Color.rgb(249, 250, 246), true));
    field.setPadding(px(c, 12), px(c, 12), px(c, 12), px(c, 12));
    field.setMinimumHeight(px(c, 50));
    field.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_DONE);
    field.setOnEditorActionListener(
        (v, action, event) -> {
          if (action != android.view.inputmethod.EditorInfo.IME_ACTION_DONE) return false;
          field.clearFocus();
          ((android.view.inputmethod.InputMethodManager)
                  c.getSystemService(Context.INPUT_METHOD_SERVICE))
              .hideSoftInputFromWindow(field.getWindowToken(), 0);
          return true;
        });
  }

  public static void actions(LinearLayout parent, Button... buttons) {
    Context c = parent.getContext();
    boolean wide = c.getResources().getConfiguration().screenWidthDp >= 600;
    LinearLayout row = new LinearLayout(c);
    row.setOrientation(wide ? 0 : 1);
    parent.addView(row, new LinearLayout.LayoutParams(-1, -2));
    for (int i = 0; i < buttons.length; i++) {
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(wide ? 0 : -1, -2, wide ? 1 : 0);
      lp.topMargin = px(c, 8);
      if (wide && i > 0) lp.leftMargin = px(c, 8);
      row.addView(buttons[i], lp);
    }
  }

  private static GradientDrawable shape(Context c, int color, boolean border) {
    GradientDrawable bg = new GradientDrawable();
    bg.setColor(color);
    bg.setCornerRadius(px(c, 14));
    if (border) bg.setStroke(px(c, 1), dark(c) ? Color.rgb(76, 98, 84) : Color.rgb(216, 224, 212));
    return bg;
  }

  public static Button button(Context c, String text, boolean primary) {
    Button b = new Button(c);
    b.setText(text);
    b.setAllCaps(false);
    b.setTextSize(14);
    b.setTextColor(primary ? onAccent(c) : text(c));
    b.setPadding(px(c, 12), px(c, 8), px(c, 12), px(c, 8));
    StateListDrawable states = new StateListDrawable();
    states.addState(
        new int[] {-android.R.attr.state_enabled},
        shape(c, dark(c) ? Color.rgb(44, 54, 47) : Color.rgb(230, 234, 225), !primary));
    states.addState(
        new int[] {android.R.attr.state_pressed},
        shape(
            c,
            primary
                ? (dark(c) ? Color.rgb(195, 228, 182) : Color.rgb(24, 70, 53))
                : (dark(c) ? Color.rgb(44, 62, 50) : Color.rgb(235, 242, 227)),
            !primary));
    states.addState(new int[] {}, shape(c, primary ? accent(c) : surface(c), !primary));
    b.setBackground(states);
    b.setStateListAnimator(null);
    b.setTextColor(
        new ColorStateList(
            new int[][] {new int[] {-android.R.attr.state_enabled}, new int[] {}},
            new int[] {
              dark(c) ? Color.rgb(156, 170, 159) : Color.rgb(117, 131, 118),
              primary ? onAccent(c) : text(c)
            }));
    b.setMinHeight(px(c, 48));
    return b;
  }
}
