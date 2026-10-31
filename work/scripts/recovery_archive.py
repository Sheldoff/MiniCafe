"""Encrypted offline recovery. Never prints keys or stores a key inside its archive."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import zipfile
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

HEADER = b"MINICAFE-RECOVERY-AES256GCM-V1\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["pack", "unpack"])
    parser.add_argument("--folder", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--key-file", type=Path, required=True)
    args = parser.parse_args()
    folder = args.folder.resolve()
    key_path = args.key_file.resolve()
    if key_path.is_relative_to(folder) or args.archive.resolve().is_relative_to(folder):
        raise ValueError("Keep archive and recovery key outside the payload folder")
    if args.mode == "pack" and not key_path.exists():
        key_path.parent.mkdir(parents=True, exist_ok=True)
        key_path.write_text(json.dumps({"format": "minicafe-recovery-key-1", "key": base64.b64encode(AESGCM.generate_key(256)).decode()}, indent=2), encoding="utf-8")
    key = base64.b64decode(json.loads(key_path.read_text(encoding="utf-8"))["key"], validate=True)
    if len(key) != 32:
        raise ValueError("Invalid recovery key")
    if args.mode == "pack":
        files = sorted(p for p in folder.rglob("*") if p.is_file())
        manifest = {str(p.relative_to(folder)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
        if "RECOVERY-MANIFEST.json" in manifest:
            raise ValueError("Reserved manifest name")
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
            for p in files:
                archive.write(p, p.relative_to(folder).as_posix())
            archive.writestr("RECOVERY-MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        nonce = os.urandom(12)
        encrypted = HEADER + nonce + AESGCM(key).encrypt(nonce, stream.getvalue(), HEADER)
        args.archive.parent.mkdir(parents=True, exist_ok=True)
        args.archive.write_bytes(encrypted)
        print(f"Encrypted {len(files)} files; recovery key remains separate.")
    else:
        if folder.exists() and any(folder.iterdir()):
            raise ValueError("Restore into an empty folder")
        raw = args.archive.read_bytes()
        if not raw.startswith(HEADER):
            raise ValueError("Unsupported archive")
        start = len(HEADER)
        plain = AESGCM(key).decrypt(raw[start:start+12], raw[start+12:], HEADER)
        with zipfile.ZipFile(io.BytesIO(plain)) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise ValueError("Duplicate archive entries")
            manifest = json.loads(archive.read("RECOVERY-MANIFEST.json"))
            if set(names) != set(manifest) | {"RECOVERY-MANIFEST.json"}:
                raise ValueError("Manifest mismatch")
            for name, expected in manifest.items():
                target = (folder / name).resolve()
                if not target.is_relative_to(folder):
                    raise ValueError("Unsafe archive path")
                if hashlib.sha256(archive.read(name)).hexdigest() != expected:
                    raise ValueError("Integrity check failed")
            folder.mkdir(parents=True, exist_ok=True)
            for name in names:
                target = (folder / name).resolve()
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(name))
        print(f"Restored and verified {len(manifest)} files. Treat the folder as private.")


if __name__ == "__main__":
    main()
