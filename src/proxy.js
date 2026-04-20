import { buildCCHeaders, injectCCBody, finalizeCCH } from './cc-headers.js'
import { getConfig, recordRequest, resolveUpstream } from './config.js'
import { extractProxyKey } from './auth.js'

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sendError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { type: 'proxy_error', message } }))
}

export async function handleProxy(req, res) {
  const config = getConfig()

  // 1. 提取客户端 key 并查找匹配的上游
  const incomingKey = extractProxyKey(req)
  if (!incomingKey) {
    sendError(res, 401, '缺少 API Key')
    recordRequest(false)
    return
  }
  const upstream = resolveUpstream(incomingKey)
  if (!upstream) {
    sendError(res, 401, '未找到匹配的上游配置')
    recordRequest(false)
    return
  }
  if (!upstream.baseUrl || !upstream.upstreamKey) {
    sendError(res, 503, '上游配置不完整')
    recordRequest(false)
    return
  }

  try {
    // 2. 读取请求体
    const rawBody = await readBody(req)
    let body
    try {
      body = JSON.parse(rawBody.toString('utf-8'))
    } catch {
      sendError(res, 400, '请求体 JSON 解析失败')
      recordRequest(false)
      return
    }

    // 3. 注入 CC 特征到 body（identityKey 确保同一上游 key 的亲和性）
    injectCCBody(body, config.ccVersion, config.options, upstream.identityKey)

    // 4. 序列化后计算 cch 并替换占位符
    const outBody = finalizeCCH(JSON.stringify(body))

    // 5. 构造上游请求头
    const ccHeaders = buildCCHeaders(config.ccVersion)
    const upstreamUrl = new URL(req.url, upstream.baseUrl)

    const upstreamHeaders = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(outBody).toString(),
      ...ccHeaders,
      'x-api-key': upstream.upstreamKey,
    }

    // 5. 转发到上游
    const upstreamResp = await fetch(upstreamUrl.href, {
      method: req.method,
      headers: upstreamHeaders,
      body: outBody,
    })

    // 6. 透传响应头
    const respHeaders = {}
    for (const [k, v] of upstreamResp.headers) {
      const lower = k.toLowerCase()
      if (lower === 'transfer-encoding' || lower === 'content-encoding') continue
      respHeaders[k] = v
    }
    res.writeHead(upstreamResp.status, respHeaders)

    // 7. 流式透传响应体
    if (!upstreamResp.body) {
      const text = await upstreamResp.text()
      res.end(text)
      recordRequest(upstreamResp.ok)
      return
    }

    const reader = upstreamResp.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
    res.end()
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
