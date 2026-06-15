# VRCW - VRChat Web Companion

VRCW 是一个运行在 Cloudflare Workers 上的 VRChat 网页伴侣工具，用来集中管理模型、收藏夹、世界、好友、群组、媒体资产、公开模型搜索和上传流程。

[English](README.md) | 简体中文

在线访问：[vrcw.yamadaryo.workers.dev](https://vrcw.yamadaryo.workers.dev)

## 功能

| 模块 | 功能 |
| --- | --- |
| 模型 | 查看自己的模型、模型收藏夹、本地收藏、筛选、下载、清理、编辑/删除，并使用 IndexedDB 优先加载缓存。 |
| 上传 | 上传 `.vrca` 文件，创建新模型或通过 VRChat file/version 流程更新已有模型。 |
| 公开搜索 | 从社区公开数据源搜索 Avatar，查看详情，收藏到指定分组，或通过 VRCX 深链打开。 |
| 好友 | 按在线/离线/收藏分类查看好友，按实例聚合，查看资料、备注、信任/屏蔽/静音状态、邀请、Boop 和右键操作菜单。 |
| 世界 | 查看最近访问、热门、自己上传的世界，支持普通/VRC+ 世界收藏夹、世界详情、实例、清理失效收藏、添加/移除收藏和本地缓存。 |
| 群组 | 查看已加入群组、群组详情、VRChat 允许时的当前实例、成员列表，以及加入/退出/资料可见性操作。 |
| 资产 | 管理 VRC+ 相册图片、拍立得、表情/贴纸、库存/商品和 Avatar Props 等可用资产。 |
| 设置 | 查看和刷新 IndexedDB 持久缓存、图片 Blob 缓存、加入实例偏好和应用信息。 |

## 架构

- 前端：`public/` 下的原生 HTML、CSS 和经典 JavaScript。
- 后端：`worker.js`，Cloudflare Worker，用于代理 VRChat API、转发认证 Cookie、代理图片/下载、代理 S3 上传，以及可选的登录代理转发。
- 存储：浏览器 IndexedDB，用于列表/详情持久缓存和图片 Blob 缓存。
- 部署：通过 `wrangler` 使用 Cloudflare Workers Static Assets。

注意：`public/js/*.js` 是经典脚本，不是 ES module。它们依赖 `public/index.html` 中的加载顺序共享全局变量。

## 本地开发

```bash
npm install
npx wrangler dev --port 8787
```

然后打开 [http://localhost:8787](http://localhost:8787)。

## 部署

```bash
npx wrangler deploy
```

`wrangler.toml` 已配置 `worker.js` 作为 Worker 入口，并把 `./public` 作为静态资源目录。

## 可选登录代理

VRChat 有时会拒绝 Cloudflare Worker IP 登录，并返回 `error code:1003`。VRCW 支持为 `/api/login` 配置外部登录代理。

Worker 当前读取这两个环境变量：

| 变量 | 值 |
| --- | --- |
| `VPS_PROXY_URL` | 你的私有登录代理基础 URL，末尾不要加斜杠。 |
| `VPS_PROXY_SECRET` | 私有共享密钥，必须和代理服务端配置一致。不要提交到仓库。 |

`VPS_PROXY_URL` 末尾不要加斜杠；Worker 会自动拼接 `/api/1/auth/user`。

### 在 Cloudflare Dashboard 配置

1. 打开 Cloudflare Dashboard。
2. 进入 Workers & Pages。
3. 选择 VRCW Worker。
4. 打开 Settings -> Variables and Secrets。
5. 添加文本变量 `VPS_PROXY_URL`。
6. 添加 Secret `VPS_PROXY_SECRET`。
7. 保存后重新部署。

### 使用 Wrangler 配置

如果希望把 URL 写入配置，可在 `wrangler.toml` 中加入：

```toml
[vars]
VPS_PROXY_URL = "https://your-login-proxy.example.com"
```

然后设置 secret 并部署：

```bash
npx wrangler secret put VPS_PROXY_SECRET
npx wrangler deploy
```

## 目录结构

```text
public/                 前端 HTML、CSS、JS、manifest、service worker
worker.js               Cloudflare Worker API 代理和静态资源入口
wrangler.toml           Cloudflare Worker 部署配置
vercel_proxy/           可选 Vercel 登录代理
vps_proxy/              可选自建登录代理示例
memory.md               Codex 本地项目记忆，不作为发布文档
```

## 注意事项

- 需要 VRChat 账号登录，并支持应用内使用的 VRChat 2FA 流程。
- 部分 VRC+ 功能需要有效的 VRC+ 订阅。
- VRChat API 对此类用途并非官方公开稳定接口，可能随时变更或追加权限限制。
- 群组实例列表、私人世界、好友限定位置和部分媒体端点可能因为 VRChat 权限返回 403。
- 本项目是独立个人工具，与 VRChat Inc. 无关联。

## 开源协议

MIT
