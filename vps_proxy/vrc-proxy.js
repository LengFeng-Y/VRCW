const http = require('http');
const https = require('https');
const PORT = 6790;
const AUTH_SECRET = "YOUR_SECRET_HERE"; // 安全密钥
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    if (req.headers['x-proxy-secret'] !== AUTH_SECRET) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Forbidden: Invalid secret" }));
        return;
    }
    const targetUrl = 'https://api.vrchat.cloud' + req.url;
    console.log(`[${new Date().toISOString()}] Proxying ${req.method} ${targetUrl}`);
    const headers = { ...req.headers };
    delete headers['host'];
    delete headers['x-proxy-secret'];
    const vrcReq = https.request(targetUrl, {
        method: req.method,
        headers: headers
    }, (vrcRes) => {
        res.writeHead(vrcRes.statusCode, vrcRes.headers);
        vrcRes.pipe(res);
    });
    vrcReq.on('error', (err) => {
        console.error('Proxy error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
    });
    req.pipe(vrcReq);
});
server.listen(PORT, () => {
    console.log(`VRChat Proxy Server is running on port ${PORT}`);
});
