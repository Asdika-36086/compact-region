/**
 * compact-region — Host half.
 *
 * Facts and one write, all over one Session:
 *
 *   turns        which turns are still visible, in surface order, and which
 *                ones survive only in the log;
 *   checkpoints  every replacement user message already on the surface;
 *   range        the contiguous surface span covered by a run of slots;
 *   preview      summarize the visible history up to the range end;
 *   apply        append the checkpoint that replaces that span;
 *   archive      the original messages that span replaced, for the sidebar.
 *
 * "preview" is the only place that talks to a model; "apply" is the only place
 * that writes. Everything else is read-only, and works on a cold session too.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { computeCheckpoints, computeRange, computeSlotRange, computeTurns, CHECKPOINT_PREAMBLE } from './stats.js'

export const name = 'compact-region'

// Settings 是宿主提供的服务：声明 Config 之后，配置项才会被登记成一个
// 可服务的 namespace，插件页那张卡片才有内容可读写。
export const inject = ['settings']

export { computeCheckpoints, computeRange, computeSlotRange, computeTurns }

const CHANNEL = '/compact-region'

/**
 * 插件配置。`language` 存的是语言包 id，也就是语言包目录里那个文件去掉
 * `.json` 后的名字（`English.json` → `English`，`中文.json` → `中文`）。
 * 现在是空转的：设置面板能选能存，但摘要还没读它。
 */
export const Config = z.object({
  language: z
    .string()
    .default('en')
    .description('摘要语言：取语言包目录里某个文件名，不含 .json。默认 en。'),
})

/** 代码里的默认配置。它同时是 config.default.json 的内容和读取失败的兜底。 */
const DEFAULT_CONFIG = { language: 'en' }

/** 用户语言包目录：DSH 主目录下的 compact-region/langs。 */
function languageDirectory() {
  return join(dshHome(), 'compact-region', 'langs')
}

/** 配置目录：和 langs 并列，一个放语言包，一个放当前值。 */
function configDirectory() {
  return join(dshHome(), 'compact-region')
}

function dshHome() {
  return process.env.DSH_HOME !== undefined && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
}

/**
 * 当前配置。文件不在就当没配过；文件坏了就回退默认值，并把原因带出去，
 * 免得用户对着一个「值不对但没人说」的面板发愁。
 */
export async function readConfig() {
  const file = join(configDirectory(), 'config.json')
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { value: { ...DEFAULT_CONFIG }, source: 'default' }
    return { value: { ...DEFAULT_CONFIG }, source: 'default', problem: String(error?.message ?? error) }
  }
  try {
    const parsed = JSON.parse(raw)
    return { value: normalizeConfig(parsed), source: 'current' }
  } catch (error) {
    return { value: { ...DEFAULT_CONFIG }, source: 'default', problem: `config.json 解析失败：${String(error?.message ?? error)}` }
  }
}

function normalizeConfig(raw) {
  const language = raw !== null && typeof raw === 'object' && typeof raw.language === 'string' && raw.language.length > 0
    ? raw.language
    : DEFAULT_CONFIG.language
  return { language }
}

/**
 * 写入当前配置。先落 config.default.json（默认值，供重置与回退），
 * 再原子替换 config.json —— 中途断电也不会留下半截 JSON。
 */
export async function writeConfig(patch) {
  const dir = configDirectory()
  await mkdir(dir, { recursive: true })
  const current = await readConfig()
  const next = { ...current.value, ...patch }
  await writeFile(join(dir, 'config.default.json'), `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8')
  const temporary = join(dir, `config.json.${process.pid}.tmp`)
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(temporary, join(dir, 'config.json'))
  return { value: next, source: 'current' }
}

/**
 * 插件的正文文本：摘要指令和界面文案，都由语言包提供。
 * 这里只做两件事：把目录扫出来、把选中的那个包解析成一份完整文本。
 */

/** 随包发布的内置语言包，在 lib/langs 下，装完就有。 */
function builtinLanguageDirectory() {
  return fileURLToPath(new URL('./langs/', import.meta.url))
}

/** 读一个语言包文件；读不出来就返回 null，由调用方决定是跳过还是记问题。 */
async function readPack(directory, id) {
  try {
    const parsed = JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch (error) {
    return null
  }
}

/** 扫一个目录，返回 id → { problem, name }。文件名就是 id，name 是包里的自称。 */
async function scanPackDirectory(directory) {
  const found = new Map()
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    return found
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.toLowerCase().endsWith('.json')) continue
    const id = entry.name.slice(0, -'.json'.length)
    if (id.length === 0) continue
    let problem
    let name
    try {
      const parsed = JSON.parse(await readFile(join(directory, entry.name), 'utf8'))
      name = parsed !== null && typeof parsed === 'object' && typeof parsed.name === 'string' && parsed.name.length > 0
        ? parsed.name
        : undefined
    } catch (error) {
      problem = String(error?.message ?? error)
    }
    found.set(id, { problem, name })
  }
  return found
}

/**
 * 列出可选的语言包。内置包和用户目录并集，同名时用户目录优先 ——
 * 嫌内置的翻译不好，放一个自己的同名文件覆盖就行。
 */
export async function listLanguagePacks() {
  const dir = languageDirectory()
  try {
    await mkdir(dir, { recursive: true })
  } catch (error) {
    return { dir, packs: [], error: `无法创建目录：${String(error?.message ?? error)}` }
  }
  let user
  try {
    user = await scanPackDirectory(dir)
  } catch (error) {
    return { dir, packs: [], error: `无法读取目录：${String(error?.message ?? error)}` }
  }
  const builtin = await scanPackDirectory(builtinLanguageDirectory())
  const packs = []
  for (const id of new Set([...builtin.keys(), ...user.keys()])) {
    // 用户目录优先：同名文件覆盖内置的那份。
    const fromUser = user.has(id)
    const entry = fromUser ? user.get(id) : builtin.get(id)
    const pack = { id, file: `${id}.json`, source: fromUser ? 'user' : 'builtin' }
    if (entry?.name !== undefined) pack.name = entry.name
    if (entry?.problem !== undefined) pack.problem = entry.problem
    packs.push(pack)
  }
  packs.sort((a, b) => {
    // 能用的排前面，坏的沉底：下拉框一打开先看见可选的。
    const badA = a.problem === undefined ? 0 : 1
    const badB = b.problem === undefined ? 0 : 1
    if (badA !== badB) return badA - badB
    return a.id.localeCompare(b.id, 'zh')
  })
  return { dir, packs }
}

/**
 * 解析出真正要用的文本。三层覆盖，后一层压前一层：
 * 内置英文 → 内置目标语言 → 用户目录里的同名文件。
 * 缺哪一段就留上一层的，所以只翻了一半的包也能用。
 */
export async function resolvePack(language) {
  const directory = builtinLanguageDirectory()
  const fallback = (await readPack(directory, 'en')) ?? {}
  const base = {
    prompt: fallback.prompt ?? {},
    ui: fallback.ui ?? {},
  }
  const layer = async (pack) => {
    if (pack === null) return
    base.prompt = { ...base.prompt, ...(pack.prompt ?? {}) }
    base.ui = { ...base.ui, ...(pack.ui ?? {}) }
  }
  if (language !== 'en') await layer(await readPack(directory, language))
  await layer(await readPack(languageDirectory(), language))
  return base
}


/** 填 `{name}` 占位符，跟客户端用的是同一套写法。 */
function fill(text, values) {
  return String(text).replace(/\{(\w+)\}/g, (whole, name) => {
    const value = values?.[name]
    return value === undefined ? whole : String(value)
  })
}

function failure(code, message) {
  return { ok: false, error: { code, message, details: {} } }
}

/** 从一条消息里取出可读文本（工具调用渲染成一行摘要），同 compact-last。 */
function messageText(message) {
  if (!Array.isArray(message?.content)) return ''
  const parts = []
  for (const part of message.content) {
    if (part?.type === 'text' && typeof part.text === 'string') parts.push(part.text)
    else if (part?.type === 'tool-call') parts.push(`[调用工具 ${part.name}]`)
  }
  return parts.join('\n').trim()
}

/**
 * 与 compact-last 相同的摘要请求：整段上下文原样送入（保留会话自己的
 * system prompt），末尾用「从用户消息…到…」锚定这次要总结的范围。
 */
async function summarize(llm, session, startSeq, endSeq, signal) {
  const pack = await resolvePack((await readConfig()).value.language)
  const ui = pack.ui ?? {}
  const prompt = pack.prompt ?? {}
  const header = session.requestHeader()
  const config = header?.config
  const provider = config?.provider
  const model = config?.model
  if (typeof provider !== 'string' || typeof model !== 'string' || provider.length === 0 || model.length === 0) {
    throw new Error(ui.errNoModel ?? 'This session has not been routed to a model yet.')
  }
  const tools = Array.isArray(header?.tools) ? header.tools : undefined
  const nodes = session.surface.nodes
  const startIndex = nodes.indexOf(startSeq)
  const endIndex = nodes.indexOf(endSeq)
  if (startIndex === -1 || endIndex === -1) throw new Error(ui.errStaleRange ?? 'The selected range is no longer in the context.')

  const messages = []
  for (let i = 0; i <= endIndex; i += 1) {
    const event = session.eventAt(nodes[i])
    if (event === undefined) continue
    const message = session.deriveEventMessage(event)
    if (message !== null) messages.push(message)
  }
  if (messages.length === 0) throw new Error(ui.errEmptyHistory ?? 'This history is empty as far as the model is concerned.')

  const realUserTexts = []
  for (let i = startIndex; i <= endIndex; i += 1) {
    const event = session.eventAt(nodes[i])
    if (event?.type !== 'user/message') continue
    if (event.data?.source?.kind !== 'user') continue
    const text = messageText({ content: event.data.content })
    if (text.length > 0) realUserTexts.push(text.replace(/\s+/g, ' ').trim())
  }
  const clip = (text) => (text.length > 160 ? text.slice(0, 160) + '…' : text)
  const anchorStart = clip(realUserTexts[0] ?? (prompt.anchorStart ?? '(start of the span)'))
  const anchorEnd = clip(realUserTexts[realUserTexts.length - 1] ?? (prompt.anchorEnd ?? '(end of the span)'))
  messages.push({
    role: 'user',
    content: [{
      type: 'text',
      // 整段指令就是一个模板：{start} / {end} 填进选的区间，其余原样送给模型。
      text: fill(typeof prompt.template === 'string' ? prompt.template : '', { start: anchorStart, end: anchorEnd }),
    }],
  })

  const request = {
    provider,
    model,
    messages,
    sessionId: session.id,
    purpose: 'compaction',
    ...(tools === undefined ? {} : { tools }),
    ...(signal === undefined ? {} : { signal }),
  }
  if (typeof session.toolHistory === 'function') request.toolHistory = session.toolHistory()
  const stream = llm.stream(request)
  let text = ''
  let finish
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'finish') finish = chunk.reason
  }
  if (finish !== undefined) {
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      throw new Error(`摘要请求失败：${finish.failure?.message ?? finish.kind}`)
    }
    if (finish.kind === 'max-tokens') throw new Error('摘要被输出上限截断，没有写入。')
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) throw new Error('摘要模型没有返回正文。')
  return { text: trimmed, provider, model, messageCount: messages.length }
}

/**
 * 被压缩区间的原文，供侧栏存档面板展示。原始节点已被 replace 遮蔽，不能从
 * surface 取；日志只追加，所以按 seq 区间回读。与 compact-last 相同的取舍。
 */
export function archiveOf(session, start, end) {
  const items = []
  const byCallId = new Map()
  const total = session.seq

  const textOf = (content) => {
    const parts = []
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
      }
    }
    return parts.join('\n').trim()
  }
  const argTextOf = (raw) => {
    if (typeof raw === 'string') return raw
    if (raw === undefined || raw === null) return ''
    try {
      return JSON.stringify(raw, null, 2)
    } catch {
      return String(raw)
    }
  }
  // 区间里可能还嵌着更早的检查点：它在压缩时是界面上的一张卡片，
  // 存档里也要当成卡片留着，点了才能继续往里看。
  const checkpointOf = (event) => {
    const kind = event.data?.source?.kind
    if (kind !== 'compact-last' && kind !== 'compact-region' && kind !== 'compact-checkpoint') return null
    const op = event.surfaceOp
    if (op === null || typeof op !== 'object' || op.op !== 'replace') return null
    let summary = textOf(event.data?.content)
    if (summary.startsWith(CHECKPOINT_PREAMBLE)) summary = summary.slice(CHECKPOINT_PREAMBLE.length).trim()
    return {
      kind: 'checkpoint',
      seq: event.seq,
      source: kind,
      start: op.startSeq,
      end: op.endSeq,
      shadowed: Array.isArray(event.sourceEventSeqs) ? event.sourceEventSeqs.length : 0,
      shadowedSeqs: Array.isArray(event.sourceEventSeqs) ? event.sourceEventSeqs.slice() : null,
      summary
    }
  }

  // 表面才是模型当时看到的东西：区间内任何一次 replace（里层压缩卡片、回退）
  // 都会让它盖住的那些序号消失。只按卡片自己的 sourceEventSeqs 过滤是不够的——
  // 那份清单只记了当时的节点，回退和更深的遮蔽不在里面。
  const covered = new Set()
  const replacements = []
  for (let seq = start; seq <= end && seq < total; seq += 1) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    const op = event.surfaceOp
    if (op === null || typeof op !== 'object' || op.op !== 'replace') continue
    replacements.push({ seq, start: op.startSeq, end: op.endSeq, checkpoint: checkpointOf(event) })
  }
  for (const op of replacements) {
    for (let inner = Math.max(start, op.start); inner <= Math.min(end, op.end); inner += 1) covered.add(inner)
  }
  const checkpointSeqs = new Set()
  for (const op of replacements) {
    if (op.checkpoint !== null && !covered.has(op.seq)) checkpointSeqs.add(op.seq)
  }

  for (let seq = start; seq <= end && seq < total; seq += 1) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    if (covered.has(seq) && !checkpointSeqs.has(seq)) continue
    const type = event.type
    if (type === 'user/message') {
      const source = event.data?.source?.kind
      const nested = checkpointOf(event)
      if (nested !== null) {
        items.push(nested)
        continue
      }
      if (source === 'compact-last' || source === 'compact-region' || source === 'compact-checkpoint') continue
      const text = textOf(event.data?.content)
      if (text.length === 0) continue
      // 只有真正的用户输入画成气泡；运行时上下文/时间/技能目录是系统注入。
      if (source === 'user' || source === 'user-approval') items.push({ kind: 'user', seq, text })
      else items.push({ kind: 'note', seq, source: typeof source === 'string' ? source : 'system', text })
      continue
    }
    if (type === 'assistant/message') {
      const blocks = event.data?.message?.content
      if (!Array.isArray(blocks)) continue
      for (const block of blocks) {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
          items.push({ kind: 'assistant', seq, text: block.text.trim() })
        } else if (block?.type === 'reasoning' && typeof block.text === 'string' && block.text.trim().length > 0) {
          items.push({ kind: 'reasoning', seq, text: block.text.trim() })
        } else if (block?.type === 'tool-call') {
          const item = {
            kind: 'tool',
            seq,
            name: typeof block.name === 'string' ? block.name : 'tool',
            args: argTextOf(block.arguments),
            callId: typeof block.id === 'string' ? block.id : typeof block.callId === 'string' ? block.callId : ''
          }
          items.push(item)
          if (item.callId.length > 0) byCallId.set(item.callId, item)
        }
      }
      continue
    }
    if (type === 'tool/result') {
      const data = event.data ?? {}
      const callId =
        typeof data.callId === 'string'
          ? data.callId
          : typeof data.message?.toolCallId === 'string'
            ? data.message.toolCallId
            : ''
      const output = textOf(data.message?.content)
      const target = callId.length > 0 ? byCallId.get(callId) : undefined
      if (target !== undefined) {
        target.output = output
        if (data.message?.isError === true) target.isError = true
      } else if (output.length > 0) {
        items.push({ kind: 'tool-output', seq, text: output })
      }
    }
  }

  const messages = items
    .filter((item) => item.kind === 'user' || item.kind === 'assistant' || item.kind === 'tool-output')
    .map((item) => ({ role: item.kind === 'assistant' ? 'assistant' : 'user', seq: item.seq, text: item.text ?? item.args ?? '' }))
  return { start, end, items, messages, count: items.length }
}

/**
 * A read-only Session-shaped view over a persisted log. It supports the same
 * queries stats.js and summarize() use, without creating a live Agent.
 */
function coldSession(sessionId, events, surfaceEvents) {
  const bySeq = new Map()
  for (const event of events) bySeq.set(event.seq, event)
  const nodes = []
  for (const event of surfaceEvents) nodes.push(event.seq)
  let header
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === 'request/header') {
      header = events[i].data.header
      break
    }
  }
  return {
    id: sessionId,
    seq: events.length,
    eventAt: (seq) => bySeq.get(seq),
    surface: { nodes, replaceGeneration: 0, contentGeneration: 0 },
    deriveEventMessage: (event) => {
      if (event === undefined || event === null) return null
      if (event.type === 'user/message') return event.data
      if (event.type === 'tool/result') return event.data.message
      if (
        event.type === 'system/message' ||
        event.type === 'developer/message' ||
        event.type === 'assistant/message'
      ) {
        const message = event.data.message
        return message !== undefined && Array.isArray(message.content) && message.content.length > 0 ? message : null
      }
      return null
    },
    requestHeader: () => header,
  }
}

/**
 * The turn that has not ended yet, as its `turn/start` event. A range that
 * reaches into it is unsafe: the replacement would cut a live turn in half.
 */
function openTurn(session) {
  let open = null
  for (let seq = 0; seq < session.seq; seq += 1) {
    const event = session.eventAt(seq)
    if (event === undefined) continue
    if (event.type === 'turn/start') open = event
    else if (event.type === 'turn/end') open = null
  }
  return open
}

function runningTurnFailure(session, endSeq) {
  const running = openTurn(session)
  if (running === null || endSeq < running.seq) return null
  return failure('compact-region/turn-running', '最后一个轮次还在运行，等它结束后再压缩。')
}

/**
 * Serve the Connection RPC protocol directly on the host web server.
 *
 * `connection.rpc.handle` registers through the Context that owns the service,
 * and in this build that Context does not carry `webServer`, so the channel is
 * never mounted (every plugin request becomes a static 405). Registering the
 * prefix ourselves and reusing `connection.admit` keeps exactly the same
 * Host/Origin and token admission while making the route reachable.
 */
function serveRpc(webServer, connection, handler) {
  return webServer.register({
    kind: 'prefix',
    path: CHANNEL,
    handler: async (req, res) => {
      const admission = typeof connection.admit === 'function' ? connection.admit(req) : undefined
      if (admission !== undefined && admission.rejection !== undefined) {
        res.writeHead(admission.rejection)
        res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const endpoint = url.pathname.startsWith(CHANNEL + '/') ? url.pathname.slice(CHANNEL.length + 1) : ''
      if (req.method !== 'POST' || endpoint.length === 0 || endpoint.split('/').some((part) => part === '' || part === '.' || part === '..')) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        res.writeHead(415)
        res.end('content type must be application/json')
        return
      }
      let raw = ''
      try {
        for await (const chunk of req) {
          raw += chunk
          if (raw.length > 8 * 1024 * 1024) throw new Error('body too large')
        }
      } catch (error) {
        res.writeHead(400)
        res.end('body read failed')
        return
      }
      let message
      try {
        message = JSON.parse(raw)
      } catch (error) {
        res.writeHead(400)
        res.end('body is not JSON')
        return
      }
      const rpcId = message !== null && typeof message === 'object' && typeof message.rpcId === 'string' ? message.rpcId : ''
      if (rpcId === '' || message.type !== 'client-request' || message.method !== endpoint) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          type: 'server-response',
          rpcId,
          result: { ok: false, error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: {} } },
        }))
        return
      }
      let result
      try {
        result = await handler(endpoint, message.payload)
      } catch (error) {
        result = { ok: false, error: { code: 'compact-region/failed', message: String(error?.message ?? error), details: {} } }
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'server-response', rpcId, result }))
    },
  })
}

export function apply(ctx, config) {
  ctx.inject(['connection', 'webServer'], (scope) => {
    const connection = scope.connection ?? scope.root?.connection ?? scope.get('connection')
    const webServer = scope.webServer
    if (connection === undefined) return

    const cache = new Map()

    const handler = async (endpoint, payload) => {
      try {
        // 语言包跟会话无关，先答，免得被下面的 sessionId 校验挡掉。
        if (endpoint === 'languages') return { ok: true, value: await listLanguagePacks() }
        // 只要界面文案和当前语言：客户端启动时先问一次，不写任何文件。
        if (endpoint === 'ui') {
          const config = await readConfig()
          const pack = await resolvePack(config.value.language)
          return { ok: true, value: { language: config.value.language, ui: pack.ui } }
        }
        // 面板要用的全量状态：目录 + 语言包 + 当前配置，一次取齐。
        if (endpoint === 'state') {
          const packs = await listLanguagePacks()
          let config = await readConfig()
          if (config.source === 'default' && config.problem === undefined) {
            // 第一次打开面板：把默认值和当前值各落一份，之后目录里就有两个
            // 文件可看可改；写失败也不影响这次读取。
            try {
              config = await writeConfig({})
            } catch (error) {}
          }
          return { ok: true, value: { dir: packs.dir, packs: packs.packs, config, ui: (await resolvePack(config.value.language)).ui } }
        }
        if (endpoint === 'config/reset') {
          // 重置：把当前值改回代码里的默认值，config.default.json 保持不动。
          const config = await writeConfig({ ...DEFAULT_CONFIG })
          const packs = await listLanguagePacks()
          return { ok: true, value: { dir: packs.dir, packs: packs.packs, config, ui: (await resolvePack(config.value.language)).ui } }
        }
        if (endpoint === 'config/set') {
          const language = payload?.language
          if (typeof language !== 'string' || language.length === 0) {
            return failure('compact-region/bad-request', 'language must be a non-empty string')
          }
          const config = await writeConfig({ language })
          const packs = await listLanguagePacks()
          return { ok: true, value: { dir: packs.dir, packs: packs.packs, config, ui: (await resolvePack(config.value.language)).ui } }
        }
        const sessionId = payload?.sessionId
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
          return failure('compact-region/bad-request', 'sessionId must be a non-empty string')
        }
        let session = scope.get('sessions')?.get?.(sessionId)
        const live = session !== undefined
        if (session === undefined) {
          // A conversation opened from the sidebar is not necessarily a live
          // Agent. Reading is still possible: fold the persisted log and the
          // current surface without creating a Session. Writing is not.
          const query = scope.get('sessionQuery')
          if (query === undefined) {
            return failure('compact-region/no-session', 'session is not live and sessionQuery is unavailable')
          }
          const read = await query.readSession(sessionId)
          const surface = await query.readSurface(sessionId)
          session = coldSession(sessionId, read.events, surface.events)
        }
        const stamp = `${session.seq}:${session.surface.replaceGeneration}`
        let entry = cache.get(sessionId)
        if (entry === undefined || entry.stamp !== stamp) {
          entry = {
            stamp,
            turns: computeTurns(session),
            checkpoints: computeCheckpoints(session),
          }
          cache.set(sessionId, entry)
        }
        if (endpoint === 'turns') return { ok: true, value: { ...entry.turns, source: 'compact-region' } }
        if (endpoint === 'checkpoints') return { ok: true, value: { ...entry.checkpoints, source: 'compact-region' } }
        if (endpoint === 'range') {
          const keys = payload?.keys
          if (!Array.isArray(keys) || keys.length === 0) {
            return failure('compact-region/bad-request', 'keys must be a non-empty array')
          }
          const range = computeSlotRange(session, keys)
          if (range === null) return failure('compact-region/no-range', 'the selected slots are not on the surface')
          // 一个压缩轮次单独再压一次没有意义（概述：个数=1 时不能是压缩轮次）。
          if (keys.length === 1 && String(keys[0]).charAt(0) === 'c') {
            return failure('compact-region/single-checkpoint', '单个压缩轮次不能再压缩，请连同前后轮次一起选')
          }
          const running = runningTurnFailure(session, range.end)
          if (running !== null) return running
          return { ok: true, value: { ...range, source: 'compact-region' } }
        }
        if (endpoint === 'preview') {
          const start = payload?.start
          const end = payload?.end
          if (!Number.isInteger(start) || !Number.isInteger(end)) {
            return failure('compact-region/bad-request', 'start and end must be integers')
          }
          const nodes = session.surface.nodes
          const startIdx = nodes.indexOf(start)
          const endIdx = nodes.indexOf(end)
          if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
            return failure('compact-region/stale-range', 'the selected range is no longer on the surface')
          }
          const running = runningTurnFailure(session, end)
          if (running !== null) return running
          const llm = scope.get('llm')
          if (llm === undefined || typeof llm.stream !== 'function') {
            return failure('compact-region/no-llm', 'the llm service is not available here')
          }
          const summary = await summarize(llm, session, start, end, payload?.signal)
          return {
            ok: true,
            value: {
              ...summary,
              start,
              end,
              count: endIdx - startIdx + 1,
            },
          }
        }
        if (endpoint === 'archive') {
          const start = payload?.start
          const end = payload?.end
          if (!Number.isInteger(start) || !Number.isInteger(end)) {
            return failure('compact-region/bad-request', 'start and end must be integers')
          }
          return { ok: true, value: archiveOf(session, start, end) }
        }
        if (endpoint === 'apply') {
          if (!live) {
            return failure('compact-region/not-live', '这个会话没有激活，先在这里发一条消息，再回来压缩。')
          }
          const start = payload?.start
          const end = payload?.end
          const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
          if (!Number.isInteger(start) || !Number.isInteger(end) || text.length === 0) {
            return failure('compact-region/bad-request', 'start, end and a non-empty text are required')
          }
          const nodes = session.surface.nodes
          const startIdx = nodes.indexOf(start)
          const endIdx = nodes.indexOf(end)
          if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
            return failure('compact-region/stale-range', 'the selected range is no longer on the surface')
          }
          const running = runningTurnFailure(session, end)
          if (running !== null) return running
          const shadowed = nodes.slice(startIdx, endIdx + 1)
          const message = {
            id: `compact-region-${randomUUID()}`,
            role: 'user',
            content: [{ type: 'text', text: `${CHECKPOINT_PREAMBLE}\n\n${text}` }],
            source: { kind: 'compact-region' },
          }
          const event = session.append('user/message', message, {
            surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
            sourceEventSeqs: shadowed,
          })
          cache.delete(sessionId)
          return { ok: true, value: { seq: event.seq, shadowed: shadowed.length } }
        }
        return failure('compact-region/unknown-endpoint', String(endpoint))
      } catch (error) {
        return failure('compact-region/failed', String(error?.message ?? error))
      }
    }
    if (webServer !== undefined && typeof webServer.register === 'function') {
      // Primary transport: our own prefix route on the live host web server.
      ctx.effect(() => serveRpc(webServer, connection, handler), 'compact-region rpc')
    } else if (connection.rpc !== undefined) {
      // Fallback for builds where the Connection service still mounts channels.
      ctx.effect(() => connection.rpc.handle(CHANNEL, handler), 'compact-region rpc')
    }
  })
}
