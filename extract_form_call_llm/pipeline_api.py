#!/usr/bin/env python3
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from forms_extraction import extract_fields
from llm_call import generate_fill_json, load_env


BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
PROFILE_PATH = ROOT_DIR / "profile.txt"
RESUME_PATH = ROOT_DIR / "resume.txt"
ENV_PATH = ROOT_DIR / ".env"
ENV_MAP = load_env(ENV_PATH)


class PipelineHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except Exception as error:
            raise ValueError(f"Invalid JSON body: {error}") from error
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    def do_POST(self):
        if urlparse(self.path).path != "/pipeline":
            self._send_json(404, {"error": "not_found"})
            return

        try:
            payload = self._read_json()
        except ValueError as error:
            self._send_json(400, {"error": "bad_request", "detail": str(error)})
            return

        url = (payload.get("url") or "").strip()
        if not url:
            self._send_json(400, {"error": "bad_request", "detail": "Missing 'url' in request body."})
            return

        try:
            fields = extract_fields(url)
        except ValueError as error:
            self._send_json(422, {"error": "invalid_url", "detail": str(error)})
            return
        except Exception as error:
            self._send_json(422, {"error": "form_extraction_failed", "detail": str(error)})
            return

        try:
            profile_text = PROFILE_PATH.read_text(encoding="utf-8")
            resume_text = RESUME_PATH.read_text(encoding="utf-8")
        except OSError as error:
            self._send_json(500, {"error": "context_read_failed", "detail": str(error)})
            return

        try:
            result = generate_fill_json(fields, profile_text, resume_text, env_map=ENV_MAP)
        except RuntimeError as error:
            detail = str(error)
            status = 500 if "OPENAI_API_KEY" in detail or "OpenAI SDK import failed" in detail else 502
            self._send_json(status, {"error": "llm_failed", "detail": detail})
            return
        except Exception as error:
            self._send_json(502, {"error": "llm_failed", "detail": str(error)})
            return

        self._send_json(200, result)

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            self._send_json(200, {"status": "ok"})
            return
        self._send_json(404, {"error": "not_found"})

    def log_message(self, format: str, *args):
        return


def run_server():
    host = os.getenv("PIPELINE_HOST", "127.0.0.1")
    port = int(os.getenv("PIPELINE_PORT", "8767"))
    server = ThreadingHTTPServer((host, port), PipelineHandler)
    print(f"Pipeline API listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run_server()
