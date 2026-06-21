# VRCAM_classic 软件需求规格说明书 (SRS)
 
> **版本**: v80 (Workers Edition)  
> **目标**: 将此文档交给全新 AI Agent，使其能 100% 还原当前项目，无需查看原代码。
 
---
 
## 1. 架构与依赖规范
 
### 1.1 技术栈清单
 
| 层级 | 技术 | 版本要求 |
|---|---|---|
| 后端运行时 | Cloudflare Workers | `wrangler ^3.78.0` |
| 前端 | 原生 JavaScript (经典脚本, 非 ES Module) | ES2020+ |
| 字体 | Google Fonts (Inter) | wght@300;400;500;600;700 |
| 外部 CDN | gifuct-js@2.1.2 | 懒加载, defer |
| 图片缓存 | Service Worker + Cache API | SW 注册 scope `./` |
| 数据库 | IndexedDB (库名 `vrcw_DB`, 版本 4) | 浏览器原生 |
| 运行时 | Cloudflare Workers 兼容日期 ≥ 2024-09-23 | `compatibility_date = "2024-11-01"` |
| PWA | Web App Manifest | `display: standalone` |
| CSP | Content-Security-Policy via `<meta>` | 详见 1.4 |
 
### 1.2 核心目录结构
 
```
VRCAM_classic/
├── worker.js                    # Cloudflare Worker 后端入口 (661行)
├── wrangler.toml                # Worker 部署配置
├── package.json                 # 项目元信息 & wrangler 脚本
├── public/
│   ├── index.html               # SPA 单页面入口 (1149行)
│   ├── style.css                # 全局样式
│   ├── manifest.json            # PWA manifest
│   ├── icon.png                 # PWA 图标 (192+512)
│   ├── sw.js                    # Service Worker (图片缓存)
│   └── js/
│       ├── core.js              # ★ 配置/全局状态/IDB/apiCall/i18n/动画表情 (1446行)
│       ├── common.js            # 信任/平台/位置/proxyImg/日期助手 (175行)
│       ├── images.js            # 图片懒加载/视口取消/批量预取 (298行)
│       ├── logging.js           # 控制台日志 helper (23行)
│       ├── auth.js              # 登录/账号/2FA/进入主界面 (325行)
│       ├── ui-controls.js       # glass-select 下拉组件 (156行)
│       ├── sidebar-profile.js   # 侧边栏迷你资料卡 (28行)
│       ├── shell.js             # ★ 收藏同步/前台加载编排/设置/缓存 (1045行)
│       ├── avatars.js           # ★ 模型分类/列表/收藏/编辑/下载 (1613行)
│       ├── friends.js           # ★ 好友标签/资料/通知/筛选 (936行)
│       ├── friend-profile-shell.js  # 好友资料懒加载壳 (65行)
│       ├── friend-profile.js    # 好友资料详情 (懒加载)
│       ├── worlds-shell.js      # 世界懒加载壳
│       ├── worlds.js            # ★ 世界标签/详情/实例加入 (1306行)
│       ├── groups-shell.js      # 群组懒加载壳
│       ├── groups-instance-shell.js # 群组实例懒加载壳
│       ├── groups-instance.js   # ★ 群组详情/实例/共同好友 (懒加载)
│       ├── search-shell.js      # 搜索懒加载壳
│       ├── search.js            # ★ avtrDB公开搜索/穿戴/Impostor (1659行)
│       ├── context-menu.js      # ★ 右键菜单/社交动作/举报/Boop (懒加载)
│       ├── profile-actions.js   # 个人资料编辑/邀请自己 (懒加载)
│       ├── upload.js            # ★ 上传/MD5/BLAKE2/gzip/缩略图 (987行, 懒加载)
│       ├── media-profile.js     # 图片/表情上传/Gallery/Prints (懒加载)
│       └── assets-groups.js     # ★ 资产/经济/道具/装备 (懒加载)
├── vps_proxy/
│   └── vrc-proxy.js             # VPS 代理 (Node.js, 端口 6790)
├── vercel_proxy/
│   └── api/proxy.js             # Vercel 代理 (备用)
└── test/
    └── worker-security.test.mjs # Worker 安全测试
```
 
**关键约束**: 全部 JS 文件为「经典脚本」(非 ES Module)，按 HTML 中 `<script defer>` 顺序加载，共享全局作用域。函数声明提升为全局，跨文件直接调用。**严禁** `type="module"`。
 
### 1.3 全局环境变量
 
| 变量名 | 位置 | 类型 | 用途 | 默认值 |
|---|---|---|---|---|
| `VPS_PROXY_URL` | Worker `env` | string | VPS 代理地址 | `""` (空=直连) |
| `VPS_PROXY_SECRET` | Worker `env` | string | VPS 代理认证密钥 | `""` |
| `ASSETS` | Worker `env` | CF binding | 静态资产绑定 | 自动注入 |
| `vrc_auth` | localStorage | string | 当前 VRChat 认证 token (base64) | `""` |
| `vrc_accounts` | localStorage | JSON string | 已保存账号列表 | `"[]"` |
| `vrc_device_fingerprint` | localStorage | JSON string | 持久化设备指纹 | 自动生成 |
| `vrc_lang` | localStorage | string | 当前语言 (`en`/`zh`/`ja`) | `"zh"` |
| `vrcw_default_instance_type` | localStorage | string | 默认实例类型 | `"hidden"` |
| `vrcw_default_region` | localStorage | string | 默认地区 | `"use"` |
| `vrcw_avtrdb_match_field` | localStorage | string | 搜索匹配字段 | `"all"` |
| `vrcw_avtrdb_sort` | localStorage | string | 搜索排序 | `"relevance"` |
 
### 1.4 Content Security Policy
 
```
default-src 'self';
script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob: https:;
connect-src 'self' blob:;
object-src 'none';
base-uri 'self';
form-action 'self';
```
 
---
 
## 2. 数据字典与状态模型
 
### 2.1 IndexedDB 模型 (`vrcw_DB`, 版本 4)
 
#### Object Store: `cache` (键值对, 无 keyPath)
 
| 键模式 | 值类型 | TTL | 说明 |
|---|---|---|---|
| `avatars_{groupName}` | `Array<Avatar>` | 无 | 头像完整数据列表 |
| `avatar_basics_{groupName}` | `Array<AvatarBasic>` | 5分钟 | 头像基础信息列表 |
| `avatar_basics_age_{groupName}` | `number` (Date.now()) | — | basics 缓存时间戳 |
| `avatar_detail_{id}` | `Object` (Avatar快照) | 无 | 单个头像详情快照 |
| `persistent_avatar_names` | `Object` (id→name映射) | 无 | 持久化 ID→名称映射 |
| `favorite_groups_avatar` | `Array<FavoriteGroup>` | 无 | 头像收藏分组 |
| `favorite_groups_world` | `Array<FavoriteGroup>` | 无 | 世界收藏分组 |
| `favorite_groups_friend` | `Array<FavoriteGroup>` | 无 | 好友收藏分组 |
| `world_basics_{category}` | `Array<WorldBasic>` | 30分钟 | 世界基础信息列表 |
| `world_basics_age_{category}` | `number` | — | 世界缓存时间戳 |
| `world_name_cache` | `Object` (worldId→name) | 无 | 世界名称缓存 |
| `friend_basics` | `Array<FriendBasic>` | 60秒 | 好友列表缓存 |
| `friend_basics_age` | `number` | — | 好友缓存时间戳 |
| `my_profile` | `Object` (CurrentUser) | 无 | 当前用户资料 |
 
#### Object Store: `mod_logs` (keyPath: `"id"`, autoIncrement)
 
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | number (auto) | 自增主键 |
| `userId` | string | 被管理用户 ID |
| `displayName` | string | 被管理用户名 |
| `type` | string | `"block"`/`"mute"`/`"avatar"` |
| `action` | string | `"block"`/`"unblock"`/`"mute"`/`"unmute"`/`"show"`/`"hide"` |
| `timestamp` | number | Date.now() |
 
#### Object Store: `local_avatars` (keyPath: `"id"`)
 
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 头像 ID (主键) |
| `name` | string | 头像名称 |
| `thumbnailImageUrl` | string | 缩略图 URL |
| 其他字段 | any | 保存时快照的全部头像属性 |
 
**约束**: 本地收藏上限 200 个。
 
#### Object Store: `images` (无 keyPath, 键为 cacheKey 字符串)
 
值类型: `Blob`。键格式: `{bucket}::{url}`。
 
### 2.2 客户端全局状态变量
 
| 变量名 | 类型 | 初始值 | 变更触发 | 所属文件 |
|---|---|---|---|---|
| `vrcAuth` | `string` | `localStorage.vrc_auth \|\| ""` | apiCall 响应头 X-VRC-Auth; 登录/登出 | core.js |
| `avatars` | `Array` | `[]` | fetchAvatars; switchCategory | core.js |
| `selectedIds` | `Set<string>` | `new Set()` | 用户选择/清除; switchCategory 重置 | core.js |
| `uploadFiles` | `Array<File>` | `[]` | 文件拖拽/选择/移除 | core.js |
| `currentLang` | `string` | `localStorage.vrc_lang \|\| "zh"` | setLang() | core.js |
| `saveDirHandle` | `FileSystemDirectoryHandle \| null` | `null` | pickSaveDir/clearSaveDir | core.js |
| `visibleAvatars` | `Array` | `[]` | applyFilters | core.js |
| `currentTab` | `string` | `"download"` | switchTab | core.js |
| `currentUserId` | `string` | `""` | showMainApp → /api/vrc/auth/user | core.js |
| `currentGlobalFetchSeq` | `number` | `0` | runPriorityTask | core.js |
| `currentWorldFetchSeq` | `number` | `0` | fetchWorlds | core.js |
| `currentUiEpoch` | `number` | `0` | bumpUiEpoch (switchTab/打开modal) | core.js |
| `selectedWorldIds` | `Set<string>` | `new Set()` | 世界选择 | core.js |
| `isPriorityTaskRunning` | `boolean` | `false` | runPriorityTask enter/leave | core.js |
| `myModerations` | `Array` | `[]` | fetchMyModerations | core.js |
| `favoriteGroups` | `Array` | `[]` | fetchFavoriteGroups | core.js |
| `worldFavGroups` | `Array` | `[]` | loadWorldFavGroups | core.js |
| `friendFavGroups` | `Array` | `[]` | fetchFavoriteGroups | core.js |
| `favoriteIdMap` | `Map<avatarId, favoriteId>` | `new Map()` | syncAllFavoriteIds | core.js |
| `avatarFavTagMap` | `Map<avatarId, Set<groupName>>` | `new Map()` | syncAllFavoriteIds | core.js |
| `worldFavoriteIdMap` | `Map<worldId, favoriteId>` | `new Map()` | syncAllFavoriteIds | core.js |
| `worldFavGroupCounts` | `Map<groupName, number>` | `new Map()` | syncAllFavoriteIds | core.js |
| `avatarFavGroupCounts` | `Map<groupName, number>` | `new Map()` | syncAllFavoriteIds | core.js |
| `friendFavoriteIdMap` | `Map<userId, {favoriteId, tags}>` | `new Map()` | syncAllFavoriteIds | core.js |
| `_localNameMap` | `Map<avatarId, name>` | `new Map()` | initLocalNameMap; persistName | core.js |
| `localAvatarFavs` | `Array` | `[]` | syncLocalFavorites | core.js |
| `localAvatarIdMap` | `Map<avatarId, true>` | `new Map()` | syncLocalFavorites | core.js |
| `allFriends` | `Array` | `[]` | fetchFriends | friends.js |
| `allWorlds` | `Array` | `[]` | fetchWorlds | worlds.js |
| `currentCategory` | `string` | `"mine"` | switchCategory | avatars.js |
| `currentWorldCategory` | `string` | — | switchWorldCategory | worlds.js |
| `currentFriendCategory` | `string` | `"myprofile"` | switchFriendCategory | friends.js |
| `myProfileData` | `Object \| null` | `null` | fetchMyProfile | friends.js |
| `currentFriendProfile` | `Object \| null` | `null` | openFriendProfile | friends.js |
| `currentWorldDetail` | `Object \| null` | `null` | openWorldDetail | worlds.js |
 
### 2.3 核心枚举与常量
 
#### Worker 端常量
 
| 名称 | 值 | 说明 |
|---|---|---|
| `VRC_API` | `"https://api.vrchat.cloud/api/1"` | VRChat API 基础 URL |
| `API_KEY` | `"JlGlobalv959ay9puS6p99En0asKuAk"` | VRChat API Key |
| `USER_AGENT` | `"VRCX/1.6.4 (vrcxml@gmail.com)"` | Worker 请求 User-Agent |
 
#### SSRF 白名单 (`ALLOWED_HOST_SUFFIXES`)
 
```
".vrchat.cloud", ".vrchat.com", ".avtrdb.com", ".vrcdb.com",
".avatarrecovery.com", ".cute.bet", ".nekosunevr.co.uk",
".amazonaws.com", ".cloudfront.net"
```
 
#### SSRF 白名单 (`ALLOWED_HOSTS` - 精确匹配)
 
```
"vrchat.cloud", "vrchat.com", "avtrdb.com", "vrcdb.com",
"avatarrecovery.com", "cute.bet", "nekosunevr.co.uk"
```
 
#### 上传目标白名单: 仅允许 `*.amazonaws.com` + `*.cloudfront.net` 且含 `X-Amz-Signature` 或 `X-Amz-Credential`。
 
#### 前端核心常量
 
| 名称 | 值 | 说明 |
|---|---|---|
| `APP_BUILD_LABEL` | `"Workers Edition"` | 构建标签 |
| `APP_CACHE_VERSION` | URL参数 `v` 或 `"82"` | 缓存版本号(显示为 v80) |
| `API_BASE` | `location.origin` | API 基础地址 |
| `API_MICRO_CACHE_MS` | `15000` | GET 请求内存缓存时长 (15秒) |
| `API_SLOW_LOG_MS` | `2500` | 慢请求日志阈值 |
| `AVATARS_CACHE_TTL` | `5 * 60 * 1000` | 头像 IDB 缓存 TTL (5分钟) |
| `WORLDS_CACHE_TTL` | `30 * 60 * 1000` | 世界 IDB 缓存 TTL (30分钟) |
| `FRIENDS_CACHE_TTL` | `60000` | 好友缓存 TTL (60秒) |
| `MAX_CONCURRENT_IMAGES` | `12` | 图片并发加载数 |
| `BATCH_SIZE` (prefetch) | `40` | 图片预取批次大小 |
| `MAX_BATCH` (Worker) | `40` | Worker prefetch 批次上限 |
| `NO_CACHE_PATTERNS` | `["/notifications", "/auth/user/friends", "/instances/", "/invite"]` | 不走 micro-cache 的路径 |
| `PHOTON_EMOJIS` | 66个默认表情名称 | Boop 表情列表 |
| `CACHE_NAME` (SW) | `"vrcw-img-v2"` | Service Worker 缓存名 |
| `IMAGE_PATH` (SW) | `"/api/image"` | SW 拦截路径 |
 
#### 信任等级映射 (`getTrustInfo`)
 
| Tag | Label | Color | CSS Class |
|---|---|---|---|
| `system_trust_veteran` | Trusted User | `#B18FFF` | veteran |
| `system_trust_trusted` | Known User | `#FF7B42` | trusted |
| `system_trust_known` | User | `#2BCF5C` | known |
| `system_trust_basic` | New User | `#1172B5` | basic |
| (无匹配) | Visitor | `#CCCCCC` | visitor |
 
#### 平台映射
 
| API 值 | 显示 | Emoji |
|---|---|---|
| `standalonewindows` | PC | 🖥️ PC |
| `android` | Quest | 🥽 Quest |
| `ios` | iOS | 📱 iOS |
| `web` | Web | 🌐 Web |
 
#### 实例类型 (`INSTANCE_TYPE_LABELS`)
 
| Key | Label |
|---|---|
| `hidden` | Friends+ (好友加) — **默认** |
| `public` | 公开 (Public) |
| `friends` | 仅好友 (Friends Only) |
| `invite` | 邀请 (Invite Only) |
| `inviteplus` | 邀请加 (Invite+) |
 
#### 地区标签 (`REGION_LABELS`)
 
| Key | Label |
|---|---|
| `use` | 🇺🇸 美国东 (US East) — **默认** |
| `usw` | 🇺🇸 美国西 (US West) |
| `eu` | 🇪🇺 欧洲 (Europe) |
| `jp` | 🇯🇵 日本 (Japan) |
 
#### 交易状态 (`statusLabels`)
 
| Key | Label | Color |
|---|---|---|
| `succeeded` | ✅ 成功 | `#86efac` |
| `expired` | ⏰ 已过期 | `#fbbf24` |
| `failed` | ❌ 失败 | `#f87171` |
 
#### 装备槽 (`_equipSlotLabels`)
 
| Key | Label |
|---|---|
| `drone` | 无人机 |
| `portal` | 传送门 |
| `warp` | 传送 |
| `loadingscreen` | 加载屏幕 |
 
---
 
## 3. 接口规范 (API & 数据通信)
 
### 3.1 Worker 自有端点
 
#### 3.1.1 `OPTIONS *` — CORS Preflight
 
- **响应**: HTTP 204, CORS Headers
- **CORS Headers**:
  ```
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
  Access-Control-Allow-Headers: Content-Type, Authorization, X-VRC-Auth, X-S3-Url, X-S3-content-md5, X-S3-content-type
  Access-Control-Expose-Headers: X-VRC-Auth
  ```
 
#### 3.1.2 `POST /api/login` — 登录认证
 
**请求体**:
```json
{ "username": "string", "password": "string", "fingerprint": { "mac": "string", "hwid": "string", "version": "string" } }
```
 
**处理逻辑**:
1. 构建 `Authorization: Basic {base64(username:password)}` (URL编码版本)
2. 发送 `GET {VRC_API}/auth/user` 带自定义 header:
   - `User-Agent: VRChat/{version} Win32`
   - `X-MacAddress`, `X-Client-Version`, `X-Platform: standalonewindows`
   - `X-SDK-Version: VRCSDK3-2024.01.22.18.33`, `X-HWID`, `X-Forwarded-For: CF-Connecting-IP`
3. 若配置了 `VPS_PROXY_URL` + `VPS_PROXY_SECRET`, 请求发往 VPS 代理 (添加 `X-Proxy-Secret` header)
4. 若响应 401 且 error.message 包含 "invalid", 用未 URL 编码的 `username:password` 重试
5. 合并 `set-cookie` 为 base64 `X-VRC-Auth` 返回
 
**成功响应** (HTTP 200):
```json
{ "ok": true, "etag": "string(无引号)" }
```
Header: `X-VRC-Auth: {base64(merged_cookies)}`
 
**限流响应** (HTTP 200, vrcStatus=429):
```json
{ "vrcResponse": {...}, "vrcStatus": 429, "rateLimited": true, "retryAfterSeconds": 60 }
```
 
**安全约束**: 不回显凭据、原始 auth 字符串或上游 set-cookie。
 
#### 3.1.3 `POST /api/2fa` — 二步验证
 
**请求体**: `{ "code": "string", "type": "totp" | "emailotp" }`
 
**路径映射**:
- `type === "emailotp"` → `/auth/twofactorauth/emailotp/verify`
- 否则 → `/auth/twofactorauth/totp/verify`
 
**成功**: `{ "ok": true }` + Header `X-VRC-Auth: {base64(merged_cookies)}`
**失败**: `{ "ok": false, "message": "Invalid code" }` HTTP 400
**异常**: `{ "ok": false, "message": "驂证失败：服务器异常 (e.message)" }` HTTP 500
 
#### 3.1.4 `GET /api/image?url=...&auth=...&bucket=...` — 图片代理
 
**参数**:
| 参数 | 位置 | 必需 | 说明 |
|---|---|---|---|
| `url` | query | 是 | 目标图片 URL |
| `auth` | query | 否 | base64 编码的 auth cookie (备选) |
| `bucket` | query | 否 | 缓存桶 (默认 `authBucket(auth)`) |
 
**处理**:
1. SSRF 校验: `isAllowedTarget(url)` → 不通过返回 403
2. 查 CF Cache API (key: `/api/image?bucket={bucket}&url={url}`)
3. 未命中: `fetch(url, { headers: {User-Agent, Referer:"https://vrchat.com/", Cookie}, redirect:"follow", signal: timeout(20s) })`
4. 成功: 返回图片流, `Cache-Control: public, max-age=604800, immutable`, 后台 `ctx.waitUntil(cache.put())`
5. 失败: 上游非 ok → 同状态码 + "Image fetch failed"; 异常 → 500
 
#### 3.1.5 `GET /api/proxy?url=...` — 第三方 JSON CORS 代理
 
- SSRF 校验 → 不通过 403
- 透传 `arrayBuffer` + 上游 status + Content-Type
- 异常 → `{ error }` 500
 
#### 3.1.6 `POST /api/images/prefetch` — 批量图片预缓存
 
**请求体**: `{ "urls": string[], "bucket?": string }`
 
- 过滤 `isAllowedTarget`, 最多取 40 条
- 并发 fetch + cache.put
- 单张失败静默跳过
- **响应**: `{ "ok": true, "cached": N, "fetched": M, "total": T }`
 
#### 3.1.7 `GET /api/download?url=...&filename=...&auth=...` — 文件下载代理
 
**参数**:
| 参数 | 位置 | 说明 |
|---|---|---|
| `url` | query | VRChat 文件 URL |
| `filename` | query | 下载文件名 (经 sanitizeDownloadFilename 处理) |
| `auth` | query | base64 auth (因 `<a>.click()` 无法发自定义 header) |
 
**处理**:
1. `resolveRedirects()`: 手动跟随最多 5 次 301/302/303/307/308, 每次检查 SSRF
2. 401 → 返回 `{ error: "VRChat auth expired" }` 401
3. CDN 返回 403 → 重新 resolveRedirects 重试一次
4. 检查 Content-Type: 若含 `text/html` 或 `application/json` → 502 (防止代理 CF challenge 页)
5. 成功: `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="..."; filename*=UTF-8''...`
 
**sanitizeDownloadFilename**: 去除 `\r\n"`, 替换 `\/` 为 `_`, 截断 180 字符, 默认 `"avatar.vrca"`。
 
#### 3.1.8 `PUT /api/s3proxy` — S3 上传代理
 
**必需 Header**: `X-S3-Url` (S3 预签名 URL)
 
**处理**:
1. `isAllowedUploadTarget(s3Url)`: 必须是 `*.amazonaws.com` 或 `*.cloudfront.net` 且含 `X-Amz-Signature` 或 `X-Amz-Credential`
2.
从预签名 URL 解析 X-Amz-SignedHeaders 参数，映射 Worker header:
   - Worker X-S3-content-md5 → S3 Content-MD5
   - Worker X-S3-content-type → S3 Content-Type
3. 若 URL 含 Content-Type= 参数，从请求头中删除 (S3 规则禁止重复)
4. **关键**: body 包装为 new Blob([bodyBuffer]) (空 type)，防止 CF Workers 自动注入 Content-Type
5. 若未提供 x-amz-content-sha256，自动填 "UNSIGNED-PAYLOAD"

**成功响应** (HTTP 200):
```json
{ "ok": true, "etag": "string(无引号)" }
```

**失败响应** (HTTP 400/500):
```json
{ "ok": false, "status": N, "error": "截断500字符" }
```
```

#### 3.1.9 ALL /api/vrc/* — VRChat API 全量代理

- **路径转换**: /api/vrc/... → {VRC_API}/... + ?apiKey={API_KEY}
- **请求体处理**: application/json → text 透传; multipart/form-data → arrayBuffer
- **响应**: arrayBuffer 原样返回 (避免 emoji/UTF-8 被 text() 破坏)
- **Header**: 添加 X-VRC-Auth: btoa(merged_cookies)

#### 3.1.10 其他路由

| 路径 | 处理 |
|---|---|
| GET / 或 /index.html | env.ASSETS.fetch(request) 或 200 |
| 不匹配任何路由 | { "error": "Not found" } HTTP 404 |

### 3.2 前端 apiCall 统一通信封装

```javascript
async function apiCall(path, options = {})
```
```

**参数**: path, method, json, body, headers, noAbort, noCache, noDedupe, cache, signal

**鉴权**: 若 vrcAuth 存在，添加 X-VRC-Auth: vrcAuth header。

**缓存策略**: GET + 非黑名单路径 → 15秒内存 micro-cache + 去重

**Abort 处理**: AbortError → 返回 HTTP 499 stub

---

## 4. 核心功能与业务逻辑

### 4.1 认证与登录模块

#### 4.1.1 自动登录流程
- DOMContentLoaded 时检查 vrcAuth → GET /api/vrc/auth/user
- 成功 → showMainApp(); 失败 → 聚焦输入框

#### 4.1.2 手动登录流程 (doLogin())
1. 禁用按钮，显示 "登录中..."
2. getDeviceFingerprint() → 生成随机 MAC + HWID
3. POST /api/login with { username, password, fingerprint }
4. 响应处理: rateLimited → 倒计时; 200+2FA → 2FA流程; 200 → showMainApp

#### 4.1.3 2FA 验证
- 根据 requiresTwoFactorAuth 决定 type: totp 或 emailotp
- POST /api/2fa with { code, type }

#### 4.1.4 登出 (doLogout())
- 清空 vrcAuth + 全局状态 + modal → 显示登录页
- **不调用** VRChat /logout API

### 4.2 模型管理模块 (avatars.js)

#### 4.2.1 分类与切换 (switchCategory(cat))
- 重置 selectedIds + 切换按钮高亮
- mine/local → fetchAvatars(false); 其他收藏夹 → fetchAvatars(true)

#### 4.2.2 模型列表加载
- **Stale-While-Revalidate**: 先读 IDB 缓存 (TTL 5分钟) → 后台刷新
- **Progressive Render**: 每批到达即追加卡片
- **失效模型处理**: 404/403 标记 isInvalid: true

#### 4.2.3 过滤与搜索
- 状态过滤: all/public/private
- 平台过滤: pc/pc-quest/pc-quest-apple
- 文本搜索评分: 名称100 > 标签30 > 描述10 > 模糊5

#### 4.2.4 收藏操作
- **添加**: POST /api/vrc/favorites
- **取消**: DELETE /api/vrc/favorites/{favoriteId}
- **批量**: 间隔300ms防限流

#### 4.2.5 编辑/删除/下载
- 编辑: PUT /api/vrc/avatars/{id}
- 删除: DELETE /api/vrc/avatars/{id}
- 下载: 并发4，优先PC无variant URL

### 4.3 搜索模块 (search.js)

#### 4.3.1 avtrDB 公开模型搜索
- **并发源**: avtrdb + vrcdb + avatarrecovery + cute.bet + nekosunevr
- **流式架构**: 每源到达即刷新 grid
- **后台分页驱动**: 自动翻页直到 has_more=false

### 4.4 上传模块 (upload.js)

#### 4.4.1 上传流程 (startUpload())
1. 创建 File + Version
2. 上传签名 (rsync signature)
3. 分块上传文件 (CHUNK_SIZE = 10MB)
4. 等待处理 → 创建头像

**更新模式**: Blueprint ID 补丁 + 重新计算MD5/签名

#### 4.4.2 算法
- **MD5**: SparkMD5 内联实现
- **BLAKE2b-256**: 完整实现
- **Rsync Signature**: weak(adler32) + strong(BLAKE2b-256)

### 4.5 世界模块 (worlds.js)

- 收藏夹: 获取ID列表 → 并发(8)获取详情 → 流式追加
- 其他: recent/active/mine
- 加入实例: POST /instances → POST /invite/myself → vrchat://launch

### 4.6 好友模块 (friends.js)

- 分类: myprofile/all/online/offline/fav_*
- 右键菜单: VRCX风格，包含社交动作/模型控制/管理

### 4.7 群组/实例模块

- 群组详情: Banner + 图标 + 成员列表 + 实例列表
- 实例详情: 在线玩家 + 好友在此 + 邀请自己

### 4.8 资产/经济模块

- 余额/商店/交易记录/VRC+订阅/Emoji/Gallery/Props

---

## 5. UI 组件规范

### 5.1 玻璃下拉组件
- 半透明背景 + 边框
- 点击展开 → 选项列表 → 点击选择

### 5.2 卡片组件
- 头像卡片: avatar-thumb-wrapper + name-overlay + checkbox + fav-quick
- 世界卡片: 额外显示在线人数 + 好友数

### 5.3 Modal 弹窗
- 全屏遮罩 + 居中内容
- modalZTop() 计算z-index; lockBodyScroll() 禁止背景滚动

### 5.4 Toast 通知
- showToast(message, type)
- 顶部居中，自动消失3秒

### 5.5 右键菜单
- buildCtxMenu(sections) 构建多section菜单
- positionCtxMenu() 定位避免溢出

---

## 6. 缓存与性能策略

### 6.1 IndexedDB 缓存
| 数据类型 | Key | TTL |
|---|---|---|
| 头像基础 | avatar_basics_{category} | 5分钟 |
| 世界基础 | world_basics_{category} | 30分钟 |
| 好友列表 | friend_basics | 60秒 |

### 6.2 API Micro-Cache
- 内存 Map apiCache (15秒 TTL)
- GET 复用 Promise (去重)

### 6.3 图片缓存
- Service Worker: 拦截 /api/image，Cache API存储7天
- Worker: CF Cache API永久缓存
- 前端: IntersectionObserver懒加载，并发12，预取40

### 6.4 流式渲染
- 每批到达即追加卡片，不重建grid
- DOM Reconciliation: 检查已有卡片，仅更新变化

---

## 7. 安全约束

### 7.1 SSRF 防护
- 仅允许白名单域名
- 上传目标仅允许 AWS S3/CloudFront + 签名

### 7.2 认证安全
- 不回显凭据; Auth token base64编码
- 登出不调用/logout API

### 7.3 限流处理
- 登录限流: 倒计时 + 禁用按钮
- API请求: 间隔200-300ms

---

## 8. 国际化
- 支持: zh(默认), en, ja
- 函数: t(key) → translations[currentLang][key]

---

## 9. 错误处理
- AbortError → 499 stub
- HTTP 429 → 限流提示; 401 → 重新登录; 404/403 → 标记失效

---

## 10. 模块注册系统

```javascript
window.VRCW = { modules: {}, registerModule(name, exports) }
VRCW.registerModule("avatars", { switchCategory, fetchAvatars, ... });
```

---

## 11. 部署配置

```toml
name = "vrcw"
main = "worker.js"
compatibility_date = "2024-11-01"

[vars]
VPS_PROXY_URL = ""
VPS_PROXY_SECRET = ""

[site]
bucket = "./public"
```

---

## 12. 测试覆盖
- SSRF白名单验证; 上传目标验证; 登录凭据不回显; 2FA流程

---

## 附录 A: 关键函数签名

```javascript
// core.js
apiCall(path, options)
runPriorityTask(taskFn)
bumpUiEpoch()

// avatars.js
fetchAvatars(forceRefresh)
switchCategory(cat)
applyFilters()
unfavorite(avatarId, avatarName)
downloadSelected()

// worlds.js
fetchWorlds(category, forceRefresh)
openWorldDetail(worldId)
joinWorldInstance()

// search.js
doAvtrdbSearch()
_collectAvatar(av)

// upload.js
startUpload()
patchBlueprintId(vrcaBytes, newAvatarId)
computeRsyncSignature(fileData)
blake2b256(data)

// friends.js
fetchMyProfile(forceRefresh)
openFriendProfileById(userId)
showFriendContextMenu(e)

// context-menu.js
buildCtxMenu(sections)
positionCtxMenu(e, menu)
showGroupInviteMenu(ev, userId, userName)
```

---

## 附录 B: VRChat API 常用端点
| 端点 | 方法 | 说明 |
|---|---|---|
| /auth/user | GET | 当前用户 |
| /users/{id} | GET | 用户详情 |
| /avatars?user=me | GET | 我的头像 |
| /avatars/{id} | GET/PUT/DELETE | 头像CRUD |
| /favorites | POST/DELETE | 收藏操作 |
| /worlds/{id} | GET/DELETE | 世界详情 |
| /instances | POST | 创建实例 |
| /file | POST | 创建文件 |
| /file/{id}/{ver}/file/start | PUT | 开始上传 |
| /file/{id}/{ver}/file/finish | PUT | 完成上传 |

---

**文档版本**: 2025-01-20
**生成方式**: 从源码逆向分析
**用途**: 交付给新 AI Agent 完全还原项目