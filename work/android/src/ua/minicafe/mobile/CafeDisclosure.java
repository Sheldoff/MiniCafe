package ua.minicafe.mobile;

import android.animation.*;
import android.view.*;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.widget.*;

/** Animate the actual occupied height so siblings move during collapse as well. */
public final class CafeDisclosure {
  private boolean open;
  private ValueAnimator animation;

  public CafeDisclosure(Button toggle, LinearLayout body, String title) {
    body.setVisibility(View.GONE);
    toggle.setText(title + "  ▾");
    toggle.setOnClickListener(
        v -> {
          open = !open;
          int start = body.getVisibility() == View.GONE ? 0 : body.getHeight();
          if (animation != null) animation.cancel();
          int width = ((View) body.getParent()).getWidth();
          View parent = (View) body.getParent();
          width -= parent.getPaddingLeft() + parent.getPaddingRight();
          body.measure(
              View.MeasureSpec.makeMeasureSpec(Math.max(1, width), View.MeasureSpec.EXACTLY),
              View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
          int target = open ? body.getMeasuredHeight() : 0;
          ViewGroup.LayoutParams lp = body.getLayoutParams();
          lp.height = start;
          body.setLayoutParams(lp);
          body.setVisibility(View.VISIBLE);
          toggle.setText(
              open
                  ? "Приховати " + title.toLowerCase(java.util.Locale.ROOT) + "  ▴"
                  : title + "  ▾");
          ValueAnimator next = ValueAnimator.ofInt(start, target);
          animation = next;
          next.setDuration(220);
          next.setInterpolator(new AccelerateDecelerateInterpolator());
          next.addUpdateListener(
              a -> {
                ViewGroup.LayoutParams params = body.getLayoutParams();
                params.height = (Integer) a.getAnimatedValue();
                body.setLayoutParams(params);
              });
          next.addListener(
              new AnimatorListenerAdapter() {
                private boolean cancelled;

                @Override
                public void onAnimationCancel(Animator a) {
                  cancelled = true;
                }

                @Override
                public void onAnimationEnd(Animator a) {
                  if (cancelled || animation != a) return;
                  body.setVisibility(open ? View.VISIBLE : View.GONE);
                  ViewGroup.LayoutParams params = body.getLayoutParams();
                  params.height = ViewGroup.LayoutParams.WRAP_CONTENT;
                  body.setLayoutParams(params);
                  animation = null;
                }
              });
          next.start();
        });
  }
}
