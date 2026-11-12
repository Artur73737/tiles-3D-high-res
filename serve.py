#!/usr/bin/env python3
"""Local server for the Tiles viewer.

Serves standalone.html (at /) and the built bundle, and exposes a small CORS proxy for data feeds that
do not send CORS headers (live aircraft / ADS-B):

    GET /proxy?url=<encoded https URL>     forwarded to an allowed host, answered with CORS headers
    GET /proxy/health                      {"ok": true} -- the viewer uses it to enable the proxy

The proxy is not open: GET only, https only, hosts in ALLOWED_HOSTS (extend with --allow), response size
and time limited. By default the server listens on 127.0.0.1 only.

    python serve.py                     http://127.0.0.1:8080
    python serve.py --port 9000 --host 0.0.0.0 --allow api.example.org

Standard library only (Python 3.9+).
"""
import argparse
import json
import mimetypes
import sys
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ALLOWED_HOSTS = {
    "api.adsb.lol",
    "opendata.adsb.fi",
    "opensky-network.org",
}
MAX_BYTES = 16 * 1024 * 1024
TIMEOUT_S = 20
USER_AGENT = "tiles-viewer-proxy/1.0"

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/geo+json", ".geojson")


class Handler(SimpleHTTPRequestHandler):
    allowed = ALLOWED_HOSTS

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # CORS on every response, so the bundle can also be loaded from other local pages.
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    # Only the viewer page and the built bundle are served; the rest of the folder (sources, .git,
    # node_modules, test output) stays private even with --host 0.0.0.0.
    def public_path(self):
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        if path in ("/", "/index.html"):
            path = "/standalone.html"
        resolved = (ROOT / path.lstrip("/")).resolve()
        public = resolved == ROOT / "standalone.html" or (resolved.is_relative_to(ROOT / "dist") and resolved.is_file())
        return path if public else None

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/proxy/health":
            return self.send_json(HTTPStatus.OK, {"ok": True, "hosts": sorted(self.allowed)})
        if path == "/proxy":
            return self.proxy()
        public = self.public_path()
        if public is None:
            return self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        self.path = public
        return super().do_GET()

    def do_HEAD(self):
        public = self.public_path()
        if public is None:
            self.send_response(HTTPStatus.NOT_FOUND)
            return self.end_headers()
        self.path = public
        return super().do_HEAD()

    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def proxy(self):
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        target = (query.get("url") or [""])[0]
        parts = urllib.parse.urlsplit(target)
        if parts.scheme != "https" or not parts.hostname:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "url must be an absolute https URL"})
        if parts.hostname not in self.allowed:
            return self.send_json(HTTPStatus.FORBIDDEN, {"error": f"host not allowed: {parts.hostname}", "allowed": sorted(self.allowed)})
        request = urllib.request.Request(target, headers={"User-Agent": USER_AGENT, "Accept": self.headers.get("Accept", "*/*")})
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_S) as upstream:
                body = upstream.read(MAX_BYTES + 1)
                if len(body) > MAX_BYTES:
                    return self.send_json(HTTPStatus.BAD_GATEWAY, {"error": "upstream response too large"})
                self.send_response(upstream.status)
                self.send_header("Content-Type", upstream.headers.get("Content-Type", "application/octet-stream"))
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            self.send_json(e.code, {"error": f"upstream HTTP {e.code}"})
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            self.send_json(HTTPStatus.BAD_GATEWAY, {"error": f"upstream unreachable: {getattr(e, 'reason', e)}"})

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description="Serve the Tiles viewer with a CORS proxy for data feeds.")
    parser.add_argument("--host", default="127.0.0.1", help="interface to listen on (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8080, help="port (default 8080)")
    parser.add_argument("--allow", action="append", default=[], metavar="HOST", help="extra host the proxy may reach (repeatable)")
    args = parser.parse_args()
    if not (ROOT / "standalone.html").exists():
        sys.exit("standalone.html not found: run `npm run build` first")
    Handler.allowed = ALLOWED_HOSTS | set(args.allow)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Tiles viewer on http://{args.host}:{args.port}/  (proxy hosts: {', '.join(sorted(Handler.allowed))})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
