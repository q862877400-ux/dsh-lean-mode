#!/usr/bin/env node
/**
 * pending 补表工具：把 descriptions.pending.json 里的事实变成 descriptions.json 的表项。
 *
 * ── 两个文件的真实关系（以 index.mjs 源码为准）────────────────────
 *   · 插件【读】 descriptions.json           （load() 读 .tools / .pending）
 *   · 插件【写】 descriptions.pending.json   （flush() 写 {_meta, tools, pending}）
 *   ⇒ pending 文件是**只写**的：插件从不回读它。离线 skill 把它读出来，
 *     把补好的条目写进 descriptions.json，下次启动才生效。
 *
 * ── 正确流程 ──────────────────────────────────────────────────────
 *   1. node curate-pending.mjs list
 *   2. node curate-pending.mjs show <name>          ← 看清全部事实再动笔
 *   3. node curate-pending.mjs apply <name> "<desc>" ← 写进 descriptions.json，pending 暂时保留
 *   4. node validate-descriptions.mjs descriptions.json --pending descriptions.pending.json
 *   5. 通过后 node curate-pending.mjs remove <name>  ← 清 pending（校验器必须还能拿到事实）
 *
 * 退出码：0 成功；1 业务失败；2 用法错。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { digest, descriptionSignature, schemaSignature, compressDescription, DEFAULT_MAX_CHARS } from '../index.mjs'
import { validateEntry } from './validate-descriptions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = resolve(HERE, '..')

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const tablePath = resolve(arg('--table', join(PLUGIN_DIR, 'descriptions.json')))
const pendingPath = resolve(arg('--pending', join(PLUGIN_DIR, 'descriptions.pending.json')))
const maxChars = Number(arg('--max-chars', String(DEFAULT_MAX_CHARS)))

function readJson(path, label) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    console.error(`✗ ${label} 解析失败 ${path}：${String(e)}`)
    process.exit(2)
  }
}

const pendingDoc = readJson(pendingPath, 'pending 文件')
const pending = pendingDoc?.pending ?? {}
const tableDoc = readJson(tablePath, '覆盖表') ?? { _meta: { version: 1, maxChars }, tools: {}, pending: {} }
const table = tableDoc
table.tools ??= {}

const cmd = process.argv[2]
if (!cmd) {
  console.error('用法: node curate-pending.mjs <list|stats|show|apply|remove> [参数]')
  process.exit(2)
}

const REASON_HINT = {
  'empty': '原描述为空 —— 只能从 name + 参数名推断，事实不足请用 INSUFFICIENT',
  'too-short': '原描述 <15 字符 —— 事实太少，容易编',
  'argblock': '原描述是 Args/Returns 参数块 —— 提炼成一句行为描述',
  'typename': '原描述是个类型名 —— 必须从参数反推行为',
  'title-like': '原描述是标题短语 —— 从 title + 参数补成完整句子',
  'over-budget': '原描述超 maxChars —— 压缩即可，事实都在，风险最低',
}

/** 收集一个工具的全部可读事实，供写描述时参考。 */
function renderFacts(name, p) {
  const props = p?.parameters?.properties ?? {}
  const required = new Set(Array.isArray(p?.parameters?.required) ? p.parameters.required : [])
  const out = []
  out.push(`工具名: ${name}`)
  out.push(`待补原因: ${p.reason ?? '?'} —— ${REASON_HINT[p.reason] ?? ''}`)
  out.push(`首次/最后见到: ${p.firstSeen ?? '?'} / ${p.lastSeen ?? '?'}`)
  out.push('')
  out.push(`原描述（${String(p.description ?? '').length} 字符）:`)
  out.push(p.description ? '  ' + String(p.description).replace(/\n/g, '\n  ') : '  （空）')
  out.push('')
  out.push(`参数（${Object.keys(props).length} 个，* = 必填）:`)
  for (const [k, v] of Object.entries(props)) {
    const parts = []
    if (v?.type !== undefined) parts.push(Array.isArray(v.type) ? `type=${v.type.join('|')}` : String(v.type))
    if (Array.isArray(v?.enum)) parts.push(`enum(${v.enum.length}): ${v.enum.slice(0, 8).join('|')}${v.enum.length > 8 ? '…' : ''}`)
    if (v?.default !== undefined) parts.push(`default=${JSON.stringify(v.default)}`)
    if (v?.description) parts.push(`desc="${String(v.description).replace(/\s+/g, ' ').slice(0, 160)}"`)
    if (v?.oneOf || v?.anyOf) parts.push('⚠ oneOf/anyOf（lean 会丢）')
    out.push(`  ${required.has(k) ? '*' : ' '} ${k}: ${parts.join('  ') || '（无信息）'}`)
  }
  if (Object.keys(props).length === 0) out.push('  （无参数）')
  return out.join('\n')
}

switch (cmd) {
  case 'list': {
    const names = Object.keys(pending).sort()
    if (!names.length) {
      console.log('pending 为空 —— 没有需要补表的工具。')
      console.log(`（读的是 ${pendingPath}）`)
      break
    }
    console.log(`待补工具 ${names.length} 个（${pendingPath}）\n`)
    for (const n of names) {
      const p = pending[n]
      const orig = String(p.description ?? '').replace(/\s+/g, ' ').trim()
      const nprops = Object.keys(p.parameters?.properties ?? {}).length
      const done = table.tools[n] ? '  [表里已有]' : ''
      console.log(`- ${n}${done}`)
      console.log(`    原因=${p.reason}  原描述 ${orig.length} 字符  参数 ${nprops} 个`)
      console.log(`    原文: ${orig.slice(0, 110)}${orig.length > 110 ? '…' : ''}`)
    }
    break
  }

  case 'stats': {
    const byReason = {}
    for (const p of Object.values(pending)) (byReason[p.reason ?? '?'] ||= []).push(p)
    const total = Object.keys(pending).length
    console.log(`pending 共 ${total} 个（${pendingPath}）\n`)
    for (const r of Object.keys(byReason).sort()) {
      console.log(`  ${r.padEnd(14)} ${String(byReason[r].length).padStart(3)}  —— ${REASON_HINT[r] ?? ''}`)
    }
    const done = Object.keys(table.tools).length
    console.log(`\n覆盖表已有 ${done} 条（${tablePath}）`)
    for (const st of ['active', 'quarantine', 'deprecated']) {
      const n = Object.values(table.tools).filter(e => (e?.status ?? 'active') === st).length
      if (n) console.log(`  ${st.padEnd(12)} ${n}`)
    }
    break
  }

  case 'show': {
    const name = process.argv[3]
    if (!name) { console.error('用法: node curate-pending.mjs show <toolName>'); process.exit(2) }
    const p = pending[name]
    if (!p) { console.error(`✗ pending 里没有 "${name}"`); process.exit(1) }
    console.log(renderFacts(name, p))
    console.log('')
    console.log('当前压缩结果（补表后会替换它）:')
    console.log('  ' + compressDescription(p.description, maxChars))
    if (table.tools[name]) {
      console.log('')
      console.log('表里已有条目:')
      console.log(`  desc: ${table.tools[name].desc}`)
      console.log(`  status: ${table.tools[name].status}  updated: ${table.tools[name].updated}`)
    }
    break
  }

  case 'apply': {
    const name = process.argv[3]
    const desc = process.argv[4]
    if (!name || desc === undefined) {
      console.error('用法: node curate-pending.mjs apply <toolName> "<description>"')
      process.exit(2)
    }
    const p = pending[name]
    if (!p) { console.error(`✗ pending 里没有 "${name}" —— 先跑 list 确认`); process.exit(1) }

    if (desc.length > maxChars) {
      console.error(`✗ 描述 ${desc.length} 字符 > maxChars ${maxChars}`)
      process.exit(1)
    }
    if (/\n/.test(desc)) {
      console.error('✗ 描述不能含换行')
      process.exit(1)
    }

    // 写之前先校验。覆盖表是插件唯一的读取源，而插件那边**不做内容校验**——
    // 写进去就是生效的。以前 apply 只查长度和换行，于是「丢了字面量」的条目
    // 也能进表，得靠后面单独跑 validate 才发现，那时表已经脏了。
    // 拒绝时不写盘，直接列出原因，改完再 apply。
    const draft = { desc, source: 'curated', status: 'active' }
    const blocking = validateEntry(name, draft, pending[name], maxChars).filter((p) => !p.warn)
    if (blocking.length > 0 && !process.argv.includes('--force')) {
      console.error(`✗ 这条描述没通过校验，未写入（${blocking.length} 处）：`)
      for (const p of blocking) console.error(`    ${p.code}: ${p.detail}`)
      console.error('  改完再 apply；确实要写草稿加 --force（但那样就没法 remove，直到改好）。')
      process.exit(1)
    }

    table.tools[name] = {
      desc,
      source: 'curated',
      status: 'active',
      basedOn: {
        descHash: descriptionSignature(p.description),
        schemaHash: schemaSignature(p.parameters ?? { type: 'object' }),
      },
      updated: new Date().toISOString().slice(0, 10),
    }
    table._meta ??= { version: 1, maxChars }
    table._meta.maxChars ??= maxChars
    table._meta.updated = new Date().toISOString().slice(0, 10)
    table.pending ??= {}

    writeFileSync(tablePath, JSON.stringify(table, null, 2) + '\n', 'utf8')
    console.log(`✓ 已写入覆盖表 ${name}（${desc.length} 字符）`)
    console.log(`  pending 条目暂时保留 —— 校验器要靠它做字面量比对。`)
    console.log(`  下一步: node validate-descriptions.mjs "${tablePath}" --pending "${pendingPath}"`)
    console.log(`  通过后: node curate-pending.mjs remove ${name}`)
    break
  }

  case 'remove': {
    const name = process.argv[3]
    if (!name) { console.error('用法: node curate-pending.mjs remove <toolName>'); process.exit(2) }
    if (!pendingDoc) { console.error(`✗ pending 文件不存在：${pendingPath}`); process.exit(1) }
    if (!pending[name]) { console.error(`✗ pending 里没有 "${name}"`); process.exit(1) }

    // 删 pending 是**不可逆**的：pending 里那条原始描述是事实的唯一副本，
    // 覆盖表里没有对应条目就等于把事实永久销毁。以前这里只检查「pending 里有」，
    // 于是一个从没 apply 过的条目也能被删掉——实测删掉了 1515 字符的原始描述，
    // 还打印「（覆盖表条目保留）」，而覆盖表是空的。
    const applied = table.tools?.[name]
    if (!applied) {
      console.error(`✗ 覆盖表里没有 "${name}" —— 它的原始事实只存在于 pending，删了就找不回来。`)
      console.error(`  先 apply 写出条目：node curate-pending.mjs apply ${name} "<description>"`)
      process.exit(1)
    }
    // 已 apply 但没通过校验的也不能删：校验器要靠 pending 做字面量比对。
    const blocking = validateEntry(name, applied, pending[name], maxChars).filter((p) => !p.warn)
    if (blocking.length > 0) {
      console.error(`✗ 覆盖表里 "${name}" 的条目没通过校验，不能清 pending：`)
      for (const p of blocking) console.error(`    ${p.code}: ${p.detail}`)
      console.error('  校验器要靠 pending 做字面量比对，清掉之后就验不了了。')
      process.exit(1)
    }

    delete pendingDoc.pending[name]
    writeFileSync(pendingPath, JSON.stringify(pendingDoc, null, 2) + '\n', 'utf8')
    console.log(`✓ 已从 pending 移除 ${name}（覆盖表条目保留且已通过校验）`)
    break
  }

  default:
    console.error(`未知子命令 "${cmd}"，可用: list / stats / show / apply / remove`)
    process.exit(2)
}
