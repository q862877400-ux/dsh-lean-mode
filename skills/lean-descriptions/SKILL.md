---
name: lean-descriptions
description: >
  给 lean-mode 的描述覆盖表补条目时用：把 descriptions.pending.json 里积压的工具
  写成 ≤300 字符的短描述，过校验器后写回 descriptions.json。
  触发：「补 lean 描述」「pending 里攒了一堆」「工具描述被截断了帮我重写」
  「lean 模式下这个工具模型选不对」。
  NOT for：改工具本身的源码描述（那要改 MCP server）；写 DSH 插件。
---

# 给 lean 覆盖表补描述

## 一、先搞清两个文件（不对称，搞错就白干）

| 文件 | 谁写 | 谁读 |
|---|---|---|
| `descriptions.json` | **你（离线 skill）** | **插件**（`load()` 读 `.tools`） |
| `descriptions.pending.json` | **插件**（`flush()` 写 `{_meta,tools,pending}`） | **你** |

**关键**：`pending` 文件是**只写**的 —— 插件从不回读它。你补完的条目必须写进 `descriptions.json`，下次启动才生效。

⇒ **别把结果写回 pending 文件**，插件永远不会读。

## 二、三步流程

```bash
P="$DSH_PROFILE_DIR/node_modules/@local/dsh-lean-mode"

# 1. 看有哪些待补、各自是什么毛病
node "$P/tools/curate-pending.mjs" list
node "$P/tools/curate-pending.mjs" stats

# 2. 逐个看完整事实（必做，别跳过）
node "$P/tools/curate-pending.mjs" show <toolName>

# 3. 写完 → 校验 → 清 pending
node "$P/tools/curate-pending.mjs" apply <toolName> "<描述>"
node "$P/tools/validate-descriptions.mjs" "$P/descriptions.json" --pending "$P/descriptions.pending.json"
node "$P/tools/curate-pending.mjs" remove <toolName>    # 只有校验过了才 remove
```

**`apply` 故意保留 pending** —— 校验器要靠它做字面量比对。先 remove 会让比对失效、看着"通过"其实没验。

## 三、六种待补原因，写法不同

`needsCuration()` 只会因这六种把工具打进 pending：

| reason | 含义 | 怎么写 |
|---|---|---|
| **`over-budget`** | 原描述 > 300 字符 | ★ **压缩**。事实全在，风险最低。保住 `Use when:`/`Not for:` |
| **`title-like`** | 只有标题短语没句子 | **补全**成 `<动词><对象>. <关键约束>.` |
| **`argblock`** | 原描述是 `Args:` / `Returns:` 块 | **提炼**成一句行为描述 |
| **`typename`** | 原描述是个类型名（`MetricsQueryRequest`） | **从参数反推**行为；推不出就 `INSUFFICIENT` |
| **`too-short`** | 原描述 < 15 字符 | 同 typename，事实太少易编 |
| **`empty`** | 原描述为空 | 同 typename，**默认应该是 `INSUFFICIENT`** |

**风险排序**：`over-budget`（低）< `argblock`/`title-like`（中）< `typename`/`too-short`/`empty`（高）。

## 四、两条防幻觉硬判据（会被校验器拦）

校验器做的是**纯字符串比对**，不需要语义判断：

### 判据 1：原描述里的字面量必须都出现

自动从「原描述 + 每个参数的 description」里抽三类必须保留的东西：

| 类型 | 例 |
|---|---|
| **枚举映射** | `0=blind`、`1=through_all` |
| **全大写单位/缩写** | `MILLIMETRES`、`DEGREES`、`PDF` |
| **数值约束** | `must be > 0`、`should be <= 100` |

**丢一个就 FAIL**，报 `[LOST_LITERAL]`。

### 判据 2：`UNVERIFIED` 出现次数不得减少

原描述或参数描述里写着 `Its meaning is UNVERIFIED` 的，**你的输出必须保留同样数量**。

**这条最容易被"顺手改好"** —— 看到 `UNVERIFIED` 想删掉让它更干净，那就等于替作者编了个含义。

## 五、输出格式

```
<动词><对象>; <最值钱的约束>. <何时用>.
```

**要保住的三样**（按价值排序）：

1. **枚举/取值域** —— `end_condition accepts 0=blind, 1=through_all`
2. **单位与数值边界** —— `depth_mm is in MILLIMETRES and must be > 0`
3. **何时用 / 排除项** —— `Use when a solid body exists.`

**禁**：`This tool` / `Allows you to` / `A tool that` / `Use this to` 开头；markdown；引号；换行。

**长度**：≤ 300 字符（`maxChars`）。超了 `apply` 会拒。

## 六、事实不足时用 `INSUFFICIENT`

**这是正解，不是失败。**

只有当「做什么」能从 name + 参数**唯一确定**时才写描述。否则：

```bash
node "$P/tools/curate-pending.mjs" remove <toolName>
```

直接放弃补写，让它继续留在 pending。**编一句看着对的话，比留着原描述更危险** —— 校验器只能拦字面量丢失，拦不住"读起来合理但语义编造"。

## 七、交付前自检

- [ ] 用了 `show` 看完整事实，不是只看 `list` 那一行
- [ ] 所有 `0=solid` 类枚举映射都在
- [ ] 所有全大写单位都在
- [ ] `must be > 0` 类约束都在
- [ ] `UNVERIFIED` 数量没减少
- [ ] 没有 `This tool` / `Allows you to` 开头
- [ ] ≤ 300 字符，无换行
- [ ] `validate-descriptions.mjs --pending` 退出码 **0**
- [ ] 校验通过**之后**才 `remove`

## 八、磁盘上的实测状态（2026-10-26 重启后）

`descriptions.pending.json` **已存在，47 个待补**（都是 `over-budget`）：

```
over-budget   47   ← 原描述 > 300 字符，压缩即可，风险最低
```

> **2026-10-26 修掉一个分类器 bug**：旧的 `title-like` 判据只检查「首字母大写」，
> 把 `Clicks on the provided element` 这类完整句子也判成标题，往待补队列里塞了 7 条垃圾
> （chrome-devtools 的 click/drag/hover/resize_page/type_text/handle_dialog + codebase-memory 的 delete_project）。
> 修好后这 7 条已从 pending 移除，判据改为「真 Title Case（多数实词首字母大写）+ ≤6 词」。

覆盖表 `descriptions.json` 仍是空表（`tools: {}`），所以这 54 个现在都走"截断 + 进 pending"。

**47 个全是 `over-budget`** —— 事实全在原文里，压缩风险最低，直接开始。
`title-like` 现在不该再误报；若真的出现，说明描述确实只是标题短语，要补全。

## 九、参考

| 什么时候读 | 读哪个 |
|---|---|
| 描述该怎么写（官方文风 + 范文库） | 插件 `docs/tool-description-style.md` |
| 为什么 lean 会丢参数描述、怎么取舍 | 插件 `docs/tool-description-style.md` §十 |
| 六种 reason 的判定源码 | 插件 `index.mjs` 的 `needsCuration()` |
| 校验器 8 条判据 | 插件 `tools/validate-descriptions.mjs` |
