"""Standard-library-only event sender for your Python agent."""
import json
import os
import urllib.request
import uuid


def emit(event):
    token = os.environ.get("AGENT_BAY_BRIDGE_TOKEN")
    if not token:
        raise RuntimeError("Set AGENT_BAY_BRIDGE_TOKEN from the panel's External Agent tab")
    url = os.environ.get("AGENT_BAY_URL", "http://127.0.0.1:4318").rstrip("/")
    request = urllib.request.Request(
        url + "/api/events",
        data=json.dumps(event).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.load(response)


if __name__ == "__main__":
    run_id = "python-" + uuid.uuid4().hex
    def send(**event):
        return emit(dict(runId=run_id, source="Python Agent", **event))

    send(type="run.start", title="Python event integration example")
    send(type="stage", stage="execute", message="Running a local calculation")
    send(type="tool.start", callId="calculate-1", name="calculate", args={"expression": "2 + 2"})
    result = 2 + 2
    send(type="tool.end", callId="calculate-1", name="calculate", ok=True, durationMs=0, result={"value": result})
    send(type="check", name="2 + 2 = 4", status="passed" if result == 4 else "failed")
    send(type="run.end", status="completed")
