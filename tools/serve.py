#!/usr/bin/env python3
# Dev-only static server for the PWA that sends Cache-Control: no-store, so the
# browser never serves a stale ES module during development. (Node users get the
# same behaviour from tools/serve.js; this is the no-Node fallback.)
# Threaded: the app loads ~20 ES modules in parallel, which a single-threaded
# server stalls on (keep-alive connections block each other).
import http.server, socketserver, sys, os
from http.server import ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'app'))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def log_message(self, *args):
        pass


ThreadingHTTPServer.allow_reuse_address = True
ThreadingHTTPServer.daemon_threads = True
with ThreadingHTTPServer(('127.0.0.1', PORT), Handler) as httpd:
    print(f'SpendLens dev server (no-store, threaded) on http://127.0.0.1:{PORT}/  serving {APP_DIR}')
    httpd.serve_forever()
