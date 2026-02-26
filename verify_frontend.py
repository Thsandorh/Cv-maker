
from playwright.sync_api import sync_playwright
import time

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # Test Desktop
        page_desktop = browser.new_page()
        try:
            print("--- Testing Desktop View ---")
            page_desktop.goto("http://localhost:3000")
            print("Page loaded (Desktop)")
            page_desktop.screenshot(path="verification_desktop_initial.png")
            print("Desktop screenshot taken")
        except Exception as e:
            print(f"Desktop Error: {e}")
        finally:
            page_desktop.close()

        # Test Mobile (iPhone 12/13 Pro dimensions: 390x844)
        # Using a slightly wider mobile viewport to ensure we catch tablet-like behavior if needed, but 390 is typical.
        # The user's screenshot looks like a standard phone.
        page_mobile = browser.new_page(viewport={'width': 390, 'height': 844})
        try:
            print("--- Testing Mobile View ---")
            page_mobile.goto("http://localhost:3000")
            print("Page loaded (Mobile)")

            # Wait for content to stabilize
            time.sleep(1)

            # Scroll to Experience section to verify overlapping buttons
            # Assuming sections are roughly in order

            # Take a full page screenshot to see all sections
            page_mobile.screenshot(path="verification_mobile_full.png", full_page=True)
            print("Mobile full page screenshot taken")

            # Specifically check if elements are overlapping or misaligned
            # We can't easily programmatically detect overlap without complex logic,
            # but we can capture the specific area for human review.

            # Take a screenshot specifically of the Experience section area
            # We'll use a locator if possible, or just scroll
            experience_section = page_mobile.locator('h2:has-text("TAPASZTALAT")').first
            if experience_section.is_visible():
                experience_section.scroll_into_view_if_needed()
                time.sleep(0.5)
                page_mobile.screenshot(path="verification_mobile_experience.png")
                print("Mobile Experience section screenshot taken")

            education_section = page_mobile.locator('h2:has-text("TANULMÁNYOK")').first
            if education_section.is_visible():
                education_section.scroll_into_view_if_needed()
                time.sleep(0.5)
                page_mobile.screenshot(path="verification_mobile_education.png")
                print("Mobile Education section screenshot taken")

        except Exception as e:
            print(f"Mobile Error: {e}")
        finally:
            page_mobile.close()
            browser.close()

if __name__ == "__main__":
    verify_frontend()
