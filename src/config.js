import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dirname, '..', 'data', 'config.json')

const DEFAULT_CONFIG = {
  // 上游端点列表：每个端点一个 baseUrl + 多个 keys
  // upstreams: [{ id, baseUrl, name, keys: [{ id, upstreamKey, customKey }] }]
  upstreams: [],
  ccVersion: '2.1.117',
  options: {
    injectBillingHeader: true,
    injectMetadata: false,
  },
}

let configCache = null

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/**
 * 兼容旧配置：把 upstream（单一 baseUrl+apiKey）+ allowedKeys 迁移为 upstreams
 */
function migrate(config) {
  if (config.upstreams && Array.isArray(config.upstreams)) {
    return config
  }
  const upstreams = []
  const legacyUpstream = config.upstream
  if (legacyUpstream && legacyUpstream.baseUrl && legacyUpstream.apiKey) {
    const customKeys = Array.isArray(config.allowedKeys) ? config.allowedKeys : []
    const keys = []
    if (customKeys.length > 0) {
      for (const ck of customKeys) {
        keys.push({ id: genId(), upstreamKey: legacyUpstream.apiKey, customKey: ck })
      }
    } else {
      keys.push({ id: genId(), upstreamKey: legacyUpstream.apiKey, customKey: '' })
    }
    upstreams.push({
      id: genId(),
      name: '默认端点',
      baseUrl: legacyUpstream.baseUrl,
      keys,
    })
  }
  const migrated = { ...config, upstreams }
  delete migrated.upstream
  delete migrated.allowedKeys
  return migrated
}

function normalize(config) {
  const upstreams = Array.isArray(config.upstreams) ? config.upstreams : []
  for (const u of upstreams) {
    if (!u.id) u.id = genId()
    if (!u.name) u.name = u.baseUrl || '未命名端点'
    if (!Array.isArray(u.keys)) u.keys = []
    for (const k of u.keys) {
      if (!k.id) k.id = genId()
      if (typeof k.upstreamKey !== 'string') k.upstreamKey = ''
      if (typeof k.customKey !== 'string') k.customKey = ''
    }
  }
  return { ...DEFAULT_CONFIG, ...config, upstreams }
}

export function loadConfig() {
  if (configCache) return configCache
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, 'utf-8')
      const parsed = JSON.parse(raw)
      configCache = normalize(migrate({ ...DEFAULT_CONFIG, ...parsed }))
    } else {
      configCache = normalize({ ...DEFAULT_CONFIG })
    }
  } catch (err) {
    console.error('[config] 加载配置失败，使用默认值:', err.message, '路径:', CONFIG_PATH)
    configCache = normalize({ ...DEFAULT_CONFIG })
  }
  return configCache
}

export function saveConfig(config) {
  const dir = dirname(CONFIG_PATH)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  configCache = normalize({ ...DEFAULT_CONFIG, ...config })
  writeFileSync(CONFIG_PATH, JSON.stringify(configCache, null, 2), 'utf-8')
  return configCache
}

export function getConfig() {
  return loadConfig()
}

export function updateConfig(partial) {
  const current = loadConfig()
  const merged = {
    ...current,
    ...partial,
    options: { ...current.options, ...(partial.options || {}) },
  }
  if (partial.upstreams) {
    // 合并上游密钥：前端省略 upstreamKey 时保留服务端原值
    const oldMap = new Map()
    for (const u of current.upstreams || []) {
      for (const k of u.keys || []) {
        oldMap.set(k.id, k.upstreamKey)
      }
    }
    merged.upstreams = partial.upstreams.map(u => ({
      ...u,
      keys: (u.keys || []).map(k => ({
        ...k,
        upstreamKey: k.upstreamKey || oldMap.get(k.id) || '',
      })),
    }))
  }
  return saveConfig(merged)
}

/**
 * 根据客户端传入的 key 查找匹配的上游
 * 匹配规则：
 * 1. 优先匹配 customKey === incoming
 * 2. 其次匹配 upstreamKey === incoming 且该条目的 customKey 为空（直接映射）
 * 返回 { baseUrl, upstreamKey, identityKey } 或 null
 */
export function resolveUpstream(incomingKey) {
  if (!incomingKey) return null
  const config = loadConfig()
  // 优先匹配 customKey
  for (const u of config.upstreams) {
    for (const k of u.keys) {
      if (k.customKey && k.customKey === incomingKey) {
        return {
          baseUrl: u.baseUrl,
          upstreamKey: k.upstreamKey,
          identityKey: k.upstreamKey || k.id,
        }
      }
    }
  }
  // 直接映射（customKey 为空时允许用 upstreamKey 直接访问）
  for (const u of config.upstreams) {
    for (const k of u.keys) {
      if (!k.customKey && k.upstreamKey === incomingKey) {
        return {
          baseUrl: u.baseUrl,
          upstreamKey: k.upstreamKey,
          identityKey: k.upstreamKey,
        }
      }
    }
  }
  return null
}

// 请求统计
const stats = {
  totalRequests: 0,
  successRequests: 0,
  failedRequests: 0,
  startTime: Date.now(),
}

export function getStats() {
  return { ...stats, uptime: Date.now() - stats.startTime }
}

export function recordRequest(success) {
  stats.totalRequests++
  if (success) {
    stats.successRequests++
  } else {
    stats.failedRequests++
  }
}
