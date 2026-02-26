from playwright.sync_api import sync_playwright
import time
import os

def verify_cv_preview():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Emulate a small desktop window where the preview might be constrained
        context = browser.new_context(viewport={'width': 1200, 'height': 900})
        page = context.new_page()

        # Load the local HTML file directly
        file_path = os.path.abspath("public/index.html")
        page.goto(f"file://{file_path}")

        # Inject a function to simulate receiving the CV content and triggering the displayCV logic
        # We need to construct the HTML string carefully.
        dummy_cv_html = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Test CV</title>
            <style>
                body {
                    background-color: white;
                    color: black;
                    font-family: sans-serif;
                }
                .content {
                    width: 100%;
                    height: 100%;
                    border: 5px solid red; /* Visual indicator of boundaries */
                    box-sizing: border-box;
                    padding: 20px;
                }
            </style>
        </head>
        <body>
            <div class="content">
                <h1>Test CV Content</h1>
                <p>This content should be scaled to fit the preview container.</p>
                <div style="width: 100%; height: 50px; background: blue;"></div>
                <p>Bottom text.</p>
            </div>
        </body>
        </html>
        """

        # Properly escape for JS injection
        dummy_cv_html_escaped = dummy_cv_html.replace("\\", "\\\\").replace("\n", "\\n").replace("'", "\\'").replace("\"", '\\"')

        print("Injecting dummy CV content...")
        page.evaluate(f"displayCV('{dummy_cv_html_escaped}')")

        # Wait for potential layout shifts and script execution
        time.sleep(2)

        # Locate the iframe element handle to access its content frame
        iframe_element_handle = page.query_selector("#previewContainer iframe")
        if not iframe_element_handle:
            print("ERROR: Iframe not found in preview container.")
            return

        iframe_content_frame = iframe_element_handle.content_frame()
        if not iframe_content_frame:
            print("ERROR: Could not access iframe content frame.")
            return

        # Check if the body has the transform style applied
        # Note: The script we injected applies style directly to document.body.style.transform
        body_transform = iframe_content_frame.evaluate("document.body.style.transform")
        body_width = iframe_content_frame.evaluate("document.body.style.width")

        print(f"Iframe body transform: '{body_transform}'")
        print(f"Iframe body width: '{body_width}'") # Should be '210mm' from CSS or script if set

        # Also check computed style for width to verify CSS injection
        computed_width = iframe_content_frame.evaluate("window.getComputedStyle(document.body).width")
        print(f"Computed body width: {computed_width}") # Should be approx 793px (210mm)

        if "scale" in body_transform:
            print("SUCCESS: Transform scale applied to iframe body.")
        else:
            print("FAILURE: Transform scale NOT applied.")

        # Take screenshots
        preview_container = page.locator("#previewContainer")
        preview_container.screenshot(path="verification/preview_scaled.png")
        page.screenshot(path="verification/full_page.png")

        browser.close()

if __name__ == "__main__":
    verify_cv_preview()
