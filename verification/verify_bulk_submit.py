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

        # 1. Switch to Bulk Mode
        bulk_btn = page.locator("#bulkModeBtn")
        bulk_btn.click()
        print("Clicked Bulk Mode button.")

        # 2. Leave Name and Email EMPTY (they are usually required)
        page.locator("#fullName").fill("")
        page.locator("#email").fill("")

        # 3. Fill in some bulk text
        page.locator("#bulkData").fill("This is some sample bulk data for testing generation.")
        print("Filled bulk text.")

        # 4. Check if we can submit without error
        # We need to intercept the request to verify it was sent
        request_sent = False
        def handle_request(request):
            nonlocal request_sent
            if "/api/generate-cv" in request.url and request.method == "POST":
                request_sent = True
                print("Request intercepted!")

        page.on("request", handle_request)

        # Mock the response so it doesn't actually hit the backend (since we're checking frontend validation)
        page.route("**/api/generate-cv", lambda route: route.fulfill(status=200, body="<html><body>Generated CV</body></html>"))

        # Click submit button
        submit_btn = page.get_by_text("Generálás Indítása")
        submit_btn.click()
        print("Clicked Submit button.")

        # Wait a bit
        page.wait_for_timeout(2000)

        if request_sent:
            print("SUCCESS: Form submitted successfully in Bulk Mode with empty structured fields.")
        else:
            print("FAILURE: Form submission blocked (likely HTML5 validation).")
            # Check if any input is invalid
            invalid_element = page.evaluate("""() => {
                const invalid = document.querySelector(':invalid');
                return invalid ? { tag: invalid.tagName, id: invalid.id, name: invalid.name, class: invalid.className } : null;
            }""")
            if invalid_element:
                print(f"Blocking Element: {invalid_element}")
            else:
                print("No invalid element found via CSS :invalid selector.")

        browser.close()

if __name__ == "__main__":
    run()
