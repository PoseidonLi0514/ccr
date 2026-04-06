import { createHash, randomUUID } from 'crypto'

// CC 指纹盐值（从 CC 源码提取，必须与后端校验一致）
const FINGERPRINT_SALT = '59cf53e54c78'

// CC 默认版本号
const DEFAULT_CC_VERSION = '2.1.88'

// anthropic-beta 完整列表（从 CC 源码 constants/betas.ts 提取）
const BETA_HEADERS = [
  'claude-code-20250219',
  'interleaved-thinking-2025-05-14',
  'context-1m-2025-08-07',
  'context-management-2025-06-27',
  'effort-2025-11-24',
  'prompt-caching-scope-2026-01-05',
  'redact-thinking-2026-02-12',
]

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
    return textBlock?.text || ''
  }
  return ''
}

/**
 * 构造 x-anthropic-billing-header 字符串
 */
export function buildAttributionHeader(version, fingerprint) {
  return `x-anthropic-billing-header: cc_version=${version}.${fingerprint}; cc_entrypoint=cli;`
}

/**
 * 构造 CC 请求头
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
  }
}

/**
 * 构造 metadata.user_id JSON 字符串
 */
export function buildMetadataUserId(sessionId) {
  return JSON.stringify({
    device_id: randomUUID(),
    account_uuid: '',
    session_id: sessionId || randomUUID(),
  })
}

/**
 * 对请求体注入 CC 特征
 * - 注入 metadata.user_id
 * - 在 system 字段追加 billing header
 */
export function injectCCBody(body, version, options = {}) {
  const v = version || DEFAULT_CC_VERSION
  const messages = body.messages || []
  const firstText = extractFirstMessageText(messages)
  const fingerprint = computeFingerprint(firstText, v)
  const attribution = buildAttributionHeader(v, fingerprint)

  // 注入 metadata
  if (options.injectMetadata !== false) {
    if (!body.metadata) {
      body.metadata = {}
    }
    if (!body.metadata.user_id) {
      body.metadata.user_id = buildMetadataUserId()
    }
  }

  // 注入 billing header 到 system 字段
  if (options.injectBillingHeader !== false) {
    if (typeof body.system === 'string' && body.system.length > 0) {
      if (!body.system.includes('x-anthropic-billing-header')) {
        body.system = body.system + '\n' + attribution
      }
    } else if (Array.isArray(body.system)) {
      // system 为数组格式时，追加一个 text block
      const hasAttr = body.system.some(
        b => typeof b.text === 'string' && b.text.includes('x-anthropic-billing-header')
      )
      if (!hasAttr) {
        body.system.push({ type: 'text', text: '\n' + attribution })
      }
    } else {
      // system 不存在或为 null
      body.system = attribution
    }
  }

  return body
}

export { DEFAULT_CC_VERSION, BETA_HEADERS }
