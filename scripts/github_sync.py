r"""
BLOCK B LQP - ZERO-GIT 2-WAY PC <-> GITHUB SYNCHRONIZER
Uses ONLY Python built-in libraries (urllib, base64, json) — NO git.exe needed!
Keeps your local E:\...\Data_MC\MC-Dashboard folder synchronized with GitHub repo
huynhphathuy-mech/LQP-MC-Dashboard.

Usage:
  python scripts/github_sync.py pull          # Pull latest data & web files from GitHub to PC
  python scripts/github_sync.py push          # Push local web/data changes from PC to GitHub
  python scripts/github_sync.py push-all      # Push ALL web code, workflows & data to GitHub (first deploy)
  python scripts/github_sync.py setup-task    # Create Windows Task Scheduler auto-pull job (every 3h + on logon)
"""

import os
import sys
import json
import base64
import hashlib
import argparse
import subprocess
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone, timedelta

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

VN_TZ = timezone(timedelta(hours=7))
MC_DIR = Path(__file__).resolve().parent.parent

DATA_SYNC_FILES = [
    "data.json",
    "data.js",
    "manual_data.json",
    "manual_data.js",
    "sync_meta.json",
]

ALL_DEPLOY_FILES = [
    "index.html",
    "app.js",
    "style.css",
    "enhancements.css",
    "enhancements.js",
    "sync_data.py",
    "UPDATE_DATA.bat",
    "SYNC_FROM_GITHUB.bat",
    "PUSH_TO_GITHUB.bat",
    "requirements.txt",
    ".gitignore",
    ".env.example",
    "master_equipments.json",
    "scripts/build_dashboard_data.py",
    "scripts/pms_auto_download.py",
    "scripts/github_sync.py",
    ".github/workflows/auto-sync.yml",
    "data.json",
    "data.js",
    "manual_data.json",
    "manual_data.js",
    "sync_meta.json",
]


def load_env():
    for candidate in (MC_DIR / ".env", MC_DIR / ".env.txt"):
        if not candidate.exists():
            continue
        for line in candidate.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip().lstrip("\ufeff")
            v = v.strip().strip('"').strip("'")
            if k and v and k not in os.environ:
                os.environ[k] = v
        break


def get_config():
    load_env()
    return {
        "owner": os.environ.get("GITHUB_OWNER", "huynhphathuy-mech").strip(),
        "repo": os.environ.get("GITHUB_REPO", "LQP-MC-Dashboard").strip(),
        "branch": os.environ.get("GITHUB_BRANCH", "main").strip(),
        "token": os.environ.get("GITHUB_TOKEN", "").strip(),
    }


def gh_request(url, token="", method="GET", payload=None):
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "LQP-MC-Dashboard-Sync",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def git_blob_sha(content_bytes):
    header = f"blob {len(content_bytes)}\0".encode("utf-8")
    return hashlib.sha1(header + content_bytes).hexdigest()


def pull_from_github(files=None):
    cfg = get_config()
    target_files = files or DATA_SYNC_FILES
    print(f"==> Pulling latest files from github.com/{cfg['owner']}/{cfg['repo']} ({cfg['branch']})...")

    updated = 0
    for rel_path in target_files:
        raw_url = f"https://raw.githubusercontent.com/{cfg['owner']}/{cfg['repo']}/{cfg['branch']}/{rel_path}"
        headers = {"User-Agent": "LQP-MC-Dashboard-Sync", "Cache-Control": "no-cache"}
        if cfg["token"]:
            headers["Authorization"] = f"Bearer {cfg['token']}"
        req = urllib.request.Request(raw_url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                content = resp.read()
            local_path = MC_DIR / rel_path
            local_path.parent.mkdir(parents=True, exist_ok=True)
            if local_path.exists() and local_path.read_bytes() == content:
                print(f"  [=] Up to date: {rel_path}")
                continue
            local_path.write_bytes(content)
            print(f"  [↓] Updated   : {rel_path} ({len(content)/1024:,.1f} KB)")
            updated += 1
        except urllib.error.HTTPError as e:
            if e.code == 404:
                print(f"  [-] Not on GitHub yet: {rel_path}")
            else:
                print(f"  [!] Failed {rel_path}: HTTP {e.code}")
        except Exception as e:
            print(f"  [!] Failed {rel_path}: {e}")

    print(f"[DONE] Pull complete ({updated} file(s) updated locally).")


def push_file_to_github(cfg, rel_path, commit_msg):
    local_path = MC_DIR / rel_path
    if not local_path.exists():
        print(f"  [-] Skip missing: {rel_path}")
        return False

    content_bytes = local_path.read_bytes()
    local_sha = git_blob_sha(content_bytes)
    api_url = f"https://api.github.com/repos/{cfg['owner']}/{cfg['repo']}/contents/{rel_path}"

    remote_sha = None
    try:
        info = gh_request(f"{api_url}?ref={cfg['branch']}", token=cfg["token"])
        remote_sha = info.get("sha")
        if remote_sha == local_sha:
            print(f"  [=] Unchanged : {rel_path}")
            return False
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise

    payload = {
        "message": commit_msg,
        "content": base64.b64encode(content_bytes).decode("ascii"),
        "branch": cfg["branch"],
    }
    if remote_sha:
        payload["sha"] = remote_sha

    gh_request(api_url, token=cfg["token"], method="PUT", payload=payload)
    print(f"  [↑] Uploaded  : {rel_path} ({len(content_bytes)/1024:,.1f} KB)")
    return True


def push_to_github(files, label="Manual PC Sync"):
    cfg = get_config()
    tok = cfg["token"]
    if not tok or tok.startswith("dan_chuoi_token") or tok.startswith("github_pat_xxxx"):
        print("[ERROR] Chua doc duoc GITHUB_TOKEN hop le trong file MC-Dashboard\\.env!")
        print("        Kiem tra lai file .env: dam bao dong GITHUB_TOKEN=ghp_... (hoac github_pat_...) khong co dau # o dau va da bam Ctrl+S luu lai.")
        sys.exit(1)

    now_str = datetime.now(VN_TZ).strftime("%Y-%m-%d %H:%M VN")
    print(f"==> Pushing {len(files)} file(s) to github.com/{cfg['owner']}/{cfg['repo']} ({cfg['branch']})...")
    uploaded = 0
    for rel_path in files:
        try:
            if push_file_to_github(cfg, rel_path, f"{label}: update {rel_path} ({now_str})"):
                uploaded += 1
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            print(f"  [!] Error uploading {rel_path}: HTTP {e.code} - {body[:200]}")
        except Exception as e:
            print(f"  [!] Error uploading {rel_path}: {e}")
    print(f"[DONE] Push complete ({uploaded} file(s) updated on GitHub).")


def setup_windows_task():
    script_path = str(MC_DIR / "scripts" / "github_sync.py")
    py_exe = sys.executable
    task_name = "LQP_MC_Dashboard_AutoSync_Pull"
    cmd = [
        "schtasks", "/Create", "/F",
        "/TN", task_name,
        "/SC", "HOURLY", "/MO", "3",
        "/TR", f'"{py_exe}" "{script_path}" pull'
    ]
    print(f"==> Creating Windows Task Scheduler job '{task_name}' (every 3 hours)...")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        print("[SUCCESS] Scheduled task created! Your PC will auto-pull latest GitHub data every 3 hours.")
    else:
        print(f"[WARN] Could not create scheduled task: {res.stderr.strip() or res.stdout.strip()}")
        print("       You can also run SYNC_FROM_GITHUB.bat anytime with 1 click.")


def main():
    parser = argparse.ArgumentParser(description="Zero-Git 2-Way Sync between PC and GitHub Pages")
    parser.add_argument("action", choices=["pull", "push", "push-all", "setup-task"], help="Sync action")
    args = parser.parse_args()

    if args.action == "pull":
        pull_from_github(DATA_SYNC_FILES)
    elif args.action == "push":
        push_to_github(DATA_SYNC_FILES, label="Data Sync")
    elif args.action == "push-all":
        push_to_github(ALL_DEPLOY_FILES, label="Deploy MC-Dashboard Upgrade")
    elif args.action == "setup-task":
        setup_windows_task()


if __name__ == "__main__":
    main()
