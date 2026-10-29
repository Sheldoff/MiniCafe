"""MiniCafe desktop entry point. UI and API are shared with the Android release."""

import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import time
import webbrowser
from desktop_engine import DesktopEngine


def addresses():
    found = {"127.0.0.1"}
    try:
        found.update(socket.gethostbyname_ex(socket.gethostname())[2])
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 80))
            found.add(probe.getsockname()[0])
    except OSError:
        pass
    return sorted(ip for ip in found if ":" not in ip)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "MiniCafe",
    )
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--key")
    args = parser.parse_args()
    args.data_dir.mkdir(parents=True, exist_ok=True)
    token_file = args.data_dir / "access.txt"
    if not token_file.exists():
        token_file.write_text(secrets.token_urlsafe(24), encoding="utf-8")
    key = args.key or token_file.read_text(encoding="utf-8").strip()
    engine = DesktopEngine(args.data_dir, key, args.port)
    if args.headless:
        try:
            engine.start()
            if args.self_test:
                assert engine.request("state")["products"]
                return
            print(f"READY {args.port}", flush=True)
            while engine.process.poll() is None:
                time.sleep(0.5)
        except KeyboardInterrupt:
            pass
        finally:
            engine.stop()
        return
    import tkinter as tk
    from tkinter import ttk, messagebox, filedialog
    import qrcode
    from PIL import ImageTk

    window = tk.Tk()
    window.title("МініКафе — сервер 3.36")
    window.geometry("650x780")
    if args.self_test:
        window.withdraw()
    window.configure(bg="#f4f3ed")
    try:
        engine.start()
    except Exception as error:
        engine.stop()
        if args.self_test:
            raise
        messagebox.showerror("Не вдалося запустити сервер", str(error))
        window.destroy()
        return
    base = f"http://127.0.0.1:{args.port}/?key={key}"
    tk.Label(
        window, text="☕ МініКафе", font=("Segoe UI", 25), bg="#f4f3ed", fg="#173f35"
    ).pack(pady=18)
    tk.Label(
        window, text="Сервер працює. Залишайте це вікно відкритим.", bg="#f4f3ed"
    ).pack()
    tk.Button(
        window,
        text="Почати роботу",
        bg="#215943",
        fg="white",
        font=("Segoe UI", 14),
        command=lambda: webbrowser.open(base + "#cash"),
    ).pack(fill="x", padx=30, pady=15)
    chosen_ip = tk.StringVar(
        value=next((ip for ip in addresses() if ip != "127.0.0.1"), "127.0.0.1")
    )
    chosen_role = tk.StringVar(value="Видача")
    ttk.Combobox(
        window, textvariable=chosen_ip, values=addresses(), state="readonly"
    ).pack(pady=5)
    role_names = {
        "Повний доступ": "admin",
        "Видача": "service",
        "Тільки каса": "cash",
        "Тільки бариста": "bar",
        "Тільки видача їжі": "delivery",
    }
    ttk.Combobox(
        window, textvariable=chosen_role, values=list(role_names), state="readonly"
    ).pack(pady=5)
    qr = tk.Label(window, bg="#f4f3ed")
    qr.pack(pady=10)
    link = tk.StringVar()
    tk.Entry(window, textvariable=link, state="readonly").pack(fill="x", padx=30)

    def update(*_):
        role = role_names[chosen_role.get()]
        access_key = key if role == "admin" else engine.request("access")[role]
        route = "cash" if role in ["admin", "service"] else role
        link.set(f"http://{chosen_ip.get()}:{args.port}/?key={access_key}#{route}")
        image = ImageTk.PhotoImage(qrcode.make(link.get()).resize((245, 245)))
        qr.configure(image=image)
        qr.image = image

    def copy_link():
        window.clipboard_clear()
        window.clipboard_append(link.get())

    def save_backup():
        path = filedialog.asksaveasfilename(
            defaultextension=".json", initialfile="MiniCafe-backup.json"
        )
        if path:
            try:
                Path(path).write_text(
                    json.dumps(engine.request("backup"), ensure_ascii=False),
                    encoding="utf-8",
                )
                messagebox.showinfo("МініКафе", "Резервну копію збережено")
            except Exception as error:
                messagebox.showerror("Помилка", str(error))

    def restore_backup():
        path = filedialog.askopenfilename(filetypes=[("Резервна копія", "*.json")])
        if path and messagebox.askyesno(
            "Відновити?", "Поточні меню й замовлення буде замінено. Продовжити?"
        ):
            try:
                engine.request(
                    "restore", json.loads(Path(path).read_text(encoding="utf-8-sig"))
                )
                messagebox.showinfo(
                    "МініКафе", "Відновлено. Оновіть касу та інші пристрої."
                )
            except Exception as error:
                messagebox.showerror("Помилка", str(error))

    def revoke():
        if messagebox.askyesno(
            "Відкликати доступ?",
            "Посилання персоналу перестануть працювати. Доступ власника залишиться.",
        ):
            engine.request("access/rotate", {})
            update()

    tk.Button(window, text="Скопіювати посилання", command=copy_link).pack(pady=10)
    tk.Button(window, text="Відкликати посилання персоналу", command=revoke).pack(
        pady=5
    )
    tk.Button(window, text="Зберегти резервну копію", command=save_backup).pack(pady=5)
    tk.Button(window, text="Відновити резервну копію", command=restore_backup).pack(
        pady=5
    )
    chosen_ip.trace_add("write", update)
    chosen_role.trace_add("write", update)
    update()
    window.protocol("WM_DELETE_WINDOW", lambda: (engine.stop(), window.destroy()))
    if args.self_test:
        window.after(500, window.destroy)
    try:
        window.mainloop()
    finally:
        engine.stop()
    if args.self_test:
        print("PASS desktop Tk interface, QR and role controls", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        if "--self-test" not in sys.argv:
            raise
        import traceback
        import tempfile

        Path(tempfile.gettempdir(), "MiniCafe-self-test-error.log").write_text(
            traceback.format_exc(), encoding="utf-8"
        )
        sys.exit(1)
