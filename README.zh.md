# dsh-lean-mode

[English](README.md) | **中文**

> 一个 [DeepSeek Harness](https://github.com/deepseek-ai) 插件：把**每一个工具**以「**浅而准**」的形态呈现给模型 —— **装上就生效，卸载就还原**，**不改任何核心包**。

---

## 要解决的问题

工具 schema 是**每一轮请求都要发**的。当一个部署挂了几百个 MCP 工具时，它就成了上下文的头号开销：

| 部署 | 工具数 | 工具 schema | 占首轮请求 |
|---|---|---|---|
| 默认 `standard` preset（某真实部署实测） | **84** | **89 KB** | **约 22,300 / 36,264 token —— 61.6%** |
| 把 MCP 工具全挂上 | **731** | **988 KB** | **约 275,000 token —— 100 万窗口的 27.5%** |

这些字节里大部分是模型很少用到的 JSON-Schema 标点：嵌套描述、深层对象、默认值。**真正让一次调用能成立的，是工具名与顶层契约。**

## 插件做什么

每次装配做两件事：

1. **把参数 schema 压到顶层契约** —— 保留顶层 keys、`required`、每个键的 `type`，以及声明了的短 `enum`；剥掉嵌套结构、描述与默认值。
2. **追加一段 `tools:catalog` 提示词**，把**全部**工具（含模型记不住的冷门工具）连**实参信封**与一句用途一起列出来。

### 为什么信封不能丢

真实目录里 **64% 的工具顶层必填是一个包装键**（常见是 `params`）。把 schema 压成开放的 `{type:'object'}`，模型就会把实参平铺，于是**每一次调用都被拒**：

| 通道形态 | 真正能执行的调用 |
|---|---|
| 开放骨架 `additionalProperties: true`
 | **1.7%** |
| **保留顶层契约** | **95.0%** |

## 实测效果

同一个模型、同一批 199 题、同一份目录：

| 工具数 | 基线（全量 schema） | **lean** | 比值 |
|---|---|---|---|
| 26 | 约 5,340 | 约 2,385 | 0.45 |
| **84**（某真实部署默认 preset） | 约 22,300 | **约 9,400** | **0.42** |
| **731**（全部 MCP 工具） | **约 275,000** | **约 68,000** | ★ **0.247** |

端到端可调用性（工具名在目录内 **且** 发出的实参通过真实 schema）：

| 呈现方式 | 端到端 |
|---|---|
| 全量 JSON Schema | 95.0% |
| **lean** | **89.9%** |
| 只有开放骨架 | 1.7% |

## 安装

```powershell
dsh plugin --profile <profile> add <本目录的路径>
```

**卸载**

```powershell
dsh plugin --profile <profile> remove @local/dsh-lean-mode
```

bundle 里同时带着**插件行**与一个「**Lean 模式**」preset 声明 ⇒ 装上后这个模式会出现在界面的模式菜单里；卸载时两者一起消失。

## 原理

`system-prompt/assemble` 是一条**瀑布**，其契约写明「**返回的值是权威的**」「**作用域监听器只收到该作用域的装配**」。因此本插件：

- 在 **profile 层**注册监听器 ⇒ 每次装配都经过它；
- 用 `agentPresets.composedPreset(agent.ctx)` 问「这次装配的 agent 用的是哪个 preset」；
- **只有**命中配置里点名的 preset 才变换，否则原样放行。

```js
export function apply(ctx, config) {
  const wanted = config?.presets            // 例如 ['lean']
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const base = await next()
    if (wanted && !wanted.includes(presetOf(ctx, context?.scope))) return base
    return { ...base, tools: base.tools.map(toShallow), sections: [...base.sections, catalog] }
  })
}
```

它**只用上游既有 API**：不新增 `tools.mode` 枚举值、不打补丁、不改任何包。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `presets` | `undefined` | 生效的 preset id 列表。不写 ⇒ 作用于**全部**会话。 |
| `shape` | `true` | 把参数压成顶层契约。 |
| `catalog` | `true` | 追加 `tools:catalog` 段。 |

## 限度（请务必读）

- ★ **所有数字都量自同一台本机部署**（731 个工具是真实会话的并集；199 题；单一模型）。**换环境要重测**。
- ★ 可调用性的判据是「**发出的调用对真实 schema 合法**」，**不是**「真机建成」。
- ★ 端到端准确率（89.9% vs 95.0%）是那批题上的**单轮**数字。
- ★ 目录**会把每个工具的一句用途重复一遍** ⇒ 省得多不多，取决于**参数有多大**，而不只是工具数量。

## 许可

MIT，见 [LICENSE](LICENSE) 与 [THIRD-PARTY.md](THIRD-PARTY.md)。
`cordis.patch.yml` 复述了 DeepSeek Harness 的一份 preset 组成（MIT，Copyright (c) 2026 DeepSeek）；插件源码为原创。
