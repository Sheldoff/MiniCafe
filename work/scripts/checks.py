"""Android-local regressions. Windows 3.36 is frozen; user data is never used."""

from pathlib import Path
import argparse
import json
import os
import subprocess
import sys
import time
import uuid

WORK = Path(__file__).resolve().parents[1]
ROOT = WORK.parent
sys.path[:0] = [str(WORK / "cafe"), str(WORK / "tests/api")]
from frontend_build import build_html
from contract import contract


def run(command, **kwargs):
    print(
        "CHECK",
        Path(command[0]).name,
        command[3] if len(command) > 3 and str(command[1]) == "-cp" else "",
        flush=True,
    )
    subprocess.run([str(x) for x in command], cwd=ROOT, check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--skip-ui", action="store_true")
    args = parser.parse_args()
    results = WORK / "tests/results" / uuid.uuid4().hex
    results.mkdir(parents=True)
    jdk = Path(
        os.environ.get("JAVA_HOME")
        or sorted((WORK / "android-tools/jdk").iterdir())[-1]
    )
    java = jdk / "bin/java.exe"
    javac = jdk / "bin/javac.exe"
    (WORK / "android/assets/index.html").write_text(build_html(), encoding="utf-8")
    run(["node", WORK / "scripts/lint_frontend.cjs"])
    run(
        [
            "node",
            WORK / "tooling/node_modules/prettier/bin/prettier.cjs",
            "--check",
            "work/frontend/**/*.js",
            "work/frontend/**/*.css",
            "work/tests/ui/*.cjs",
        ]
    )
    if not args.skip_build:
        run(
            [
                "powershell",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                WORK / "android/build.ps1",
                "-PythonExe",
                sys.executable,
            ]
        )
    classes = results / "classes"
    classes.mkdir()
    core = [
        WORK / "android/src/ua/minicafe/mobile" / f"{name}.java"
        for name in [
            "CafeStore",
            "ImageStore",
            "CafeStats",
            "CafeHttpServer",
            "Codec",
            "CafeLink",
            "PdfFont",
            "PdfReport",
            "AccessControl",
        ]
    ]
    tests = sorted((WORK / "tests/unit/java").glob("*.java"))
    libraries = os.pathsep.join(
        str(p)
        for p in [
            WORK / "android/test-libs/android-json.jar",
            WORK / "android/libs/nanohttpd.jar",
        ]
    )
    run(
        [
            javac,
            "-encoding",
            "UTF-8",
            "--release",
            "8",
            "-cp",
            libraries,
            "-d",
            classes,
            *core,
            *tests,
            WORK / "android/ServerHarness.java",
        ]
    )
    cp = str(classes) + os.pathsep + libraries
    photo = next((WORK / "android/assets/default-menu").glob("*.jpg"))
    for test in tests:
        extra = []
        if test.stem in ["StoreTest", "QueueStorageAccessTest"]:
            extra = [photo]
        if test.stem == "StatsTest":
            extra = [
                WORK / "android/assets/fonts/DejaVuSans.ttf",
                results / "report.pdf",
                results / "long-report.pdf",
            ]
        run([java, "-cp", cp, test.stem, *extra])
    server = subprocess.Popen(
        [
            str(java),
            "-cp",
            cp,
            "ServerHarness",
            str(results / "android.json"),
            str(WORK / "android/assets/index.html"),
        ],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=(results / "server.log").open("wb"),
    )
    try:
        ready = server.stdout.readline()
        assert ready.startswith(b"READY"), ready
        contract("http://127.0.0.1:8768", "phone-test-key")
        if not args.skip_ui:
            env = {
                **os.environ,
                "CAFE_TEST_URL": "http://127.0.0.1:8768",
                "CAFE_TEST_KEY": "phone-test-key",
                "CAFE_SCREENSHOT": str(results / "menu.png"),
            }
            for test in [
                "editor-calculator",
                "cashier",
                "interaction",
                "statistics",
                "optimized",
                "theme",
                "network-motion",
                "tablet",
                "appearances",
                "queue-motion",
                "navigation",
                "cash-swipe",
            ]:
                run(["node", WORK / "tests/ui" / f"{test}.cjs"], env=env)
    finally:
        server.terminate()
        server.wait(timeout=10)
        server.stdout.close()
    summary = {
        "passed": True,
        "unit_suites": len(tests),
        "profile": "local-android",
        "api_contracts": ["android-core"],
        "ui_engines": [] if args.skip_ui else ["Chrome", "WebKit"],
        "legacy_migration": False,
        "desktop_checked": False,
        "build_targets": [] if args.skip_build else ["apk"],
        "full_build": not args.skip_build,
    }
    (results / "summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    (WORK / "tests/latest-results.txt").write_text(str(results), encoding="utf-8")
    print("ALL CHECKS PASSED", results, flush=True)


if __name__ == "__main__":
    main()
