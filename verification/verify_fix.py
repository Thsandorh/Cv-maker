from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Navigating to home page...")
        page.goto("http://localhost:3000")

        # 1. Switch to Bulk Mode
        print("Switching to Bulk Mode...")
        page.click("#bulkModeBtn")

        # Verify Bulk Section is visible
        expect(page.locator("#bulkSection")).to_be_visible()

        # 2. Enter Text
        print("Entering text...")
        page.fill("#bulkData", "Ez egy teszt önéletrajz szöveg. Kovács Béla vagyok, fejlesztő.")

        # 3. Click Generate
        print("Clicking Generate...")
        # We need to handle the potential alert if the API fails (which is likely without a key)
        # OR check for the loading overlay.

        # Setup dialog listener to accept alerts (like "Hiba történt...")
        page.on("dialog", lambda dialog: dialog.accept())

        with page.expect_request("**/api/generate-cv", timeout=5000) as request_info:
            page.click("button[type='submit']")

        print("Request was sent!", request_info.value.url)

        # Check if loading overlay appeared (it might disappear quickly if error is fast)
        # But the fact that a request was sent proves the JS is working!

        # Let's take a screenshot of the state
        time.sleep(1)
        page.screenshot(path="verification/verification_fix.png")
        print("Screenshot saved to verification/verification_fix.png")

        browser.close()

if __name__ == "__main__":
    run()
