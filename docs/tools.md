<p align="right"><a href="tools.en.md"><b>English</b></a></p>

# dsh-zotero 工具参考

dsh-zotero 注册 11 个工具（写入三工具需在设置中开启 `writeEnabled`，默认关闭），通过本地 Zotero HTTP API 操作用户的文献库。所有 ref 均为 `zotero://user/0/item/<KEY>`（个人库）或 `zotero://group/<ID>/item/<KEY>`（群组库）格式的稳定标识符，个人库恒为 `user/0` canonical。

---

## zotero_search

在文献库中发现候选条目。metadata 模式搜索标题/作者/年份，everything 模式同时搜索全文索引。

### 参数

| 参数             | 类型                           | 默认值              | 说明                                                                                                                |
| ---------------- | ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `query`          | string                         | —                   | 自由文本查询；省略则浏览全库                                                                                        |
| `mode`           | `"metadata"` \| `"everything"` | `"metadata"`        | 搜索范围                                                                                                            |
| `scope`          | object                         | `{kind: "library"}` | `{kind:"library"}` / `{kind:"collection", refOrName}` / `{kind:"savedSearch", refOrName}` / `{kind:"publications"}` |
| `library`        | object                         | —                   | 库：`{type:"user",id:0}` 或 `{type:"group",id}`；`scope` 为 name 时作解析上下文，`ref` 时必须一致                   |
| `itemTypes`      | string[]                       | —                   | Zotero 条目类型名（如 `journalArticle`），OR 组合                                                                   |
| `tags`           | string[]                       | —                   | 标签名，`tagMatch` 控制 AND/OR                                                                                      |
| `tagMatch`       | `"all"` \| `"any"`             | `"all"`             | 多标签组合：`all`=AND，`any`=OR                                                                                     |
| `excludeTags`    | string[]                       | —                   | 需排除的标签（NOT）                                                                                                 |
| `includeTrashed` | boolean                        | `false`             | 是否包含已删除条目（仅 `library` scope 允许）                                                                       |
| `sort`           | string                         | `"dateModified"`    | 排序字段：`dateModified` / `dateAdded` / `date` / `title` / `creator`                                               |
| `direction`      | `"asc"` \| `"desc"`            | `"desc"`            | 排序方向                                                                                                            |
| `offset`         | integer                        | `0`                 | 分页偏移                                                                                                            |
| `limit`          | integer                        | `10`                | 返回数量上限（受 `maxSearchResults` 限制，默认 20）                                                                 |

### 输出

`scope`（`library` scope 含 `library` 字段，便于分页回放）, `items`（仅主结果：ref, title, creatorSummary, year, itemType, parentRef, bestAttachmentRef, bestAttachmentType, attachmentSize）, `total`, `offset`, `returned`, `nextOffset`, `supplemental`（可选：`{kind:"noteBody", items, scanned, truncated}`）

### 注意事项

首次查询（offset 0）且 scope 为 `library`/`collection` 时（`savedSearch` 不扫描），客户端扫描笔记正文，命中的笔记列入 `supplemental.items`（按 dateModified 降序、最多填满 `limit` 剩余额度、受 `maxNoteScanRecords` 限制）。`items`/`total`/`returned`/`nextOffset` 只描述主结果集合，`returned` 永远不会大于 `total`；collection scope 下子笔记通过父条目判定归属（子笔记自身不携带 collections）。`tagMatch` 必须与 `tags` 同现，否则报参数错误。

### 示例

```
zotero_search(query="transformer attention", mode="everything", tags=["deep-learning"], limit=5)
```

---

## zotero_get

读取单个条目的完整元数据。默认仅返回元数据；指定 `include` 后额外读取子内容：`notes`/`attachments` 走裸 `/children`（仅笔记与附件），`annotations` 另走 `/children?itemType=annotation`——Zotero 本地 API 的裸 `/children` **从不**返回批注（批注挂在 PDF 附件下）。

### 参数

| 参数      | 类型                                        | 必填 | 说明                                                                                                       |
| --------- | ------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| `ref`     | string                                      | ✓    | 条目 ref                                                                                                   |
| `include` | `("notes"\|"annotations"\|"attachments")[]` | —    | 需要包含的子内容类型                                                                                       |
| `fields`  | `"standard"` \| `"all"`                     | —    | 返回字段集合：`standard`（默认）返回规范化字段模型；`all` 额外返回 `extraFields`（保留特殊条目的原生字段） |

### 输出

`ref`, `itemType`, `title`, `creators`, `date`, `year`, `venue`, `doi`, `url`, `abstract`, `abstractTruncated`, `noteBody`（笔记条目）, `tags`, `collections`, `children`, `bestAttachment`, `relations`（如 `dc:relation` 等，`targetRef` 仅同库可证时出现）, `fields="all"` 时的 `extraFields`, 以及请求的 `notes`/`annotations`/`attachments`（含 total、returned、items）

### 示例

```
zotero_get(ref="zotero://user/0/item/ABC123", include=["notes", "annotations"])
```

---

## zotero_retrieve

为单个条目收集并按查询排序证据段落。来源包括：Zotero 批注（带页码）、笔记、摘要、全文分块（BM25 排序）。

### 参数

| 参数               | 类型     | 默认值    | 说明                                                    |
| ------------------ | -------- | --------- | ------------------------------------------------------- |
| `ref`              | string   | —         | 条目 ref（必填）                                        |
| `query`            | string   | —         | 用于排序证据的查询词（必填）                            |
| `sources`          | string[] | 全部 4 种 | `annotation` / `note` / `abstract` / `fulltext`         |
| `passages`         | integer  | `4`       | 返回段落数上限（受 `maxEvidencePassages` 限制，默认 4） |
| `attachmentPolicy` | string   | `best`    | 全文来源：`best` / `allIndexed` / `specified`           |
| `attachmentRefs`   | string[] | —         | `specified` 必填：参与排名的附件 ref 列表               |

### 输出

`ref`, `attachmentRef`, `attachmentContentType`, `coverage`（indexedChars/totalChars/complete 等）, `attachments`（多附件策略下逐个附件的事实：`ref`, `contentType?`, `status`, `coverage?`, `inputTruncated?`, `passages?`——这是全文来源清单，不是 `zotero_get`/`zotero_children` 的子附件行）, `evidence`（source, sourceRef, attachmentRef, text, chunkIndex, chunkCount, comment, pageLabel, matchedFields）, `truncated`, `sourcesSkipped`

### 注意事项

- 仅 Zotero 批注携带页码标签，全文段落不会有虚构的页码
- 不可用的来源跳过并在 `sourcesSkipped` 中报告，不视为错误
- 只有 `annotation` 来源有 `pageLabel`；全文段落永远不携带页码
- `truncated` 为 true 表示有更多证据被截断：超出段落数或字符预算的段落整段省略、不做改写。预算按"模型实际读到的内容"计费——段落正文，加上批注的评论
- `attachmentPolicy="specified"` 的每个附件都必须能证明属于 `ref` 这条条目：`parentItem` 指向它、库与 Zotero 实例一致、回答中确有 `itemType: "attachment"`。任一条件无法证明即报错，不会退化成"同 key 的另一个对象"——跨条目或跨实例的附件不会进入当前条目的证据
- 重复的 ref 只读一次；单次调用最多 16 个附件，超限报错而不是静默丢弃（拆成多次调用）
- 需要另一条目的全文时按该条目单独调用 `zotero_retrieve`，而不是把它挂到当前条目的证据里
- 排序用的词元与 Zotero 搜索使用同一套折叠（音调符号、排版引号/破折号、NFKD 分解），所以 `cafe` 能命中正文里的 `café`；返回的段落文本始终是原文，不被改写
- 批注按"高亮原文 + 读者评论"一起参与排序，所以只写了评论、没有选中文字的批注也能被检索到；`matchedFields` 标明命中来自 `text` 还是 `comment`，只有评论命中时结果会明确提示那是批注者的话、不是论文原文（其余来源只有单一文本字段，不带该字段）
- 多附件策略（`allIndexed` / `specified`）下 `attachments` 逐个列出这次真正考虑的全文来源：`indexed`（读到全文，附 `coverage`、`passages`、是否被字符预算截断）、`unindexed`（Zotero 索引里没有该文件）、`unread`（本次达到附件上限未读）。因此"补充材料没有索引"表现为明确缺口，而不是"其中没有相关内容"
- `maxFulltextChars` 是**单次调用**的全文输入预算，在本次读取的附件之间均分：单个附件时即全额；多附件时各自按份内额度截断，并在 `attachments[].inputTruncated` 与 `truncated` 上报告。单次调用最多读取 16 个附件（见上）

### 示例

```
zotero_retrieve(ref="zotero://user/0/item/ABC123", query="attention mechanism", sources=["annotation", "fulltext"], passages=6)
```

---

## zotero_attachment

将 ref 解析为可访问的附件位置。接受条目 ref（自动选择最佳附件）或附件 ref（精确指定）。

### 参数

| 参数  | 类型   | 必填 | 说明                |
| ----- | ------ | ---- | ------------------- |
| `ref` | string | ✓    | 条目 ref 或附件 ref |

### 输出

判别联合类型：

- `{kind: "file", path, ref, title, contentType}` — 本地文件（经异步 `stat` 验证存在）。路径属于运行 Zotero 的那台机器；在沙箱、容器或远程主机中读取文件的调用方可能看不到它，渲染结果会注明该环境
- `{kind: "url", url, ref, title, contentType}` — 链接型附件

条目 ref 首先跟随 Zotero 的 best-attachment 链接，回退到最早的 PDF 子项。文件型位置经异步 stat 验证存在后再返回。

### 示例

```
zotero_attachment(ref="zotero://user/0/item/ABC123")
```

---

## zotero_export

生成引用或格式化导出。

### 参数

| 参数     | 类型     | 默认值    | 说明                                                                            |
| -------- | -------- | --------- | ------------------------------------------------------------------------------- |
| `refs`   | string[] | —         | 条目 ref 列表（必填），受 `maxExportRefs` 限制（默认 50）                       |
| `format` | string   | —         | `citation` / `bibliography` / `bibtex` / `biblatex` / `ris` / `csljson`（必填） |
| `style`  | string   | 配置值    | CSL 样式 ID（仅 citation/bibliography）                                         |
| `locale` | string   | `"en-US"` | CSL 区域设置（仅 citation/bibliography）                                        |

### 输出

| format                              | 输出结构                                                     |
| ----------------------------------- | ------------------------------------------------------------ |
| `citation`                          | `{citations: [{ref, text}]}`                                 |
| `bibliography`                      | `{text}`                                                     |
| `bibtex`/`biblatex`/`ris`/`csljson` | `{text, items: [{ref, key, title, entryIndex, start, end}]}` |

### 注意事项

- `citation` 模式自动按 Zotero 的 50 键上限分批请求
- `bibtex`/`biblatex`/`ris`/`csljson` 每次调用最多 50 条，超出需分批
- 导出文本永远不会被截断——超过 `maxExportChars`（默认 1M）会报错
- 单次导出仅允许同一 `library` 的 refs，跨库（`user/0` + `group` 或不同 `group`）会 `INVALID_ARGUMENT` 且 0 次 HTTP

### 示例

```
zotero_export(refs=["zotero://user/0/item/ABC123", "zotero://user/0/item/DEF456"], format="bibtex")
```

---

## zotero_browse

发现库结构。所有 `kind` 均 `offset/limit` 分页（默认 `20`，受 `maxBrowseResults` 限制 50），返回 `total/returned/nextOffset`。

分页诚实性对所有服务端分页列表端点统一生效：`zotero_search` 以及 `zotero_browse` 的 `collections`、`savedSearches`、`tags` 数组型列表读取要求响应携带合法的 `Total-Results` 头，缺失或非法时整个调用以 `ZOTERO_UNEXPECTED` 失败，而不是用响应体长度猜测总数；`libraries`、`itemTypes`、`itemFields` 是本地构建的完整清单，直接以已读行数作为 `total`。`zotero_changes` 走另一条路：它按资源整批读取（不带 `limit`，本地 API 对无上限请求返回全集；条目种类是 `/items`、`/items/top`、`/items/trash` 三个端点各整批读一次），`Total-Results` 存在时用它与 map 键数比对来判定这一批是否读全，缺失时按「无上限请求即全集」信任；列表本身按 `maxChangesResults` 截断，真实条数进 `totals`；渲染给模型的就是这份列表的全部，不再二次截断——超出上限的部分要读就得提高 `maxChangesResults`，而不是换个参数重试。响应体不是 key→version map（如数组、字符串，或值不是非负整数）时不当作「没有变化」：该种类记为不可读（`unobservable` 的 `unreadable`）并否决本次游标。

| 参数            | 类型                                                                           | 默认值               | 说明                                                                                      |
| --------------- | ------------------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------- |
| `kind`          | `libraries`\|`collections`\|`savedSearches`\|`tags`\|`itemTypes`\|`itemFields` | —                    | 浏览类型（`itemFields` 需 `itemType`）                                                    |
| `library`       | object `{type, id}`                                                            | `user/0`             | 目标库（`collections/savedSearches/tags` 有效；`libraries/itemTypes/itemFields` 拒绝）    |
| `parentRef`     | string                                                                         | —                    | 仅 `collections`：父集合 ref，列出其直接子集合；省略则列出顶层集合                        |
| `tagScope`      | `"library"`\|`"collection"`\|`"publications"`                                  | `"library"`          | 仅 `tags`：标签统计作用域；`collection`/`publications` 调用作用域端点                     |
| `tagCollection` | string                                                                         | —                    | 仅 `tags` 且 `tagScope="collection"`：集合 ref 或精确名称                                 |
| `itemLevel`     | `"top"`\|`"all"`                                                               | `"top"`              | 仅有作用域的 `tags`：`top` 仅统计文献条目（默认），`all` 包含子条目                       |
| `itemQuery`     | string                                                                         | —                    | 仅有作用域的 `tags`：仅统计匹配该查询词的条目标签（用于搜索后发现分面）                   |
| `itemQueryMode` | `"titleCreatorYear"`\|`"everything"`                                           | `"titleCreatorYear"` | 仅有 `itemQuery` 的 `tags`：查询匹配模式                                                  |
| `itemType`      | string                                                                         | —                    | 仅 `itemFields`：需要查询有效字段及创作者类型的 Zotero 条目类型（如 `dataset`, `patent`） |
| `q`             | string                                                                         | —                    | `tags` 时 substring 过滤                                                                  |
| `match`         | `contains`\|`startsWith`                                                       | `contains`           | `tags` 时 `q` 的匹配方式（需 `q`）                                                        |
| `offset`        | integer                                                                        | `0`                  | 分页偏移                                                                                  |
| `limit`         | integer                                                                        | `20`                 | 返回上限                                                                                  |

### 输出

- `libraries`：`{library, name}`（个人库固定 `My Library`，群组名来自 `GET /users/0/groups`，`serverId` 在顶层）
- `collections`：`{ref, name, parentRef?, path: string[], depth}`（完整集合图共享 30s TTL 快照——面包屑需要全部祖先；`path` 为根到叶子）
- `savedSearches`：`{ref, name, conditions?}`（`conditions` 为 Zotero 的条件行数组（非该形状时按缺省处理）；服务器端 `start/limit` 分页，缺 `Total-Results` 头则 fail-closed）
- `tags`：`{tag, count?}`（`count` 仅服务端提供时；服务器端分页）
- `itemTypes`：`{itemType, localized?}`
- `itemFields`：给定 `itemType` 的 `{field, localized?}` 或 `{creatorType, localized?}`

各 `kind` 的行结构在工具 output schema 中以判别式 `oneOf` 声明；`collections` 渲染为 `A / B / C — ref` 面包屑，`tags` 带 `— N items`，`savedSearches` 带 `— N conditions`。`q` 提供时必须非空白，否则报参数错误。

### 示例

```
zotero_browse(kind="collections", library={type:"group", id:42}, limit=20)
zotero_browse(kind="tags", q="review", match="contains")
```

---

## zotero_children

探索条目或附件的子对象。条目 ref：直接笔记与附件来自裸 `/children`；批注（挂在 PDF 下而非条目下）仅来自 `/children?itemType=annotation`。附件 ref：经同一过滤接口返回该文件自身的批注。先用它枚举结构，再用 `zotero_get` 读完整元数据。

### 参数

| 参数      | 类型     | 必填 | 说明                                                                              |
| --------- | -------- | ---- | --------------------------------------------------------------------------------- |
| `ref`     | string   | ✓    | 条目 ref 或附件 ref                                                               |
| `include` | string[] | —    | `notes` / `attachments` / `annotations`（省略返回全部三类；显式空数组报参数错误） |

### 输出

`{ref, itemType?, serverId?, notes?, attachments?, annotations?}`，每类为 `{total, returned, items}`。笔记项含 `parentRef`（产生它的父条目 ref）。`attachments` 行是子对象清单（`ref`, `title`, `contentType`, `linkMode?`），与 `zotero_retrieve` 里按全文策略列出的 `attachments` 行（`status`/`coverage`/`passages`）不是同一结构。

### 示例

```
zotero_children(ref="zotero://user/0/item/ABC123", include=["annotations"])
```

---

## zotero_changes

查看库的增量变化。在核验过的 Zotero 10.0.2-beta.9 上，版本号是本地事务版本——每次对象保存都会递增库计数器并给该对象盖章（Zotero 源码 `dataObject.js` 的 `_finalizeSave`），删除只递增计数器。插件不按 Zotero 版本号猜语义，而是在每次调用里按响应本身判定：拿不到库版本就报 `versionUnavailable`（该构建无法做增量），某类资源读不到就在 `unobservable` 里点名并说明原因。不带 `since` 调用先取基线，它给出一个**游标**：版本号连同它所属的实例与库。下次把该游标原样作为 `since` 传回即得差异。

**条目空间按 Zotero 自己的划分读取**：`items` 一项覆盖三个端点——`/items/top`（顶层条目）、`/items`（全部活动条目）与 `/items/trash`（回收站），分别列为 `changed.items`、`changed.childItems`、`changed.trashedItems`。子对象（笔记、附件、批注）是 `/items` 与 `/items/top` 的差集：它们有自己的版本，编辑一条批注会推进库版本却不动任何顶层条目，只读 `/items/top` 的增量会静默漏掉它；Zotero 的条目列表同样排除回收站，不读 `/items/trash` 就看不到「移入回收站」这一变化。三者缺一时整个种类列为不可观测，而不是把条目空间的一部分当作全部报出去。

**游标契约**：`cursor` 出现即安全——它表示该调用已把报告范围内的变更整批读完，且读取期间库版本没有前进，因此可以直接作为下次 `since`。读不全（该构建给响应加了上限）或读取期间有写入时不返回 `cursor`（后者另带 `libraryChanged: true`），此时不要从这次结果推进游标。游标只覆盖产生它的那次调用 `include` 的资源种类。对单一资源而言，`unobservable` 里的 `not-served`（该构建没有这个端点）与 `range-not-covered`（范围早于该构建保留的删除日志）**不**否决游标——这些变更本来就不在任何区间可观测；`unreadable`（响应形状不合约）则否决，因为数据存在、只是这次调用没读到。`items` 种类更严格：顶层条目、活动条目和回收站三个分区必须全部读到；任一分区失败都不返回游标，避免后续 diff 跳过子对象或回收站变更。

**删除的读法**：`deleted` 出现即已观测——四个列表（`items`/`collections`/`savedSearches`/`tags`，最后一个存标签名而非 key）在读取成功时总是存在，全空即正面陈述「本区间没有删除」；端点 404（本机 Zotero 10.0.2-beta.9 没有 `/deleted` 路由）或响应形状不合约时 `deleted` 整体缺席，并在 `unobservable` 里点名，绝不把「没读到」写成「没有删除」。文档化的四类之外的墓碑条目（Zotero 自己也同步一份 settings 列表）计数进 `totals.deletedOther`。

**游标带身份**：版本号是某一个库的事务计数器，同一个数字在另一个 Zotero 实例或另一个库里毫无关系，所以游标里带着 `serverId` 与 `library`，而且不接受裸版本号。用它做 `since` 时：这份实例身份会作为 `Zotero-Server-ID` 请求头随每个请求发出，服务端不匹配就 412，插件报 `ZOTERO_SERVER_MISMATCH`（客户端重建、设置热更新、宿主重启后同样成立，因为校验不依赖插件内存）；游标里的库与本次调用的 `library` 不一致则在发起任何请求前以 `ZOTERO_INVALID_ARGUMENT` 拒绝。

**fulltext 不在默认集合内**：`/fulltext?since=` 过滤的是 `fulltextItems.version`，那是全文索引自己的计数器（`fulltext_<libraryID>`，见 Zotero `fulltext.js`），不是库版本——真机核验（Zotero 10.0.2-beta.9）：`since=0` 与 `since=<库版本>` 返回同一批行，且该端点不返回任何版本头。因此这些行是一份清单而不是库版本上的增量，只有显式点名 `fulltext` 时才读取。

### 参数

| 参数      | 类型     | 默认值           | 说明                                                                                                                          |
| --------- | -------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `library` | object   | —                | `{type, id}`，省略默认个人库 `user/0`                                                                                         |
| `since`   | object   | —                | 起始游标 `{serverId, library, version}`：把早先结果的 `cursor` 原样传回；不接受裸版本号；省略取基线                           |
| `include` | string[] | 除 fulltext 现有 | `items`（顶层条目 + 子对象 + 回收站，分列）/ `collections` / `savedSearches` / `fulltext` / `deleted`（显式空数组报参数错误） |

### 输出

`{library, serverId?, fromVersion?, cursor?, libraryChanged?, versionUnavailable?, changed: {items?, childItems?, trashedItems?, collections?, savedSearches?, fulltextAttachments?}, deleted?: {items, collections, savedSearches, tags}, totals?, unobservable?: {kind, reason}[], truncated?}`。每种资源整批读取（条目是三个端点各整批读一次），但每个列表按 `maxChangesResults`（默认 50）截断，`truncated` 表示列表是摘要；`totals` 给出每种资源（含 `childItems`/`trashedItems`/`deletedItems`/`deletedCollections`/`deletedSavedSearches`/`deletedTags`/`deletedOther`）被截断前的真实条数——某个计数出现即表示该种类读过，读没读过不必从列表是否为空去猜。`unobservable` 的每项带原因：`not-served`（该构建没有这个端点，如本机 Zotero 10.0.2-beta.9 没有 `/deleted` 路由）、`range-not-covered`（`since` 早于该构建保留的删除日志，409）、`unreadable`（响应形状不是文档化的那个，本次没读到，游标也不归还）。对 `items` 种类，`/items`、`/items/top` 或 `/items/trash` 任一分区失败也不返回游标；`fulltext` 使用独立计数器，因此包含 fulltext 的结果明确不返回库游标。

### 示例

```
zotero_changes()
zotero_changes(since={serverId: "<from cursor>", library: {type: "user", id: 0}, version: 1234}, include=["items", "deleted"])
```

---

## zotero_create_note

创建研究笔记：独立笔记，或挂到某条目下的子笔记，创建时可同时带标签、合集与来源关系。markdown 由插件转换为 Zotero 笔记 HTML——白名单语法（段落、一至四级标题、粗斜体、行内与围栏代码、引用、一层列表、带 `---` 分隔行的管道表格、仅 `https://`/`http://`/`zotero://` 链接），**语法之外的任何内容一律转义为字面文本，原始 HTML 不透传**。Zotero 服务端对写入不做格式转换，markdown 原样存入就会显示为原始标记（社区集成踩过的坑），所以转换发生在插件侧。子笔记继承父条目的合集，只有独立笔记可携带 `collections`；子笔记再传非空 `collections` 会在计划卡前被拒绝。来源以 `dc:relation` 关系记录（Zotero 的"关联条目"），创建后从批量写响应的 `successful` 桶读回保存态，无需再发 GET。每次写入都先展示计划卡片等待批准（这个确认没有关闭开关）；Zotero 10 首次写入还会弹它自己的授权对话框（允许 / 总是允许 / 拒绝，默认拒绝）。

### 参数

| 参数          | 类型     | 默认值 | 说明                                                                                                                                                 |
| ------------- | -------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `markdown`    | string   | —      | 笔记正文（markdown，上限 65536 字符）                                                                                                                |
| `parentItem`  | string   | —      | 个人库父条目 ref（`zotero://user/0/item/<KEY>`）；省略为独立笔记                                                                                     |
| `collections` | string[] | —      | 个人库合集 ref（`zotero://user/0/collection/<KEY>`）或精确名称；仅独立笔记，子笔记再传非空 collections 会在计划卡前以 `ZOTERO_INVALID_ARGUMENT` 拒绝 |
| `tags`        | string[] | —      | 创建时应用的标签                                                                                                                                     |
| `sourceRefs`  | string[] | —      | 个人库来源条目 ref（`zotero://user/0/item/<KEY>`），记为 `dc:relation` 关系并回显                                                                    |

### 输出

`{kind: "applied", ref, key, version, parentItem?, collections, tags, sourceRefs, libraryVersion, serverId?}`。若写入结果必须按已提交处理、但响应无法证明完整状态，则返回 `{kind: "committed-unverified", committed: true, retryable: false, reason: "saved-state-unverified" | "commit-unknown", ref?, key?, version?, libraryVersion?, serverId}`；不要重试，按可用的 key/ref 核对。`kind: "declined"` 表示用户在计划卡片上未批准——未写入任何内容，这是正常结果而非错误，不要重试。

### 示例

```
zotero_create_note(markdown="**方法**：见第 2 节。", parentItem="zotero://user/0/item/ABCD1234", tags=["综述"], sourceRefs=["zotero://user/0/item/EFGH5678"])
```

---

## zotero_add_tags

给一个条目加标签。Zotero 的 PATCH 对数组是整体替换而非合并，所以工具内部读-合并-写：先读条目现有标签与版本，把新增项并入（既有标签及其彩色/自动类型原样保留）后以 `If-Unmodified-Since-Version` 前置提交；所请求标签全部已存在时**不发任何写请求**，直接返回 `unchanged: true`。版本前置失败（对象在读取后被改动）报 `ZOTERO_WRITE_CONFLICT`——重跑一次工具即可，它会重新读取并在其上合并。每次写入都先展示计划卡片等待批准（这个确认没有关闭开关）。

### 参数

| 参数   | 类型     | 默认值 | 说明                                                     |
| ------ | -------- | ------ | -------------------------------------------------------- |
| `ref`  | string   | —      | 要打标签的个人库条目 ref（`zotero://user/0/item/<KEY>`） |
| `tags` | string[] | —      | 要新增的标签（≥1 个，≤50 个；自动去重）                  |

### 输出

`{kind: "applied", ref, version, tags, added, unchanged, libraryVersion?, serverId?}`。`tags` 是合并后的完整列表，`added` 是本次真正新增的部分。

### 示例

```
zotero_add_tags(ref="zotero://user/0/item/ABCD1234", tags=["综述", "待读"])
```

---

## zotero_add_to_collection

把一个条目加入合集（ref 或精确名称）。合集名称在执行时通过本地 API 解析（未知名称在任何读写修改发生前报 `ZOTERO_NOT_FOUND`），随后与标签相同的读-合并-写：条目已有合集原样保留，合并后带版本前置提交；条目已是成员时 `added: false` 且不写。

### 参数

| 参数         | 类型   | 默认值 | 说明                                                     |
| ------------ | ------ | ------ | -------------------------------------------------------- |
| `ref`        | string | —      | 要加入合集的条目 ref                                     |
| `collection` | string | —      | 合集 ref（`zotero://user/0/collection/<KEY>`）或精确名称 |

### 输出

`{kind: "applied", ref, version, collections, added, libraryVersion?, serverId?}`。`collections` 是加入后的完整合集列表。

### 示例

```
zotero_add_to_collection(ref="zotero://user/0/item/ABCD1234", collection="方法论")
```

---

## 写入边界

三个写入工具只在设置的 `writeEnabled` 打开时注册，且都只写 `zotero://user/0/`（个人库）。每次写入前都展示 dsh 侧计划卡片，没有任何设置能跳过它。参数校验在计划卡之前完成，畸形调用不会被当作「未批准」。

**闸门在服务接缝上。** 计划审查是 `ctx.zotero.createNote` / `updateTags` / `addToCollection` 的组成部分。工具与其他消费方都必须传入 `ZoteroWriteCall`（计划文本，以及发起调用的 agent 与 signal）。服务先过能力门（关闭时返回 `ZOTERO_CAPABILITY_UNAVAILABLE`，不弹卡），再向用户提问。未批准返回 `{kind:"declined"}`，不发送任何请求；没有可用交互通道时失败关闭（`ZOTERO_WRITE_APPROVAL_UNAVAILABLE`）。任何调用方都必须经过这道闸门。

**Zotero 10 的授权层是硬边界**（对照源码 `server_localAPI.js`，10.0.3-beta.3）：写请求必须携带实例 id（缺失 428、不匹配 412）与本地签发的 key。`/api/local/authorize` 弹窗三个按钮是「允许」（`remember:false`）、「始终允许」（`remember:true`）、「拒绝」，默认按钮是「拒绝」，该端点限速 5 次/分钟。单次 key 在鉴权阶段即被删除，请求体尚未判定，写失败同样消耗该 key。插件因此只在 401 后重新授权并同批重放一次，这是唯一的自动重试。`remember:true` 的 key 不会被消耗：它保存在 `<Zotero 配置目录>/localAPIKeys.json`，可长期重复使用，直到用户在 Zotero 中清除已保存的授权。「始终允许」等价于一枚长期有效的库写入凭据，写入日志、脚本或对话会泄漏该凭据。

**写路径的请求下限**（由回归测试钉住）：`zotero_create_note` 只发一次 `POST /api/users/0/items`，不回读（批量响应已带回 ref/key/版本）；`zotero_add_tags` 与 `zotero_add_to_collection` 各是一次读加一次 `PATCH`（按名指定合集时再加一次解析）。实例身份与授权在进程内缓存，稳定状态下建一条笔记就是一次请求。

**shell 直写同样需要确认，不另设开关。** 会话内的 `bash` 可以直接 `curl` 本地接口，绕过服务闸门。harness 的审批策略本身只在沙箱升级时提问，`dsh-bash-sandbox` 只约束文件访问、不约束网络。插件不提供「拦截 shell 写入」选项，而是把该路由变成必须确认：`tools/pre-execute` 瀑布检测到命令文本指向 Zotero 本地写入接口（授权端点，或对本机地址带写方法/请求体的请求）时，插件返回 `{kind:"ask"}`，由 harness 的审批请求在工具体执行之前裁决。

- 用户确认（`allowed-once`）→ 只执行这一次
- 拒绝或取消 → 不执行
- 会话审批策略为 `never`（对每次 ask 自动拒绝）→ 不执行
- 没有任何审批通道 → 不执行

检测只读命令文本，属于检测而非保证。下列路径无法覆盖：写入脚本后执行（`bash x.sh`）、命令文本中不出现端点的解释器调用（URL 在运行时拼出时的 `python -c` / `node -e`）、环境变量中的 URL，以及任何混淆写法。命令文本中写明端点的解释器调用仍会被检出（例如 `requests.post('http://127.0.0.1:23119/...')`）。对 `/api/users/` 的写请求在任意 loopback 端口都会被检出，不限于配置端口。系统提示约束模型只使用写工具，这道确认约束路由。若要 shell 完全不能触碰文献库，应让会话不带无约束 shell：按 agent 使用 `tools.restrict({ deny: ["bash"] })`，或使用不含 shell 的预设。被确认放行的原始写入不经过插件写域：无计划卡、无版本前置、无 markdown→note HTML 转换与 provenance。

写入会推进库版本，`zotero_changes` 会看到这批变更。

---

## 错误码

| 错误码                              | 说明                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `ZOTERO_WRITE_UNAUTHORIZED`         | Zotero 拒绝写入授权：key 缺失或失效（401），或用户在授权弹窗拒绝           |
| `ZOTERO_WRITE_APPROVAL_UNAVAILABLE` | 计划审查卡无法发起交互（无用户交互通道或系统级询问异常，非用户决策结果）   |
| `ZOTERO_WRITE_CONFLICT`             | 写入的版本前置失败（412）：对象在读取后被修改，重跑工具即可                |
| `ZOTERO_WRITE_RATE_LIMITED`         | Zotero 对写入授权请求限速（429，含 Retry-After）                           |
| `ZOTERO_NOT_RUNNING`                | Zotero 未运行或本地 API 不可达                                             |
| `ZOTERO_API_DISABLED`               | Zotero 运行中但本地 API 被禁用（403）                                      |
| `ZOTERO_API_VERSION`                | Zotero API 版本不受支持                                                    |
| `ZOTERO_NOT_IMPLEMENTED`            | 本地 API 明确拒绝该请求（501）且非版本问题：端点或输出格式在本构建中不可用 |
| `ZOTERO_SERVER_MISMATCH`            | ref 来自不同的 Zotero 实例                                                 |
| `ZOTERO_NOT_FOUND`                  | 引用的条目、集合或保存搜索不存在                                           |
| `ZOTERO_RANGE_UNSUPPORTED`          | 服务端未保留所请求版本至今的变更历史（409）                                |
| `ZOTERO_NO_ATTACHMENT`              | 条目没有指定类型的附件                                                     |
| `ZOTERO_NO_FULLTEXT`                | 附件没有全文索引                                                           |
| `ZOTERO_FILE_MISSING`               | Zotero 报告的本地文件在磁盘上不存在                                        |
| `ZOTERO_INVALID_REF`                | ref 字符串不符合 `zotero://` 语法或引用了不支持的库                        |
| `ZOTERO_INVALID_ARGUMENT`           | 参数违反了 schema 无法表达的领域约束                                       |
| `ZOTERO_SCOPE_AMBIGUOUS`            | 集合或保存搜索名称匹配到多个对象                                           |
| `ZOTERO_TIMEOUT`                    | 提供方自身超时                                                             |
| `ZOTERO_RESPONSE_TOO_LARGE`         | 响应流式传输超出资源限制                                                   |
| `ZOTERO_OUTPUT_TOO_LARGE`           | 导出输出超过提供方硬上限                                                   |
| `ZOTERO_CAPABILITY_UNAVAILABLE`     | 提供方未声明所需能力                                                       |
| `ZOTERO_PROVIDER_UNAVAILABLE`       | 配置的提供方未注册，或声明了能力却未实现对应方法                           |
| `ZOTERO_UNEXPECTED`                 | 响应无法解析或行为异常                                                     |
