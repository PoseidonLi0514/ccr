# CCR

Claude Code Request Proxy — 将标准 Anthropic API 请求伪装为 Claude Code 客户端请求。

## 为什么需要这个

通过 Go/Python 等语言编写的 API 网关转发请求时，Anthropic 会检测到非 Claude Code 客户端（如 `Go-http-client/2.0`）并拒绝。CCR 使用 Node.js 原生 HTTP 实现，TLS 指纹与 Claude Code（基于 Bun/Node.js）一致，同时注入完整的 CC 请求特征。

## 特性

- **零依赖** — 纯 Node.js 原生实现，无 npm 依赖
- **完整伪装** — User-Agent、anthropic-beta、session ID、billing header、fingerprint 全部按 CC 源码还原
- **真实指纹算法** — SHA256 fingerprint 与 CC 完全一致
- **流式透传** — 支持 SSE streaming 响应
- **Web 管理面板** — 配置上游地址/密钥、管理请求 Key、查看统计
- **PM2 支持** — 开箱即用的 ecosystem.config.cjs

## 快速开始

```bash
git clone https://github.com/PoseidonLi0514/ccr.git
cd ccr

# 启动（设置管理面板密码）
CCR_ACCESS_PASSWORD=你的密码 node src/index.js
```

打开 `http://localhost:8787/admin`，登录后配置上游密钥即可使用。

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `CCR_ACCESS_PASSWORD` | 管理面板登录密码（必填） | - |
| `CCR_PORT` | 监听端口 | `8787` |

## PM2 部署

```bash
# 编辑 ecosystem.config.cjs 中的环境变量
pm2 start ecosystem.config.cjs

# 常用命令
pm2 status ccr
pm2 logs ccr
pm2 restart ccr
```

## 使用方式

### 作为 NewAPI 上游

将 NewAPI 渠道的上游地址设为：

```
http://你的服务器IP:8787
```

NewAPI → CCR（伪装） → Anthropic API

### 直接调用

```bash
curl http://localhost:8787/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: 你配置的请求Key" \
  -d '{
    "model": "claude-sonnet-4-6-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

## 管理面板

访问 `http://localhost:8787/admin`

- **上游配置** — 设置 Anthropic API 地址和密钥
- **请求 Key 管理** — 添加/删除允许访问代理的 Key（留空则不校验）
- **CC 版本号** — 伪装的 Claude Code 版本（默认 2.1.88）
- **运行统计** — 总请求数、成功/失败数、运行时长

## 注入的请求特征

**请求头：**

```
User-Agent: claude-cli/2.1.88 (consumer, cli)
x-app: cli
anthropic-version: 2023-06-01
anthropic-beta: claude-code-20250219,interleaved-thinking-2025-05-14,...
X-Claude-Code-Session-Id: <uuid>
x-client-request-id: <uuid>
```

**请求体：**

- `metadata.user_id` — CC 格式的设备/会话标识
- `system` 字段追加 `x-anthropic-billing-header` 归因信息
- fingerprint 按 CC 真实算法计算（SHA256 + salt）

## 项目结构

```
ccr/
├── src/
│   ├── index.js          # 入口，HTTP 服务 + 路由
│   ├── proxy.js          # 代理核心：拦截 → 注入 → 转发 → 透传
│   ├── cc-headers.js     # CC 特征构造（指纹、headers、attribution）
│   ├── config.js         # 配置读写（data/config.json）
│   ├── auth.js           # 鉴权（请求 Key + 面板密码）
│   └── panel.js          # 管理面板 API
├── public/
│   └── index.html        # 管理面板前端
├── ecosystem.config.cjs  # PM2 配置
└── .env.example          # 环境变量示例
```

## 要求

- Node.js >= 18

## License

MIT
