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

        # 1. Check initial state (Structured Mode)
        # fullName should be required
        is_required = page.eval_on_selector("#fullName", "el => el.hasAttribute('required')")
        print(f"Initial #fullName required: {is_required}")
        assert is_required, "fullName should be required in Structured Mode"

        # Check dynamic field (company)
        is_company_required = page.eval_on_selector(".company", "el => el.hasAttribute('required')")
        print(f"Initial .company required: {is_company_required}")
        assert is_company_required, "company should be required in Structured Mode"

        # 2. Switch to Bulk Mode
        bulk_btn = page.locator("#bulkModeBtn")
        bulk_btn.click()
        print("Clicked Bulk Mode button.")

        # Check if required removed
        is_required_bulk = page.eval_on_selector("#fullName", "el => el.hasAttribute('required')")
        print(f"Bulk Mode #fullName required: {is_required_bulk}")
        assert not is_required_bulk, "fullName should NOT be required in Bulk Mode"

        is_company_required_bulk = page.eval_on_selector(".company", "el => el.hasAttribute('required')")
        print(f"Bulk Mode .company required: {is_company_required_bulk}")
        assert not is_company_required_bulk, "company should NOT be required in Bulk Mode"

        # 3. Switch back to Structured Mode
        struct_btn = page.locator("#structuredModeBtn")
        struct_btn.click()
        print("Clicked Structured Mode button.")

        # Check if required restored
        is_required_restored = page.eval_on_selector("#fullName", "el => el.hasAttribute('required')")
        print(f"Restored #fullName required: {is_required_restored}")
        assert is_required_restored, "fullName should be required again in Structured Mode"

        is_company_required_restored = page.eval_on_selector(".company", "el => el.hasAttribute('required')")
        print(f"Restored .company required: {is_company_required_restored}")
        assert is_company_required_restored, "company should be required again in Structured Mode"

        print("Verification successful.")
        browser.close()

if __name__ == "__main__":
    run()
