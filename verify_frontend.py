
from playwright.sync_api import sync_playwright
import time

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            page.goto("http://localhost:3000")
            print("Page loaded")

            # Screenshot initial state
            page.screenshot(path="verification_initial.png")
            print("Initial screenshot taken")

            # Check if "Szabad Szöveg" button is visible and clickable
            bulk_btn = page.locator("#bulkModeBtn")
            if bulk_btn.is_visible():
                print("Bulk mode button is visible")
                bulk_btn.click()
                print("Clicked bulk mode button")

                # Wait for animation
                time.sleep(1)

                # Check if bulk section is visible
                bulk_section = page.locator("#bulkSection")
                if bulk_section.is_visible():
                    print("Bulk section is visible")
                else:
                    print("Bulk section is NOT visible")

                page.screenshot(path="verification_bulk_mode.png")
                print("Bulk mode screenshot taken")
            else:
                print("Bulk mode button is NOT visible")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_frontend()
