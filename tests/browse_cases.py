import json
import subprocess
import threading
import time

from harness import MCPTestClient, TEST_ENV

class BrowseCases:
    def test_call_tool_browse_success(self):
        print("--- Running Test: Call Tool - Browse Success (No Window Param) ---")
        response = self._run_browse({"url": self._example_url()})
        payload = self.get_tool_payload(response)
        assert payload["outputMode"] == "text"
        assert payload["status"] == 200
        assert "example domain" in payload["text"].lower()
        print("CallTool browse success (no window) test passed.")

    def test_call_tool_browse_metadata(self):
        print("--- Running Test: Call Tool - Browse Metadata Output ---")
        response = self._run_browse({
            "url": self._example_url(),
            "outputMode": "metadata"
        })
        payload = self.get_tool_payload(response)
        assert payload["outputMode"] == "metadata"
        assert payload["status"] == 200
        assert "text" not in payload
        assert "html" not in payload
        print("CallTool metadata output test passed.")

    def test_call_tool_browse_selector_text(self):
        print("--- Running Test: Call Tool - Browse Selector Text ---")
        response = self._run_browse({
            "url": self._example_url(),
            "selector": "h1",
            "maxChars": 1000
        })
        payload = self.get_tool_payload(response)
        assert payload["selector"] == "h1"
        assert payload["selectorFound"] is True
        assert payload["text"].strip() == "Example Domain"
        assert payload["truncated"] is False
        print("CallTool selector text test passed.")

    def test_call_tool_browse_network_diagnostics(self):
        print("--- Running Test: Call Tool - Browse Network Diagnostics ---")
        response = self._run_browse({
            "url": self._example_url(),
            "outputMode": "metadata",
            "includeNetwork": True
        })
        payload = self.get_tool_payload(response)
        diagnostics = payload.get("diagnostics", {})
        assert diagnostics.get("network"), f"Expected network diagnostics: {payload}"
        assert diagnostics["network"][0]["url"].startswith("http://")
        print("CallTool network diagnostics test passed.")

    def test_call_tool_browse_selector_jpeg_screenshot(self):
        print("--- Running Test: Call Tool - Browse Selector JPEG Screenshot ---")
        html = """<!doctype html>
<html>
<body>
  <h1 style="display:inline-block;width:320px;height:80px;margin:0">Screenshot target</h1>
</body>
</html>"""
        response = self._run_browse({
            "url": self._fixture_url(html),
            "selector": "h1",
            "screenshot": True,
            "screenshotOptions": {
                "selector": "h1",
                "type": "jpeg",
                "quality": 60
            }
        })
        payload = self.get_tool_payload(response)
        screenshot = payload.get("screenshot", {})
        assert screenshot.get("included") is True, f"Expected included screenshot: {payload}"
        assert screenshot.get("type") == "jpeg"
        assert screenshot.get("selectorFound") is True
        content = response.get("result", {}).get("content", [])
        assert len(content) == 2
        assert content[1].get("mimeType") == "image/jpeg"
        print("CallTool selector JPEG screenshot test passed.")

    def test_call_tool_focused_extractors(self):
        print("--- Running Test: Call Tool - Focused Extractors ---")
        html = """<!doctype html>
<html>
<head><title>Extractor Fixture</title><meta name="description" content="Focused extractor page"></head>
<body>
  <nav><a href="/pricing">Pricing</a><a href="https://example.org/docs">Docs</a></nav>
  <main>
    <h1>Docs</h1>
    <h2>Install</h2>
    <p>Install the package with npm before running the browser.</p>
    <form id="login-form">
      <label>Email <input name="email" type="email" required placeholder="you@example.com"></label>
      <label>Role <select name="role"><option value="admin">Admin</option><option value="user">User</option></select></label>
      <button type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>"""
        url = self._fixture_url(html)

        links = self.get_tool_payload(self._run_links({"url": url, "maxLinks": 10}, timeout=90))
        assert any(link["text"] == "Pricing" for link in links["links"]), f"Expected Pricing link: {links}"
        assert links["selectorFound"] is True

        forms = self.get_tool_payload(self._run_forms({"url": url, "maxForms": 5, "maxFields": 10}, timeout=90))
        assert forms["forms"], f"Expected forms: {forms}"
        field_names = {field.get("name") for form in forms["forms"] for field in form["fields"]}
        assert "email" in field_names
        assert "role" in field_names
        assert forms["forms"][0]["submit"]["text"] == "Sign in"

        outline = self.get_tool_payload(self._run_outline({"url": url, "maxItems": 10}, timeout=90))
        assert outline["description"] == "Focused extractor page"
        assert any(heading["text"] == "Install" and heading["level"] == 2 for heading in outline["headings"])
        assert "nav" in outline["landmarks"] or "navigation" in outline["landmarks"]

        found = self.get_tool_payload(self._run_find({
            "url": url,
            "query": "npm",
            "maxMatches": 3,
            "contextChars": 80
        }, timeout=90))
        assert found["matches"], f"Expected find matches: {found}"
        assert "npm" in found["matches"][0]["text"].lower()
        print("CallTool focused extractors test passed.")

    def test_call_tool_screenshot_tool(self):
        print("--- Running Test: Call Tool - Screenshot Tool ---")
        html = """<!doctype html>
<html>
<body>
  <h1 style="display:inline-block;width:320px;height:80px;margin:0">Screenshot target</h1>
</body>
</html>"""
        response = self._run_screenshot({
            "url": self._fixture_url(html),
            "selector": "h1",
            "type": "jpeg",
            "quality": 70
        })
        payload = self.get_tool_payload(response)
        assert payload["screenshot"]["included"] is True, f"Expected screenshot: {payload}"
        assert payload["screenshot"]["selectorFound"] is True
        content = response.get("result", {}).get("content", [])
        assert len(content) == 2
        assert content[1].get("mimeType") == "image/jpeg"
        print("CallTool screenshot tool test passed.")

    def test_call_tool_console_and_network_summary(self):
        print("--- Running Test: Call Tool - Console And Network Summary ---")
        html = """<!doctype html>
<html>
<body>
  <script>console.log('diagnostic fixture message');</script>
  <p>diagnostics</p>
</body>
</html>"""
        console_payload = self.get_tool_payload(self._run_console({"url": self._fixture_url(html)}, timeout=90))
        assert any("diagnostic fixture message" in entry["text"] for entry in console_payload["console"]), console_payload

        network_payload = self.get_tool_payload(self._run_network_summary({
            "url": self._example_url(),
            "maxFailures": 5
        }, timeout=90))
        assert network_payload["requests"] >= 1, f"Expected network requests: {network_payload}"
        assert "200" in network_payload["statusCounts"], f"Expected status count: {network_payload}"
        print("CallTool console and network summary test passed.")

    def test_call_tool_browse_rejects_oversize_fullpage_screenshot(self):
        print("--- Running Test: Call Tool - Reject Oversize Full-Page Screenshot ---")
        html = """<!doctype html>
<html>
<body style="margin:0">
  <main style="height:3000px;width:100%;background:#eee">tall page</main>
</body>
</html>"""
        response = self._run_browse({
            "url": self._fixture_url(html),
            "screenshot": True,
            "screenshotOptions": {
                "fullPage": True
            },
            "maxChars": 1000
        }, timeout=90)
        payload = self.get_tool_payload(response)
        screenshot = payload.get("screenshot", {})
        assert screenshot.get("included") is False, f"Expected omitted screenshot: {payload}"
        assert "dimension policy" in screenshot.get("error", ""), f"Expected dimension policy error: {payload}"
        assert len(response.get("result", {}).get("content", [])) == 1
        print("CallTool oversize full-page screenshot rejection test passed.")

    def test_call_tool_browse_rejects_oversize_selector_screenshot(self):
        print("--- Running Test: Call Tool - Reject Oversize Selector Screenshot ---")
        html = """<!doctype html>
<html>
<body style="margin:0">
  <div id="large" style="width:2200px;height:1200px;background:#ddd">large target</div>
</body>
</html>"""
        response = self._run_browse({
            "url": self._fixture_url(html),
            "screenshot": True,
            "screenshotOptions": {
                "selector": "#large"
            },
            "maxChars": 1000
        }, timeout=90)
        payload = self.get_tool_payload(response)
        screenshot = payload.get("screenshot", {})
        assert screenshot.get("included") is False, f"Expected omitted screenshot: {payload}"
        assert screenshot.get("selectorFound") is True
        assert "dimension policy" in screenshot.get("error", ""), f"Expected dimension policy error: {payload}"
        print("CallTool oversize selector screenshot rejection test passed.")

    def test_call_tool_browse_missing_selector(self):
        print("--- Running Test: Call Tool - Browse Missing Selector ---")
        response = self._run_browse({
            "url": self._example_url(),
            "selector": ".does-not-exist",
            "maxChars": 1000
        })
        payload = self.get_tool_payload(response)
        assert payload["selectorFound"] is False
        assert payload["text"] == ""
        assert payload["truncated"] is False
        print("CallTool missing selector test passed.")

    def test_call_tool_snapshot_success(self):
        print("--- Running Test: Call Tool - Browse Snapshot Success ---")
        response = self._run_snapshot({
            "url": self._example_url(),
            "maxChars": 2000,
            "maxElements": 20
        })
        payload = self.get_tool_payload(response)
        assert payload["selectorFound"] is True
        assert "example domain" in payload["text"].lower()
        assert "ariaSnapshot" in payload, f"Expected ARIA snapshot: {payload}"
        assert payload["elements"], f"Expected snapshot elements: {payload}"
        assert any(element.get("role") == "link" for element in payload["elements"])
        print("CallTool snapshot success test passed.")

    def test_call_tool_snapshot_does_not_truncate_only_hidden_candidates(self):
        print("--- Running Test: Call Tool - Snapshot Hidden Candidates Not Truncated ---")
        hidden = "".join("<button style='display:none'>Hidden</button>" for _ in range(10))
        html = f"""<!doctype html>
<html>
<body>
  <button id="visible">Visible</button>
  {hidden}
</body>
</html>"""
        response = self._run_snapshot({
            "url": self._fixture_url(html),
            "maxChars": 1000,
            "maxElements": 5
        }, timeout=90)
        payload = self.get_tool_payload(response)
        assert len(payload["elements"]) == 1, f"Expected one visible element: {payload}"
        assert payload["elementsTruncated"] is False, f"Hidden candidates should not imply truncation: {payload}"
        print("CallTool snapshot hidden candidates truncation test passed.")

    def test_call_tool_browse_separates_adjacent_inline_text(self):
        print("--- Running Test: Call Tool - Browse Separates Adjacent Inline Text ---")
        html = """<!doctype html>
<html>
<body><span>Hello</span><span>World</span></body>
</html>"""
        response = self._run_browse({
            "url": self._fixture_url(html),
            "maxChars": 1000
        }, timeout=90)
        payload = self.get_tool_payload(response)
        assert payload["text"].strip() == "Hello World", f"Expected separated inline text: {payload}"
        print("CallTool adjacent inline text spacing test passed.")
