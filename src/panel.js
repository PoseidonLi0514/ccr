import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { login, extractAdminToken, verifyAdminToken } from './auth.js'
import { getConfig, updateConfig, getStats } from './config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(__dirname, '..', 'public')

/**
 * 读取请求体
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

/**
 * 处理管理面板请求
 */
export async function handlePanel(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname

  // 静态页面
  if (path === '/admin' || path === '/admin/') {
    try {
      const html = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf-8')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    } catch {
      res.writeHead(404)
      res.end('面板页面不存在')
    }
    return
  }

  // 登录
  if (path === '/admin/api/login' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    const token = login(body.password)
    if (token) {
      json(res, 200, { token })
    } else {
      json(res, 401, { error: '密码错误' })
    }
    return
  }

  // 以下 API 需要鉴权
  const token = extractAdminToken(req)
  if (!verifyAdminToken(token)) {
    json(res, 401, { error: '未登录或 token 已过期' })
    return
  }

  // 获取配置
  if (path === '/admin/api/config' && req.method === 'GET') {
    const config = getConfig()
    // 脱敏上游密钥
    const safe = {
      ...config,
      upstream: {
        ...config.upstream,
        apiKey: config.upstream.apiKey ? '***' + config.upstream.apiKey.slice(-6) : '',
      },
    }
    json(res, 200, safe)
    return
  }

  // 更新配置
  if (path === '/admin/api/config' && req.method === 'PUT') {
    const body = JSON.parse(await readBody(req))
    const updated = updateConfig(body)
    json(res, 200, { message: '配置已更新', config: updated })
    return
  }

  // 获取统计
  if (path === '/admin/api/stats' && req.method === 'GET') {
    json(res, 200, getStats())
    return
  }

  json(res, 404, { error: '接口不存在' })
}
