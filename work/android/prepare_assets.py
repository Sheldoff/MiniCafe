import json, base64, hashlib
from pathlib import Path

root = Path(__file__).parent
import shutil

font = root / "assets/fonts/DejaVuSans.ttf"
assert font.exists() and font.stat().st_size > 100000, "Missing PDF font"
shutil.copyfile(font, root / "assets/pdf-font.bin")
# Reject encoding damage before packaging a release.
import xml.etree.ElementTree as ET

assert (
    ET.parse(root / "res/values/strings.xml").find("string[@name='app_name']").text
    == "МініКафе"
), "Invalid UTF-8 application name"

# Human-editable manifest and bundled photos are the source of truth for every build.
base = root / "assets/default-menu"
if (base / "menu.json").exists():
    entries = json.loads((base / "menu.json").read_text(encoding="utf-8"))["items"]
    products = []
    for item in entries:
        raw = (base / item["image"]).read_bytes()
        products.append(
            dict(
                name=item["name"],
                category="Напої",
                price=item["price"],
                route="bar",
                active=1,
                image=base64.b64encode(raw).decode(),
                image_version=hashlib.sha256(raw).hexdigest()[:16],
            )
        )
    (root / "assets/default-menu.json").write_text(
        json.dumps(products, ensure_ascii=False), encoding="utf-8"
    )
import sys

sys.path.insert(0, str(root.parent / "cafe"))
from frontend_build import build_html

html = build_html()
(root / "assets/index.html").write_text(html, encoding="utf-8")
# Runtime uses the encoded menu, not source originals/duplicate JPEGs or duplicate font.
package = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "build/packaged-assets"
package.mkdir(parents=True, exist_ok=True)
for name in ["index.html", "default-menu.json", "pdf-font.bin"]:
    shutil.copyfile(root / "assets" / name, package / name)
shutil.copyfile(
    root / "assets/fonts/LICENSE-DejaVu.txt", package / "LICENSE-DejaVu.txt"
)
