from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use iPhone 13 Pro viewport
        context = browser.new_context(viewport={"width": 390, "height": 844})
        page = context.new_page()

        # Load local index.html
        page.goto(f"file://{os.getcwd()}/public/index.html")

        # Screenshot initial state
        page.screenshot(path="verification/initial_structured.png")
        print("Screenshot saved: verification/initial_structured.png")

        # Click Bulk Mode Button
        bulk_btn = page.locator("#bulkModeBtn")
        bulk_btn.click()

        # Wait for transition
        page.wait_for_timeout(500)

        # Screenshot bulk state
        page.screenshot(path="verification/switched_to_bulk.png")
        print("Screenshot saved: verification/switched_to_bulk.png")

        browser.close()

if __name__ == "__main__":
    run()
