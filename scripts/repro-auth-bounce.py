"""
Reproduce the 'Become a barber bounces to signin' bug.

Logs every response the browser makes + every navigation + cookie state,
so we can see exactly where the session is lost.

Run: py scripts/repro-auth-bounce.py
"""

import io
import sys
import time

# Force UTF-8 stdout so emoji don't crash on Windows cp1252 terminals.
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from playwright.sync_api import sync_playwright

BASE_URL = "https://dbu-poc.vercel.app"
PASSWORD = "test-password-123"


def log_cookies(ctx, label):
    cookies = ctx.cookies(BASE_URL)
    auth_cookies = [c for c in cookies if "authjs" in c.get("name", "").lower()]
    print(f"  [cookies @ {label}] total={len(cookies)} authjs={len(auth_cookies)}")
    for c in auth_cookies:
        v = c.get("value", "")
        print(
            f"    - {c['name']} len={len(v)} "
            f"domain={c.get('domain')} path={c.get('path')} "
            f"secure={c.get('secure')} sameSite={c.get('sameSite')}"
        )


def main():
    email = f"playwright-{int(time.time())}@example.com"

    import os
    headless = os.environ.get("HEADLESS", "1") != "0"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless, slow_mo=0 if headless else 500)
        ctx = browser.new_context()
        page = ctx.new_page()

        # Log *every* response
        def on_resp(r):
            url = r.url
            if BASE_URL in url:
                short = url.replace(BASE_URL, "") or "/"
                nxt_action = r.request.headers.get("next-action", "")
                tag = f"  [action]" if nxt_action else ""
                print(f"  [net] {r.request.method} {short} -> {r.status}{tag}")

        def on_frame_nav(frame):
            if frame == page.main_frame:
                print(f"  [nav] frame url -> {frame.url}")

        page.on("response", on_resp)
        page.on("framenavigated", on_frame_nav)

        # ── signup ─────────────────────────────────────────────────────────
        print(f"\n== step 1: signup as {email} ==")
        page.goto(f"{BASE_URL}/signup", wait_until="networkidle")
        page.fill('input[name="name"]', "Playwright Test")
        page.fill('input[name="email"]', email)
        page.fill('input[name="password"]', PASSWORD)

        with page.expect_navigation(wait_until="networkidle", timeout=20_000):
            page.click('button[type="submit"]')
        print(f"  final url: {page.url}")
        log_cookies(ctx, "after signup")

        if "/signup" in page.url:
            # Find any red error banner
            err = page.locator(".text-red-700, .text-red-300").first
            if err.count() > 0:
                print(f"  error shown: {err.inner_text()}")
            print("  SIGNUP DID NOT LAND ON /  — aborting")
            browser.close()
            sys.exit(1)

        # ── verify logged in ───────────────────────────────────────────────
        print("\n== step 2: logged-in home ==")
        body = page.locator("body").inner_text()
        logged = "Become a barber" in body
        print(f"  'Become a barber' button visible: {logged}")
        if not logged:
            print(f"  body preview:\n  {body[:400]}")
            browser.close()
            sys.exit(1)

        # ── click Become a barber ──────────────────────────────────────────
        print("\n== step 3: click Become a barber ==")
        with page.expect_navigation(wait_until="networkidle", timeout=20_000):
            page.click('button:has-text("Become a barber")')
        final = page.url.replace(BASE_URL, "") or "/"
        print(f"  final url: {final}")
        log_cookies(ctx, "after click")

        if final.startswith("/signin"):
            print("\n❌ REPRODUCED: URL redirected to /signin")
            browser.close()
            sys.exit(2)
        if final.startswith("/barber"):
            page_body = page.locator("body").inner_text()
            has_signin_ui = "Sign in" in page_body and "Welcome back" in page_body
            has_barber_ui = "Public booking link" in page_body or "TODAY" in page_body
            print(f"  page content has signin UI: {has_signin_ui}")
            print(f"  page content has barber dashboard: {has_barber_ui}")
            if has_signin_ui and not has_barber_ui:
                print("\n❌ REPRODUCED: URL is /barber but content is the signin form")
                print("   (NextAuth middleware is *rewriting* to signin — JWT still has stale role)")
                browser.close()
                sys.exit(2)
            print("\n✅ WORKED: barber dashboard rendered at /barber")
            browser.close()
            sys.exit(0)
        print(f"\n? unexpected url: {final}")
        browser.close()
        sys.exit(3)


if __name__ == "__main__":
    main()
