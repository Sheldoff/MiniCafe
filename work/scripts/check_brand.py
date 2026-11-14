"""Check CSS color coverage without changing selectors, property names or alpha."""
from pathlib import Path
import sys
import re
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cafe"))
from brand_theme import palette_styles, coffee_color, mono_color, COLORS

sample = "#add:hover{color:white;white-space:nowrap;background:#1234;box-shadow:0 0 3px #173f3580} @keyframes tap{50%{background:#27634f}}"
result = palette_styles(sample)
assert "#add:hover" in result and "white-space:nowrap" in result
assert "color:var(--tone-white,white)" in result
assert "background:var(--tone-1234,#1234)" in result
assert coffee_color("#1234").endswith("44")
assert coffee_color("#173f3580").endswith("80")
assert "background:var(--tone-27634f,#27634f)" in result
for color in ("#173f3580", "#f00", "#1234", "white", "black"):
    mapped = mono_color(color)
    assert mapped[1:3] == mapped[3:5] == mapped[5:7]
assert mono_color("#1234").endswith("44")
assert ":root[data-palette=mono]" in result
root = Path(__file__).resolve().parents[2]
paths = list((root / "work/frontend/css").glob("*.css")) + [root / "apps/online/src" / p for p in ("cloud.css", "guest.css", "auth.css")]
for path in paths:
    if path.name == "coffee.css":
        continue
    css = path.read_text(encoding="utf-8")
    mapped = palette_styles(css)
    source = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for color in COLORS.findall(source):
        # These sources have no hex-only element IDs; every literal color maps.
        assert "--tone-" + color.lower().lstrip("#") + ":" in mapped, (path, color)
print("PASS CSS palette: all source colors/keyframes mapped, exact standard fallbacks, preserved selectors/properties and alpha")
