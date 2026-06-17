# VRCW 专用 VPS 登录代理

本目录下的代码用于部署在私人 VPS 上，作为 VRCW 登录端点 (`/api/login`) 的专用转发代理，用来绕过 VRChat 针对 Cloudflare Worker IP 的 `error code:1003` 封锁。

## 当前部署信息

| 项目 | 值 |
|------|-----|
| VPS 服务器 | `YOUR_VPS_DOMAIN` = `YOUR_VPS_IP` |
| 监听端口 | `6790` |
| 运行脚本 | `vrc-proxy.py` (Python3 + requests + WARP SOCKS5) |
| systemd 服务 | `vrc-proxy.service`（开机自启） |
| CF 环境变量 `VPS_PROXY_URL` | `http://YOUR_VPS_IP:6790` |
| CF 环境变量 `VPS_PROXY_SECRET` | 通过 Secret/env var 配置，不要写入文件 |
| WARP 出口 | `socks5h://127.0.0.1:40000`（Cloudflare WARP proxy 模式） |

## 工作原理

```
浏览器 → Cloudflare Worker (/api/login)
       → VPS (YOUR_VPS_IP:6790)  [过滤CF头，走WARP出口]
       → WARP SOCKS5 (127.0.0.1:40000)
       → VRChat API (api.vrchat.cloud)
```

Worker 直连 VRChat 会因 Cloudflare IP 被 VRChat 识别为 `error code:1003`。
VPS IP 本身不被封，但转发时若携带 `cf-ray`、`cf-ipcountry` 等 CF 头，同样触发 1003。
新版脚本同时解决了两个问题：① 过滤 CF 头；② 通过 WARP 出口（备用保险）。

## 部署步骤（新服务器）

### 依赖安装
```bash
apt install python3-requests python3-socks -y
```

### 安装 Cloudflare WARP
```bash
curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --yes --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ bookworm main" | tee /etc/apt/sources.list.d/cloudflare-client.list
apt update && apt install cloudflare-warp -y
warp-cli registration new
warp-cli mode proxy
warp-cli connect
```

### 创建 systemd 服务
```bash
cat > /etc/systemd/system/vrc-proxy.service << 'EOF'
[Unit]
Description=VRChat Avatar Manager Proxy Service
After=network.target

[Service]
ExecStart=/usr/bin/python3 /root/vrc-proxy.py
Restart=always
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable vrc-proxy.service
systemctl start vrc-proxy.service
```

### 验证是否正常
```bash
curl -s -w "\nHTTP: %{http_code}" http://localhost:6790/api/1/auth/user \
  -H "x-proxy-secret: $VPS_PROXY_SECRET" \
  -H "Authorization: Basic dGVzdDp0ZXN0" \
  -H "User-Agent: VRChat/1.24.0 Win32"
# 应返回 {"error":{"message":"Invalid Username/Email or Password","status_code":401}} HTTP: 401
```

## Cloudflare Worker 环境变量（缺一不可）

在 Cloudflare 后台 Workers & Pages → vrcw → Settings → Variables and Secrets 设置：

- **VPS_PROXY_URL**（纯文本）：`http://YOUR_VPS_IP:6790`（末尾无斜杠）
- **VPS_PROXY_SECRET**（密钥）：通过 Secret/env var 配置，不要写入文件

设置后务必点 **Save and deploy** 触发重新部署，否则不生效。
也可以在本地运行 `npx wrangler deploy` 触发新部署。

## 排查清单

| 症状 | 原因 | 解决方法 |
|------|------|---------|
| `error code:1003` | Worker 没用代理（环境变量未生效） | `npx wrangler deploy` 触发重新部署 |
| `error code:1003` | 代理转发了 CF 头 | 确认用新版 `vrc-proxy.py`（含 STRIP_HEADERS） |
| 522 Connection Timeout | VPS 端口未开放或脚本未运行 | `ss -tulpn | grep 6790` 检查 |
| 500 Proxy Error | WARP 未连接 | `warp-cli status` + `warp-cli connect` |
