/**
 * lean-mode —— 装上即生效、卸载即失效：只对指定 preset 的会话把工具呈现改成「浅而准」。
 *
 * 怎么做到只对某个模式生效：本插件挂在 profile 层，注册一个【全局】的
 * `system-prompt/assemble` 监听器 —— 每次装配都会经过它。然后从装配的 scope
 * （真实装配里就是 Agent）拿到 `agent.ctx`，向 `agentPresets.composedPreset()`
 * 问「这个会话用的是哪个 preset」。是配置里点名的那个才变换，否则原样放行。
 *
 * 因此它【不需要修改任何核心包】：不新增 mode 枚举、不碰 dsh-tools。
 *
 * ── 描述表示（v2）─────────────────────────────────────────────────────
 * 工具描述是第三方写的文档（MCP 由 `mcp-client/src/tools.ts` 原样透传
 * `tool.description`），lean 只能对它做有损压缩。v1 用 `split(/[。\n]/)` 取第一句，
 * 这个假设只对「手写、单句、动词开头」的描述成立。
 *
 * 实测（2026-10-25）：
 *   · 自制 SolidWorks MCP（542 工具）：描述中位 71 字符，1 个含换行 ⇒ 几乎无损
 *   · 第三方 Sciverse MCP（6 工具）：描述中位 492 字符，6/6 含换行，
 *     67% 带 `Use when:`、50% 带 `Not for:` ⇒ v1 砍掉 67% 的决策段
 *
 * v2 的做法：
 *   1. 不再按句切分，只按 maxChars 做词边界截断（默认 300：实测 250 是不再丢
 *      `Use when`/`Not for` 的最小值）。
 *   2. 覆盖表 descriptions.json：命中则用人工/离线 LLM 维护的短描述，长度可控。
 *   3. 覆盖表带 basedOn 哈希：上游描述或 schema 变了自动 quarantine 并回落，
 *      绝不用一句可能过时的话骗模型。
 *   4. 未覆盖且「压缩会损坏」的工具自动进 pending 清单（带完整事实），供离线
 *      skill 补表 —— 运行时零模型调用，确定性。
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'lean-mode'

/** systemPrompt：监听装配。agentPresets 走 ctx.get（可选，拿不到就作用于全部会话）。 */
export const inject = ['systemPrompt']

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))

/** 描述字符上限。250 是实测「不再丢 Use when/Not for」的最小值，取 300 留余量。 */
export const DEFAULT_MAX_CHARS = 300

const CATALOG_SECTION = 'tools:catalog'
const CATALOG_HEADER = [
  '## Available tools',
  '',
  '★ 这些工具都存在 —— 名字在这里，完整 schema 在工具定义里（按需查）。',
  '★ 需要哪个就照它的定义调；★ 键后面带 : … 的是必填。',
  '★ 不要凭记忆猜参数 —— 用错工具或漏参数比多看一眼定义贵得多。',
].join('\n')

// ────────────────────────────────────────────────────────────────
// 描述压缩
// ────────────────────────────────────────────────────────────────

/**
 * 把一段描述压到 `maxChars` 以内。
 *
 * 不再按 `。` 或换行切句 —— 那种切法对英文零收益（`.` 根本不在此列），
 * 对中文和结构化描述是纯损害（第三方 MCP 的描述 100% 含换行）。
 * 只在【词边界】截断：早期版本在固定位置硬切会把单词切成两半
 * （官方 pwsh 的 "pass" 被切成 "p"+"s"），模型读到破碎英文。
 *
 * @param description 原始描述。
 * @param maxChars 字符上限。
 * @returns 压成单行的描述；未超上限时原样（仅折叠空白）。
 */
export function compressDescription(description, maxChars = DEFAULT_MAX_CHARS) {
  const text = String(description == null ? '' : description).replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  // ★ 先给省略号留一格，否则 `slice(0, maxChars) + '…'` 会输出 maxChars+1。
  //   实测 CJK 无空格、超长 URL、超长单词三种情况都会超 1 个字符。
  // maxChars <= 1 时连省略号都放不下，直接硬切到上限，保证不发生溢出。
  if (maxChars <= 1) return text.slice(0, Math.max(0, maxChars))
  const budget = maxChars - 1
  // `slice` 按 UTF-16 码元切，会**劈开代理对**：emoji（😀 等）占两个码元，
  // 切在中间就留下一个孤立的高位代理 —— 非法 Unicode。实测 pad=298 时输出尾部是 `\ud83d`。
  // 代码里已经有「不把单词切两半」的意识，这里补齐码点层面。
  let head = text.slice(0, budget)
  if (head.length > 0) {
    const lastUnit = head.charCodeAt(head.length - 1)
    if (lastUnit >= 0xD800 && lastUnit <= 0xDBFF) head = head.slice(0, -1)
  }
  const space = head.lastIndexOf(' ')
  // 只在空格足够靠后时退到词边界，否则硬切（中文没有空格）。
  const body = space > budget * 0.66 ? head.slice(0, space) : head
  return body.replace(/[,;:\s]+$/, '') + '…'
}

/**
 * 判断一个工具的描述是否需要离线补表。
 *
 * 只覆盖「压缩会损坏语义」的形态。`title-like` 的判据来自实测：
 * SolidWorks MCP 的 32 个 title-only 工具是唯一命中的真实样本。
 *
 * @param tool 含 name / description 的工具。
 * @param maxChars 字符上限；超限的工具也需要改写。
 * @returns 命中原因，或 `null` 表示无需处理。
 */
export function needsCuration(tool, maxChars = DEFAULT_MAX_CHARS) {
  const orig = String(tool?.description == null ? '' : tool.description).trim()
  if (orig === '') return 'empty'
  if (orig.length < 15) return 'too-short'
  // 参数块开头。补上 `Arguments`（Sphinx / 部分 Google 风格用这个）——
  // 实测 `Arguments:` 以前落到 null，被当成正常描述，但它其实是个参数块。
  if (/^(Args|Arguments|Returns|Parameters|Params|Raises|Note|Example)s?:/i.test(orig)) return 'argblock'
  // 单个 CamelCase 标识符当描述（`MetricsQueryRequest`），模型只知道类型名。
  if (/^[A-Z][A-Za-z0-9]{3,}$/.test(orig)) return 'typename'
  // 标题式短语：真的 Title Case（多数实词首字母大写）+ 词数少 + 没有句末标点。
  //
  // ⚠ 旧写法 `/^[A-Z][A-Za-z0-9\s,'()/-]+$/` 只检查「首字母大写」，
  // 于是 "Clicks on the provided element"（5 词、仅 1 词大写）也被判成标题。
  // 实测 90 个真实 MCP 描述里 7 条被误判（chrome-devtools 的 click/drag/hover/
  // resize_page/type_text/handle_dialog、codebase-memory 的 delete_project）。
  // 真标题如 "Structural Analysis" 是每个实词都大写。
  if (!/[.!?。]$/.test(orig)) {
    const words = orig.split(/\s+/).filter(Boolean)
    if (words.length >= 1 && words.length <= 6) {
      const capped = words.filter(w => /^[A-Z]/.test(w)).length
      const looksTitleCase = /^[A-Z]/.test(words[0]) && capped / words.length >= 0.6
      if (looksTitleCase && /^[A-Za-z0-9\s,'()/-]+$/.test(orig)) return 'title-like'
    }
  }
  // 结构化长描述：压缩会切掉 `Use when` / `Not for` 这类决策段。
  if (orig.replace(/\s+/g, ' ').trim().length > maxChars) return 'over-budget'
  return null
}

// ────────────────────────────────────────────────────────────────
// JSON Schema 浅投影
// ────────────────────────────────────────────────────────────────

/**
 * 把一个 JSON Schema 里的 `$ref` 就地展开到它指向的 `$defs` 条目。
 * MCP 服务器（Pydantic 生成的那类）习惯把真正的入参写成
 * `{"params": {"$ref": "#/$defs/XxxInput"}}`，参数名全在 `$defs` 里。
 * 不展开的话，浅投影后只剩 `{"params": {"type": "object"}}`，
 * 模型看不到任何参数名，只能自己编（实测 44.2% 对）。
 */
/**
 * 递归展开 `$ref`，并保留原来的 `$defs` 根。
 *
 * 旧实现只解一层：`{$ref:'#/$defs/Outer'}` 解开后得到的目标里若还有
 * `{$ref:'#/$defs/Inner'}`，就直接交给调用方了——而调用方拿的是**已解析的子树**，
 * 里面没有 `$defs`，于是内层引用解析失败、塌成 `{}`。实测 Pydantic 的嵌套模型
 * （Outer → Inner）投影后 `inner` 变成空对象，模型看不到任何字段。
 *
 * 两条规则：
 *   1. 递归解到底，且始终用**最初的根**去找目标；
 *   2. 用一个 seen 集合挡住循环引用（`A → B → A` 会在重复处塌成 `{}`，不爆栈）。
 * @param node 待解析节点。
 * @param root 提供 `$defs` 的根 schema。
 * @param seen 已展开过的 `$ref` 字符串，用于防环。
 * @returns 展开后的节点；解不开的部分返回 `{}`。
 */
function resolveRef(node, root, seen) {
  if (node == null || typeof node !== 'object') return node
  const visited = seen ?? new Set()
  if (typeof node.$ref === 'string') {
    if (visited.has(node.$ref)) return {}
    let cursor = root
    for (const segment of node.$ref.replace(/^#\//, '').split('/')) {
      if (cursor == null) return {}
      cursor = cursor[segment]
    }
    if (cursor == null) return {}
    const next = new Set(visited)
    next.add(node.$ref)
    const resolved = resolveRef(cursor, root, next)
    // `$ref` 同层的注解（description 等）优先于目标自带的
    const rest = { ...node }
    delete rest.$ref
    return Object.keys(rest).length === 0 ? resolved : { ...resolved, ...rest }
  }
  if (Array.isArray(node)) return node.map(item => resolveRef(item, root, visited))
  const out = {}
  for (const [key, value] of Object.entries(node)) {
    // `$defs` 本身不往下展开（那是引用的仓库，展开会指数膨胀）
    out[key] = key === '$defs' || key === 'definitions' ? value : resolveRef(value, root, visited)
  }
  return out
}

/**
 * 把一个 JSON schema 投影成顶层契约。
 * @param parameters 工具的 `parameters` schema。
 * @returns 只保留顶层键、类型、enum（≤12）与 required 的 schema。
 */
/**
 * 浅投影时推断一个属性的类型。
 *
 * 优先看 `type`；没有就看 `anyOf`/`oneOf` 里**唯一的非 null 分支**
 * （这是 Pydantic `Optional[X]` 的标准编码）。都推不出就返回 undefined，
 * 由调用方写成 annotation-only（任意 JSON），不要猜。
 * @param prop 单个属性的 schema 节点。
 * @returns 可用的类型字符串，或 undefined。
 */
function inferShallowType(prop) {
  const t = Array.isArray(prop.type) ? prop.type[0] : prop.type
  if (typeof t === 'string' && t !== 'null') return t
  for (const key of ['anyOf', 'oneOf']) {
    const branches = Array.isArray(prop[key]) ? prop[key] : []
    if (branches.length === 0) continue
    const typed = branches.filter(b => b && typeof b.type === 'string' && b.type !== 'null')
    if (typed.length === 1) return typed[0].type          // Optional[X] → X
    if (typed.length > 1) {
      const uniq = [...new Set(typed.map(b => b.type))]
      if (uniq.length === 1) return uniq[0]               // 多个分支同类型
    }
  }
  return undefined
}

export function shallowParameters(parameters) {
  if (parameters == null || parameters.type !== 'object' || parameters.properties == null) return { type: 'object' }
  const required = Array.isArray(parameters.required) ? parameters.required : []
  const properties = {}
  for (const key of Object.keys(parameters.properties)) {
    const prop = resolveRef(parameters.properties[key] || {}, parameters)
    const declared = inferShallowType(prop)
    // 推不出类型就**不要写 type**（annotation-only = 任意 JSON），
    // 绝不能谎报成 "object"——那会让模型以为该传对象。实测 anyOf 参数
    // （Pydantic 的 Optional[X]）以前全被标成 object，106 处。
    const type = declared
    const enumValues = prop.enum
    const base = type === undefined ? {} : { type }
    const shape = Array.isArray(enumValues) && enumValues.length > 0 && enumValues.length <= 12
      ? { ...base, enum: enumValues }
      : base
    // 被展开出来的对象带上它的键名——那正是模型唯一能看到的参数清单。
    if (prop.properties != null && Object.keys(prop.properties).length > 0) {
      shape.properties = shallowParameters(prop).properties
      if (Array.isArray(prop.required) && prop.required.length > 0) shape.required = prop.required
    }
    properties[key] = shape
  }
  const out = { type: 'object', properties }
  if (required.length > 0) out.required = required
  return out
}

// ────────────────────────────────────────────────────────────────
// 覆盖表
// ────────────────────────────────────────────────────────────────

/** 稳定序列化：键排序，保证同一 schema 的哈希不随插入顺序变化。 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}'
}

/** 取 16 位十六进制摘要，用于 basedOn 比对。 */
export function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
}

/** 解析配置里的表路径：相对路径按插件目录解析。 */
function tablePath(spec, fallbackName) {
  const raw = typeof spec === 'string' && spec.trim() !== '' ? spec.trim() : fallbackName
  return isAbsolute(raw) ? raw : join(PLUGIN_DIR, raw)
}

/** 工具的 schema 签名，用于识别「同名但定义变了」。 */
/**
 * 工具描述的指纹，用于覆盖表的 `basedOn.descHash`。
 *
 * **按归一化后的文本算，不是原始文本。** 理由：纯空白差异（换行 / 多空格 /
 * 首尾空格）经 `compressDescription` 后输出完全相同，对模型没有任何影响。
 * 用原始文本做哈希会把这类变化误判成「上游已变更」→ 无谓隔离 + 无谓补表。
 * 实测：`"foo"` 与 `"foo\n"` 压缩后同为 `"foo"`，但原始哈希不同。
 * @param description 工具原始描述。
 * @returns 16 位十六进制指纹。
 */
export function descriptionSignature(description) {
  return digest(String(description ?? '').replace(/\s+/g, ' ').trim())
}

export function schemaSignature(parameters) {
  return digest(stableStringify(parameters ?? {}))
}

/**
 * 工具描述覆盖表 + 待补清单。
 *
 * 三种条目状态：
 *   · `active`     —— 哈希匹配则使用
 *   · `quarantine` —— 哈希失配，回落到压缩，进 pending 等重写
 *   · `deprecated` —— 不参与匹配，条目保留（表只增不减）
 */
export class DescriptionTable {
  constructor({ path, pendingPath, logger, maxChars = DEFAULT_MAX_CHARS }) {
    this.path = path
    this.pendingPath = pendingPath
    this.logger = logger
    this.maxChars = maxChars
    this.tools = {}
    this.pending = {}
    this.flushTimer = undefined
    /** 是否已 load()。忘了调会让 resolve() 静默回落到压缩。 */
    this.loaded = false
  }

  load() {
    this.loaded = true
    try {
      if (!existsSync(this.path)) return this
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
      if (parsed?.tools !== null && typeof parsed?.tools === 'object') this.tools = parsed.tools
      if (parsed?.pending !== null && typeof parsed?.pending === 'object') this.pending = parsed.pending
    } catch (error) {
      // 表损坏不能让整个装配失败：退化成「全部走压缩」仍然可用。
      this.logger?.warn?.(`lean-mode: 描述覆盖表读取失败，全部走压缩: ${String(error)}`)
    }
    return this
  }

  /** 记入待补清单，附带完整事实供离线 skill 使用。 */
  markPending(tool, reason) {
    const prev = this.pending[tool.name]
    const today = new Date().toISOString().slice(0, 10)
    if (prev !== undefined && prev.reason === reason && prev.description === String(tool.description ?? '')) return
    this.pending[tool.name] = {
      reason,
      description: String(tool.description == null ? '' : tool.description),
      // MCP 桥接来的工具用 inputSchema，插件内部工具用 parameters——两种都认，
      // 否则会把整份 schema 丢成 {type:'object'}，补表时看不到任何参数。
      parameters: tool.parameters ?? tool.inputSchema ?? { type: 'object' },
      firstSeen: prev?.firstSeen ?? today,
      lastSeen: today,
    }
    this.scheduleFlush()
  }

  /**
   * 解析一个工具应当使用的描述。
   *
   * @param tool 含 name / description / parameters 的工具。
   * @returns `{ text, origin }`；origin 用于诊断。
   */
  resolve(tool) {
    // 忘了 load() 时，	his.tools 是空的 ⇒ 每条都静默回落压缩，覆盖表形同不存在。
    // 这是个不报错的坏状态：插件看着在工作，只是永远不用表。实测我自己写探针时就漏了 load()。
    if (!this.loaded) this.logger?.warn?.('lean-mode: DescriptionTable.resolve() 在 load() 之前被调用——覆盖表未加载，全部回落压缩')
    const fallback = compressDescription(tool.description, this.maxChars)
    const entry = this.tools[tool.name]

    if (entry === undefined) {
      const reason = needsCuration(tool, this.maxChars)
      if (reason !== null) this.markPending(tool, reason)
      return { text: fallback, origin: 'compress' }
    }
    if (entry.status !== undefined && entry.status !== 'active') {
      return { text: fallback, origin: `compress:${entry.status}` }
    }

    // 上游变了就隔离：宁可回落到有损压缩，也不用可能过时的话骗模型。
    const basedOn = entry.basedOn
    if (basedOn !== undefined && basedOn !== null) {
      const descChanged = typeof basedOn.descHash === 'string'
        && basedOn.descHash !== descriptionSignature(tool.description)
      const schemaChanged = typeof basedOn.schemaHash === 'string'
        && basedOn.schemaHash !== schemaSignature(tool.parameters ?? tool.inputSchema)
      if (descChanged || schemaChanged) {
        entry.status = 'quarantine'
        this.markPending(tool, descChanged ? 'stale-description' : 'stale-schema')
        this.scheduleFlush()
        this.logger?.warn?.(`lean-mode: 工具 ${tool.name} 上游已变更，覆盖表条目转入 quarantine`)
        return { text: fallback, origin: 'compress:stale' }
      }
    }

    return { text: compressDescription(entry.desc, this.maxChars), origin: 'table' }
  }

  /** 延迟落盘，避免每次装配都写文件。 */
  scheduleFlush() {
    if (this.flushTimer !== undefined) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flush()
    }, 2000)
    this.flushTimer.unref?.()
  }

  /** 立即落盘。 */
  flush() {
    try {
      const payload = {
        _meta: { version: 1, maxChars: this.maxChars, updated: new Date().toISOString().slice(0, 10) },
        tools: this.tools,
        pending: this.pending,
      }
      writeFileSync(this.pendingPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
    } catch (error) {
      this.logger?.warn?.(`lean-mode: 覆盖表落盘失败: ${String(error)}`)
    }
  }
}

// ────────────────────────────────────────────────────────────────
// 装配
// ────────────────────────────────────────────────────────────────

/**
 * `catalog: 'full'` 模式下，目录行里那条描述的字符上限。
 *
 * ⚠ **这与 `maxChars`（工具通道，默认 300）是两个独立预算，别混。**
 * 目录进的是【系统提示词】的指令区，越短小精确、遵循度越好；
 * 工具通道进的是结构化 `tools` 字段，可以放宽到 300 以免丢掉 `Use when:`/`Not for:`。
 */
const CATALOG_DESC_CHARS = 120

function catalogLine(tool) {
  const p = tool.parameters || {}
  const props = p.properties || {}
  const required = new Set(Array.isArray(p.required) ? p.required : [])
  const keys = Object.keys(props)
  const shape = keys.length === 0
    ? '{}'
    : '{' + keys.map(k => JSON.stringify(k) + (required.has(k) ? ': …' : '?: …')).join(', ') + '}'
  return '- ' + tool.name + ' ← 实参写成 ' + shape + ' // ' + compressDescription(tool.description, CATALOG_DESC_CHARS)
}

/**
 * ★ 目录默认【只列名字】。
 * 为什么：目录进的是【系统提示词】（指令区），而指令区越短小精确、遵循度越好。
 * 早期版本每条工具写「实参形状 + 一句描述」= 138 B/工具 ⇒ 731 个工具就是 101 KB，
 * 超出 65536 的指令预算，会把 AGENTS.md 撑到被截断 —— 那是本末倒置。
 * 只列名字 = 13 B/工具 ⇒ 731 个工具 10 KB，占预算 15%。
 * 实参细节本来就在【工具通道】里（结构化、按需查），不需要在指令区重复一遍。
 */
function catalogBody(tools, full) {
  if (full) return CATALOG_HEADER + '\n\n' + '```' + '\n' + tools.map(catalogLine).join('\n') + '\n' + '```'
  return CATALOG_HEADER + '\n\n' + tools.map(t => '- ' + t.name).join('\n')
}

/**
 * 这次装配属于哪个 preset。
 *
 * 取 Agent context 的顺序（正式字段优先）:
 *   1. `context.agent.ctx` —— `assembleContextFor()` 的正式返回字段
 *      (`packages/core/agent/src/dispatch.ts`: `{ agent, scope: agent }`)。
 *   2. `scope.ctx` —— 历史路径。真实装配里 `scope` 恰好是 Agent 实例，而 Agent
 *      有 `readonly ctx`；但 `ScopeKey` 的类型只是 `object`
 *      (`packages/core/scope/src/index.ts`)，该路径没有类型契约保证，故仅兜底。
 *
 * 拿不到时不能静默放行 —— 否则 Lean 模式不生效却没有任何迹象。
 */
function presetOf(ctx, context) {
  const registry = ctx.get('agentPresets')
  const agent = context?.agent ?? context?.scope
  if (registry == null || agent == null) {
    ctx.logger?.warn?.(
      'lean-mode: agentPresets 或装配 subject 不可用，本次装配未变换'
      + ` (registry=${registry == null ? 'missing' : 'ok'}, agent=${agent == null ? 'missing' : 'ok'})`,
    )
    return undefined
  }
  const agentCtx = agent.ctx ?? agent
  try {
    return registry.composedPreset(agentCtx)
  } catch (error) {
    ctx.logger?.warn?.(`lean-mode: composedPreset 查询失败，本次装配未变换: ${String(error)}`)
    return undefined
  }
}

/**
 * 把一条工具投影成 lean 形态。
 * @param tool 原始工具。
 * @param table 覆盖表；`undefined` 表示未启用。
 * @param fallbackMode `compress` | `original` | `empty`。
 */
function projectTool(tool, table, fallbackMode) {
  const resolved = table === undefined ? undefined : table.resolve(tool)
  const origin = resolved?.origin ?? 'compress'
  let description
  if (origin === 'table') {
    description = resolved.text
  } else if (fallbackMode === 'empty') {
    description = ''
  } else if (fallbackMode === 'original') {
    description = String(tool.description == null ? '' : tool.description)
  } else {
    description = resolved === undefined ? compressDescription(tool.description) : resolved.text
  }
  return {
    name: tool.name,
    description,
    parameters: shallowParameters(tool.parameters),
    // `deferLoading` 是官方 ToolSchema 的正式字段
    // (`packages/core/system-prompt/src/index.ts` L642-647 显式保留)；
    // 丢掉会让该工具失去「延迟激活」语义。
    ...tool.deferLoading === true ? { deferLoading: true } : {},
  }
}

/**
 * 注册 lean 呈现。
 *
 * @param ctx 插件 context（profile 层）。
 * @param config 见 `cordis.patch.yml` 的 `lean-mode` 行。
 */
export function apply(ctx, config) {
  const settings = config || {}
  const wanted = Array.isArray(settings.presets) && settings.presets.length > 0 ? settings.presets : undefined
  const withCatalog = settings.catalog !== false
  const withShape = settings.shape !== false
  const maxChars = Number.isInteger(settings.maxChars) && settings.maxChars > 0 ? settings.maxChars : DEFAULT_MAX_CHARS
  const fallbackMode = settings.fallback === 'original' || settings.fallback === 'empty' ? settings.fallback : 'compress'

  let table
  if (settings.descriptions !== false) {
    table = new DescriptionTable({
      path: tablePath(settings.table, 'descriptions.json'),
      pendingPath: tablePath(settings.pending, 'descriptions.pending.json'),
      logger: ctx.logger,
      maxChars,
    }).load()
  }

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const base = await next()
    if (base == null || !Array.isArray(base.tools) || base.tools.length === 0) return base
    if (wanted !== undefined) {
      const preset = presetOf(ctx, context)
      if (preset === undefined || wanted.indexOf(preset) < 0) return base
    }
    const tools = withShape ? base.tools.map(tool => projectTool(tool, table, fallbackMode)) : base.tools
    if (!withCatalog) return Object.assign({}, base, { tools })
    if ((base.sections || []).some(s => s.name === CATALOG_SECTION)) return Object.assign({}, base, { tools })
    const order = ctx.systemPrompt.getSectionOrder('TOOLS_SDK')
    const body = catalogBody(tools, settings.catalog === 'full')
    return Object.assign({}, base, { tools, sections: base.sections.concat([{ name: CATALOG_SECTION, order, interpolate: false, text: body }]) })
  })

  // 卸载前把待补清单落盘，避免 debounce 计时器被丢弃。
  ctx.effect?.(() => () => table?.flush(), 'lean-mode.flush')
}
