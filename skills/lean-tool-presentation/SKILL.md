---
name: lean-tool-presentation
description: >
  改工具描述/schema，或在 Lean 模式下调呈现方式时用。回答：工具描述怎么写才在 lean 下不丢信息
  （英文、动词开头、句号收尾、300 字符预算怎么分配）、描述超限了怎么补、目录为什么只列名字、
  schema 该写肥还是写瘦、三档呈现（native/index/lean）怎么选、lean 与 DSH 官方 agent-experience 的冲突怎么取舍。
  触发：「改工具描述」「新加 MCP 工具」「工具 schema 怎么写」「lean 下工具怎么呈现」「工具目录太长」
  「这个插件为什么这样设计」。
  NOT for：写 DSH 插件（用 cordis-plugin-development）；模型 provider 配置（用 model-config）。
---

# Lean 模式下的工具呈现

## 一、改描述前先记住一句话

**判断描述好坏的唯一标准是「模型看了能不能一次调对」，不是它有多少字节。**

```
目标：调用准确率
手段：该有的信息一个不少、不该有的冗余一个不多
结果：token 多少  ← 副产品
```

**不要为省 token 删信息，也不要为显摆某种呈现能省而加信息。**

---

## 二、工具描述用英文（理由在 v2 变了）

**只限工具描述（`tool.description`）。别的对象不受这条影响，见下节对照表。**

`compressDescription()` 只折叠空白 + 按词边界截断，**`。` 和换行都不被砍**。

⇒ **中英文在截断上完全对称。** 仍建议英文的三条理由（与截断无关）：

1. 官方 72 个工具全英文，混语言让模型耗注意力在切换上
2. `maxChars` 数 `.length`：300 汉字 = 300 字符但 token 远高于 300 ASCII ⇒ 中文更快撞 token 成本
3. 能直接复用官方范文结构

### 这条只作用于工具描述 —— 别推广到别处

`compressDescription` 在插件里作用于 `tool.description`：

```js
catalogLine(tool)  → compressDescription(tool.description)
projectTool(tool)  → compressDescription(tool.description)
```

| 对象 | 受这条影响吗 | 依据 |
|---|---|---|
| **工具描述** `tool.description` | **是** | 超 `maxChars`（300）按词边界截断 |
| 工具参数描述 | 是（更狠） | `shallowParameters` **整条丢弃** |
| **skill 正文** | **否** | pruner 只数 codePoint，与标点无关 |
| **skill 的 `description`** | **否** | 按 500 字符上限独立截断，不看语言 |

**skill 正文用什么语言，只看表达效率，与截断无关。** 实测：11,500 codePoint 的中文和 30,000 codePoint 的英文，pruner 都在头 4096 处切，`。` 和 `.` 一视同仁。

---

## 三、描述模板

### 官方实际怎么写（n=72 工具 / 228 条描述）

| 项 | 官方 |
|---|---|
| 工具描述长度 | 中位 **139 字符** |
| 首词 | **82% 是动词** |
| 结尾 | **99% 句号收尾** |
| 句数 | **中位 2 句** |
| 参数描述长度 | 中位 **55 字符**，**100% 句号收尾** |
| 官方中位 vs lean 上限 | **139 vs 300** ⇒ 绝大多数原样通过 |

### 工具描述

```
<动词> <对象> <关键限定>.
<何时用 / 调用前提 / 副作用 / 返回什么>.
```

**第一句 = 做什么，第二句 = 决策信息。**

官方实例的第二句装什么：

| 工具 | 第二句 |
|---|---|
| `bash` | `Each call runs in a fresh shell; pass workdir instead of using cd.` ← 使用方式 |
| `present` | `Use it when the user needs a separate file...` ← 何时用 |
| `plugin_manager` | `Every action requires danger-full-access permission...` ← 副作用 |

### 参数描述

```
<它是什么>[; <范围>][; defaults to <默认值>].
```

官方实例：`Zero-based list offset; defaults to 0.` / `List page size, from 1 to 100; defaults to 25.`

boolean 惯例：`Whether <命题>. Defaults to <true|false>.`

### 300 字符的优先级

官方中位 139 < 300 ⇒ **绝大多数官方描述原样通过**。只有超 300 才要取舍：

| 优先 | 内容 |
|---|---|
| 1 | 动词 + 对象 |
| 2 | **必填参数的取值域** |
| 3 | 何时用 / 排除项（`Use when:` / `Not for:`） |
| 4 | 副作用 |

超 300 不会被硬砍，而是进 `descriptions.pending.json` 等离线补写（见 §六 与插件 `docs/tool-description-style.md` §六）。

放不下的靠**键名自带语义**兜（`depth_mm` 而非 `depth`）。

⚠ **与官方规范的冲突**：`agent-experience` 要求「parameter rules on the parameter」，但 lean 会丢 per-property description。取舍见 §十一。

---

## 四、schema 该写肥还是写瘦

**写准。** 不要为了配合 lean 而写瘦。

插件 `docs/authoring-mcp-tools.md` 原文：

> **「不要为了配合 lean 把 schema 写瘦。」**
> 目录成本是**固定**的（≈195 B/工具），lean 的收益 = **原 schema 省下的字节**。
> ⇒ **schema 越肥，lean 省得越多；schema 越瘦，lean 越没用**（瘦到一定程度反而更贵）。

schema 里真信息越多，字节自然越多——那不是「写得肥」，是「写得准」。

---

## 五、逐条检查清单

**工具描述**
- [ ] 语言 = **英文**（理由见 §二，不是截断问题）
- [ ] **动词开头**、**句号收尾**
- [ ] 前 300 字符含：做什么 + 必填取值域 + 何时用
- [ ] 超 300 ⇒ 写进覆盖表 `descriptions.json`（别指望截断保留）

**参数**
- [ ] 每个参数都有 `description`
- [ ] 含默认值（`defaults to X`）、含范围/单位
- [ ] 键名自带单位/语义（**因为 lean 会丢参数描述**）
- [ ] `required` 老实标（**lean 下唯一的必填信号**）
- [ ] 枚举 **≤12 个**（超了整个丢）
- [ ] 无 `oneOf`/`anyOf`（会丢）

**schema**
- [ ] 顶层 = `type:"object"` + `properties`（否则 **lean 下参数全丢**）
- [ ] 嵌套/数组类型标注仍写全（native 用得到）
- [ ] **不要**为了 lean 把 schema 拍平
- [ ] `deferLoading` 若存在必须保留（官方 `system-prompt` 显式保留该字段）

---

## 六、改完怎么验

```powershell
$lean = "$env:DSH_PROFILE_DIR\node_modules\@local\dsh-lean-mode"
node "$lean\tools\lean-lint.mjs" --mcp path/to/server.mjs
node "$lean\tools\lean-lint.mjs" tools.json
node "$lean\tools\lean-lint.mjs" tools.json --max-chars 150   # 临时换预算
```

报：**真实损害**（顶层非 object、枚举 >12、缺 type、`oneOf`/`anyOf`、type 数组）、**待补清单**（哪些工具会进 `pending`，按 `empty`/`too-short`/`argblock`/`typename`/`title-like`/`over-budget` 分类）、**超 300 的描述**、**字节账与比值**、**lean 目录逐行原文**。

文风项只提醒不判失败。退出码 0 = 无真实损害，1 = 有。

---

## 七、三档呈现：选错档等于白做

### 核心区分

| 位置 | 装什么 | 为什么 |
|---|---|---|
| **工具通道**（tools 数组） | **全量 schema** | 结构化、模型按需查 —— **准确率在这里** |
| **系统提示词**（指令区） | **越短越精确** | 指令区被撑长，遵循度下降 |

### 三档

| 档 | 配置 | 通道 | 指令区目录 | 牺牲 | 用在哪 |
|---|---|---|---|---|---|
| **native** | 不装插件 | 全量 | 无 | — | 工具少 |
| **index**（推荐） | `shape: false, catalog: true` | **全量** | 15.5 B/工具 | **不牺牲任何信息** | 工具多、要准 |
| **lean** | `shape: true, catalog: true` | 浅（顶层契约） | 15.5 B/工具 | 嵌套/数组/枚举>12/默认值/属性描述/描述第二句 | 上下文**装不下**时 |

### 三问决策

```
① 工具通道装得下吗？
     装得下 → 别用 lean。用 native 或 index
     装不下 → 问 ②
② N 能不能减？（按需挂载进不同 preset）
     能 → 先减 N，lean 只是兜底
     不能 → 问 ③
③ 调错的代价 vs 上下文的代价，哪个大？
     调错贵 → index 档
     上下文贵 → lean（承认 -5 个点）
```

### 硬数据

| 指标 | 数值 |
|---|---|
| 端到端可调用率 | native **95.0%** vs lean **89.9%** |
| 官方 72 个常规 schema | 通道 19,886 → 12,318 B（**0.619×**） |
| 731 个肥 schema | 275,020 → 67,911 token（**0.247×**） |
| 43 个普通工具 | 首轮 input 15,831 → 13,240（**仅 −16.4%**） |

**`lean` 省的是准确率。** 只在工具多到装不下时才划算。

---

## 八、目录为什么只列名字

`index.mjs` 源码注释：

> 目录进的是系统提示词（指令区），指令区越短小精确、遵循度越好。早期版本每条工具写「实参形状 + 一句描述」= 138 B/工具 ⇒ 731 个工具就是 101 KB，超出 65536 的指令预算，会把 AGENTS.md 撑到被截断。

| 目录形态 | B/工具 | 731 个工具时 |
|---|---|---|
| 实参形状 + 一句描述 | 138 B | **101 KB —— 超预算 155%，AGENTS.md 被截断** |
| 名字 + 一句描述 | 119 B | 87 KB —— 仍爆 |
| **只列名字** | **15.5 B** | **11.3 KB（18%）** ✓ |

**`catalog: 'full'` 不推荐** —— 那是 138 B/工具的形态。

---

## 九、四条弯路

| ❌ 弯路 | 为什么错 |
|---|---|
| 为了省 token 而用 lean | 省是**副产品**。硬指标是调用准确率 |
| 为了让 lean 省得多而把 schema 写肥 | **本末倒置**。该写的是「准」 |
| 把目录写肥 | 138 B/工具 ⇒ 731 个 = 101 KB = 预算 155% ⇒ AGENTS.md 被截断 |
| 以为它提升准确率 | 实测**降 5 个点** |

---

## 十、配置与维护边界

```yaml
config:
  presets: [lean]      # 只对点名的 preset 生效；不写 = 所有会话
  shape: false         # 有代价的那项：把参数压成顶层契约
  catalog: true        # 名字索引（默认）。15.5 B/工具
```

**改 preset 声明时**：本插件 `cordis.patch.yml` 里那段是 `preset-lean` 的**完整重声明**。上游若改了 standard preset 的组成（增删插件行），**要同步这段**，否则上游改动被它遮蔽。

**这一节的细节**：`references/preset-composition.md`

---

## 十一、与 DSH 官方 `agent-experience` 的关系

**工具定义的规范源头是 DSH 官方**：`app/source/.agents/skills/agent-experience/SKILL.md`。本 skill 只讲 **lean 呈现层**的额外约束。

### ⚠ 一处实质冲突

| | 说法 |
|---|---|
| **官方第 3 条** | 「**Put parameter rules on the parameter.** Defaults, ranges, pairing, and when-to-set rules belong in that parameter's description or schema」 |
| **lean 实际** | `shallowParameters` **丢弃 per-property description**，只剩顶层键名 / type / enum≤12 / required |

⇒ **官方要求把参数规则写在参数上，lean 会把它丢掉。**

### 取舍判据

| 情形 | 怎么做 |
|---|---|
| 约束「模型必须知道才能调对」（枚举取值、单位、互斥） | **冗余进工具描述** |
| 约束「写错会报错，错误信息能自解释」 | 留给参数或运行时校验（官方第 1 条：删掉显而易见的约束） |
| 默认值 | 参数描述写 `defaults to X`；**影响决策时**再在工具描述提一句 |
| 纯实现细节 | 两边都不写（官方第 2 条） |
| 同一事实 | 只写一处（官方第 4 条），**冗余仅限上面第一类** |

**一句话**：lean 不是另一套规范，是同一套规范在「信息会丢」这个约束下的适配。**写定义照 `agent-experience`；只有确认某条会被 lean 丢掉、且丢了就调不对时，才冗余进描述，并接受「同一事实说两遍」的代价。**

---

## 十二、出处

| 内容 | 来源 |
|---|---|
| 三档、四条弯路、实测数字 | 插件 `docs/when-to-use.md` |
| 描述写法、范文库、300 预算、现行处理机制 | 插件 `docs/tool-description-style.md` |
| schema 该写肥、195 B/工具 | 插件 `docs/authoring-mcp-tools.md` |
| 目录只列名字的理由 | 插件 `index.mjs` 注释 |
| `compressDescription` 实现 | 插件 `index.mjs`（`DEFAULT_MAX_CHARS=300`） |
| **工具定义规范源头** | **DSH 官方 `app/source/.agents/skills/agent-experience/SKILL.md`** |

**插件路径**：`$DSH_PROFILE_DIR\node_modules\@local\dsh-lean-mode`
