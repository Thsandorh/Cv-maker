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

        # Check initial state (should have 1 experience and 1 education entry by default from DOMContentLoaded)
        # Note: DOMContentLoaded calls window.addExperience/Education, so we expect 1 each.
        exp_entries = page.locator(".experience-entry")
        edu_entries = page.locator(".education-entry")

        print(f"Initial Experience entries: {exp_entries.count()}")
        print(f"Initial Education entries: {edu_entries.count()}")

        assert exp_entries.count() >= 1, "Should have at least 1 experience entry initially"
        assert edu_entries.count() >= 1, "Should have at least 1 education entry initially"

        # Click 'Add Experience' button
        # The button has text "Új pozíció"
        add_exp_btn = page.get_by_role("button", name="Új pozíció")
        add_exp_btn.click()
        print("Clicked 'Új pozíció'.")

        # Verify new entry added
        assert exp_entries.count() >= 2, "Should have 2 experience entries after click"
        print("New experience entry added successfully.")

        # Click 'Add Education' button
        # The button has text "Új végzettség"
        add_edu_btn = page.get_by_role("button", name="Új végzettség")
        add_edu_btn.click()
        print("Clicked 'Új végzettség'.")

        # Verify new entry added
        assert edu_entries.count() >= 2, "Should have 2 education entries after click"
        print("New education entry added successfully.")

        # Click 'Remove' on the new experience entry
        # The remove button is the first child of the entry, it's an SVG icon button.
        # We target the last entry's remove button.
        remove_btns = page.locator(".experience-entry .remove-btn")
        last_remove_btn = remove_btns.last
        last_remove_btn.click()
        print("Clicked remove button on last experience entry.")

        assert exp_entries.count() == 1, "Should allow removing entries (back to 1)" # Assuming we started with 1+1=2 and removed 1
        print("Experience entry removed successfully.")

        browser.close()

if __name__ == "__main__":
    run()
