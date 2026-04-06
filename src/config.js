import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dirname, '..', 'data', 'config.json')

const DEFAULT_CONFIG = {
  upstream: {
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
  },
  allowedKeys: [],
  ccVersion: '2.1.88',
  options: {
    injectBillingHeader: true,
    injectMetadata: true,
  },
}

let configCache = null

export function loadConfig() {
  if (configCache) return configCache
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, 'utf-8')
      configCache = { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
    } else {
      configCache = { ...DEFAULT_CONFIG }
    }
  } catch {
    configCache = { ...DEFAULT_CONFIG }
  }
  return configCache
}

export function saveConfig(config) {
  const dir = dirname(CONFIG_PATH)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  configCache = { ...DEFAULT_CONFIG, ...config }
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
    upstream: { ...current.upstream, ...(partial.upstream || {}) },
    options: { ...current.options, ...(partial.options || {}) },
  }
  return saveConfig(merged)
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
