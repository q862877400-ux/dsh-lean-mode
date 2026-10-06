#!/usr/bin/env node
// lean-lint：检查一批工具的 schema 在 DSH lean 呈现下会不会踩坑。
// 用法: node lean-lint.mjs <tools.json|--mcp <server.mjs>>
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { shallowParameters, firstLine } from '../index.mjs'

const BT = String.fromCharCode(96)
const CATALOG_HEADER = ['## Tool catalog','','★ 每条都给出该工具实参的【顶层 JSON 形状】：箭头右边就是你要传的对象。','★ 形状里没有列出的键一律不要传；★ 不要拆开单键信封 —— 形如 {"params": …} 的，所有实参都放进 params 里面。','★ 键后面带 : … 的是必填。'].join('\n')
const B = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8')

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
const tools = argv[0] === '--mcp' ? await fromMcp(argv[1]) : JSON.parse(fs.readFileSync(argv[0], 'utf8'))
if (!tools.length) { console.log('没读到工具'); process.exit(1) }

const nativeBytes = B(tools)
const shallow = tools.map(t => ({ name: t.name, description: firstLine(t.description), parameters: shallowParameters(t.parameters) }))
const catalogBody = CATALOG_HEADER + '\n\n' + BT + BT + BT + '\n' + shallow.map(catalogLine).join('\n') + '\n' + BT + BT + BT
const shallowBytes = B(shallow) + Buffer.byteLength(catalogBody, 'utf8')

console.log('工具数 = ' + tools.length)
console.log('native schema 合计 = ' + nativeBytes + ' B   (' + Math.round(nativeBytes / tools.length) + ' B/工具)')
console.log('lean 通道 + 目录   = ' + shallowBytes + ' B   (' + Math.round(shallowBytes / tools.length) + ' B/工具)')
console.log('目录本身           = ' + Buffer.byteLength(catalogBody, 'utf8') + ' B')
console.log('⇒ 比值 = ' + (shallowBytes / nativeBytes).toFixed(3) + (shallowBytes < nativeBytes ? '  ✅ lean 更省' : '  ❌ lean 更贵'))
console.log('')
const bad = []
for (const t of tools) {
  const p = t.parameters || {}
  const issues = []
  if (p.type !== 'object' || !p.properties) issues.push('顶层不是 object+properties ⇒ lean 下参数【全丢】(只剩 {type:object})')
  const d = String(t.description ?? '')
  if (/[。\n]/.test(d)) issues.push('描述里有 。或换行 ⇒ 从这里被截断，后面全丢')
  if (d.length > 120) issues.push('描述 ' + d.length + ' 字符 > 120 ⇒ 截断')
  for (const [k, v] of Object.entries(p.properties || {})) {
    if (v.enum && v.enum.length > 12) issues.push('键 ' + k + ' 有 ' + v.enum.length + ' 个枚举值 > 12 ⇒ 枚举被丢')
    if (!v.type) issues.push('键 ' + k + ' 没写 type ⇒ 会被记成 object')
    if (v.type === 'object') issues.push('键 ' + k + ' 是嵌套 object ⇒ lean 只留 type，内部结构全丢')
    if (v.type === 'array') issues.push('键 ' + k + ' 是数组 ⇒ lean 只留 type，元素结构丢（模型得猜）')
    if (Array.isArray(v.type)) issues.push('键 ' + k + ' 的 type 是数组 ⇒ 只取第一个')
    if (v.oneOf || v.anyOf) issues.push('键 ' + k + ' 用 oneOf/anyOf ⇒ 被丢')
  }
  if (issues.length) bad.push({ name: t.name, issues })
}
console.log('=== 会踩的坑 ===')
if (!bad.length) console.log('  无 ✓')
for (const b of bad) { console.log('  ' + b.name); for (const i of b.issues) console.log('      ⚠ ' + i) }
console.log('')
console.log('=== lean 里这条工具长这样（目录行） ===')
for (const l of shallow.map(catalogLine)) console.log('  ' + (l.length > 170 ? l.slice(0, 170) + '…' : l))