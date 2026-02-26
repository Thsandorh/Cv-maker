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

        # 1. Add Experience and Education items to populate the list
        page.get_by_role("button", name="Új pozíció").click()
        page.get_by_role("button", name="Új végzettség").click()
        print("Added new entries.")

        # 2. Check for visibility of Delete buttons (red X buttons)
        # They should be visible immediately, without hover.
        # We look for the button with the specific class and red background
        delete_btns = page.locator("button.bg-red-500")

        count = delete_btns.count()
        print(f"Found {count} delete buttons.")

        # We expect at least 4 delete buttons now (2 initial + 2 added)
        # Wait, the initial load calls addExperience/addEducation once each. So 2 initial.
        # Plus we clicked add twice. So 4 total.
        assert count >= 4, f"Expected at least 4 delete buttons, found {count}"

        # Check visibility of the first one
        first_btn = delete_btns.first
        assert first_btn.is_visible(), "Delete button should be visible without hover"
        print("Delete button visibility verified.")

        # 3. Take a screenshot for visual inspection of the 'card' style
        # Scroll to the experience list
        page.locator("#experienceList").scroll_into_view_if_needed()
        page.screenshot(path="verification/ui_consistency_experience.png")
        print("Screenshot saved: verification/ui_consistency_experience.png")

        # 4. Test functionality: Click delete on the last added experience
        last_exp_delete = page.locator("#experienceList .experience-entry button.bg-red-500").last
        last_exp_delete.click()

        # Verify count decreased
        current_exp_count = page.locator("#experienceList .experience-entry").count()
        # We started with 1 (initial) + 1 (added) = 2. Removed 1. Should be 1.
        print(f"Experience entries after delete: {current_exp_count}")
        assert current_exp_count == 1, "Should have 1 experience entry after deletion"

        print("Verification successful.")
        browser.close()

if __name__ == "__main__":
    run()
