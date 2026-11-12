async function contrast(page, scope = "body") {
  return page.evaluate((scope) => {
    const parse = (s) => {
      let n = s.match(/[\d.]+/g)?.map(Number);
      return n && n.length >= 3 ? [n[0], n[1], n[2], n[3] ?? 1] : [0, 0, 0, 0];
    };
    const luminance = (c) =>
      c
        .slice(0, 3)
        .map((v) => {
          let n = v / 255;
          return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        })
        .reduce((v, n, i) => v + n * [0.2126, 0.7152, 0.0722][i], 0);
    const over = (fg, bg) =>
      fg
        .slice(0, 3)
        .map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]))
        .concat(1);
    let problems = [],
      checked = 0;
    for (let element of document.querySelectorAll(scope + " *")) {
      // The drawer blurs/dims the covered page; inspect its controls, not covered text.
      const field = element.matches(
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="file"]),textarea,select',
      );
      if (
        !field &&
        document.body.classList.contains("drawer-open") &&
        !element.closest("#appDrawer")
      )
        continue;
      if (
        ![...element.childNodes].some(
          (n) => n.nodeType === 3 && /[\p{L}\p{N}]/u.test(n.textContent),
        )
      )
        continue;
      let css = getComputedStyle(element),
        rect = element.getBoundingClientRect();
      if (
        !rect.width ||
        !rect.height ||
        css.visibility === "hidden" ||
        element.closest(
          '[aria-hidden="true"],button:disabled,input:disabled,.stats-content-ghost,.cash-swipe-ghost',
        )
      )
        continue;
      let ancestors = [];
      for (let p = element; p; p = p.parentElement) ancestors.push(p);
      if (ancestors.some((p) => Number(getComputedStyle(p).opacity) < 0.99))
        continue;
      let bg = [20, 27, 24, 1];
      for (let p of ancestors.reverse())
        bg = over(parse(getComputedStyle(p).backgroundColor), bg);
      if (element.matches(".cash-switch.indicator-ready button.selected"))
        bg = parse(
          getComputedStyle(document.querySelector(".cash-tab-indicator"))
            .backgroundColor,
        );
      let color =
        field && !element.value && element.placeholder
          ? getComputedStyle(element, "::placeholder").color
          : css.color;
      let fg = over(parse(color), bg),
        a = luminance(fg),
        b = luminance(bg),
        ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        large =
          parseFloat(css.fontSize) >= 24 ||
          (parseFloat(css.fontSize) >= 18.66 && Number(css.fontWeight) >= 700),
        required = large ? 3 : 4.5;
      checked++;
      if (ratio < required - 0.04)
        problems.push({
          tag: element.tagName,
          cls: element.className,
          text: (field
            ? element.value || element.placeholder || ""
            : element.textContent
          )
            .trim()
            .slice(0, 65),
          ratio: Math.round(ratio * 100) / 100,
          fg: color,
          bg,
        });
    }
    return { checked, problems };
  }, scope);
}

module.exports = { contrast };
