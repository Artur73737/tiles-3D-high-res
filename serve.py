#!/usr/bin/env python3
"""Local server for the Tiles viewer.

Serves standalone.html (at /) and the built bundle, and exposes a small CORS proxy. The viewer opened
through it sends its Google 2D tiles and data feeds there: live aircraft (ADS-B has no CORS at all),
and Google answers a missing tile with a 404 without CORS headers, which only a proxy makes readable.

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
import urllib.parse
import http.client
import threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ALLOWED_HOSTS = {
    # live aircraft
    "api.adsb.lol",
    "opendata.adsb.fi",
    "opensky-network.org",
    # Google 2D tiles
    "mt0.google.com",
    "mt1.google.com",
    "mt2.google.com",
    "mt3.google.com",
    # data feeds and elevation
    "celestrak.org",
    "earthquake.usgs.gov",
    "eonet.gsfc.nasa.gov",
    "api.open-meteo.com",
    "api.rainviewer.com",
}
MAX_BYTES = 16 * 1024 * 1024
TIMEOUT_S = 20
USER_AGENT = "tiles-viewer-proxy/1.0"

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/geo+json", ".geojson")


# One kept-alive HTTPS connection per upstream host and server thread (the browser reuses its connection
# to this server, so one thread serves many tiles): no TLS handshake per tile.
_pool = threading.local()


def fetch_upstream(parts, headers):
    """GET an https URL; returns (status, lower-case headers, body or None when over MAX_BYTES)."""
    conns = _pool.__dict__.setdefault("conns", {})
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    for attempt in (0, 1):
        conn = conns.get(parts.netloc)
        if conn is None:
            conn = conns[parts.netloc] = http.client.HTTPSConnection(parts.hostname, parts.port or 443, timeout=TIMEOUT_S)
        try:
            conn.request("GET", path, headers={**headers, "Host": parts.netloc, "Connection": "keep-alive"})
            response = conn.getresponse()
            body = response.read(MAX_BYTES + 1)
            if response.will_close:
                conn.close()
                conns.pop(parts.netloc, None)
            return response.status, {k.lower(): v for k, v in response.getheaders()}, (body if len(body) <= MAX_BYTES else None)
        except (OSError, http.client.HTTPException):
            # A kept-alive connection the server closed meanwhile: retry once on a fresh one.
            conn.close()
            conns.pop(parts.netloc, None)
            if attempt:
                raise


class Handler(SimpleHTTPRequestHandler):
    allowed = ALLOWED_HOSTS

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # CORS on every response, so the bundle can also be loaded from other local pages.
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")
        self.send_header("Access-Control-Expose-Headers", "Retry-After, X-Upstream-Status")
        if not getattr(self, "_cache_control_sent", False):
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

    def send_json(self, status, body, headers=None):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    # The viewer cancels requests it no longer needs (the view moved): writing the answer then fails
    # because the browser closed the connection. That is normal, not an error worth a traceback.
    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            self.close_connection = True

    def proxy(self):
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        target = (query.get("url") or [""])[0]
        parts = urllib.parse.urlsplit(target)
        if parts.scheme != "https" or not parts.hostname:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "url must be an absolute https URL"})
        if parts.hostname not in self.allowed:
            return self.send_json(HTTPStatus.FORBIDDEN, {"error": f"host not allowed: {parts.hostname}", "allowed": sorted(self.allowed)})
        # 1. Upstream only: its failures become an error answer for the browser.
        try:
            status, headers, body = fetch_upstream(parts, {"User-Agent": USER_AGENT, "Accept": self.headers.get("Accept", "*/*")})
        except (OSError, http.client.HTTPException) as e:
            return self.send_json(HTTPStatus.BAD_GATEWAY, {"error": f"upstream unreachable: {e}"})
        if body is None:
            return self.send_json(HTTPStatus.BAD_GATEWAY, {"error": "upstream response too large"})
        if status == 404:
            # "No such tile" is a normal answer for map tiles. Sent as 204 + X-Upstream-Status, so the
            # browser console does not list every missing tile as a failed request; the viewer reads the header.
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("X-Upstream-Status", "404")
            self.send_header("Cache-Control", "max-age=3600")
            self._cache_control_sent = True
            self.end_headers()
            self._cache_control_sent = False
            return
        if status >= 400:
            extra = {"Retry-After": headers["retry-after"]} if headers.get("retry-after") else {}
            return self.send_json(status, {"error": f"upstream HTTP {status}"}, extra)
        # 2. Answer the browser. If it already gave up (request cancelled), handle() drops the connection.
        #    Upstream caching rules pass through, so the viewer can keep tiles.
        self.send_response(status)
        self.send_header("Content-Type", headers.get("content-type", "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        if headers.get("cache-control"):
            self.send_header("Cache-Control", headers["cache-control"])
            self._cache_control_sent = True
        self.end_headers()
        self._cache_control_sent = False
        self.wfile.write(body)

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
