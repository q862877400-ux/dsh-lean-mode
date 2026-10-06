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
| ★ 超过 120 字符的工具描述 | **38/72 = 53%** |

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

## 二、★★★ 语言选英文（这条最省事也最要命）

lean 的 `firstLine()` 是这么切的：

```js
const cut = text.split(/[。\n]/)[0]     // ★ 只在「。」或换行处断
return trimmed.length > 120 ? trimmed.slice(0, 120) + '…' : trimmed
```

⇒ ★★ **`。`（中文句号）会断句，`.`（英文句点）不会。**

| 描述语言 | lean 下实际保留 |
|---|---|
| **英文**（用 `.` 断句） | ★ **不断句，整体保留到 120 字符**才硬截 |
| **中文**（用 `。` 断句） | ★★ **第一个 `。` 就断**（通常只剩 30–50 字符） |

⇒ ★★★ **同样是两句描述，英文能活 120 字符、中文只能活第一句。** 中文在 lean 下损失大得多。
⇒ ★ 官方**本来就是英文**，所以**照官方写法用英文** = 一举两得。

⚠ 如果你**必须**写中文：**第一句里塞满关键信息**，并且**不要用 `。`**（改用 `，` / `；`）。

---

## 三、前 120 字符怎么分配（lean 的硬预算）

官方中位 139 字符 > 120 ⇒ ★ **官方风格过半会被截**。所以按这个优先级塞：

| 优先级 | 内容 | 例 |
|---|---|---|
| 1 | **动词 + 对象** | `Creates an extruded boss…` |
| 2 | **必填参数的取值域** | `end_condition is blind, through_all, up_to_next or up_to_vertex` |
| 3 | **何时用 / 调用前提** | `Call only after opening a document` |
| 4 | **副作用** | `Writes to disk; overwrites an existing file` |

⇒ 放不下的靠 **键名自带语义**（`depth_mm`、`through_all`、`dry_run`）兜，
⇒ 以及 **肥 schema**（枚举/嵌套/默认值/per-property 说明）—— native 用户看得到，lean 也省得更多。

---

## 四、逐条检查清单（可 grep）

**工具描述**

- [ ] 语言 = **英文**
- [ ] **动词开头**（List / Read / Create / Execute / Search / Add / …）
- [ ] **句号收尾**
- [ ] **前 120 字符内**已含：做什么 + 必填取值域 + 何时用
- [ ] 中文描述：**无 `。`、无换行**（否则被截）
- [ ] 不在描述里换行

**参数**

- [ ] **每个参数都有** `description`（lean 会丢，但 native 用户需要）
- [ ] 参数描述**句号收尾**、**含默认值**（`defaults to X`）、**含范围/单位**
- [ ] 键名**自带单位/语义**（`depth_mm` 而不是 `depth`）
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

会报：描述是否含 `。`/换行/超 120、顶层是否 object、枚举是否 >12、是否嵌套/数组/缺 type/oneOf，
以及**字节账与比值**和**lean 目录的逐行原文**。

---

## 六、★ 一个必须知道的限度（关于本插件的 120 截断）

官方 **53% 的工具描述 > 120 字符**，而它们的**第二句**装的正是「何时用 / 调用前提 / 副作用」——
⇒ ★★ **lean 会把官方一半以上工具的关键决策信息砍掉。**

这很可能就是实测 **端到端 89.9% vs native 95.0%** 那 5 个点差距的一部分来源。

⇒ ★ **可调的改进方向**（尚未实现）：把 `firstLine` 的 120 改成可配置，或让**通道里保留完整描述**、只让目录用一行索引。
⇒ 代价：token 会回升。**这是一个可以实测的取舍**，不该拍脑袋定。

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
