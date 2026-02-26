from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use iPhone 13 Pro viewport
        context = browser.new_context(viewport={"width": 390, "height": 844})
        page = context.new_page()

        # Enable console logging
        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))

        # Load local index.html
        page.goto(f"file://{os.getcwd()}/public/index.html")
        print("Page loaded.")

        # 1. Add extra entries in Structured Mode to create more required fields
        page.get_by_role("button", name="Új pozíció").click()
        page.get_by_role("button", name="Új végzettség").click()
        print("Added extra experience and education entries.")

        # 2. Switch to Bulk Mode
        bulk_btn = page.locator("#bulkModeBtn")
        bulk_btn.click()
        print("Clicked Bulk Mode button.")

        # 3. Fill in some bulk text
        page.locator("#bulkData").fill("This is some sample bulk data.")
        print("Filled bulk text.")

        # 4. Setup request interception
        request_sent = False
        def handle_request(request):
            nonlocal request_sent
            if "/api/generate-cv" in request.url:
                request_sent = True
                print("Request intercepted!")

        page.on("request", handle_request)

        # 5. Click submit button
        submit_btn = page.get_by_text("Generálás Indítása")
        submit_btn.click()
        print("Clicked Submit button.")

        # Wait a bit
        page.wait_for_timeout(3000)

        if request_sent:
            print("SUCCESS: Request sent.")
        else:
            print("FAILURE: Request NOT sent.")
            # Check for invalid elements
            invalid = page.evaluate("""() => {
                const el = document.querySelector(':invalid');
                return el ? el.outerHTML : null;
            }""")
            if invalid:
                print(f"Invalid Element Found: {invalid}")

        browser.close()

if __name__ == "__main__":
    run()
