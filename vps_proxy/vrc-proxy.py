import http.server
import json
import os
import requests
import socket

PORT = 6790
SECRET = os.environ.get("VPS_PROXY_SECRET", "")
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

def is_warp_available():
    try:
        # Check if WARP SOCKS5 proxy is listening
        with socket.create_connection(("127.0.0.1", 40000), timeout=1):
            return True
    except OSError:
        return False

class ProxyHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass
        
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', '*')
        self.end_headers()

    def send_error_response(self, code, msg):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps({"error": msg}).encode())

    def handle_proxy(self):
        if not SECRET:
            self.send_error_response(500, "VPS_PROXY_SECRET is not configured")
            return
        if self.headers.get('x-proxy-secret') != SECRET:
            self.send_error_response(403, "Forbidden")
            return
            
        target_url = "https://api.vrchat.cloud" + self.path
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else None
        
        req_headers = {k: v for k, v in self.headers.items() if k.lower() not in STRIP_HEADERS}
        
        def make_request(use_warp):
            proxies = WARP_PROXIES if use_warp else None
            return requests.request(
                self.command, target_url,
                headers=req_headers, data=body,
                proxies=proxies, timeout=20, allow_redirects=False
            )

        resp = None
        try:
            # 1. First, attempt direct connection without WARP
            resp = make_request(use_warp=False)
            
            # 2. If VRChat/Cloudflare blocks the request (403/429) AND WARP is running, fallback to WARP
            # Note: VRChat usually returns 401 for wrong credentials, so 401 is passed through normally.
            if resp.status_code in (403, 429) and is_warp_available():
                resp = make_request(use_warp=True)
                
        except requests.exceptions.RequestException as e:
            # Network level failure (Timeout, Connection refused). Try WARP if available.
            if is_warp_available():
                try:
                    resp = make_request(use_warp=True)
                except Exception as e2:
                    self.send_error_response(500, f"Direct & WARP both failed: {str(e2)}")
                    return
            else:
                self.send_error_response(500, f"Direct failed, no WARP available: {str(e)}")
                return
        except Exception as e:
            self.send_error_response(500, str(e))
            return

        # 3. Send response back to client
        self.send_response(resp.status_code)
        for k, v in resp.headers.items():
            if k.lower() not in {'content-encoding', 'transfer-encoding', 'connection'}:
                self.send_header(k, v)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(resp.content)

    def do_GET(self): self.handle_proxy()
    def do_POST(self): self.handle_proxy()
    def do_PUT(self): self.handle_proxy()
    def do_DELETE(self): self.handle_proxy()

if __name__ == '__main__':
    server = http.server.HTTPServer(('0.0.0.0', PORT), ProxyHandler)
    print(f"VRChat Proxy (Auto fallback to WARP) running on port {PORT}")
    server.serve_forever()
