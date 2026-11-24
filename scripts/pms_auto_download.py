"""
BLOCK B LQP - PTSC PMS AUTOMATED EXCEL DOWNLOADER
Automatically logs into https://pms-web.ptscmc.com.vn/ (Blazor WebAssembly),
selects FacilityCode = LQ MODULE & LQ UTILITY, and downloads all 4 official reports:
  1. BB_PREC_ChecksheetOverview_Report.xlsx
  2. BB_PREC_CertificateOverview_Report.xlsx
  3. BB_PREC_PunchlistOverview_Report.xlsx
  4. BB_PREC_FTP_Overview_Report.xlsx

Credentials are read ONLY from environment variables (GitHub Secrets) or local .env file.
"""

import os
import sys
import time
import zipfile
import argparse
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

PMS_BASE_URL = "https://pms-web.ptscmc.com.vn"
TARGET_FACILITIES = ["LQ MODULE", "LQ UTILITY"]

REPORTS = [
    {
        "key": "checksheet",
        "menu_text": "Checksheet Overview",
        "url_path": "/PREC_ITR_Checksheet_Overview_Viewer",
        "filename": "BB_PREC_ChecksheetOverview_Report.xlsx",
    },
    {
        "key": "certificate",
        "menu_text": "Certificate Overview",
        "url_path": "/PREC_Certificate_Overview_Viewer",
        "filename": "BB_PREC_CertificateOverview_Report.xlsx",
    },
    {
        "key": "punchlist",
        "menu_text": "Punchlist Overview",
        "url_path": "/PREC_Punchlist_Overview_Viewer",
        "filename": "BB_PREC_PunchlistOverview_Report.xlsx",
    },
    {
        "key": "ftp",
        "menu_text": "FTP Overview",
        "url_path": "/PREC_FTP_Overview_Viewer",
        "filename": "BB_PREC_FTP_Overview_Report.xlsx",
    },
]


def load_local_env(mc_dir):
    env_path = Path(mc_dir) / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def save_debug(page, debug_dir, tag):
    try:
        os.makedirs(debug_dir, exist_ok=True)
        page.screenshot(path=os.path.join(debug_dir, f"{tag}.png"), full_page=True)
    except Exception:
        pass


def wait_blazor_ready(page, timeout_ms=45000):
    """Waits for Blazor WASM loader to disappear."""
    try:
        page.wait_for_selector(".progress-app", state="detached", timeout=timeout_ms)
    except Exception:
        pass
    page.wait_for_timeout(1500)


def login_pms(page, username, password, debug_dir):
    print(f"-> Opening {PMS_BASE_URL} ...")
    page.goto(f"{PMS_BASE_URL}/PREC_ITR_Checksheet_Overview_Viewer", wait_until="domcontentloaded", timeout=60000)
    wait_blazor_ready(page)

    # Check if already logged in (sidebar View menu visible)
    if page.locator("text=Checksheet Overview").count() > 0 and page.locator("input[type='password']").count() == 0:
        print("-> Already authenticated in browser session.")
        return

    print("-> Login form detected. Signing in...")
    # Wait for password input
    pw_input = page.locator("input[type='password']").first
    pw_input.wait_for(state="visible", timeout=30000)

    # Find username input (text/email input before password)
    user_candidates = [
        "input[name*='user' i]",
        "input[id*='user' i]",
        "input[placeholder*='user' i]",
        "input[placeholder*='account' i]",
        "input[type='email']",
        "input[type='text']",
    ]
    user_input = None
    for sel in user_candidates:
        loc = page.locator(sel).first
        if loc.count() > 0 and loc.is_visible():
            user_input = loc
            break
    if user_input is None:
        save_debug(page, debug_dir, "01_login_no_user_input")
        raise RuntimeError("Could not locate username input on PTSC PMS login page.")

    user_input.fill(username)
    pw_input.fill(password)

    # Click Login / Sign in button
    login_btn = page.locator("button:has-text('Login'), button:has-text('Sign in'), button:has-text('Sign In'), button[type='submit']").first
    if login_btn.count() > 0:
        login_btn.click()
    else:
        pw_input.press("Enter")

    # Wait until login completes and sidebar / dashboard loads
    try:
        page.wait_for_selector("text=Checksheet Overview", timeout=45000)
    except Exception:
        # Maybe needs to expand 'View' menu first
        view_menu = page.locator("text=View").first
        if view_menu.count() > 0 and view_menu.is_visible():
            view_menu.click()
            page.wait_for_timeout(1000)
        if page.locator("text=Checksheet Overview").count() == 0:
            save_debug(page, debug_dir, "02_login_failed")
            raise RuntimeError("Login to PTSC PMS did not reach main portal. Check credentials or screenshot in scripts/debug_logs.")
    print("-> Logged in to PTSC PMS successfully!")


def select_lq_facilities(page, debug_dir, report_key):
    """Opens FacilityCode modal, selects LQ MODULE & LQ UTILITY, clicks SELECT."""
    # Look for the '...' picker button near FacilityCode label
    opened = False
    try:
        # Strategy 1: Parent container containing FacilityCode text with a button/span '...'
        fac_row = page.locator("div, td, label").filter(has_text="FacilityCode").locator("xpath=ancestor::div[1]")
        dots = fac_row.locator("button, a, span, i").filter(has_text="...").first
        if dots.count() > 0 and dots.is_visible():
            dots.click()
            opened = True
    except Exception:
        pass

    if not opened:
        # Strategy 2: Click first '...' button on filter panel (FacilityCode is top-left in PMS)
        dots_all = page.locator("button:has-text('...'), span:has-text('...'), a:has-text('...')")
        if dots_all.count() > 0:
            dots_all.first.click()
            opened = True

    if not opened:
        # Strategy 3: Click FacilityCode input directly
        inp = page.locator("input[placeholder*='Facility' i], input[aria-label*='Facility' i]").first
        if inp.count() > 0:
            inp.click()
            opened = True

    page.wait_for_timeout(1200)

    # Wait for FacilityCode popup modal
    modal_search = page.locator("div.modal input[type='text'], div[role='dialog'] input[type='text'], input[placeholder*='Search' i]").first
    for fac in TARGET_FACILITIES:
        # Search for facility if search box exists inside modal
        if modal_search.count() > 0 and modal_search.is_visible():
            modal_search.fill("")
            page.wait_for_timeout(200)
            modal_search.fill(fac)
            page.wait_for_timeout(600)

        # Find row matching exact facility name and click its checkbox
        row = page.locator("tr, div[role='row'], li").filter(has_text=fac).first
        if row.count() == 0:
            save_debug(page, debug_dir, f"{report_key}_missing_{fac.replace(' ', '_')}")
            raise RuntimeError(f"Could not find facility '{fac}' in FacilityCode modal for {report_key}")

        cb = row.locator("input[type='checkbox']").first
        if cb.count() > 0:
            if not cb.is_checked():
                cb.check(force=True)
        else:
            row.click()
        page.wait_for_timeout(300)

    # Clear search just in case, then click SELECT
    select_btn = page.locator("button:has-text('SELECT'), button:has-text('Select'), button:has-text('OK')").first
    select_btn.wait_for(state="visible", timeout=10000)
    select_btn.click()
    page.wait_for_timeout(800)


def download_single_report(page, report, output_dir, debug_dir):
    key = report["key"]
    menu_text = report["menu_text"]
    out_path = os.path.join(output_dir, report["filename"])
    print(f"\n==> Downloading [{menu_text}] -> {report['filename']}")

    # Navigate via sidebar menu click (most reliable in Blazor SPA)
    menu_link = page.locator(f"a:has-text('{menu_text}'), span:has-text('{menu_text}'), li:has-text('{menu_text}')").first
    if menu_link.count() > 0 and menu_link.is_visible():
        menu_link.click()
    else:
        # Try expanding 'View' sidebar group first
        view_toggle = page.locator("a:has-text('View'), span:has-text('View')").first
        if view_toggle.count() > 0 and view_toggle.is_visible():
            view_toggle.click()
            page.wait_for_timeout(600)
        if menu_link.count() > 0 and menu_link.is_visible():
            menu_link.click()
        else:
            page.goto(f"{PMS_BASE_URL}{report['url_path']}", wait_until="domcontentloaded", timeout=45000)
            wait_blazor_ready(page)

    page.wait_for_timeout(2000)

    # Select LQ MODULE & LQ UTILITY
    select_lq_facilities(page, debug_dir, key)

    # Click Load Data
    load_btn = page.locator("button:has-text('Load Data'), button:has-text('Load'), button:has-text('Search')").first
    load_btn.wait_for(state="visible", timeout=15000)
    load_btn.click()
    print("    Loading data from PMS...")

    # Wait for loading spinner/overlay to finish
    page.wait_for_timeout(2500)
    for spinner_sel in (".loading", ".spinner", ".progress", ".b-loading", ".mud-progress-linear"):
        try:
            if page.locator(spinner_sel).first.is_visible():
                page.wait_for_selector(spinner_sel, state="hidden", timeout=90000)
        except Exception:
            pass
    page.wait_for_timeout(2000)

    # Trigger Excel Export and capture download
    export_selectors = [
        "button:has-text('Export Excel')",
        "button:has-text('Excel')",
        "button:has-text('Export')",
        "a:has-text('Export Excel')",
        "a:has-text('Excel')",
        "button[title*='Excel' i]",
        "button[title*='Export' i]",
        "i.fa-file-excel",
        ".fa-file-excel",
    ]
    export_btn = None
    for sel in export_selectors:
        loc = page.locator(sel).first
        if loc.count() > 0 and loc.is_visible():
            export_btn = loc
            break

    if export_btn is None:
        save_debug(page, debug_dir, f"{key}_no_export_btn")
        raise RuntimeError(f"Could not find Export Excel button on {menu_text}")

    with page.expect_download(timeout=120000) as dl_info:
        export_btn.click()
        # Handle dropdown export menu if Export button opens a sub-menu ('Excel')
        page.wait_for_timeout(800)
        sub_excel = page.locator("li:has-text('Excel'), a:has-text('Excel'), button:has-text('Export to Excel')").first
        try:
            if sub_excel.count() > 0 and sub_excel.is_visible() and sub_excel != export_btn:
                sub_excel.click()
        except Exception:
            pass

    download = dl_info.value
    os.makedirs(output_dir, exist_ok=True)
    tmp_path = out_path + ".tmp"
    download.save_as(tmp_path)

    # Validate xlsx is a valid zip archive and non-empty
    if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) < 1024 or not zipfile.is_zipfile(tmp_path):
        save_debug(page, debug_dir, f"{key}_invalid_xlsx")
        raise RuntimeError(f"Downloaded file for {menu_text} is invalid or empty.")

    os.replace(tmp_path, out_path)
    size_kb = os.path.getsize(out_path) / 1024
    print(f"    [OK] Saved {report['filename']} ({size_kb:,.1f} KB)")


def run_download(output_dir, headed=False):
    mc_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    load_local_env(mc_dir)
    debug_dir = os.path.join(os.path.dirname(__file__), 'debug_logs')

    username = os.environ.get("PMS_USERNAME", "").strip()
    password = os.environ.get("PMS_PASSWORD", "").strip()
    if not username or not password:
        print("[ERROR] Missing PMS_USERNAME or PMS_PASSWORD.")
        print("        Please set them in MC-Dashboard/.env (local) or GitHub Repository Secrets (cloud).")
        sys.exit(1)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[ERROR] Playwright is not installed. Install with:")
        print("        pip install playwright openpyxl && playwright install chromium")
        sys.exit(1)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed, args=["--no-sandbox"])
        context = browser.new_context(
            accept_downloads=True,
            viewport={"width": 1440, "height": 900},
            locale="en-US",
        )
        page = context.new_page()
        try:
            login_pms(page, username, password, debug_dir)
            for rep in REPORTS:
                download_single_report(page, rep, output_dir, debug_dir)
        except Exception as exc:
            save_debug(page, debug_dir, "fatal_error")
            print(f"[ERROR] PMS download failed: {exc}")
            raise
        finally:
            context.close()
            browser.close()

    print("\n[SUCCESS] All 4 PTSC PMS Excel reports downloaded successfully!")


def main():
    parser = argparse.ArgumentParser(description="Auto-download 4 PTSC PMS Excel reports for LQ MODULE & LQ UTILITY")
    parser.add_argument("--output-dir", default=None, help="Output folder for Excel files (default: parent Data_MC folder)")
    parser.add_argument("--headed", action="store_true", help="Show browser window (for local debugging)")
    args = parser.parse_args()

    mc_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    out_dir = os.path.abspath(args.output_dir) if args.output_dir else os.path.abspath(os.path.join(mc_dir, '..'))
    run_download(out_dir, headed=args.headed)


if __name__ == "__main__":
    main()
