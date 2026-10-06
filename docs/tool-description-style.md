# MCP / 工具描述的具体写法规范（以 DSH 官方为准）

> 依据：`docs/cookbook/adding-a-tool.md`（官方工程契约）+ `docs/tool-catalog.md`（**官方全部 72 个工具的实文**，由 `pnpm run gen-tool-catalog` 从真实 `ctx.tools.schemas()` 生成，不是手写的）+ `docs/user/develop/basic/tool.md`（官方教程）。

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
