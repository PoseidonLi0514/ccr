import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { login, extractAdminToken, verifyAdminToken } from './auth.js'
import { getConfig, updateConfig, getStats } from './config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(__dirname, '..', 'public')

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

function maskKey(k) {
  if (!k || k.length < 8) return '***'
  return k.slice(0, 4) + '...' + k.slice(-4)
}

export async function handlePanel(req, res) {
  var url = new URL(req.url, 'http://localhost')
  var path = url.pathname

  if (path === '/admin' || path === '/admin/') {
    try {
      var html = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf-8')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    } catch {
      res.writeHead(404)
      res.end('面板页面不存在')
    }
    return
  }

  if (path === '/admin/api/login' && req.method === 'POST') {
    var body = JSON.parse(await readBody(req))
    var tk = login(body.password)
    if (tk) {
      json(res, 200, { token: tk })
    } else {
      json(res, 401, { error: '密码错误' })
    }
    return
  }

  var tk2 = extractAdminToken(req)
  if (!verifyAdminToken(tk2)) {
    json(res, 401, { error: '未登录或 token 已过期' })
    return
  }

  if (path === '/admin/api/config' && req.method === 'GET') {
    var config = getConfig()
    var safe = {
      ccVersion: config.ccVersion,
      options: config.options,
      upstreams: (config.upstreams || []).map(function(u) {
        return {
          id: u.id,
          name: u.name,
          baseUrl: u.baseUrl,
          keys: (u.keys || []).map(function(k) {
            return {
              id: k.id,
              upstreamKey: maskKey(k.upstreamKey),
              customKey: k.customKey || '',
              _hasUpstreamKey: !!k.upstreamKey,
            }
          }),
        }
      }),
    }
    json(res, 200, safe)
    return
  }

  if (path === '/admin/api/config' && req.method === 'PUT') {
    var body2 = JSON.parse(await readBody(req))
    var updated = updateConfig(body2)
    json(res, 200, { message: '配置已更新' })
    return
  }

  if (path === '/admin/api/stats' && req.method === 'GET') {
    json(res, 200, getStats())
    return
  }

  json(res, 404, { error: '接口不存在' })
}
