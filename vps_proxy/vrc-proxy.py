import http.server
import json
import requests

PORT = 6790
SECRET = "YOUR_SECRET_HERE"
WARP_PROXIES = {
    'http': 'socks5h://127.0.0.1:40000',
    'https': 'socks5h://127.0.0.1:40000',
}
STRIP_HEADERS = {
    'host', 'x-proxy-secret', 'content-length',
    'cf-connecting-ip', 'cf-ray', 'cf-ipcountry',
    'cf-visitor', 'x-forwarded-for', 'x-real-ip',
    'cdn-loop', 'transfer-encoding'
}

class ProxyHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', '*')
        self.end_headers()
    def handle_proxy(self):
        if self.headers.get('x-proxy-secret') != SECRET:
            self.send_response(403)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Forbidden"}).encode())
            return
        target_url = "https://api.vrchat.cloud" + self.path
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else None
        req_headers = {k: v for k, v in self.headers.items() if k.lower() not in STRIP_HEADERS}
        try:
            resp = requests.request(
                self.command, target_url,
                headers=req_headers, data=body,
                proxies=WARP_PROXIES, timeout=30, allow_redirects=False
            )
            self.send_response(resp.status_code)
            for k, v in resp.headers.items():
                if k.lower() not in {'content-encoding', 'transfer-encoding', 'connection'}:
                    self.send_header(k, v)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(resp.content)
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
    def do_GET(self): self.handle_proxy()
    def do_POST(self): self.handle_proxy()
    def do_PUT(self): self.handle_proxy()
    def do_DELETE(self): self.handle_proxy()

if __name__ == '__main__':
    server = http.server.HTTPServer(('0.0.0.0', PORT), ProxyHandler)
    print(f"VRChat Proxy (via WARP) running on port {PORT}")
    server.serve_forever()
