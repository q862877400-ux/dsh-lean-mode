# 自研 MCP 工具怎么写（在 DSH / lean 呈现下）

> 配套脚本：[`tools/lean-lint.mjs`](../tools/lean-lint.mjs) —— 把任何 MCP server 的工具喂给它，报出 lean 下的呈现、字节账、以及会踩的坑。
> ```sh
> node lean-lint.mjs --mcp path/to/server.mjs
> node lean-lint.mjs tools.json
> ```

---

## 〇、先给结论（反直觉的那条）

**不要为了配合 lean 把 schema 写瘦。**

原因：目录的成本是**固定**的（≈ **195 B/工具**），而 lean 的收益 = **原 schema 省下的字节**。
⇒ **schema 越肥，lean 省得越多；schema 越瘦，lean 越没用**（瘦到一定程度反而更贵）。

实测（本仓 14 个自研工具，706 B/工具）：

| | 字节 | 每工具 |
|---|---|---|
| native schema | 9,880 B | 706 B |
| lean 通道 + 目录 | 9,768 B | 698 B |
| **⇒ 比值** | | ★ **0.989（只省 1.1%）** |

⇒ ★★ **正确的目标写法是「肥 schema + 自足的第一句描述 + 键名自带语义」**：

- **native 用户**：拿到完整精度（枚举、嵌套、默认值、per-property 说明）
- **lean 用户**：因为 native 肥 ⇒ **省得多**；第一句描述与键名**兜住语义**；目录把**全部**工具列成清单（解决「几百个工具只记得住几个」）

> ★ 反过来做（为 lean 把 schema 拍平）= **两边都变差**：native 精度丢了，lean 也没得省。


---

## 〇之二、对照实测（规范有用吗？）

同一批 14 个工具，两种写法：

| | native schema | lean 通道+目录 | **比值** | 每工具 native |
|---|---|---|---|---|
| **v1** 随手写（瘦） | 9,880 B | 9,768 B | ★ **0.989（省 1.1%）** | 706 B |
| **v2** 按规范写（肥） | 13,450 B | 10,720 B | ★ **0.797（省 20.3%）** | 961 B |

⇒ ★★ **schema 写得越全，lean 省得越多**；同时 **native 用户还拿到了完整精度**（枚举/嵌套/默认值/说明）。
⇒ ★ **「为 lean 把 schema 写瘦」是两头亏**：native 精度丢了，lean 也没得省。

### ★★ 但实测暴露了这个规范自己的边界：「120 字符」是硬预算

v2 的 14 个描述里有 **4 个 150–196 字符 ⇒ 全部被截断**（我自己违反了第 2 条）。

⇒ **必须取舍**。120 字符 ≈ **60 个汉字** ≈ **20 个英文词**。优先级：

1. **干什么**（动词 + 对象）—— 不能省
2. **必填参数的取值域**（枚举、单位）—— 最值钱
3. 关键副作用（会不会改模型、会不会写盘）

⇒ 放不下的，靠 **键名自带语义** 兜（`depth_mm`、`edge_ids`、`through_all`）。
⇒ ★★ **三者同时做**：**肥 schema（native 用）+ 短促自足的第一句（lean 用）+ 自解释的键名（两边都用）**。
---

## 一、lean 到底保留/丢弃什么（以下全部以插件源码为准）

### 1. 工具描述 ⇒ `firstLine()`

```js
const cut = text.split(/[。\n]/)[0]      // ★ 在「。」或换行处断开
return trimmed.length > 120 ? trimmed.slice(0, 120) + '…' : trimmed
```

| 保留 | 丢弃 |
|---|---|
| **第一句**（到第一个 `。` 或换行前） | 第一句之后的**一切** |
| 最多 **120 字符** | 超出部分 |

⚠ **注意**：`。`（中文句号）**会**截断，而 `.`（英文句点）**不会**。写中文描述时这是最容易踩的。

⇒ ★ **第一句必须自足**：写清「干什么 + 关键副作用 + 关键取值」。

### 2. 参数 schema ⇒ `shallowParameters()`

```js
if (parameters.type !== 'object' || parameters.properties == null) return { type: 'object' }   // ★ 全丢
// 每个顶层键：保留 type；enum 仅在 1..12 个时保留；required 保留
```

| 保留 ✓ | 丢弃 ✗ |
|---|---|
| 顶层键名 | **嵌套 object 的内部结构**（只剩 `type:"object"`） |
| 每个键的 `type` | **数组的 `items`**（只剩 `type:"array"`） |
| `enum`（**≤12 个**时） | `enum`（**>12 个**时，整个丢） |
| `required`（在目录里显示为 `: …` vs `?: …`） | **每个属性自己的 `description`** |
| | 默认值 · `pattern` · `minimum`/`maximum` · `format` · `oneOf`/`anyOf` |
| | `type` 是数组时只取**第一个** |

### 3. 目录行 ⇒ `catalogLine()`

```
- <name> ← 实参写成 {"必填键": …, "可选键"?: …} // <第一句描述>
```

⇒ ★★ 模型在 lean 下看到的**全部**就是：**工具名 + 顶层键名 + 必填性 + 第一句描述**。

### 4. 目录头部（模型看到的规则）

> ★ 每条都给出该工具实参的【顶层 JSON 形状】…
> ★ 形状里没有列出的键一律不要传；★ 不要拆开单键信封 —— 形如 `{"params": …}` 的，所有实参都放进 `params` 里面。
> ★ 键后面带 `: …` 的是必填。

---

## 二、自研 MCP 工具的写法清单

### ✅ 必做

1. **顶层必须是** `type: "object"` **且带** `properties`。
   ⚠ 若你把参数包在 `oneOf`/`anyOf` 里、或根本不是 object ⇒ **lean 下参数信息全丢**（只剩 `{type:object}`）。
2. **描述第一句自足、≤120 字符、不用** `。`**、不换行。**
   ✅ `Creates an extruded boss; end_condition accepts blind, through_all. Depth is in mm.`（用 `;` 和 `.`）
   ✗ `创建一个拉伸凸台。深度以毫米计。` ← 第二句全丢
3. **键名自带单位与语义**：`depth_mm` 优于 `depth` + 描述「单位毫米」。
   （因为 per-property 的 description 在 lean 下会被丢弃）
4. **`required` 老实标** —— 这是 lean 下**唯一**的必填信号。
5. **枚举控制在 ≤12 个**；超过就把取值写进**第一句描述**。
6. **信封最多一层**：要么顶层拍平（推荐），要么老老实实一个 `params` 键。
   ✗ 最坏：`{"params": {"input": {…}}}` —— 模型得猜两层。

### ✅ 推荐（让两边都好吃）

7. ★ **schema 写全**（枚举、嵌套、默认值、per-property 说明）—— **native 用户直接受益，lean 也省得更多**。
8. ★ **把最关键的 2–3 条约束【冗余】进第一句描述**（因为属性描述会被丢）。
   ✅ `Exports to STEP/IGES/Parasolid/STL; units one of mm, cm, inch, m; tolerance is chord height in mm.`
9. ★ **避免纯数组/纯嵌套参数**；实在要，**把元素结构写进第一句描述**。
   ✅ `edge_ids must be an array of edge names such as Edge1.`

### ❌ 别做

10. ✗ 为了配合 lean 把 schema 拍平 —— **native 精度丢了，lean 也没得省**。
11. ✗ 把关键信息只放在**第二句之后**，或只放在 per-property 的 `description` 里。
12. ✗ 一个工具塞进 >12 个枚举值（会被整个丢掉，模型只能瞎猜）。

---

## 三、用 `lean-lint.mjs` 自检

它会对每个工具报：

- 描述是否含 `。`/换行、是否 >120 字符
- 顶层是否 object+properties
- 是否有 >12 枚举、嵌套 object、数组、缺 `type`、`oneOf`/`anyOf`
- **字节账**：native 合计 vs lean 通道+目录，以及**比值**
- **lean 目录行长什么样**（逐条打印）

---

## 四、该不该用 lean（决策用）

设某个工具集：native 合计 `N` 字节、`k` 个工具。

```
lean ≈ shallow(N) + catalog        catalog ≈ 195 B × k（+头部 ~400 B）
净省 ≈ N − shallow(N) − 195k
```

| 情形 | 结论 |
|---|---|
| 工具 schema 很肥（≈1 KB+/工具，如成熟的 CAD / 桌面 MCP） | ★ **lean 省得多** |
| 工具 schema 普通（≈300–700 B/工具） | 省得有限（实测 43 工具 ≈ **−16% 首轮 token**） |
| 工具 schema 很瘦（< ~200 B/工具） | ★ **lean 可能反而更贵** |

⚠ **lean 的收益与字节节省不成正比**：目录是散文、浅 schema 反复出现键名 ⇒ **tokenize 效率更差**。
实测 43 工具：**字节省 25.7%，token 只省 16.4%**（403 vs 454 tokens/KB）。

> ★ **另有一条与省钱无关的价值**：目录把**全部**工具（含你记不住的冷门工具）列成一行清单 ——
> 这解决的是「几百个工具里注意力漂移、只用记得住的那几个」，**跟省不省钱是两件事**。
