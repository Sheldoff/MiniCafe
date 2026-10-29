"""Package only a fully checked release, excluding secrets, data and build leftovers."""

from pathlib import Path
import argparse
import hashlib
import json
import shutil
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "work"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    manifest = ET.parse(WORK / "android/AndroidManifest.xml").getroot()
    namespace = "{http://schemas.android.com/apk/res/android}"
    assert manifest.get(namespace + "versionName") == args.version
    context = json.loads((ROOT / "PROJECT-CONTEXT.json").read_text(encoding="utf-8"))
    assert context["version"] == args.version, "Update the handoff context version"
    assert str(context["android_version_code"]) == manifest.get(
        namespace + "versionCode"
    )
    results = Path(
        (WORK / "tests/latest-results.txt").read_text(encoding="utf-8").strip()
    )
    summary = json.loads((results / "summary.json").read_text(encoding="utf-8"))
    assert (
        summary["passed"] and summary["full_build"] and summary["ui_engines"]
    ), "Run complete checks before a release"
    out = ROOT / "outputs"
    artifacts = {}
    for suffix in ["apk", "exe"]:
        source = out / f"MiniCafe.{suffix}"
        target = out / f"MiniCafe-{args.version}.{suffix}"
        shutil.copyfile(source, target)
        artifacts[target.name] = hashlib.sha256(target.read_bytes()).hexdigest()
    archive = out / f"MiniCafe-{args.version}-source.zip"
    roots = [
        "work/frontend",
        "work/android/src",
        "work/android/res",
        "work/android/libs",
        "work/android/test-libs",
        "work/android/assets/default-menu",
        "work/android/assets/fonts",
        "work/tests/unit",
        "work/tests/api",
        "work/tests/ui",
        "work/scripts",
    ]
    singles = [
        "README.md",
        "AGENTS.md",
        "COLLABORATION-UA.md",
        ".gitattributes",
        ".github/workflows/source-checks.yml",
        "START-HERE-UA.md",
        "NEXT-CHAT-PROMPT-UA.txt",
        "PROJECT-CONTEXT.json",
        ".gitignore",
        "work/cafe/app.py",
        "work/cafe/desktop_engine.py",
        "work/cafe/frontend_build.py",
        "work/cafe/requirements.txt",
        "work/android/AndroidManifest.xml",
        "work/android/build.ps1",
        "work/android/prepare_assets.py",
        "work/android/verify_apk.py",
        "work/android/signing-cert.sha256",
        "work/android/dependencies.sha256.json",
        "work/android/assets/default-menu.json",
        "work/desktop/DesktopServer.java",
        "work/android/ServerHarness.java",
        "work/tooling/package.json",
        "work/tooling/package-lock.json",
        "work/tooling/google-java-format.jar",
    ]
    paths = {ROOT / p for p in singles}
    for base in roots:
        paths.update(
            p
            for p in (ROOT / base).rglob("*")
            if p.is_file()
            and p.suffix not in [".sqlite3", ".pyc"]
            and not set(p.relative_to(ROOT).parts).intersection(
                {"__pycache__", "node_modules", "dist", "build", "originals"}
            )
        )
    # Images are source assets, not test screenshots.
    paths.update((WORK / "android/assets/default-menu").glob("*"))
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        checksums = {}
        for p in sorted(paths):
            if p.is_file() and p.suffix != ".jks" and p.name != "signing.local.json":
                relative = p.relative_to(ROOT).as_posix()
                content = p.read_bytes()
                z.writestr(relative, content)
                checksums[relative] = hashlib.sha256(content).hexdigest()
        z.writestr("TEST-RESULTS.json", json.dumps(summary, indent=2))
        z.writestr("SOURCE-FILES-SHA256.json", json.dumps(checksums, indent=2))
    shutil.copyfile(archive, out / "MiniCafe-Android-source.zip")
    artifacts[archive.name] = hashlib.sha256(archive.read_bytes()).hexdigest()
    (out / f"MiniCafe-{args.version}-sha256.json").write_text(
        json.dumps(artifacts, indent=2), encoding="utf-8"
    )
    print(
        "RELEASE", json.dumps({name: (out / name).stat().st_size for name in artifacts})
    )


if __name__ == "__main__":
    main()
