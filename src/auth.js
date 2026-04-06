import { createHash, randomUUID } from 'crypto'
import { getConfig } from './config.js'

// 管理面板 token 存储（内存，重启失效）
const activeTokens = new Map()

const TOKEN_EXPIRY = 24 * 60 * 60 * 1000 // 24 小时

/**
 * 校验管理面板密码，返回 token
 */
export function login(password) {
  const expected = process.env.CCR_ACCESS_PASSWORD
  if (!expected) return null
  if (password !== expected) return null
  const token = randomUUID()
  activeTokens.set(token, Date.now() + TOKEN_EXPIRY)
  return token
}

/**
 * 校验管理面板 token
 */
export function verifyAdminToken(token) {
  if (!token) return false
  const expiry = activeTokens.get(token)
  if (!expiry) return false
  if (Date.now() > expiry) {
    activeTokens.delete(token)
    return false
  }
  return true
}

/**
 * 从请求中提取管理面板 token
 */
export function extractAdminToken(req) {
  const auth = req.headers['authorization']
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7)
  }
  return null
}

/**
 * 从请求中提取代理 API key
 */
export function extractProxyKey(req) {
  // 优先 x-api-key
  const xApiKey = req.headers['x-api-key']
  if (xApiKey) return xApiKey
  // 其次 Authorization: Bearer xxx
  const auth = req.headers['authorization']
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return null
}

/**
 * 校验代理请求的 key 是否在允许列表中
 */
export function verifyProxyKey(key) {
  if (!key) return false
  const config = getConfig()
  // 如果允许列表为空，不做 key 校验（放行所有请求）
  if (!config.allowedKeys || config.allowedKeys.length === 0) return true
  return config.allowedKeys.includes(key)
}
