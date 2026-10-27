#!/usr/bin/env node
/**
 * lean-mode 纯函数的自检：把「文档说它会这样」变成「跑一遍确认它这样」。
 *
 * 为什么需要：这个包是生产依赖，但此前**一个自检都没有**。所有关于它的断言
 * （描述压到 300、enum > 12 丢弃、per-property description 丢弃…）都只写在文档里，
 * 没人执行过。实测文档就错了：多处说「嵌套结构被丢弃」，而 `shallowParameters`
 * 是递归展开、完整保留嵌套结构的。
 *
 * 判据只有一条：**期望值来自代码实际行为**，不是来自我对它的印象。每条都附
 * 「为什么是这样」，改代码时若行为变了，这里会红。
 *
 * 用法：node tools/lean-selftest.mjs
 * 退出码：0 全部成立；1 有断言不成立。
 *
 * @module
 */

import { compressDescription, shallowParameters, needsCuration, DEFAULT_MAX_CHARS, DescriptionTable, descriptionSignature, schemaSignature } from '../index.mjs'
import { requiredLiterals, countOf, factText, validateEntry, skippedLiterals } from './validate-descriptions.mjs'

let fail = 0
let pass = 0

/**
 * 断言一个值等于期望。
 *
 * @param {string} label 人读的断言名。
 * @param {unknown} actual 实际值。
 * @param {unknown} expected 期望值（JSON 比较）。
 * @returns {void}
 */
function eq(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass += 1
    console.log(`  ✓ ${label}`)
  } else {
    fail += 1
    console.log(`  ✗ ${label}`)
    console.log(`      期望 ${e}`)
    console.log(`      实际 ${a}`)
  }
}

/**
 * 断言一个条件成立。
 *
 * @param {string} label 人读的断言名。
 * @param {boolean} ok 条件。
 * @returns {void}
 */
function ok(label, ok) {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`) } else { fail += 1; console.log(`  ✗ ${label}`) }
}

console.log('\n═══ lean-mode 纯函数自检 ═══\n')

console.log('— 描述压缩 —')
eq('DEFAULT_MAX_CHARS 是 300', DEFAULT_MAX_CHARS, 300)
eq('短描述原样返回', compressDescription('Return the thing.'), 'Return the thing.')
const long = 'x'.repeat(500)
ok('超长描述压到 ≤300', compressDescription(long).length <= 300)
ok('省略号标记存在（截断要显式）', /[.…]$/.test(compressDescription(long)))
eq('边界：正好 300 不截断', compressDescription('y'.repeat(300)).length, 300)
ok('边界：301 截断', compressDescription('y'.repeat(301)).length <= 300)
eq('null 不抛', compressDescription(null), '')
// 代理对不能被劈开：emoji 占两个 UTF-16 码元，切在中间会留下孤立高位代理（非法 Unicode）。
// 实测 pad=298 时输出尾部是 `\ud83d`。真实 99 个工具里没有 emoji，所以这条纯靠构造输入才测得出。
{
  let loneFound = ''
  let overFound = ''
  for (let pad = 285; pad <= 310; pad += 1) {
    const out = compressDescription('a'.repeat(pad) + '😀' + 'b'.repeat(50))
    for (let i = 0; i < out.length; i += 1) {
      const unit = out.charCodeAt(i)
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = out.charCodeAt(i + 1)
        if (!(next >= 0xdc00 && next <= 0xdfff)) { loneFound ||= `pad=${pad}`; break }
        i += 1
      } else if (unit >= 0xdc00 && unit <= 0xdfff) { loneFound ||= `pad=${pad}`; break }
    }
    if (out.length > DEFAULT_MAX_CHARS) overFound ||= `pad=${pad} len=${out.length}`
  }
  eq('截断不产生孤立代理项（pad 285-310）', loneFound, '')
  eq('截断后不超过上限（pad 285-310）', overFound, '')
}

console.log('\n— 浅投影：保留什么 —')
const nested = {
  type: 'object',
  properties: {
    filter: {
      type: 'object',
      description: '过滤条件',
      properties: { author: { type: 'string', description: '作者' }, year: { type: 'integer' } },
      required: ['author'],
    },
  },
  required: ['filter'],
}
const shallow = shallowParameters(nested)
eq('顶层 keys 保留', Object.keys(shallow.properties), ['filter'])
eq('嵌套结构**保留**（文档曾错写成丢弃）', shallow.properties.filter.properties, {
  author: { type: 'string' }, year: { type: 'integer' },
})
eq('嵌套 required 保留', shallow.properties.filter.required, ['author'])
ok('嵌套层的 description 被丢', shallow.properties.filter.description === undefined)
ok('嵌套属性的 description 被丢', shallow.properties.filter.properties.author.description === undefined)

console.log('\n— 浅投影：丢弃什么 —')
const lossy = {
  type: 'object',
  properties: {
    a: { type: 'string', description: 'd', default: 'x', pattern: '^A' },
    b: { type: 'integer', minimum: 1, maximum: 9, format: 'int32' },
    c: { type: 'array', items: { type: 'string' } },
    d: { type: 'string', enum: Array.from({ length: 13 }, (_, i) => `v${i}`) },
    e: { type: 'string', enum: ['a', 'b'] },
  },
}
const ls = shallowParameters(lossy).properties
ok('per-property description 丢弃', ls.a.description === undefined)
ok('default 丢弃', ls.a.default === undefined)
ok('pattern 丢弃', ls.a.pattern === undefined)
ok('minimum/maximum 丢弃', ls.b.minimum === undefined && ls.b.maximum === undefined)
ok('format 丢弃', ls.b.format === undefined)
eq('数组只剩 type，items 丢弃', ls.c, { type: 'array' })
eq('enum 13 个整段丢弃', ls.d, { type: 'string' })
eq('enum 2 个保留', ls.e, { type: 'string', enum: ['a', 'b'] })

console.log('\n— 类型推断 —')
eq('anyOf[X, null] 推断成 X', shallowParameters({
  type: 'object', properties: { q: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
}).properties.q, { type: 'string' })
eq('两种非 null 类型 → annotation-only（不谎报类型）', shallowParameters({
  type: 'object', properties: { q: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
}).properties.q, {})
eq('oneOf 两支对象 → 只剩 type（分支结构丢）', shallowParameters({
  type: 'object', properties: {
    q: { oneOf: [
      { type: 'object', properties: { x: { type: 'string' } } },
      { type: 'object', properties: { y: { type: 'string' } } },
    ] },
  },
}).properties.q, { type: 'object' })

console.log('\n— needsCuration —')
// needsCuration 返回**原因字符串**（null 表示不用处理），不是布尔。
eq('正常描述返回 null', needsCuration({ name: 't', description: 'Return the thing unchanged.' }), null)
eq('空描述 → empty', needsCuration({ name: 't', description: '' }), 'empty')
eq('太短 → too-short', needsCuration({ name: 't', description: 'Returns x' }), 'too-short')
eq('参数块开头 → argblock', needsCuration({ name: 't', description: 'Args: a b c this is long enough.' }), 'argblock')
eq('超预算 → over-budget', needsCuration({ name: 't', description: 'y'.repeat(400) }), 'over-budget')

console.log('\n— 字面量提取（validate-descriptions）—')
eq('枚举映射抽出', requiredLiterals('0=solid'), ['0=solid'])
eq('带空格的枚举映射归一', requiredLiterals('0 = midsurface'), ['0=midsurface'])
ok('单位抽出', requiredLiterals('Units are MILLIMETRES').includes('MILLIMETRES'))
ok('缩写抽出', requiredLiterals('Returns a PDF').includes('PDF'))
ok('数值约束抽出', requiredLiterals('must be > 0').length === 1)
// 普通英文词是正文强调，不是单位/缩写。旧实现 `\b[A-Z]{2,}\b` 把它们全抽出来，
// 实测 47 条真实 pending 里 12 条的提取物**全是**这类词
// （WHEN/TO/CALL/BEFORE/AGAIN/SKIP/CURRENT）——策展人得在 300 字符里硬塞它们。
for (const w of ['WHEN', 'TO', 'CALL', 'BEFORE', 'AGAIN', 'SKIP', 'CURRENT', 'ALWAYS', 'NOT', 'MUST']) {
  ok(`普通英文词 ${w} 不算必需字面量`, !requiredLiterals(`**${w}** something happens here`).includes(w))
}
eq('普通英文词会记录到 skippedLiterals（可排查）', skippedLiterals.includes('WHEN'), true)
// 端到端：一个合理的改写不该被噪音词拦住，但真丢了事实必须报
const litFacts = { description: '**WHEN** to call: returns a PDF. Set mode 0=fast.' }
const litGood = { desc: 'Returns a PDF when called. Set mode 0=fast for speed.' }
const litBad = { desc: 'Returns a document when called. Set mode 0=fast for speed.' }
eq('合理改写通过', validateEntry('t', litGood, litFacts, 300).filter((p) => !p.warn).map((p) => p.code), [])
eq('真丢了 PDF 则报 LOST_LITERAL', validateEntry('t', litBad, litFacts, 300).filter((p) => !p.warn).map((p) => p.code), ['LOST_LITERAL'])

console.log('\n— 覆盖表解析（resolve 的状态机，此前零测试）—')
{
  const os4 = await import('node:os')
  const fs4 = await import('node:fs')
  const path4 = await import('node:path')
  const tool = { description: 'Original long description. '.repeat(20), parameters: { type: 'object', properties: {} } }
  const tmp4 = fs4.mkdtempSync(path4.join(os4.tmpdir(), 'lean-resolve-'))
  const tablePath4 = path4.join(tmp4, 'table.json')
  fs4.writeFileSync(tablePath4, JSON.stringify({
    _meta: { version: 1, maxChars: 300 },
    tools: {
      fresh: { desc: 'Fresh curated text.', source: 'curated', status: 'active', basedOn: { descHash: descriptionSignature(tool.description), schemaHash: schemaSignature(tool.parameters) } },
      stale: { desc: 'Stale curated text.', source: 'curated', status: 'active', basedOn: { descHash: 'deadbeef00000000', schemaHash: 'deadbeef00000000' } },
      noHash: { desc: 'No hash curated text.', source: 'curated', status: 'active' },
      retired: { desc: 'Deprecated text.', source: 'curated', status: 'deprecated' },
    },
    pending: {},
  }))
  /**
   * 造一个表实例。
   *
   * @param {boolean} doLoad 是否调用 load()。
   * @returns {{t: DescriptionTable, warnings: string[]}} 实例与收集到的警告。
   */
  const mk = (doLoad) => {
    const warnings = []
    const t = new DescriptionTable({ path: tablePath4, pendingPath: path4.join(tmp4, 'pending.json'), logger: { warn: (m) => warnings.push(m) }, maxChars: 300 })
    if (doLoad) t.load()
    return { t, warnings }
  }
  const { t: dt, warnings: w4 } = mk(true)
  /**
   * 取一条的 origin。
   *
   * @param {string} name 工具名。
   * @returns {string} origin。
   */
  const originOf = (name) => dt.resolve({ ...tool, name }).origin

  eq('baseOn 哈希匹配 → 用表', originOf('fresh'), 'table')
  eq('无 basedOn → 用表', originOf('noHash'), 'table')
  eq('哈希不符 → 隔离回落', originOf('stale'), 'compress:stale')
  eq('归档状态 → 回落', originOf('retired'), 'compress:deprecated')
  eq('表里没有 → 回落压缩', originOf('missing'), 'compress')
  ok('隔离时会 warn', w4.some((w) => w.includes('quarantine')))
  // 反向断言：load() 之后不该出现「忘了 load()」的警告。
  // 只测「没 load 会警告」不够——把 loaded 永远置 false 也能过。
  ok('load() 之后没有「忘了 load()」警告', !w4.some((w) => w.includes('load()')))
  // 忘了 load()：表是空的，每条都静默回落——插件看着在工作，只是永远不用表。
  const noLoad = mk(false)
  eq('忘了 load() → 回落压缩', noLoad.t.resolve({ ...tool, name: 'fresh' }).origin, 'compress')
  ok('忘了 load() → 有警告（不是静默）', noLoad.warnings.some((w) => w.includes('load()')))
  fs4.rmSync(tmp4, { recursive: true, force: true })
}

console.log('\n— 包卫生 —')
{
  // package.json 的 `files` 包含 docs/tools/skills，所以这些目录里的 `.bak`
  // 会被打进发布包。实测这里攒了 30 个备份（来自历次改动），合计占包体一大截。
  const fs3 = await import('node:fs')
  const path3 = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here3 = path3.dirname(fileURLToPath(import.meta.url))
  const pkg3 = path3.resolve(here3, '..')
  const dirty = []
  const walk = (dir) => {
    for (const e of fs3.readdirSync(dir, { withFileTypes: true })) {
      const full = path3.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full); continue }
      if (/\.bak|\.tmp$|~$|\.orig$|\.rej$/.test(e.name)) dirty.push(full.slice(pkg3.length + 1))
    }
  }
  walk(pkg3)
  eq('包内无备份/临时文件', dirty, [])
}

console.log('\n— curate-pending 的写入守卫（子进程跑真 CLI）—')
{
  const os2 = await import('node:os')
  const fs2 = await import('node:fs')
  const path2 = await import('node:path')
  const { execFileSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const here = path2.dirname(fileURLToPath(import.meta.url))
  const pkg = path2.resolve(here, '..')
  const tmp = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'lean-curate-'))
  const pendingPath = path2.join(tmp, 'pending.json')
  const tablePath = path2.join(tmp, 'table.json')
  // 自造夹具，**不读 descriptions.pending.json**。
  // 那个文件被 .gitignore 排除（插件运行时写入的积压清单），新克隆的仓库里没有它——
  // 实测在干净仓库里跑这个自检会直接崩。测试不能依赖运行时状态。
  fs2.writeFileSync(pendingPath, JSON.stringify({
    _meta: { version: 1, maxChars: 300 },
    tools: {},
    pending: {
      hindsight_capture_initiative: {
        reason: 'over-budget',
        description: 'Record a new feature or initiative as a tracked knowledge page, so future sessions know it exists and can build on it. ' + 'x'.repeat(1200),
        parameters: { type: 'object', properties: { title: { type: 'string' }, summary: { type: 'string' } }, required: ['title', 'summary'] },
      },
      ks_collect: {
        reason: 'over-budget',
        description: 'Collect a remote document from a URL as a reference material. Handles PDF sources, extracts text from JS and CSS pages as JSON, and guards against SSRF.',
        parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      },
      hindsight_diagnose: {
        reason: 'over-budget',
        // 描述里必须带字面量（API / MCP）——最后一个用例靠「丢了字面量」让校验失败，
        // 没有字面量的描述会让 'Short.' 也能过校验，那个用例就失去前提了。
        description: 'Diagnose the MCP server connection and report safe API diagnostics for this session.',
        parameters: { type: 'object', properties: { bank: { type: 'string' } }, required: [] },
      },
    },
  }))
  fs2.writeFileSync(tablePath, JSON.stringify({ _meta: { version: 1, maxChars: 300 }, tools: {}, pending: {} }))

  /**
   * 跑一次 curate-pending，返回退出码与输出。
   *
   * @param {string[]} sub 子命令与参数。
   * @returns {{code: number, out: string}} 退出码与合并输出。
   */
  const run = (sub) => {
    try {
      const out = execFileSync(process.execPath, [path2.join(here, 'curate-pending.mjs'), ...sub, '--pending', pendingPath, '--table', tablePath], { encoding: 'utf8', stdio: 'pipe' })
      return { code: 0, out }
    } catch (e) {
      return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
  }
  /** @returns {number} 覆盖表条目数。 */
  const tableCount = () => Object.keys(JSON.parse(fs2.readFileSync(tablePath, 'utf8')).tools ?? {}).length
  /** @returns {number} pending 条目数。 */
  const pendingCount = () => Object.keys(JSON.parse(fs2.readFileSync(pendingPath, 'utf8')).pending ?? {}).length

  const p0 = pendingCount()
  // ① 从没 apply 过就 remove：pending 里那条原始描述是事实的唯一副本，删了不可逆。
  //    实测旧版会删掉 1515 字符的原始描述，还打印「（覆盖表条目保留）」，而表是空的。
  const r1 = run(['remove', 'hindsight_capture_initiative'])
  eq('没 apply 过就 remove → 退出 1', r1.code, 1)
  eq('没 apply 过就 remove → pending 不变', pendingCount(), p0)
  ok('拒绝信息点明「删了就找不回来」', r1.out.includes('找不回来'))

  // ② apply 一条丢字面量的：必须拒绝且**不写盘**
  const bad = run(['apply', 'ks_collect', 'Collect the text of a remote document as a reference material.'])
  eq('丢字面量的 apply → 退出 1', bad.code, 1)
  eq('被拒的 apply 不写盘', tableCount(), 0)
  ok('列出丢了哪些字面量', bad.out.includes('LOST_LITERAL'))

  // ③ 合格描述 → 写盘 → remove 成功
  const good = 'Collect a remote document as a reference material. Handles URL and PDF sources, extracts text from JS and CSS pages as JSON, and guards against SSRF by checking the resolved address before fetch.'
  eq('合格描述 apply → 退出 0', run(['apply', 'ks_collect', good]).code, 0)
  eq('写入后表里 1 条', tableCount(), 1)
  eq('合格条目 remove → 退出 0', run(['remove', 'ks_collect']).code, 0)
  eq('remove 后 pending 少 1 条', pendingCount(), p0 - 1)

  // ④ 已 apply 但校验不过的，remove 必须拒绝（校验器要靠 pending 比对）
  fs2.writeFileSync(tablePath, JSON.stringify({ _meta: { version: 1, maxChars: 300 }, tools: { hindsight_diagnose: { desc: 'Short.', source: 'curated', status: 'active' } }, pending: {} }))
  eq('校验不过的条目 remove → 退出 1', run(['remove', 'hindsight_diagnose']).code, 1)

  fs2.rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n  ${pass}/${pass + fail} 条成立`)
if (fail > 0) {
  console.log('  关于 lean 的文档断言与代码实际行为不一致，改代码或改文档。')
  process.exit(1)
}
console.log('\n✅ lean-mode 的行为与期望一致')
