from pathlib import Path
import sys, zipfile

root = Path(__file__).parent
with zipfile.ZipFile(sys.argv[1]) as apk:
    assert (
        apk.read("assets/pdf-font.bin")
        == (root / "assets/fonts/DejaVuSans.ttf").read_bytes()
    ), "PDF font missing or changed in APK"
    assert (
        apk.getinfo("assets/pdf-font.bin").compress_type == zipfile.ZIP_STORED
    ), "PDF font must be uncompressed"
    assert not any(
        name.startswith("assets/default-menu/") or name == "assets/fonts/DejaVuSans.ttf"
        for name in apk.namelist()
    ), "Source images or duplicate font packaged"
    for name in ["assets/index.html", "assets/default-menu.json", "classes.dex"]:
        assert len(apk.read(name)) > 100
print("PASS: packaged PDF font, UI, menu and executable verified")
