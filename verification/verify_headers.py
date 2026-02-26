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

        # Scroll to Experience section
        page.locator("#experienceList").scroll_into_view_if_needed()

        # Screenshot Experience Section
        page.screenshot(path="verification/experience_header.png")
        print("Screenshot saved: verification/experience_header.png")

        browser.close()

if __name__ == "__main__":
    run()
