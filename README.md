# dsh-lean-mode

**English** | [中文](README.zh.md)

> A [DeepSeek Harness](https://github.com/deepseek-ai) plugin that presents every tool to the model in a **lean, executable** form — **install it and it just works**, remove it and the old form is back. **No core changes.**

---

## The problem

Tool schemas are sent on **every** request. In a deployment with hundreds of MCP tools they dominate the context:

| Deployment | Tools | Tool schemas | Share of the first request |
|---|---|---|---|
| Default `standard` preset (measured on a real deployment) | **84** | **89 KB** | **~22,300 of 36,264 tokens — 61.6%** |
| All MCP tools mounted | **731** | **988 KB** | **~275,000 tokens — 27.5% of a 1M window** |

Most of that is JSON-Schema punctuation the model rarely needs: nested descriptions, deep objects, defaults. The **names** and the **top-level contract** are what make a call possible.

## What this plugin does

Two things, per assembly:

1. **Shrinks each tool's parameter schema to its top-level contract** — top-level keys, `required`, each key's `type`
 and a short `enum` when declared. Nested structure, descriptions and defaults are dropped.
2. **Appends a `tools:catalog` prompt section** listing **every** tool — including the ones the model is unlikely to recall — with the exact argument envelope and a one-line purpose.

### Why the envelope must survive

In a real catalogue **64% of tools take a single required wrapper key** (commonly `params`). Collapse the schema to an open `{type:'object'}` and the model flattens the arguments, so every call is rejected:

| Channel shape | Calls that actually execute |
|---|---|
| Open skeleton `additionalProperties: true`
 | **1.7%** |
| **Top-level contract kept** | **95.0%** |

## Measured effect

Same model, same 199-task set, same catalogue:

| Tools | Baseline (full schemas) | **lean** | Ratio |
|---|---|---|---|
| 26 | ~5,340 tok | ~2,385 tok | 0.45 |
| **84** (a real deployment's default preset) | ~22,300 tok | **~9,400 tok** | **0.42** |
| **731** (every MCP tool) | **~275,000 tok** | **~68,000 tok** | ★ **0.247** |

End-to-end callability (tool name in the catalogue **and** the emitted arguments satisfy the real schema):

| Presentation | End-to-end |
|---|---|
| Full JSON Schema | 95.0% |
| **lean** | **89.9%** |
| Open skeleton only | 1.7% |

## Install

```powershell
dsh plugin --profile <profile> add <path to this directory>
```

**Uninstall**

```powershell
dsh plugin --profile <profile> remove @local/dsh-lean-mode
```

The bundle carries both the plugin row and a **Lean mode** preset declaration, so once installed the mode appears in the UI's preset menu; removing the bundle removes both.

## How it works

`system-prompt/assemble` is a **waterfall** whose contract states *the returned value is authoritative*, and *scoped listeners receive only that scope's assemblies*. This plugin therefore:

- registers a **profile-level** listener, so it sees every assembly;
- asks `agentPresets.composedPreset(agent.ctx)` which preset the assembly's agent runs under;
- transforms **only** when that preset is one it was configured for.

```js
export function apply(ctx, config) {
  const wanted = config?.presets            // e.g. ['lean']
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const base = await next()
    if (wanted && !wanted.includes(presetOf(ctx, context?.scope))) return base
    return { ...base, tools: base.tools.map(toShallow), sections: [...base.sections, catalog] }
  })
}
```

It uses **only upstream APIs** — no new `tools.mode` value, no patched package.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `presets` | `undefined` | Preset ids this applies to. Omit to apply to **every** session. |
| `shape` | `true` | Project parameters to the top-level contract. |
| `catalog` | `true` | Append the `tools:catalog` section. |

## Limitations

- ★ **All figures were measured on one local deployment** (731-tool catalogue unioned from real sessions; 199 tasks; a single model). Ratios will differ elsewhere — **re-measure before relying on them**.
- ★ Callability is judged as **"the emitted call is valid against the real schema"**, not "the tool succeeded on a machine".
- ★ End-to-end accuracy (89.9% vs 95.0%) is a **single-run** figure on that task set.
- ★ The catalogue **repeats each tool's one-line purpose**, so the win grows with the **size of the parameters**, not merely the count of tools.

## License

MIT. See [LICENSE](LICENSE) and [THIRD-PARTY.md](THIRD-PARTY.md) — `cordis.patch.yml` restates a preset composition from DeepSeek Harness (MIT, Copyright (c) 2026 DeepSeek); the plugin source is original.
