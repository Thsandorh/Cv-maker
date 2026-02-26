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

        print("Page loaded.")

        # Check initial state (Structured Mode Active)
        assert page.is_visible("#structuredSections"), "Structured sections should be visible initially"
        assert not page.is_visible("#bulkSection"), "Bulk section should be hidden initially"
        print("Initial state verified.")

        # Click Bulk Mode Button
        bulk_btn = page.locator("#bulkModeBtn")
        bulk_btn.click()
        print("Clicked Bulk Mode button.")

        # Wait for transition (though inline script is instant, animations take time)
        page.wait_for_timeout(500)

        # Check final state (Bulk Mode Active)
        assert page.is_visible("#bulkSection"), "Bulk section should be visible after click"
        assert not page.is_visible("#structuredSections"), "Structured sections should be hidden after click"
        print("Bulk mode switch verified successfully.")

        # Click back to Structured Mode
        struct_btn = page.locator("#structuredModeBtn")
        struct_btn.click()
        print("Clicked Structured Mode button.")

        page.wait_for_timeout(500)

        assert page.is_visible("#structuredSections"), "Structured sections should be visible again"
        assert not page.is_visible("#bulkSection"), "Bulk section should be hidden again"
        print("Switch back to Structured mode verified successfully.")

        browser.close()

if __name__ == "__main__":
    run()
