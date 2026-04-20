import { createHash, randomUUID } from 'crypto'
import os from 'os'

// CC 指纹盐值（从 CC 源码提取，必须与后端校验一致）
const FINGERPRINT_SALT = '59cf53e54c78'

// CC 默认版本号（与最新 CC 保持同步）
const DEFAULT_CC_VERSION = '2.1.111'

// Anthropic SDK 版本号（从 CC 依赖的 @anthropic-ai/sdk 提取）
const SDK_VERSION = '0.74.0'

// anthropic-beta 完整列表（从 CC 源码 utils/betas.ts getAllModelBetas 提取）
// 仅包含 firstParty + 非 haiku + 非 ant 用户的标准 beta 集合
const BETA_HEADERS = [
  'claude-code-20250219',
  'interleaved-thinking-2025-05-14',
  'context-1m-2025-08-07',
  'context-management-2025-06-27',
  'prompt-caching-scope-2026-01-05',
  'redact-thinking-2026-02-12',
]

// 为每个请求 key 缓存固定的 device_id 和 session_id（保证亲和性）
const keyIdentityMap = new Map()

function getOrCreateIdentity(proxyKey) {
  const k = proxyKey || '__default__'
  if (keyIdentityMap.has(k)) return keyIdentityMap.get(k)
  const identity = {
    // device_id 使用 64 位十六进制哈希（与真实 CC 一致）
    deviceId: createHash('sha256').update(randomUUID()).digest('hex'),
    sessionId: randomUUID(),
  }
  keyIdentityMap.set(k, identity)
  return identity
}

/**
 * 计算 3 字符指纹
 * 算法：SHA256(SALT + msg[4] + msg[7] + msg[20] + version) 取前 3 位 hex
 */
export function computeFingerprint(messageText, version) {
  const indices = [4, 7, 20]
  const chars = indices.map(i => messageText[i] || '0').join('')
  const input = `${FINGERPRINT_SALT}${chars}${version}`
  return createHash('sha256').update(input).digest('hex').slice(0, 3)
}

/**
 * 从 messages 数组中提取第一条用户消息文本
 */
export function extractFirstMessageText(messages) {
  if (!Array.isArray(messages)) return ''
  const userMsg = messages.find(m => m.role === 'user')
  if (!userMsg) return ''
  if (typeof userMsg.content === 'string') return userMsg.content
  if (Array.isArray(userMsg.content)) {
    const textBlock = userMsg.content.find(b => b.type === 'text')
    return textBlock && textBlock.text ? textBlock.text : ''
  }
  return ''
}

/**
 * 计算 cch 校验值
 * 基于请求体内容生成 5 位十六进制哈希，模拟 Bun Attestation.zig 的行为
 */
export function computeCCH(bodyString) {
  const hash = createHash('sha256').update(bodyString || '').digest('hex')
  return hash.slice(0, 5)
}

/**
 * 构造 x-anthropic-billing-header 字符串
 * 格式与最新 CC 一致：cc_version + cc_entrypoint + cch
 */
export function buildAttributionHeader(version, fingerprint, cch) {
  const cchPart = cch ? ` cch=${cch};` : ''
  return `x-anthropic-billing-header: cc_version=${version}.${fingerprint}; cc_entrypoint=cli;${cchPart}`
}

/**
 * 构造 X-Stainless-* 系列头（Anthropic SDK 自动注入的平台信息）
 */
function buildStainlessHeaders() {
  const platform = os.platform()
  const arch = os.arch()

  const normalizeOS = (p) => {
    if (p === 'darwin') return 'MacOS'
    if (p === 'win32') return 'Windows'
    if (p === 'linux') return 'Linux'
    if (p === 'freebsd') return 'FreeBSD'
    return 'Other:' + p
  }
  const normalizeArch = (a) => {
    if (a === 'x64') return 'x64'
    if (a === 'arm64') return 'arm64'
    if (a === 'arm') return 'arm'
    if (a === 'x32' || a === 'ia32') return 'x32'
    return 'other:' + a
  }

  return {
    'X-Stainless-Lang': 'js',
    'X-Stainless-Package-Version': SDK_VERSION,
    'X-Stainless-OS': normalizeOS(platform),
    'X-Stainless-Arch': normalizeArch(arch),
    'X-Stainless-Runtime': 'node',
    'X-Stainless-Runtime-Version': process.version,
  }
}

/**
 * 构造 CC 请求头（含 Stainless 头）
 */
export function buildCCHeaders(version) {
  const v = version || DEFAULT_CC_VERSION
  return {
    'User-Agent': `claude-cli/${v} (consumer, cli)`,
    'x-app': 'cli',
    'X-Claude-Code-Session-Id': randomUUID(),
    'x-client-request-id': randomUUID(),
    'anthropic-version': '2023-06-01',
    'anthropic-beta': BETA_HEADERS.join(','),
    ...buildStainlessHeaders(),
  }
}

/**
 * 构造 metadata.user_id JSON 字符串
 * 同一个 proxyKey 始终返回相同的 device_id 和 session_id
 * 确保 NewAPI 渠道亲和性能正确匹配
 */
export function buildMetadataUserId(proxyKey) {
  const identity = getOrCreateIdentity(proxyKey)
  return JSON.stringify({
    device_id: identity.deviceId,
    account_uuid: '',
    session_id: identity.sessionId,
  })
}

/**
 * 对请求体注入 CC 特征
 * - 注入 metadata.user_id（固定，保证亲和性）
 * - 在 system 字段追加 billing header（含 cch 占位符）
 * 返回 { body, cchPlaceholder } 以便序列化后替换 cch
 */
export function injectCCBody(body, version, options = {}, proxyKey) {
  const v = version || DEFAULT_CC_VERSION
  const messages = body.messages || []
  const firstText = extractFirstMessageText(messages)
  const fingerprint = computeFingerprint(firstText, v)
  // 先用占位符 00000，序列化后再替换为真实 cch
  const attribution = buildAttributionHeader(v, fingerprint, '00000')

  // 注入 metadata
  if (options.injectMetadata !== false) {
    if (!body.metadata) {
      body.metadata = {}
    }
    if (!body.metadata.user_id) {
      body.metadata.user_id = buildMetadataUserId(proxyKey)
    }
  }

  // 注入 billing header 到 system 字段
  if (options.injectBillingHeader !== false) {
    if (typeof body.system === 'string' && body.system.length > 0) {
      if (!body.system.includes('x-anthropic-billing-header')) {
        body.system = body.system + '\n' + attribution
      }
    } else if (Array.isArray(body.system)) {
      const hasAttr = body.system.some(
        b => typeof b.text === 'string' && b.text.includes('x-anthropic-billing-header')
      )
      if (!hasAttr) {
        body.system.push({ type: 'text', text: '\n' + attribution })
      }
    } else {
      body.system = attribution
    }
  }

  return body
}

/**
 * 序列化请求体后，计算 cch 并替换占位符
 */
export function finalizeCCH(bodyString) {
  if (!bodyString.includes('cch=00000')) return bodyString
  const cch = computeCCH(bodyString)
  return bodyString.replace('cch=00000', 'cch=' + cch)
}

export { DEFAULT_CC_VERSION, BETA_HEADERS }
