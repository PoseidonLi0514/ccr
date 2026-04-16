import { buildCCHeaders, injectCCBody } from './cc-headers.js'
import { getConfig, recordRequest } from './config.js'
import { extractProxyKey, verifyProxyKey } from './auth.js'

/**
 * 读取请求体
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * 发送 JSON 错误响应
 */
function sendError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { type: 'proxy_error', message } }))
}

/**
 * 处理代理请求
 */
export async function handleProxy(req, res) {
  const config = getConfig()

  // 1. 校验请求 key
  const key = extractProxyKey(req)
  if (!verifyProxyKey(key)) {
    sendError(res, 401, '无效的 API Key')
    recordRequest(false)
    return
  }

  // 2. 检查上游配置
  if (!config.upstream.apiKey) {
    sendError(res, 503, '上游密钥未配置')
    recordRequest(false)
    return
  }

  try {
    // 3. 读取请求体
    const rawBody = await readBody(req)
    let body
    try {
      body = JSON.parse(rawBody.toString('utf-8'))
    } catch {
      sendError(res, 400, '请求体 JSON 解析失败')
      recordRequest(false)
      return
    }

    // 4. 注入 CC 特征到 body（传入 proxyKey 保证同一 key 的亲和性）
    injectCCBody(body, config.ccVersion, config.options, key)

    const outBody = JSON.stringify(body)

    // 5. 构造上游请求头
    const ccHeaders = buildCCHeaders(config.ccVersion)
    const upstreamUrl = new URL(req.url, config.upstream.baseUrl)

    const upstreamHeaders = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(outBody).toString(),
      ...ccHeaders,
      'x-api-key': config.upstream.apiKey,
    }

    // 6. 转发到上游
    const upstreamResp = await fetch(upstreamUrl.href, {
      method: req.method,
      headers: upstreamHeaders,
      body: outBody,
    })

    // 7. 透传响应头
    const respHeaders = {}
    for (const [k, v] of upstreamResp.headers) {
      // 跳过传输编码相关头
      const lower = k.toLowerCase()
      if (lower === 'transfer-encoding' || lower === 'content-encoding') continue
      respHeaders[k] = v
    }
    res.writeHead(upstreamResp.status, respHeaders)

    // 8. 流式透传响应体
    if (!upstreamResp.body) {
      const text = await upstreamResp.text()
      res.end(text)
      recordRequest(upstreamResp.ok)
      return
    }

    const reader = upstreamResp.body.getReader()
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
      res.end()
    }

    await pump()
    recordRequest(upstreamResp.ok)
  } catch (err) {
    recordRequest(false)
    if (!res.headersSent) {
      sendError(res, 502, `上游请求失败: ${err.message}`)
    } else {
      res.end()
    }
  }
}
