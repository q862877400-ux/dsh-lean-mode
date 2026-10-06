/**
 * lean-mode —— 装上即生效、卸载即失效：只对指定 preset 的会话把工具呈现改成「浅而准」。
 *
 * 怎么做到只对某个模式生效：本插件挂在 profile 层，注册一个【全局】的
 * `system-prompt/assemble` 监听器 —— 每次装配都会经过它。然后从装配的 scope
 * （真实装配里就是 Agent）拿到 `agent.ctx`，向 `agentPresets.composedPreset()`
 * 问「这个会话用的是哪个 preset」。是配置里点名的那个才变换，否则原样放行。
 *
 * 因此它【不需要修改任何核心包】：不新增 mode 枚举、不碰 dsh-tools。
 */

export const name = 'lean-mode'

/** systemPrompt：监听装配。agentPresets 走 ctx.get（可选，拿不到就作用于全部会话）。 */
export const inject = ['systemPrompt']

const CATALOG_SECTION = 'tools:catalog'
const CATALOG_HEADER = [
  '## Tool catalog',
  '',
  '★ 每条都给出该工具实参的【顶层 JSON 形状】：箭头右边就是你要传的对象。',
  '★ 形状里没有列出的键一律不要传；★ 不要拆开单键信封 —— 形如 {"params": …} 的，所有实参都放进 params 里面。',
  '★ 键后面带 : … 的是必填。',
].join('\n')

function firstLine(description) {
  const text = String(description == null ? '' : description)
  const cut = text.split(/[。\n]/)[0] || ''
  const trimmed = cut.trim()
  return trimmed.length > 120 ? trimmed.slice(0, 120) + '…' : trimmed
}

/** 把一个 JSON schema 投影成顶层契约。 */
export function shallowParameters(parameters) {
  if (parameters == null || parameters.type !== 'object' || parameters.properties == null) return { type: 'object' }
  const required = Array.isArray(parameters.required) ? parameters.required : []
  const properties = {}
  for (const key of Object.keys(parameters.properties)) {
    const prop = parameters.properties[key] || {}
    const declared = Array.isArray(prop.type) ? prop.type[0] : prop.type
    const type = typeof declared === 'string' ? declared : 'object'
    const enumValues = prop.enum
    properties[key] = Array.isArray(enumValues) && enumValues.length > 0 && enumValues.length <= 12
      ? { type, enum: enumValues }
      : { type }
  }
  const out = { type: 'object', properties }
  if (required.length > 0) out.required = required
  return out
}

function catalogLine(tool) {
  const p = tool.parameters || {}
  const props = p.properties || {}
  const required = new Set(Array.isArray(p.required) ? p.required : [])
  const keys = Object.keys(props)
  const shape = keys.length === 0
    ? '{}'
    : '{' + keys.map(k => JSON.stringify(k) + (required.has(k) ? ': …' : '?: …')).join(', ') + '}'
  return '- ' + tool.name + ' ← 实参写成 ' + shape + ' // ' + firstLine(tool.description)
}

/** 这次装配属于哪个 preset（拿不到就当没命中）。 */
function presetOf(ctx, scope) {
  const registry = ctx.get('agentPresets')
  if (registry == null || scope == null) return undefined
  const agentCtx = scope.ctx
  if (agentCtx == null) return undefined
  try { return registry.composedPreset(agentCtx) } catch { return undefined }
}

export function apply(ctx, config) {
  const settings = config || {}
  const wanted = Array.isArray(settings.presets) && settings.presets.length > 0 ? settings.presets : undefined
  const withCatalog = settings.catalog !== false
  const withShape = settings.shape !== false
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const base = await next()
    if (base == null || !Array.isArray(base.tools) || base.tools.length === 0) return base
    if (wanted !== undefined) {
      const preset = presetOf(ctx, context == null ? undefined : context.scope)
      if (preset === undefined || wanted.indexOf(preset) < 0) return base
    }
    const tools = withShape
      ? base.tools.map(t => ({ name: t.name, description: firstLine(t.description), parameters: shallowParameters(t.parameters) }))
      : base.tools
    if (!withCatalog) return Object.assign({}, base, { tools })
    if ((base.sections || []).some(s => s.name === CATALOG_SECTION)) return Object.assign({}, base, { tools })
    const order = ctx.systemPrompt.getSectionOrder('TOOLS_SDK')
    const body = CATALOG_HEADER + '\n\n' + '```' + '\n' + tools.map(catalogLine).join('\n') + '\n' + '```'
    return Object.assign({}, base, { tools, sections: base.sections.concat([{ name: CATALOG_SECTION, order, interpolate: false, text: body }]) })
  })
}