import json
import subprocess
import threading
import time

from harness import MCPTestClient, TEST_ENV

class SequenceCases:
    def test_call_tool_sequence_click_link(self):
        print("--- Running Test: Call Tool - Browse Sequence Click Link ---")
        html = """<!doctype html>
<html>
<body>
  <a href="#" onclick="document.getElementById('result').textContent = 'clicked'; return false;">Click target</a>
  <p id="result">waiting</p>
</body>
</html>"""
        response = self._run_sequence({
            "url": self._fixture_url(html),
            "actions": [
                {"type": "click", "selector": "a[href]"}
            ],
            "maxChars": 2000,
            "includeNetwork": True
        }, timeout=90)
        payload = self.get_tool_payload(response)
        assert payload["actions"][0]["status"] == "ok"
        assert "clicked" in payload["text"], f"Expected click side effect: {payload}"
        assert payload["status"] and payload["status"] < 400
        assert payload.get("diagnostics", {}).get("network")
        print("CallTool sequence click link test passed.")

    def test_call_tool_sequence_click_auto_pointer_path(self):
        print("--- Running Test: Call Tool - Browse Sequence Click Auto Pointer Path ---")
        html = """<!doctype html>
<html>
<body>
  <button id="target">Click target</button>
  <p id="result">waiting</p>
  <script>
    const target = document.getElementById('target');
    let pointerStarted = false;
    target.addEventListener('pointerdown', () => { pointerStarted = true; });
    target.addEventListener('mousedown', () => { pointerStarted = true; });
    target.addEventListener('click', () => {
      document.getElementById('result').textContent = pointerStarted ? 'pointer clicked' : 'dom clicked';
    });
  </script>
</body>
</html>"""
        response = self._run_sequence({
            "url": self._fixture_url(html),
            "actions": [
                {"type": "click", "selector": "#target", "clickMode": "auto", "timeout": 3000}
            ],
            "maxChars": 2000
        }, timeout=90)
        payload = self.get_tool_payload(response)
        assert payload["actions"][0]["status"] == "ok"
        assert "pointer clicked" in payload["text"] or "dom clicked" in payload["text"], f"Expected auto click side effect: {payload}"
        print("CallTool sequence click auto pointer path test passed.")

    def test_call_tool_sequence_click_auto_falls_back_to_dom(self):
        print("--- Running Test: Call Tool - Browse Sequence Click Auto Falls Back To DOM ---")
        html = """<!doctype html>
<html>
<head>
  <style>
    #target { position: absolute; left: 20px; top: 20px; width: 180px; height: 60px; }
    #cover { position: absolute; left: 0; top: 0; width: 260px; height: 120px; z-index: 10; background: rgba(0, 0, 0, 0.01); }
    #result { position: absolute; top: 140px; }
  </style>
</head>
<body>
  <button id="target" onclick="document.getElementById('result').textContent = 'clicked';">Click target</button>
  <div id="cover"></div>
  <p id="result">waiting</p>
</body>
</html>"""
        response = self._run_sequence({
            "url": self._fixture_url(html),
            "actions": [
                {"type": "click", "selector": "#target", "clickMode": "auto", "timeout": 1000}
            ],
            "maxChars": 2000
        }, timeout=90)
        payload = self.get_tool_payload(response)
        assert payload["actions"][0]["status"] == "ok"
        assert "clicked" in payload["text"], f"Expected DOM fallback side effect: {payload}"
        print("CallTool sequence click auto fallback test passed.")

    def test_call_tool_sequence_form_actions(self):
        print("--- Running Test: Call Tool - Browse Sequence Form Actions ---")
        html = """<!doctype html>
<html>
<body>
  <label>Name <input id="name-field" aria-label="Name"></label>
  <label>Notes <textarea id="notes-field" aria-label="Notes"></textarea></label>
  <label>Choice <select id="choice-field" aria-label="Choice"><option value="alpha">Alpha</option><option value="beta">Beta</option></select></label>
  <p id="summary">empty</p>
  <script>
    const nameField = document.getElementById('name-field');
    const notesField = document.getElementById('notes-field');
    const choiceField = document.getElementById('choice-field');
    const summary = document.getElementById('summary');
    function update() {
      summary.textContent = `name ${nameField.value} notes ${notesField.value} choice ${choiceField.value}`;
    }
    nameField.addEventListener('input', update);
    notesField.addEventListener('input', update);
    choiceField.addEventListener('change', update);
  </script>
</body>
</html>"""
        response = self._run_sequence({
            "url": self._fixture_url(html),
            "actions": [
                {"type": "fill", "selector": "#name-field", "value": "Alice"},
                {"type": "type", "selector": "#notes-field", "text": "hello"},
                {"type": "select", "selector": "#choice-field", "value": "beta"},
                {"type": "waitFor", "selector": "#summary"}
            ],
            "maxChars": 2000,
            "maxElements": 20
        }, timeout=90)
        payload = self.get_tool_payload(response)
        assert len(payload["actions"]) == 4
        assert all(action["status"] == "ok" for action in payload["actions"])
        assert "name Alice notes hello choice beta" in payload["text"]
        assert payload["snapshot"]["elements"], f"Expected final snapshot elements: {payload}"
        print("CallTool sequence form actions test passed.")

    def test_call_tool_sequence_rejects_timeout_budget(self):
        print("--- Running Test: Call Tool - Browse Sequence Rejects Timeout Budget ---")
        response = self._call_tool("browse_sequence", {
            "url": "https://example.com",
            "actions": [
                {"type": "waitFor", "timeout": 60000},
                {"type": "waitFor", "timeout": 60000},
                {"type": "waitFor", "timeout": 60000}
            ]
        }, timeout=10)
        assert response and response.get("result", {}).get("isError"), response
        assert "Sequence timeout budget exceeds server policy" in self.get_tool_text(response), response
        print("CallTool sequence timeout budget rejection test passed.")


    def test_call_tool_sequence_scrolls_selector_element(self):
        print("--- Running Test: Call Tool - Browse Sequence Scroll Selector Element ---")
        html = """<!doctype html>
<html>
<body>
  <div id="box" style="height:50px;width:200px;overflow:auto;border:1px solid black"
       onscroll="document.getElementById('result').textContent = 'scrollTop ' + this.scrollTop;">
    <div style="height:500px">scroll content</div>
  </div>
  <p id="result">scrollTop 0</p>
</body>
</html>"""
        response = self._run_sequence({
            "url": self._fixture_url(html),
            "actions": [
                {"type": "scroll", "selector": "#box", "deltaY": 180}
            ],
            "maxChars": 2000
        }, timeout=90)
        payload = self.get_tool_payload(response)
        assert payload["actions"][0]["status"] == "ok"
        assert "scrollTop 0" not in payload["text"], f"Expected selected element to scroll: {payload}"
        assert "scrollTop " in payload["text"], f"Expected scroll result text: {payload}"
        print("CallTool sequence selector scroll test passed.")

    def test_call_tool_sequence_rejects_private_redirect(self):
        print("--- Running Test: Call Tool - Browse Sequence Reject Private Redirect ---")
        response = self._call_tool("browse_sequence", {
            "url": self._url("/redirect-to?url=http%3A%2F%2F127.0.0.1%3A80"),
            "actions": []
        }, timeout=30)
        assert response and response.get("result", {}).get("isError"), f"Private sequence redirect was not rejected: {response}"
        assert "blocked unsafe browser request" in self.get_tool_text(response).lower()
        print("CallTool sequence private redirect rejection test passed.")

    def test_call_tool_sequence_rejects_evaluate_by_default(self):
        print("--- Running Test: Call Tool - Browse Sequence Reject Evaluate By Default ---")
        response = self._call_tool("browse_sequence", {
            "url": self._example_url(),
            "actions": [
                {"type": "evaluate", "expression": "document.title"}
            ]
        }, timeout=60)
        assert response and response.get("result", {}).get("isError"), f"Evaluate action was not rejected: {response}"
        assert "evaluate action is disabled" in self.get_tool_text(response).lower()
        print("CallTool sequence evaluate rejection test passed.")
