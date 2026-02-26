from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844})
        page = context.new_page()

        # Capture console logs
        logs = []
        page.on("console", lambda msg: logs.append(msg.text))

        # Load local index.html
        page.goto(f"file://{os.getcwd()}/public/index.html")
        print("Page loaded.")

        # Switch to Bulk Mode
        page.locator("#bulkModeBtn").click()
        print("Switched to Bulk Mode.")

        # Fill bulk data
        page.locator("#bulkData").fill("Test bulk data for submission verification.")

        # Intercept request to verify no reload
        request_intercepted = False
        def handle_request(request):
            nonlocal request_intercepted
            if "/api/generate-cv" in request.url:
                request_intercepted = True
                print("API Request intercepted.")

        page.on("request", handle_request)

        # Mock response to prevent actual failure
        page.route("**/api/generate-cv", lambda route: route.fulfill(status=200, body="<html>OK</html>"))

        # Submit
        page.get_by_text("Generálás Indítása").click()
        print("Clicked Submit.")

        page.wait_for_timeout(2000)

        # Check logs for interception
        submit_intercepted = any("Form submit intercepted" in log for log in logs)
        print(f"Submit intercepted log found: {submit_intercepted}")
        assert submit_intercepted, "Form submission was not intercepted by JS handler!"

        if request_intercepted:
            print("SUCCESS: Form submitted via JS (no reload).")
        else:
            print("FAILURE: API request not sent (but handler might have run?).")
            print("ALL LOGS:", logs)

        browser.close()

if __name__ == "__main__":
    run()
