# MCP / 工具描述的具体写法规范（以 DSH 官方为准）

> 依据：`docs/cookbook/adding-a-tool.md`（官方工程契约）+ `docs/tool-catalog.md`（**官方全部 72 个工具的实文**，由 `pnpm run gen-tool-catalog` 从真实 `ctx.tools.schemas()` 生成）+ `docs/user/develop/basic/tool.md`（官方教程）。

---

## 〇、唯一目标：让模型**调对**

**判断一份描述/schema 好不好的唯一标准是「模型看了能不能一次调对」**，不是它有多少字节。

```
目标：调用准确率 / 成功率            ← 唯一的硬指标
手段：该有的信息一个不少、不该有的冗余一个不多
结果：token 多少                      ← 副产品，不是目标
```

⇒ ★★ **不要为省 token 删信息，也不要为显摆某种呈现方式能省而加信息。**
⇒ ★ **该写的就必须写**：枚举、默认值、单位、范围、必填性、什么时候别用 —— **模型缺了它们就会调错**。
⇒ ★ **不该有的才删**：重复的解释、人看的排版、能由键名表达的废话。

**一条推论（很重要）**：schema 里**真信息越多**，字节自然越多 —— 那不是「写得肥」，那是「写得准」。
所以任何呈现方式的收益，都应当**在信息量不变的前提下**去比 —— **不许靠改工具来制造收益**。

### ⚠ 本书不承诺的事

- ❌ **不教你怎么写才能让某种呈现方式省得多**（那是本末倒置）
- ❌ **不要求你为了某个上限去删信息**（见第五节：那是呈现方式的缺陷，该修呈现方式，不该改工具）
- ✅ 只教**怎么写才准**，然后让呈现方式去适配它

---
## 一、官方实际是怎么写的（实测数字，n=72 个工具 / 228 条描述）

| 项 | 官方实测 |
|---|---|
| 工具描述长度 | 中位 **139 字符**（均值 234） |
| 首词 | **82% 是动词**（祈使句：List / Read / Create / Execute / Search…） |
| 结尾 | **99% 以句号收尾** |
| 句数 | **中位 2 句** |
| 参数描述长度 | 中位 **55 字符** |
| 参数描述结尾 | **100% 句号收尾** |
| ★ 官方中位 vs lean 上限 | **139 字符 vs 300** ⇒ 绝大多数官方描述原样通过，零损失 |

### 官方模板（归纳自 72 个实例）

```
<动词> <对象> <关键限定>.
<何时用 / 调用前提 / 副作用 / 返回什么>.
```

**第一句 = 做什么。第二句 = 决策信息。** 实例（官方原文，第二句是重点）：

| 工具 | 第一句 | ★ 第二句（装什么） |
|---|---|---|
| `bash` | Execute a bash command and return its stdout/stderr. | **Each call runs in a fresh shell; pass `workdir` instead of using `cd`.** ← 使用方式 |
| `present` | Declare existing files as final deliverables for the user. | **Use it when the user needs a separate file…** ← 何时用 |
| `exit_plan_mode` | Use only in plan mode. | **Present your plan for the user's review and, on approval, leave plan mode.** ← 前提与效果 |
| `plugin_manager` | List plugins or bundles in the current profile… | **Every action requires danger-full-access permission…** ← 权限/副作用 |
| `cordis_inspect_query` | Run a read-only query declared by an Inspect Provider. | **platform, provider, and method must come from cordis_inspect_list…** ← 调用前提 |

### 参数描述模板

```
<它是什么>; <默认值 / 范围 / 取值>.
```

官方实例：

- `Zero-based list offset; defaults to 0.`
- `List page size, from 1 to 100; defaults to 25.`
- `Whether the user may select more than one option. Defaults to false.`
- `Positive elapsed-time budget in milliseconds, capped by the deployment maximum.`
- `Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI).` ← ★ 连**风格要求**都写进描述里

⇒ ★ **必含**：用途 + **默认值**（如果有）+ **范围/单位**（如果有）。

---

## 二、语言选英文（理由在 v2 变了，结论不变）

`compressDescription()` 只做两件事：

```js
text = String(description ?? '').replace(/\s+/g, ' ').trim()   // 折叠空白
if (text.length <= maxChars) return text                        // 未超上限原样返回
// 超了才按词边界截断；中文没有空格，则硬切
return body.replace(/[,;:\s]+$/, '') + '…'
```

⇒ ★ **中英文在截断规则上已经完全对称。** 写中文不会被句号砍，也不会因为换行被砍。

**那为什么仍建议英文？** 三条与截断无关的理由：

1. **官方 72 个工具全是英文**，工具集混语言会让模型在语言切换上耗注意力
2. **`maxChars` 数的是 `.length`**：300 个汉字 = 300 个字符，但 token 数远高于 300 个 ASCII 字符 ⇒ **同样预算下中文塞的语义更多，也更快撞上 token 成本**
3. **照官方范文写**能直接复用它的结构（见 §七 范文库）

⚠ 如果你**必须**写中文：`。` 和换行都不再有害，放心用；但要留意 **300 字符中文的信息量远大于 300 字符英文**。

---

## 三、300 字符怎么分配（lean 的预算）

官方中位 139 字符 < 300 ⇒ ★ **绝大多数官方描述原样通过，零损失**。超出 300 的才按这个优先级取舍：

| 优先级 | 内容 | 例 |
|---|---|---|
| 1 | **动词 + 对象** | `Creates an extruded boss…` |
| 2 | **必填参数的取值域** | `end_condition is blind, through_all, up_to_next or up_to_vertex` |
| 3 | **何时用 / 调用前提**（`Use when:`） | `Use when a solid body already exists` |
| 4 | **排除项**（`Not for:`） | `Not for surface modelling` |
| 5 | **副作用** | `Writes to disk; overwrites an existing file` |

⇒ 超过 300 的工具**不会硬砍了事**：`needsCuration()` 判为 `over-budget` ⇒ 进 `descriptions.pending.json` 等离线补写（见 §八）。

⇒ 放不下的靠 **键名自带语义**（`depth_mm`、`through_all`、`dry_run`）兜，
⇒ 以及 **肥 schema**（枚举/嵌套/默认值/per-property 说明）—— native 用户看得到，lean 也省得更多。

⚠ **但要注意这条与 DSH 官方规范的冲突**：官方 `agent-experience` 要求「parameter rules on the parameter」（默认值/范围/配对写进该参数的 description），而 **lean 的 `shallowParameters` 会丢弃 per-property description**。取舍判据见 §十。

---

## 四、逐条检查清单（可 grep）

**工具描述**

- [ ] 语言 = **英文**
- [ ] **动词开头**（List / Read / Create / Execute / Search / Add / …）
- [ ] **句号收尾**
- [ ] **前 300 字符内**已含：做什么 + 必填取值域 + 何时用
- [ ] 超过 300 → 写进覆盖表，别指望截断保留关键信息
- [ ] 不在描述里换行（v2 会折叠成空格，不报错但会变一行）

**参数**

- [ ] **每个参数都有** `description`（lean 会丢，但 native 用户需要）
- [ ] 参数描述**句号收尾**、**含默认值**（`defaults to X`）、**含范围/单位**
- [ ] 键名**自带单位/语义**（`depth_mm` 而不是 `depth`）—— 因为 lean 下参数描述会被丢
- [ ] `required` 老实标（lean 下唯一的必填信号）
- [ ] 枚举 **≤12 个**（超了会被整个丢掉）
- [ ] 无 `oneOf`/`anyOf`（会被丢掉）

**schema**

- [ ] 顶层 = `type:"object"` + `properties`（否则 lean 下**参数全丢**）
- [ ] 嵌套 object / 数组的类型标注仍要写全（native 用得到）
- [ ] **不要**为了 lean 把 schema 拍平

---

## 五、★★ 用 `tools/lean-lint.mjs` 逐条验

```sh
node tools/lean-lint.mjs --mcp path/to/server.mjs
```

会报：**真实损害**（顶层非 object、枚举 >12、缺 type、`oneOf`/`anyOf`、type 数组）、
**待补清单**（哪些工具会被插件判定进 `pending`，按 `empty`/`too-short`/`argblock`/`typename`/`title-like`/`over-budget` 分类）、
**字节账与比值**、以及 **lean 目录的逐行原文**。

文风项（动词开头、句号收尾、参数有描述…）**只提醒，不判失败** —— 它们是"怎么写更好"，不是"写错了"。

---

## 六、描述处理的现行机制

| 环节 | 现行行为 |
|---|---|
| 函数 | **`compressDescription()`** |
| 切句 | **不切句** —— 只折叠空白 |
| 上限 | **300 字符（`DEFAULT_MAX_CHARS`）** |
| 超限处理 | **词边界截断**（中文无空格则硬切），末尾加 `…` |
| 覆盖表 | **`descriptions.json`**，三态（active/quarantine/deprecated）+ `basedOn` 双哈希 |
| 超限长描述 | **进 `descriptions.pending.json` 等离线补写**，不硬砍了事 |
| 目录区（`catalog:'full'`） | **独立预算 120 字符**（指令区越短越遵循），与 300 无关 |

**为什么是 300**（实测依据）：

| 样本 | 工具数 | 描述长度中位 | 含换行 | 带 `Use when`/`Not for` |
|---|---:|---:|---:|---:|
| 自制 SolidWorks MCP | 524 | **71** | 1 个 | 几乎无 |
| 第三方 Sciverse MCP | 6 | **492** | **100%** | 67% / 50% |

**两个样本中位差 7 倍，分布是双峰的。** 预算扫描（Sciverse 样本）显示：**250 是「不再丢 `Use when`/`Not for`」的最小值**，取 300 留余量。

⇒ ★ **≤300 的工具（如 SolidWorks 全部）：原样通过，零损失。**
⇒ ★ **>300 的工具（如 Sciverse 5/6）：不被硬砍，进覆盖表由离线流程压缩。**
⇒ ★ 实测：压缩后仍含 `Use when` 的有 **4 条**。

**仍然存在的限度**：覆盖表目前是空的（`tools: {}`），所以 >300 的工具暂时仍是"被截断 + 进 pending"，直到离线补表跑过。见 §八。

---

## 七、★★★ 范文库（照这个抄，不要照我描述抄）

> 全部从 `docs/tool-catalog.md` 逐字摘出（那是从真实 `ctx.tools.schemas()` 生成的）。
> **模仿样本比模仿规则有效得多** —— 先读 20 条，再写你自己的。

### 7.1 一句话型（最短，24–62 字符）

适合：**参数少、语义无歧义**的工具。

```
Update the current goal.
Navigate a Stagehand browser tab to a URL.
Create or fully replace a UTF-8 text file.
List resources available from an MCP server.
List the active reminders in the current session.
Request cancellation of a running background job.
List, create, select, or close a Stagehand browser tab.
Read a UTF-8 text file and return line-numbered content.
Capture a Stagehand tab screenshot for visual inspection.
Edit an existing UTF-8 text file by replacing literal text.
Create one unowned pending task on the shared Team task board.
Fetch the content of a specific HTTP(S) URL and return it decoded to text.
```

★ **句式**：`<动词> <对象>.` 或 `<动词> <对象> and return <返回物>.`
★ ★ 注意倒数几条：**把返回值也写进同一句**（`and return line-numbered content`）。

### 7.2 一句话 + 限定型（74–100 字符）

适合：**有范围/对象限定**的工具。

```
Perform one natural-language browser action using the configured Stagehand model.
Find browser actions matching an instruction using the configured Stagehand model.
Read the complete latest value of one shared task before changing or executing it.
Extract page data using the configured Stagehand model and an optional JSON Schema.
Close one persistent terminal and wait until its captured owned process tree is gone.
List your background jobs (running and finished) with their ids, kinds, and statuses.
Read the current session goal, including the id and revision that update_goal requires.
Read a bounded page of retained output from a persistent terminal without sending input.
Interrupt one teammate's current turn while preserving its pending inbox. Team Lead only.
List shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.
```

★ **句式**：`<动词> <对象> <现在分词/介词短语作限定>.`
★ 限定用 `using …` / `including …` / `while …` / `before …` / `without …` / `and wait until …`。
★ ★ 权限类限定直接跟一句短句：**`Team Lead only.`**

### 7.3 两句型（★ 官方主流：中位 2 句）

★ **第一句做什么，第二句「何时用 / 前提 / 副作用 / 返回什么」**：

```
Declare existing files as final deliverables for the user. Use it when the user needs a separate file, especially Office documents, spreadsheets, and slide decks; prefer your final response when that suffices.

Execute a bash command (`bash -c`) and return its stdout/stderr. Each call runs in a fresh shell; pass `workdir` instead of using `cd`.

Use only in plan mode. Present your plan for the user's review and, on approval, leave plan mode.

Create a persisted goal that keeps this session working across automatic continuation rounds. Use it when the direct human request is a long-running objective, even if the user did not say "goal"; not for single-turn work.
```

★ 第二句的开头词（照抄）：**`Use it when …`** · **`Each call …`** · **`Not for: …`** · **`Prefer …`**

### 7.4 参数描述的两种写法（官方 100% 句号收尾）

```
Management operation.
Zero-based list offset; defaults to 0.
List page size, from 1 to 100; defaults to 25.
Whether the user may select more than one option. Defaults to false.
Positive elapsed-time budget in milliseconds, capped by the deployment maximum.
Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI).
Short user-facing option label.
Stable id for this question; echoed in the answer.
Optional short heading for the question, such as "Confirm" or "Choose Mode".
```

★ 句式：`<它是什么>[; <范围>][; defaults to <默认值>].`
★ boolean 参数惯例：**`Whether <命题>. Defaults to <true|false>.`**
★ 示例值直接写进描述：**`such as "Confirm" or "Choose Mode"`**

### 7.5 ★ 照抄这个结构写（填空模板）

```
<动词> <对象>[ <限定>][ and return <返回物>].
[Use it when <场景> | Each call <行为> | Not for <不该用的场景>].   ← 可选第二句
```

参数：

```
<它是什么>[; <范围/取值>][; defaults to <默认值>].        ← 句号必须
```

---

## 八、★★★ 三档呈现（选哪档，由「要准确率」还是「要压上下文」决定）

本插件的 config 有 **两个开关**：`shape`（是否把参数压成顶层契约）与 `catalog`（是否追加工具目录）。
**它们组合出三档**，差别在**牺牲什么、换来什么**：

| 档位 | 配置 | 参数 schema | 目录 | ★ 牺牲 | ★ 换来 | 该用在 |
|---|---|---|---|---|---|---|
| **native** | 不装插件 | 全量 | 无 | —— | 最省字节 | 工具少（几十个） |
| ★★ **catalog**（**推荐**） | `shape: false, catalog: true` | ★ **全量** | 有 | **不牺牲任何信息** | ★ **全局可见性**（解决「几百个工具只记得住几个」） | ★ **工具多、要准确率** |
| **lean** | `shape: true, catalog: true` | 浅（顶层契约） | 有 | **嵌套/数组/枚举>12/默认值/属性的描述** | 上下文最小 | 工具**极**多、且上下文吃紧 |

⇒ ★★★ **`catalog` 档才是「让 agent 知道有哪个工具可用」的正解** —— 它在**信息一点不少**的前提下，
把**全部工具**摊在模型面前。**省 token 不是它的目的。**
⇒ ★★ **`lean` 档的取舍必须说白**：它压掉的信息（数组元素结构、嵌套内部、>12 的枚举、默认值、
每个属性的说明、描述的第二句）**都是模型调对参数要用的** ⇒ **它省的是准确率**。
⇒ ✓ **只有在「工具多到上下文快装不下」时，用准确率换上下文才划算**。

### ★ 因此，判断该用哪档的口径

```
先问：现在模型调错的代价大，还是上下文的代价大？
  调错代价大   ⇒ catalog 档（全量 schema + 目录）
  上下文吃紧   ⇒ lean 档（承认在用准确率换）
```

⚠ **不要**因为「lean 省得多」就选 lean —— **省是副产品，不是理由**。

---

## 九、★★★ 目录只列名字（这一条否决了我之前的做法）

**关键区分**（我最初搞混了，导致设计走偏）：

| 位置 | 装什么 | 为什么 |
|---|---|---|
| **工具通道**（tools 数组） | ★ **全量 schema** | 结构化、**模型按需查** ⇒ **准确率在这里** |
| **系统提示词 / 指令区** | ★★ **越短小越精确** | ★ **指令区被撑长，遵循度就下降** |

**我早期把目录写成「每条工具：实参形状 + 一句描述」= 138 B/工具** ⇒

| 目录形态 | B/工具 | **731 个工具时** |
|---|---|---|
| 实参形状 + 一句描述（**我早期的做法**） | 138 B | ★ **101 KB —— 超出 65536 指令预算 155%，会把 AGENTS.md 撑到被截断** |
| 名字 + 一句描述 | 119 B | 87 KB —— 仍然爆 |
| ★★ **只列名字** | ★ **15.5 B** | ★ **11.3 KB（占预算 18%）** ✓ |

⇒ ★★★ **目录只列名字就够**：**实参细节本来就在工具通道里**，
目录唯一的任务是让模型**知道「有这么个工具」** —— **不需要在指令区把参数重复一遍**。

### 修正后的三档（731 个工具，用官方 72 个工具的真实 schema 外推）

| 档位 | 通道 | 指令区目录 | 合计 | 占 65536 预算 | 信息 |
|---|---|---|---|---|---|
| **native** | 197 KB | 0 | 197 KB | 0% | 全量 |
| ★★ **index** | ★ **197 KB（全量）** | **11.3 KB** | 209 KB | **18%** | ★ **全量 + 全部工具可见** |
| ★ **lean** | **122 KB（浅）** | **11.3 KB** | 133 KB | **18%** | 丢嵌套/数组/枚举/默认值 |

⇒ ★★ **`index` 档 = 全量 schema + 名字目录** ⇒ **准确率最高、指令区只占 18%** ——
**只花 11 KB 买「几百个工具全可见」**，这就是你要的东西。
⇒ ★ **`lean` 档 = 通道砍到 0.619×** ⇒ 上下文吃紧时才用，**且目录同样是瘦的**（不再破坏指令区）。
⇒ ⚠ **注意 lean 的真实比值是 0.619，不是早期说的 0.247** —— 后者量自**特别肥**的 MCP schema。

---

## 十、★★★ 与 DSH 官方 `agent-experience` 的对齐与冲突

> **工具定义规范以 DSH 官方为准**：`app/source/.agents/skills/agent-experience/SKILL.md`
> 本文只讲 **lean 呈现层**的额外约束，不重复、也不覆盖官方规范。

### 10.1 官方怎么说

`agent-experience` 的 `## Tool definitions` 五条，逐字：

| # | 官方原文 | 中文 |
|---|---|---|
| 1 | **Delete obvious constraints.** Omit rules the model learns from the call result | 删掉模型从调用结果就能学到的约束 |
| 2 | **Describe behavior, not implementation.** | 描述行为，不描述实现 |
| 3 | **Put parameter rules on the parameter.** Defaults, ranges, pairing, and when-to-set rules belong in that parameter's description or schema | **默认值/范围/配对/何时设 → 写在该参数的 description 或 schema 里** |
| 4 | **Say each fact once.** | 每个事实只说一次 |
| 5 | **Measure the change.** Compare first-turn prompt tokens before and after | 改动前后量首轮 token |

### 10.2 ⚠ 冲突：第 3 条 vs lean 的 `shallowParameters`

**官方要求把参数规则写在参数上；lean 的浅投影会把 per-property `description` 整个丢掉。**

`shallowParameters()` 只保留：顶层键名 / 每键 `type` / `enum`（≤12）/ `required`。
**丢弃**：每个属性自己的 `description`、默认值、`pattern`、`minimum`/`maximum`、`format`、`oneOf`/`anyOf`、数组 `items`、嵌套结构。

⇒ **同一份工具定义，native 用户看得到参数规则，lean 用户看不到。**

### 10.3 取舍判据（出现冲突时按这个选）

| 情形 | 怎么做 |
|---|---|
| **约束是「模型必须知道才能调对」**（枚举取值、单位、互斥关系） | ★ **冗余进工具描述**，别只放在参数上 |
| **约束是「写错了会报错，错误信息能自解释」** | 留给参数 / 留给运行时校验，**不要进描述**（官方第 1 条） |
| **默认值** | 参数 `description` 写 `defaults to X`（native 受益）；**若该值影响模型决策，再在工具描述里提一句** |
| **纯实现细节**（内部字段名、序列化格式） | 两边都不写（官方第 2 条） |
| **同一事实** | **只写一处**（官方第 4 条）—— 冗余仅限上面「必须知道」那一类 |

### 10.4 一句话

**lean 不是另一套规范，是同一套规范在「信息会丢」这个约束下的适配。**
写工具定义照 `agent-experience`；只有当你确认某条信息会被 lean 丢掉、且模型丢了就调不对时，才把它冗余到描述里——**并且接受「同一个事实说了两遍」这个代价**。
