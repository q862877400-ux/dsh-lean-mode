#!/usr/bin/env node
/**
 * 覆盖表校验器。
 *
 * 用法：
 *   node validate-descriptions.mjs                                  # 校验插件目录的 descriptions.json
 *   node validate-descriptions.mjs <table.json>                     # 指定表
 *   node validate-descriptions.mjs <table.json> --max-chars 300     # 指定上限
 *   node validate-descriptions.mjs --pending <pending.json>         # 用 pending 的原始事实做字面量比对
 *
 * 退出码：0 = 全部合规；1 = 有不合规项；2 = 用法错。
 *
 * 「防幻觉」的两条硬判据（纯字符串比对，不需要语义判断）：
 *   · 原描述里的字面量（枚举映射 `0=solid`、单位 `MILLIMETRES`、数值 `must be > 0`）必须都出现
 *   · `UNVERIFIED` 的出现次数不得减少
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const OPENERS = [
  'this tool',
  'a tool that',
  'allows you to',
  'use this to',
  'this function',
  'this endpoint',
]

/** 从原描述里抽出必须保留的字面量。 */
/**
 * 全大写但**是普通英文词**的令牌——它们是正文里的强调，不是单位或缩写。
 *
 * 实测：47 条真实 pending 描述里，`\b[A-Z]{2,}\b` 抽出 64 种「必需字面量」，
 * 其中 12 条描述的提取物**全是**这类词（`WHEN`/`TO`/`CALL`/`BEFORE`/`AGAIN`/`SKIP`/`CURRENT`）。
 * 要求策展人在 300 字符里保住「WHEN」「TO」，纯属浪费预算。
 *
 * 这张表来自真实语料的经验，不是权威词表。要新增噪音词，先看 `skippedLiterals` 的日志。
 */
const COMMON_WORDS = new Set([
  'AGAIN', 'ALL', 'ALSO', 'ALWAYS', 'AND', 'ANY', 'AS', 'BEFORE', 'BUT', 'BY', 'CALL', 'CAN', 'CHEAP',
  'CITATIONS', 'CURRENT', 'DIFFERS', 'DO', 'EMPTY', 'EVEN', 'EXAMPLES', 'FOR', 'FROM', 'FULL',
  'GOOD', 'HEAD', 'HOME', 'HOW', 'IF', 'IMPORTANT', 'IN', 'INTO', 'IS', 'IT', 'ITEM', 'JUST',
  'MAY', 'MORE', 'MUST', 'NAME', 'NO', 'NOT', 'OF', 'OMIT', 'ON', 'ONLY', 'OR', 'OVER',
  'PROACTIVELY', 'QUERIES', 'RECALL', 'REFERENCES', 'RETRIEVAL', 'SHOULD', 'SKIP', 'SO',
  'THIS', 'TO', 'TOOL', 'UNLESS', 'UP', 'USE', 'WHEN', 'WHY', 'WITH', 'YOU',
])

/** 被 COMMON_WORDS 跳过的令牌，供排查「为什么某个词没被要求保留」。 */
export const skippedLiterals = []

/**
 * 从原描述里抽出必须保留的字面量。
 *
 * 三类：枚举映射（`0=solid`）、**全大写单位/缩写**（`MILLIMETRES`/`PDF`）、数值约束（`must be > 0`）。
 * 全大写那一类要排除普通英文词——见 `COMMON_WORDS`。
 *
 * @param {string} source 原描述（含所有参数描述）。
 * @returns {string[]} 必须逐字保留的字面量。
 */
export function requiredLiterals(source) {
  const out = new Set()
  // 枚举映射：0=solid / 1=midsurface
  for (const m of String(source).matchAll(/\b\d+\s*=\s*[A-Za-z][A-Za-z0-9_]*/g)) {
    out.add(m[0].replace(/\s+/g, ''))
  }
  // 全大写单位/缩写：MILLIMETRES / DEGREES / PDF。普通英文词不算。
  for (const m of String(source).matchAll(/\b[A-Z]{2,}\b/g)) {
    if (COMMON_WORDS.has(m[0])) { if (!skippedLiterals.includes(m[0])) skippedLiterals.push(m[0]); continue }
    out.add(m[0])
  }
  // must be > 0 之类的数值约束
  for (const m of String(source).matchAll(/\b(?:must|should)\s+be\s*[<>=!]+\s*-?\d+(?:\.\d+)?/gi)) out.add(m[0])
  return [...out]
}

/** 统计一个词在原描述里出现的次数。 */
export function countOf(text, needle) {
  let n = 0
  let i = 0
  while ((i = String(text).indexOf(needle, i)) !== -1) { n++; i += needle.length }
  return n
}

/** 汇总一段事实里所有可读文本：工具描述 + 每个参数的描述。 */
export function factText(facts) {
  const parts = []
  if (typeof facts?.description === 'string') parts.push(facts.description)
  const props = facts?.parameters?.properties
  if (props !== null && typeof props === 'object') {
    for (const key of Object.keys(props)) {
      const d = props[key]?.description
      if (typeof d === 'string') parts.push(d)
    }
  }
  return parts.join('\n')
}

/**
 * 校验单条表项。
 *
 * @param name 工具名。
 * @param entry 表项 `{ desc, source, status, basedOn }`。
 * @param facts 可选的原描述与参数（来自 pending），用于字面量比对。
 * @param maxChars 字符上限。
 * @returns 问题列表（空 = 通过）。
 */
export function validateEntry(name, entry, facts, maxChars = 300) {
  const problems = []
  const desc = String(entry?.desc == null ? '' : entry.desc)
  const fail = (code, detail) => problems.push({ name, code, detail })

  if (desc.trim() === '') { fail('EMPTY', '描述为空'); return problems }
  if (desc.length > maxChars) fail('TOO_LONG', `${desc.length} 字符 > ${maxChars}`)
  if (/[\r\n]/.test(desc)) fail('NEWLINE', '含换行')
  if (desc !== desc.trim()) fail('PADDING', '首尾有空白')

  const lower = desc.toLowerCase()
  for (const opener of OPENERS) {
    if (lower.startsWith(opener)) { fail('BAD_OPENER', `以 "${opener}" 开头`); break }
  }
  if (!/^[A-Z\u4e00-\u9fa5]/.test(desc)) fail('NO_VERB', '不是大写字母或中文开头')

  if (facts !== undefined && facts !== null) {
    // 字面量与 UNVERIFIED 同时可能出现在工具描述和参数描述里，两处都要看。
    const source = factText(facts)

    // ① 字面量必须保留
    for (const lit of requiredLiterals(source)) {
      if (!desc.includes(lit)) fail('LOST_LITERAL', `丢失字面量 "${lit}"`)
    }

    // ② UNVERIFIED 不得减少
    const before = countOf(source, 'UNVERIFIED')
    const after = countOf(desc, 'UNVERIFIED')
    if (after < before) fail('LOST_UNVERIFIED', `UNVERIFIED ${before} → ${after}`)

    // ③ 必填参数应被提到（警告级，不阻断）
    const required = Array.isArray(facts.parameters?.required) ? facts.parameters.required : []
    for (const p of required) {
      if (!desc.includes(p)) problems.push({ name, code: 'MISSING_REQUIRED_PARAM', detail: `未提到必填参数 "${p}"`, warn: true })
    }
  }

  return problems
}

function main(argv) {
  let tablePath
  let pendingPath
  let maxChars = 300
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--max-chars') { maxChars = Number(argv[++i]) }
    else if (a === '--pending') { pendingPath = argv[++i] }
    else if (a.startsWith('-')) { console.error(`未知参数: ${a}`); return 2 }
    else if (tablePath === undefined) { tablePath = a }
    else { console.error(`多余参数: ${a}`); return 2 }
  }
  if (!Number.isFinite(maxChars) || maxChars <= 0) { console.error('--max-chars 必须是正数'); return 2 }

  tablePath = tablePath === undefined
    ? join(HERE, '..', 'descriptions.json')
    : (isAbsolute(tablePath) ? tablePath : join(process.cwd(), tablePath))
  if (!existsSync(tablePath)) { console.error(`表不存在: ${tablePath}`); return 1 }

  let table
  try {
    table = JSON.parse(readFileSync(tablePath, 'utf8'))
  } catch (error) {
    console.error(`表不是合法 JSON: ${error.message}`)
    return 1
  }

  let facts = {}
  const resolvedPending = pendingPath === undefined
    ? tablePath.replace(/\.json$/, '.pending.json')
    : (isAbsolute(pendingPath) ? pendingPath : join(process.cwd(), pendingPath))
  if (existsSync(resolvedPending)) {
    try {
      const p = JSON.parse(readFileSync(resolvedPending, 'utf8'))
      facts = p?.pending ?? {}
    } catch { /* pending 损坏不阻断校验 */ }
  }

  const tools = table?.tools ?? {}
  const names = Object.keys(tools)
  const all = []
  for (const name of names) all.push(...validateEntry(name, tools[name], facts[name], maxChars))

  const errors = all.filter(p => p.warn !== true)
  const warnings = all.filter(p => p.warn === true)

  console.log(`表: ${tablePath}`)
  console.log(`条目: ${names.length}   上限: ${maxChars}   事实来源: ${Object.keys(facts).length} 条`)
  for (const p of all) {
    console.log(`  ${p.warn ? 'WARN' : 'FAIL'} [${p.code}] ${p.name}: ${p.detail}`)
  }
  console.log(`\n${errors.length} 个错误, ${warnings.length} 个警告`)
  if (errors.length === 0 && warnings.length === 0) console.log('✅ 全部合规')
  return errors.length === 0 ? 0 : 1
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)))
}
