"""One regression entry point. Never reads or modifies the user's cafe database."""

from pathlib import Path
import argparse
import json
import os
import socket
import subprocess
import sys
import time
import uuid

WORK = Path(__file__).resolve().parents[1]
ROOT = WORK.parent
sys.path[:0] = [str(WORK / "cafe"), str(WORK / "tests/api")]
from frontend_build import build_html
from desktop_engine import DesktopEngine
from contract import contract
from migration import migration_test


def run(command, **kwargs):
    print(
        "CHECK",
        Path(command[0]).name,
        command[3] if len(command) > 3 and str(command[1]) == "-cp" else "",
        flush=True,
    )
    subprocess.run([str(x) for x in command], cwd=ROOT, check=True, **kwargs)


def available_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


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
    run(
        [
            "powershell",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            WORK / "scripts/build_desktop.ps1",
            "-PythonExe",
            sys.executable,
            "-SkipExe",
        ]
    )
    desktop = DesktopEngine(results / "desktop", "desktop-test-key", available_port())
    try:
        desktop.start()
        contract(f"http://127.0.0.1:{desktop.port}", "desktop-test-key")
        bundled = (
            Path(
                (WORK / "desktop/current-dist.txt")
                .read_text(encoding="utf-8-sig")
                .strip()
            )
            / "assets/index.html"
        )
        assert (
            bundled.read_text(encoding="utf-8") == build_html()
        ), "Desktop/Android UI differ"
    finally:
        desktop.stop()
    migration_test(results / "legacy-desktop", available_port())
    run(
        [
            sys.executable,
            WORK / "cafe/app.py",
            "--self-test",
            "--data-dir",
            results / "desktop-ui",
            "--port",
            str(available_port()),
            "--key",
            "ui-test-key",
        ]
    )
    if not args.skip_build:
        run(
            [
                "powershell",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                WORK / "scripts/build_desktop.ps1",
                "-PythonExe",
                sys.executable,
            ]
        )
    if not args.skip_build:
        for mode in ["headless", "window"]:
            command = [
                ROOT / "outputs/MiniCafe.exe",
                "--self-test",
                "--data-dir",
                results / ("exe-" + mode),
                "--port",
                str(available_port()),
                "--key",
                "packaged-test-key",
            ]
            if mode == "headless":
                command.append("--headless")
            run(command, timeout=90)
    summary = {
        "passed": True,
        "unit_suites": len(tests),
        "api_contracts": ["android-core", "desktop"],
        "ui_engines": [] if args.skip_ui else ["Chrome", "WebKit"],
        "legacy_migration": True,
        "full_build": not args.skip_build,
    }
    (results / "summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    (WORK / "tests/latest-results.txt").write_text(str(results), encoding="utf-8")
    print("ALL CHECKS PASSED", results, flush=True)


if __name__ == "__main__":
    main()
