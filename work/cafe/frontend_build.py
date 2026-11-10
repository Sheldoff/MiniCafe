"""The single deterministic frontend assembly for Android and desktop."""

from pathlib import Path
import json
import sys
import base64
from brand_theme import palette_styles


def source_root():
    packaged = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    return packaged / "frontend"


def build_html():
    root = source_root()
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    html = (root / "index.template.html").read_text(encoding="utf-8")
    styles = "\n".join(
        (root / name).read_text(encoding="utf-8-sig") for name in manifest["styles"] if name != "css/coffee.css"
    )
    script = "\n".join(
        (root / name).read_text(encoding="utf-8-sig") for name in manifest["scripts"]
    )
    early = (root / "early-errors.js").read_text(encoding="utf-8-sig")
    return (
        html.replace(
            "{{THEME_BOOT}}", (root / "theme-boot.js").read_text(encoding="utf-8-sig")
        )
        .replace("{{STYLES}}", palette_styles(styles) + (root / "css/coffee.css").read_text(encoding="utf-8"))
        .replace("{{SCRIPT}}", script)
        .replace("{{EARLY_ERRORS}}", early)
        .replace("{{BRAND_TOUCH_ICON}}", "data:image/png;base64," + base64.b64encode((root / "assets/brand-512.png").read_bytes()).decode("ascii"))
        .replace("{{BRAND_ICON}}", "data:image/svg+xml;base64," + base64.b64encode((root / "assets/brand.svg").read_bytes()).decode("ascii"))
    )


if __name__ == "__main__":
    target = (
        Path(sys.argv[1])
        if len(sys.argv) > 1
        else source_root() / "dist" / "index.html"
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(build_html(), encoding="utf-8")
