#!/usr/bin/env node
// lean-lint：检查一批工具的 schema 在 DSH lean 呈现下会不会踩坑，并校官方文风。
// 用法: node lean-lint.mjs <tools.json|--mcp <server.mjs>>
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { shallowParameters, firstLine } from '../index.mjs'

const BT = String.fromCharCode(96)
const CATALOG_HEADER = ['## Tool catalog','','★ 每条都给出该工具实参的【顶层 JSON 形状】：箭头右边就是你要传的对象。','★ 形状里没有列出的键一律不要传；★ 不要拆开单键信封 —— 形如 {"params": …} 的，所有实参都放进 params 里面。','★ 键后面带 : … 的是必填。'].join('\n')
const B = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8')

// 官方实测口径（docs/tool-catalog.md，n=72 工具 / 228 条描述）
const OFFICIAL = { descMedian: 139, verbFirstPct: 82, periodEndPct: 99, sentencesMedian: 2, paramMedian: 55 }
const VERB_STEM = /^(list|read|create|edit|search|fetch|write|return|add|get|set|run|send|open|close|show|remove|delete|update|kill|wait|ask|find|move|copy|build|start|stop|inspect|validate|generate|render|export|import|load|save|execute|spawn|interrupt|present|register|manage|query|trace|resolve|measure|check|apply|extract|upload|attach|launch|terminate|collect|describe|explain|cancel|resume|pause|enable|disable|install|uninstall|toggle|schedule|perform|capture|navigate|declare|place|assign|mirror|hollow|repeat|optimize|click|compare|convert|parse|merge|split|filter|sort|count|locate|retrieve|store|publish|subscribe|notify|report|emit|observe|append|insert|replace|patch|revert|refresh|suppress|unsuppress|export|import|insert|remove|extrude|fillet|shell|mirror|pattern|weld|hollow|assign|measure|run|optimize|topolog|click|obtain|acquire|determine|identify|evaluate|analyze|calculate|compute|derive|query|fetch|retrieve|update|modify|change|alter|adjust|enable|disable|toggle|attach|detach|mount|unmount|read|write|append|prepend|truncate|clear|reset|restore|backup|archive|compress|decompress|encode|decode|encrypt|decrypt|sign|verify|authorize|authenticate|login|logout|connect|disconnect|broadcast|emit|publish|subscribe|subscribe|emit|render|draw|paint|plot|chart|visualize|highlight|select|deselect|focus|blur|scroll|drag|drop|hover|type|press|release|hold|wait|sleep|retry|abort|cancel|terminate|kill|spawn|fork|clone|replicate|duplicate|copy|move|rename|relabel|tag|untag|label|annotate|comment|review|approve|reject|accept|deny|grant|revoke|allow|forbid|permit|block|unblock|pause|resume|continue|start|stop|restart|reload|refresh|sync|desync)(s|es|ed|ing)?\b/

function catalogLine(t) {
  const p = t.parameters || {}; const props = p.properties || {}; const req = new Set(Array.isArray(p.required) ? p.required : [])
  const keys = Object.keys(props)
  const shape = keys.length === 0 ? '{}' : '{' + keys.map(k => JSON.stringify(k) + (req.has(k) ? ': …' : '?: …')).join(', ') + '}'
  return '- ' + t.name + ' ← 实参写成 ' + shape + ' // ' + firstLine(t.description)
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
// ★ 两套模式：--mode official（照官方，中位 139，允许 2 句） vs --mode lean（≤120，目录友好）
const modeArg = argv.indexOf('--mode')
const MODE = modeArg >= 0 ? argv[modeArg + 1] : 'lean'
const files = argv.filter((a, i) => a !== '--mode' && i !== modeArg + 1)
const raw = files[0] === '--mcp' ? await fromMcp(files[1]) : JSON.parse(fs.readFileSync(files[0], 'utf8'))
// ★ 兼容 MCP 的 inputSchema 与 DSH 的 parameters 两种叫法
const tools = raw.map(t => ({ name: t.name, description: t.description, parameters: t.parameters || t.inputSchema || t.schema }))
if (!tools.length) { console.log('没读到工具'); process.exit(1) }

const nativeBytes = B(tools)
const shallow = tools.map(t => ({ name: t.name, description: firstLine(t.description), parameters: shallowParameters(t.parameters) }))
const catalogBody = CATALOG_HEADER + '\n\n' + BT + BT + BT + '\n' + shallow.map(catalogLine).join('\n') + '\n' + BT + BT + BT
const shallowBytes = B(shallow) + Buffer.byteLength(catalogBody, 'utf8')

const R = (s) => (s.match(/[.!?](\s|$)/g) || []).length
const fails = []
const warns = []
const W = (tool, rule, detail) => warns.push({ tool, rule, detail })
const F = (tool, rule, detail) => fails.push({ tool, rule, detail })

// ── A. lean 呈现的坑 ──────────────────────────────────────────────
for (const t of tools) {
  const p = t.parameters || {}
  const d = String(t.description ?? '')
  if (p.type !== 'object' || !p.properties) F(t.name, 'A1 顶层须 object+properties', 'lean 下参数会【全丢】')
  if (/[。\n]/.test(d)) F(t.name, 'A2 描述禁含 。 或换行', 'lean 会从这里断句')
  const cap = MODE === 'official' ? 320 : 120
  if (d.length > cap) F(t.name, 'A3 描述须 ≤' + cap + ' 字符（' + MODE + ' 模式）', '当前 ' + d.length)
  if (MODE === 'lean' && !VERB_STEM.test(String(t.description ?? '').toLowerCase())) { /* B1 另报 */ }
  for (const [k, v] of Object.entries(p.properties || {})) {
    if (v.enum && v.enum.length > 12) F(t.name, 'A4 枚举须 ≤12 个', k + ' 有 ' + v.enum.length + ' 个')
    if (!v.type) F(t.name, 'A5 每个键须写 type', k)
    if (v.type === 'object') W(t.name, 'A6 慎用嵌套 object', k + '（lean 只留 type；native 完整）')
    if (v.type === 'array') W(t.name, 'A7 慎用数组', k + '（lean 只留 type；native 完整）')
    if (Array.isArray(v.type)) F(t.name, 'A8 type 不可为数组', k)
    if (v.oneOf || v.anyOf) F(t.name, 'A9 禁 oneOf/anyOf', k)
  }
}

// ── B. 官方文风 ──────────────────────────────────────────────────
for (const t of tools) {
  const d = String(t.description ?? '').trim()
  if (!VERB_STEM.test(d.toLowerCase())) F(t.name, 'B1 须动词开头（官方 82%）', '首词: ' + (d.split(/\s+/)[0] || ''))
  if (!/[.]$/.test(d)) F(t.name, 'B2 须句号收尾（官方 99%）', '结尾: ' + d.slice(-12))
  const sc = R(d)
  if (sc < 1) F(t.name, 'B3 建议 ≥1 句', '句数 ' + sc)
  // 官方第二句装「何时用 / 前提 / 副作用 / 返回什么」
  if (sc === 1 && d.length < 60) F(t.name, 'B4 建议补第二句（何时用/前提/副作用/返回）', '当前只有一句且偏短')
  for (const [k, v] of Object.entries((t.parameters || {}).properties || {})) {
    if (!v.description) F(t.name, 'B5 每个参数须有 description', k)
    else {
      const pd = String(v.description).trim()
      if (!/[.]$/.test(pd)) F(t.name, 'B6 参数描述须句号收尾（官方 100%）', k + ': ' + pd.slice(0, 40))
      if (pd.length > 120) F(t.name, 'B7 参数描述宜 ≤~90 字符', k + ' = ' + pd.length)
    }
  }
}

console.log('工具数 = ' + tools.length)
console.log('native schema 合计 = ' + nativeBytes + ' B   (' + Math.round(nativeBytes / tools.length) + ' B/工具)')
console.log('lean 通道 + 目录   = ' + shallowBytes + ' B   (' + Math.round(shallowBytes / tools.length) + ' B/工具)')
console.log('⇒ 字节比 = ' + (shallowBytes / nativeBytes).toFixed(3) + '   ⚠ 这只是参考：省得多 = 丢得多，不是好')
const cutCount = tools.filter(t => firstLine(String(t.description ?? '')).length < String(t.description ?? '').length).length
console.log('★ 信息完整性（lean 相对 native 丢掉的）')
console.log('   描述被截断的工具      = ' + cutCount + '/' + tools.length)
const lostKeys = tools.flatMap(t => Object.entries((t.parameters || {}).properties || {}).filter(([, v]) => v.type === 'object' || v.type === 'array' || (v.enum && v.enum.length > 12) || v.description || v.default !== undefined).map(([k, v]) => k))
console.log('   参数里被 lean 丢掉的信息点 = ' + lostKeys.length + ' 处（嵌套/数组/枚举>12/默认值/属性说明）')
console.log('   ⇒ ★ 要保住这些信息就用 catalog 档（shape: false），要压上下文才用 lean 档')
console.log('')
const byRule = {}
for (const f of fails) { (byRule[f.rule] ||= []).push(f) }
console.log('=== 违规（' + fails.length + ' 条）===')
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