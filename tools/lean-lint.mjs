#!/usr/bin/env node
// lean-lint：检查一批工具的 schema 在 DSH lean 呈现下会不会踩坑，并校官方文风。
// 用法: node lean-lint.mjs <tools.json|--mcp <server.mjs>> [--max-chars N]
//
// 本文件对应插件 v2（2026-10-26）：
//   · 描述用 compressDescription：只做词边界截断，不按 `。`/换行切句
//   · 默认上限 300（DEFAULT_MAX_CHARS）
//   · 超上限或压缩会损坏语义的工具由 needsCuration 判定进 pending
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import {
  shallowParameters,
  compressDescription,
  needsCuration,
  DEFAULT_MAX_CHARS,
} from '../index.mjs'

const BT = String.fromCharCode(96)
const CATALOG_HEADER = ['## Available tools','','★ 这些工具都存在 —— 名字在这里，完整 schema 在工具定义里（按需查）。','★ 需要哪个就照它的定义调；★ 键后面带 : … 的是必填。','★ 不要凭记忆猜参数 —— 用错工具或漏参数比多看一眼定义贵得多。'].join('\n')
const B = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8')

// 官方实测口径（docs/tool-catalog.md，n=72 工具 / 228 条描述）—— 仅用于「与官方对表」，不是硬判据
const OFFICIAL = { descMedian: 139, verbFirstPct: 82, periodEndPct: 99, sentencesMedian: 2, paramMedian: 55 }

/** 单个**参数描述**的建议上限。官方中位 55 字符，超过这个数多半写成了句子。（与工具描述的 maxChars 无关） */
const PARAM_DESC_CHARS = 120
const VERB_STEM = /^(list|read|create|edit|search|fetch|write|return|add|get|set|run|send|open|close|show|remove|delete|update|kill|wait|ask|find|move|copy|build|start|stop|inspect|validate|generate|render|export|import|load|save|execute|spawn|interrupt|present|register|manage|query|trace|resolve|measure|check|apply|extract|upload|attach|launch|terminate|collect|describe|explain|cancel|resume|pause|enable|disable|install|uninstall|toggle|schedule|perform|capture|navigate|declare|place|assign|mirror|hollow|repeat|optimize|click|compare|convert|parse|merge|split|filter|sort|count|locate|retrieve|store|publish|subscribe|notify|report|emit|observe|append|insert|replace|patch|revert|refresh|suppress|unsuppress|obtain|acquire|determine|identify|evaluate|analyze|calculate|compute|derive|modify|change|alter|adjust|detach|mount|unmount|prepend|truncate|clear|reset|restore|backup|archive|compress|decompress|encode|decode|encrypt|decrypt|sign|verify|authorize|authenticate|login|logout|connect|disconnect|broadcast|draw|paint|plot|chart|visualize|highlight|select|deselect|focus|blur|scroll|drag|drop|hover|type|press|release|hold|sleep|retry|abort|fork|clone|replicate|duplicate|rename|relabel|tag|untag|label|annotate|comment|review|approve|reject|accept|deny|grant|revoke|allow|forbid|permit|block|unblock|continue|restart|reload|sync|desync)(s|es|ed|ing)?\b/

function catalogLine(t) {
  const p = t.parameters || {}; const props = p.properties || {}; const req = new Set(Array.isArray(p.required) ? p.required : [])
  const keys = Object.keys(props)
  const shape = keys.length === 0 ? '{}' : '{' + keys.map(k => JSON.stringify(k) + (req.has(k) ? ': …' : '?: …')).join(', ') + '}'
  return '- ' + t.name + ' ← 实参写成 ' + shape + ' // ' + compressDescription(t.description)
}

async function fromMcp(file) {
  const child = spawn(process.execPath, [file], { stdio: ['pipe', 'pipe', 'inherit'] })
  let buf = ''
  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n')
  return await new Promise((resolve) => {
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8')
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        if (!line) continue
        let m; try { m = JSON.parse(line) } catch { continue }
        if (m.id === 1) send({ jsonrpc: '2.0', method: 'notifications/initialized' })
        if (m.id === 2) { child.kill(); resolve(m.result.tools.map(t => ({ name: t.name, description: t.description, parameters: t.inputSchema }))) }
      }
    })
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    setTimeout(() => { child.kill(); resolve([]) }, 15000)
  })
}

const argv = process.argv.slice(2)
// --max-chars 覆盖默认 300（与插件 DEFAULT_MAX_CHARS 一致）
const capArg = argv.indexOf('--max-chars')
const MAX_CHARS = capArg >= 0 ? Number(argv[capArg + 1]) : DEFAULT_MAX_CHARS
const files = capArg >= 0 ? argv.filter((_, i) => i !== capArg && i !== capArg + 1) : argv
// ★ 兼容三种输入：裸数组、DSH 会话导出（{tools:[…]}）、以及 MCP 的 tools/list 结果
const unwrap = value => Array.isArray(value) ? value : Array.isArray(value?.tools) ? value.tools : undefined
const raw = files[0] === '--mcp' ? await fromMcp(files[1]) : unwrap(JSON.parse(fs.readFileSync(files[0], 'utf8')))
if (raw === undefined) { console.log('输入里找不到工具数组（期望裸数组或 {tools:[…]}）'); process.exit(1) }
// ★ 兼容 MCP 的 inputSchema 与 DSH 的 parameters 两种叫法
const tools = raw.map(t => ({ name: t.name, description: t.description, parameters: t.parameters || t.inputSchema || t.schema }))
if (!tools.length) { console.log('没读到工具'); process.exit(1) }

const nativeBytes = B(tools)
const shallow = tools.map(t => ({ name: t.name, description: compressDescription(t.description, MAX_CHARS), parameters: shallowParameters(t.parameters) }))
const catalogBody = CATALOG_HEADER + '\n\n' + BT + BT + BT + '\n' + shallow.map(catalogLine).join('\n') + '\n' + BT + BT + BT
const shallowBytes = B(shallow) + Buffer.byteLength(catalogBody, 'utf8')

const R = (s) => (s.match(/[.!?](\s|$)/g) || []).length
const fails = []
const warns = []
const W = (tool, rule, detail) => warns.push({ tool, rule, detail })
const F = (tool, rule, detail) => fails.push({ tool, rule, detail })

// ── A. lean 呈现的真实损害（这些才是违规）──────────────────────────
// $ref 会由 shallowParameters 展开，检查前先展开，否则会把「$ref 没有内联 type」误报成违规。
const resolveRef = (node, root) => {
  if (node == null || typeof node !== 'object' || node.$ref === undefined) return node
  let cursor = root
  for (const segment of String(node.$ref).replace(/^#\//, '').split('/')) {
    if (cursor == null) return {}
    cursor = cursor[segment]
  }
  return cursor == null ? {} : cursor
}
for (const t of tools) {
  const p = t.parameters || {}
  const d = String(t.description ?? '')
  if (p.type !== 'object' || !p.properties) F(t.name, 'A1 顶层须 object+properties', 'lean 下参数会【全丢】')
  // v2 不按 `。`/换行切句，但会把连续空白折叠成单空格 —— 换行只是被压平，不是损害
  if (/\n/.test(d)) W(t.name, 'A2 描述含换行（v2 会折叠成空格）', '不是错误：compressDescription 折叠空白')
  if (d.replace(/\s+/g, ' ').trim().length > MAX_CHARS) W(t.name, 'A3 描述超 ' + MAX_CHARS + ' 字符', '当前 ' + d.trim().length + '，会被截断并进入 pending 待补')
  for (const [k, rawProp] of Object.entries(p.properties || {})) {
    const v = resolveRef(rawProp, p)
    if (v.enum && v.enum.length > 12) F(t.name, 'A4 枚举须 ≤12 个', k + ' 有 ' + v.enum.length + ' 个（lean 会整个丢弃）')
    if (!v.type && v.properties == null) F(t.name, 'A5 每个键须写 type', k)
    if (v.type === 'object') W(t.name, 'A6 慎用嵌套 object', k + '（lean 只留 type；native 完整）')
    if (v.type === 'array') W(t.name, 'A7 慎用数组', k + '（lean 只留 type；native 完整）')
    if (Array.isArray(v.type)) F(t.name, 'A8 type 不可为数组', k)
    if (v.oneOf || v.anyOf) F(t.name, 'A9 禁 oneOf/anyOf', k + '（lean 只留 type）')
  }
}

// ── B. 官方文风（只提醒，不判失败）────────────────────────────────
// 依据 DSH 官方 .agents/skills/agent-experience/SKILL.md 与 72 个官方工具的实测分布。
// 这些是「怎么写更好」，不是「写错了」。
for (const t of tools) {
  const d = String(t.description ?? '').trim()
  if (!VERB_STEM.test(d.toLowerCase())) W(t.name, 'B1 建议动词开头（官方 82%）', '首词: ' + (d.split(/\s+/)[0] || ''))
  if (!/[.]$/.test(d)) W(t.name, 'B2 建议句号收尾（官方 99%）', '结尾: ' + d.slice(-12))
  const sc = R(d)
  if (sc === 1 && d.length < 60) W(t.name, 'B4 建议补第二句（何时用/前提/副作用/返回）', '当前只有一句且偏短')
  for (const [k, v] of Object.entries((t.parameters || {}).properties || {})) {
    if (!v.description) W(t.name, 'B5 建议每个参数有 description', k + '（native 用户看得到；lean 会丢弃）')
    else {
      const pd = String(v.description).trim()
      if (!/[.]$/.test(pd)) W(t.name, 'B6 建议参数描述句号收尾（官方 100%）', k + ': ' + pd.slice(0, 40))
      if (pd.length > PARAM_DESC_CHARS) W(t.name, 'B7 参数描述建议 ≤' + PARAM_DESC_CHARS + ' 字符', k + ' = ' + pd.length)
    }
  }
}

console.log('工具数 = ' + tools.length)
console.log('描述上限 maxChars = ' + MAX_CHARS + (capArg >= 0 ? '（--max-chars 指定）' : '（插件默认）'))
console.log('native schema 合计 = ' + nativeBytes + ' B   (' + Math.round(nativeBytes / tools.length) + ' B/工具)')
console.log('lean 通道 + 目录   = ' + shallowBytes + ' B   (' + Math.round(shallowBytes / tools.length) + ' B/工具)')
console.log('⇒ 字节比 = ' + (shallowBytes / nativeBytes).toFixed(3) + '   ⚠ 这只是参考：省得多 = 丢得多，不是好')
const cutCount = tools.filter(t => compressDescription(t.description, MAX_CHARS).length < String(t.description ?? '').replace(/\s+/g, ' ').trim().length).length
console.log('★ 信息完整性（lean 相对 native 丢掉的）')
console.log('   描述被截断的工具      = ' + cutCount + '/' + tools.length)
// 哪些工具需要离线补表（插件会写进 descriptions.pending.json）
const pending = tools.map(t => ({ name: t.name, reason: needsCuration(t, MAX_CHARS) })).filter(x => x.reason !== null)
console.log('   需离线补表（pending）  = ' + pending.length + '/' + tools.length)
if (pending.length) {
  const byReason = {}
  for (const x of pending) (byReason[x.reason] ||= []).push(x.name)
  for (const r of Object.keys(byReason).sort()) console.log('      ' + r + ' ×' + byReason[r].length + '： ' + byReason[r].slice(0, 3).join(', ') + (byReason[r].length > 3 ? ' …' : ''))
}
const lostKeys = tools.flatMap(t => Object.entries((t.parameters || {}).properties || {}).filter(([, v]) => v.type === 'object' || v.type === 'array' || (v.enum && v.enum.length > 12) || v.description || v.default !== undefined).map(([k]) => k))
console.log('   参数里被 lean 丢掉的信息点 = ' + lostKeys.length + ' 处（嵌套/数组/枚举>12/默认值/属性说明）')
console.log('   ⇒ ★ 要保住这些信息就用 catalog 档（shape: false），要压上下文才用 lean 档')
console.log('')
const byRule = {}
for (const f of fails) { (byRule[f.rule] ||= []).push(f) }
console.log('=== 违规（' + fails.length + ' 条，会导致 lean 下信息丢失）===')
if (!fails.length) console.log('  无 ✓')
for (const r of Object.keys(byRule).sort()) {
  const list = byRule[r]
  console.log('  ' + r + '  ×' + list.length)
  for (const f of list.slice(0, 3)) console.log('      ' + f.tool + ': ' + f.detail)
  if (list.length > 3) console.log('      …还有 ' + (list.length - 3) + ' 条')
}
console.log('')
// 文风对表
const descs = tools.map(t => String(t.description ?? '').trim())
const pdescs = tools.flatMap(t => Object.values((t.parameters || {}).properties || {}).map(v => String(v.description ?? '')))
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 }
const pct = (n, d) => d ? Math.round(n / d * 100) + '%' : '-'
const byWarn = {}
for (const w of warns) { (byWarn[w.rule] ||= []).push(w) }
console.log('=== 提醒（' + warns.length + ' 条，不算失败）===')
if (!warns.length) console.log('  无')
for (const r of Object.keys(byWarn).sort()) console.log('  ' + r + '  ×' + byWarn[r].length + '   （' + byWarn[r][0].detail.slice(0, 40) + '…）')
console.log('')
console.log('=== 与官方对表 ===')
console.log('  工具描述长度  中位 你=' + med(descs.map(s => s.length)) + '   官方=' + OFFICIAL.descMedian)
console.log('  动词开头           你=' + pct(descs.filter(d => VERB_STEM.test(d.toLowerCase())).length, descs.length) + '   官方=' + OFFICIAL.verbFirstPct + '%')
console.log('  句号收尾           你=' + pct(descs.filter(d => /[.]$/.test(d)).length, descs.length) + '   官方=' + OFFICIAL.periodEndPct + '%')
console.log('  句数          中位 你=' + med(descs.map(R)) + '   官方=' + OFFICIAL.sentencesMedian)
console.log('  参数描述长度  中位 你=' + med(pdescs.map(s => s.length)) + '   官方=' + OFFICIAL.paramMedian)
console.log('  参数有描述         你=' + pct(pdescs.filter(Boolean).length, pdescs.length) + '   官方=100%')
console.log('')
console.log('=== lean 目录行（模型实际看到的）===')
for (const l of shallow.map(catalogLine)) console.log('  ' + (l.length > 170 ? l.slice(0, 170) + '…' : l))
process.exit(fails.length ? 1 : 0)
