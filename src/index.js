import { createServer } from 'http'
import { handleProxy } from './proxy.js'
import { handlePanel } from './panel.js'
import { loadConfig } from './config.js'

const PORT = parseInt(process.env.CCR_PORT || '8787', 10)

// 初始化配置
loadConfig()

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = req.url || '/'

  try {
    // 管理面板路由
    if (url.startsWith('/admin')) {
      await handlePanel(req, res)
      return
    }

    // API 代理路由（/v1/messages 等所有 /v1/ 路径）
    if (url.startsWith('/v1/')) {
      await handleProxy(req, res)
      return
    }

    // 根路径 → 重定向到管理面板
    if (url === '/' || url === '') {
      res.writeHead(302, { Location: '/admin' })
      res.end()
      return
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { type: 'not_found', message: '路由不存在' } }))
  } catch (err) {
    console.error('[CCR] 请求处理异常:', err)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { type: 'internal_error', message: err.message } }))
    }
  }
})

server.listen(PORT, () => {
  console.log(`[CCR] Claude Code 请求伪装代理已启动`)
  console.log(`[CCR] 代理端口: ${PORT}`)
  console.log(`[CCR] 管理面板: http://localhost:${PORT}/admin`)
  console.log(`[CCR] 代理地址: http://localhost:${PORT}/v1/messages`)
  if (!process.env.CCR_ACCESS_PASSWORD) {
    console.warn('[CCR] 警告: 未设置 CCR_ACCESS_PASSWORD 环境变量，管理面板登录将无法使用')
  }
})
