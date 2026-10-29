<p align="right"><a href="tools.en.md"><b>English</b></a></p>

# 工具参考

dsh-zotero 注册 23 个本地工具（8 个读工具 + 15 个写工具），通过本地 Zotero HTTP API 与文献库交互。其中 15 个写入工具默认关闭，需在设置中显式启用 `writeEnabled`，且只操作个人库（`zotero://user/0/`）。另有 7 个学术检索工具属于单独的 `dsh-zotero/scholarly` 组件，随包发布但默认关闭；启用该组件即启用这些工具。所有文献引用（ref）均为 `zotero://user/0/item/<KEY>`（个人库）或 `zotero://group/<ID>/item/<KEY>`（群组库）格式的稳定标识符。

---

## zotero_search

检索文献库中的条目。支持元数据匹配与全文检索模式。

### 参数

| 参数             | 类型                           | 默认值              | 说明                                                                                                                                                      |
| ---------------- | ------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`          | string                         | —                   | 自由文本查询词；省略则浏览全部条目                                                                                                                        |
| `mode`           | `"metadata"` \| `"everything"` | `"metadata"`        | 搜索模式：`metadata` 匹配标题/作者/年份；`everything` 同时检索全文索引                                                                                    |
| `scope`          | object                         | `{kind: "library"}` | 搜索范围：`{kind:"library"}`、`{kind:"collection", refOrName}`、`{kind:"savedSearch", refOrName}` 或 `{kind:"publications"}`（`publications` 仅限个人库） |
| `library`        | object                         | —                   | 目标库：`{type:"user", id:0}` 或 `{type:"group", id}`；当 `scope` 传名称时用于指定上下文                                                                  |
| `itemTypes`      | string[]                       | —                   | Zotero 条目类型列表（如 `journalArticle`），按 OR 组合                                                                                                    |
| `tags`           | string[]                       | —                   | 标签列表，由 `tagMatch` 决定组合逻辑                                                                                                                      |
| `tagMatch`       | `"all"` \| `"any"`             | `"all"`             | 多标签匹配逻辑：`all` 为 AND，`any` 为 OR（需与 `tags` 配合使用）                                                                                         |
| `excludeTags`    | string[]                       | —                   | 排除的标签列表（NOT）                                                                                                                                     |
| `includeTrashed` | boolean                        | `false`             | 是否包含回收站中的条目（仅限 `library` 范围）                                                                                                             |
| `itemLevel`      | `"top"` \| `"all"`             | `"top"`             | 条目层级：`top` 仅检索顶层条目；`all` 同时检索子条目与附件（仅 `library`/`collection` 范围；`publications` 与已存搜索为单一列表）                         |
| `sort`           | string                         | `"dateModified"`    | 排序字段：`dateModified`、`dateAdded`、`date`、`title`、`creator`                                                                                         |
| `direction`      | `"asc"` \| `"desc"`            | `"desc"`            | 排序方向                                                                                                                                                  |
| `offset`         | integer                        | `0`                 | 分页偏移量                                                                                                                                                |
| `limit`          | integer                        | `10`                | 返回条目数量上限（受配置项 `maxSearchResults` 限制，默认 20）                                                                                             |

### 输出

返回对象包含：`scope`、`items`（包含 ref、title、creatorSummary、year、itemType、parentRef、bestAttachmentRef、bestAttachmentType、attachmentSize、extra、doi）、`total`、`offset`、`returned`、`nextOffset`，以及可选的 `supplemental`（包含笔记命中内容 `{kind:"noteBody", items, scanned, truncated}`）。在卡片呈现中，若 `extra` 携带 Citation Key（大小写不敏感，含 `citekey` 别名，与导出对齐共用同一语法，取冒号后的首个 token），会以 `[@citekey]` 形式显示。

### 说明

在初次查询（offset 0）且搜索范围为 `library`、`publications` 或 `collection` 时，插件会扫描笔记正文，命中条目列入 `supplemental.items`。`items` 与 `total` 仅统计主结果条目。

### 示例

```text
zotero_search(query="transformer attention", mode="everything", tags=["deep-learning"], limit=5)
```

---

## zotero_get

读取单篇文献的详细元数据与关联子内容。

### 参数

| 参数      | 类型                                        | 必填 | 说明                                                                             |
| --------- | ------------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| `ref`     | string                                      | ✓    | 文献条目 ref                                                                     |
| `include` | `("notes"\|"annotations"\|"attachments")[]` | —    | 需包含的子内容类型                                                               |
| `fields`  | `"standard"` \| `"all"`                     | —    | 返回字段范围：`standard`（默认）返回规范化字段模型；`all` 额外包含 `extraFields` |

### 输出

返回条目详细对象：

- `ref`、`itemType`、`title`；
- `creators`：创作者对象列表（每个创作者包含 `creatorType`，以及可选的 `name`、`firstName`、`lastName`）；
- `extra`：附加元数据（如 Citation Key、arXiv ID、PMID 等）；
- `date`、`year`、`venue`、`doi`、`url`、`abstract`、`abstractTruncated`；
- `tags`、`collections`、`children`、`bestAttachment`、`relations`；
- `fields="all"` 时的原生附加字段 `extraFields`；
- 请求的子项集合：`notes`、`annotations`、`attachments`（包含 total、returned、items）。

### 示例

```text
zotero_get(ref="zotero://user/0/item/ABC123", include=["notes", "annotations"])
```

---

## zotero_retrieve

从单篇文献的多数据源中提取与查询相关的原文片段，并基于 BM25 算法排序。

### 参数

| 参数               | 类型     | 默认值    | 说明                                                      |
| ------------------ | -------- | --------- | --------------------------------------------------------- |
| `ref`              | string   | —         | 文献条目 ref（必填）                                      |
| `query`            | string   | —         | 排序关键词（必填）                                        |
| `sources`          | string[] | 全部 4 种 | 检索源：`annotation`、`note`、`abstract`、`fulltext`      |
| `passages`         | integer  | `4`       | 返回段落数量上限（受 `maxEvidencePassages` 限制，默认 4） |
| `attachmentPolicy` | string   | `"best"`  | 全文附件选取策略：`best`、`allIndexed`、`specified`       |
| `attachmentRefs`   | string[] | —         | 当 `attachmentPolicy="specified"` 时指定的附件 ref 列表   |

### 输出

返回结构包含：`ref`、`attachmentRef`、`attachmentContentType`、`coverage`（全文覆盖信息）、`attachments`（各附件检索状态）、`evidence`（段落列表，每项包含 source、sourceRef、attachmentRef、text、chunkIndex、chunkCount、comment、pageLabel、matchedFields）、`truncated`、`sourcesSkipped`。

### 说明

- 仅 `annotation` 来源包含页码标签（`pageLabel`）；全文段落不提供页码；
- 不可用或未建立索引的来源会记入 `sourcesSkipped`；
- 批注内容将高亮原文与用户评论一并纳入排序，`matchedFields` 标注匹配来源为 `text` 还是 `comment`；
- 多附件策略下，未索引的附件明确标注为 `unindexed`，未读取的附件标注为 `unread`。

### 示例

```text
zotero_retrieve(ref="zotero://user/0/item/ABC123", query="attention mechanism", sources=["annotation", "fulltext"], passages=6)
```

---

## zotero_attachment

将文献或附件 ref 解析为本地文件路径或链接 URL。

### 参数

| 参数  | 类型   | 必填 | 说明                    |
| ----- | ------ | ---- | ----------------------- |
| `ref` | string | ✓    | 文献条目 ref 或附件 ref |

### 输出

联合类型结果：

- 本地文件：`{kind: "file", path, ref, title, contentType}`（路径经异步 `stat` 验证存在）；
- 链接附件：`{kind: "url", url, ref, title, contentType}`。

### 示例

```text
zotero_attachment(ref="zotero://user/0/item/ABC123")
```

---

## zotero_export

文件导出可传 `outputFile`（非空路径，仅适用于书目及 translator 文本格式，不适用于 `citation`）。文件路径按调用会话的当前工作目录解析，由 Harness 文件系统按该会话的沙箱策略写入；写入失败会使工具或后台任务失败。前台、显式后台和超时提升均在文件写入、原始 turn 的交付事件及可选 spill 完成后才结束。若文件已写入而交付发布失败，错误包含实际路径，不自动重试。

生成格式化引用或导出数据文件。

### 参数

| 参数                | 类型     | 默认值     | 说明                                                                                                                                                    |
| ------------------- | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refs`              | string[] | —          | 条目 ref 列表（必填，单次受 `maxExportRefs` 限制，默认 50）                                                                                             |
| `format`            | string   | —          | 导出格式：`citation`、`bibliography`、`bibtex`、`biblatex`、`ris`、`csljson`（必填）                                                                    |
| `style`             | string   | 配置默认值 | CSL 样式标识（仅用于 citation 和 bibliography）                                                                                                         |
| `locale`            | string   | `"en-US"`  | CSL 语言环境（仅用于 citation 和 bibliography）                                                                                                         |
| `run_in_background` | boolean  | `false`    | 是否作为后台任务启动（由 Harness `ctx.jobs` 管理；参数恒定声明，当 `enableRunInBackground=false` 或宿主未挂载 `jobs` 服务时传 `true` 会得到结构化拒绝） |

### 输出

前台同步完成时：

- `citation`：`{citations: [{ref, text}]}`；
- `bibliography`：`{text}`；
- `bibtex` / `biblatex` / `ris` / `csljson`：`{text, items: [{ref, key, title, entryIndex, start, end}]}`。

后台执行（或前台等待超时自动提升）时：
返回 `{kind: "background", jobId}` 或 `{kind: "promoted", jobId, timeoutMs, message}`。任务进度在 Web 会话顶栏与日志中展示，完成后结果写入 Job 产物。

### 说明

- refs 总数先受 `maxExportRefs` 拦截（默认 50）。除 `citation` 外的 5 种格式（`bibliography`、`bibtex`、`biblatex`、`ris`、`csljson`）单次调用最多 50 条，这是 Zotero `itemKey` 请求的上限，超出即报错，不会自动分批；
- `citation` 是唯一会分批的格式：refs 数超过 50 时按 50 一组分批请求。默认 `maxExportRefs` 同为 50，因此需先将该配置调至 50 以上，分批才会实际发生；
- `bibtex`、`biblatex`、`ris`、`csljson` 的批量导出全程使用批处理请求：`ris`、`csljson` 发起 1 次本地 API 批处理请求；`bibtex`、`biblatex` 在此基础上并行发起第 2 次批处理请求，读取条目原始元数据用于字段对齐。返回内容在内存中解析，每条记录按 key 或元数据指纹与 ref 配对，不按位置猜测；无法定位的 ref 在结果中只保留自身。第 2 次元数据请求失败（如 Zotero 返回 5xx）时导出照常完成：正文原样返回，未能配对的 ref 保持仅有 `ref` 的裸形状。调用方取消（abort）不属于这类降级，仍照常抛出。单次调用最多支持 50 条；
- 单次导出仅允许同一 library 的 refs，不支持跨库混合导出。

### 示例

```text
zotero_export(refs=["zotero://user/0/item/ABC123", "zotero://user/0/item/DEF456"], format="bibtex")
zotero_export(refs=["zotero://user/0/item/ABC123", "zotero://user/0/item/DEF456"], format="bibtex", run_in_background=true)
```

---

## zotero_browse

浏览文献库结构与分类元数据。支持分页查询。

### 参数

| 参数            | 类型    | 默认值                  | 说明                                                                                                                    |
| --------------- | ------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `kind`          | string  | —                       | 浏览类别：`libraries`、`collections`、`savedSearches`、`tags`、`itemTypes`、`itemFields`（必填）                        |
| `library`       | object  | `{type: "user", id: 0}` | 目标库（适用于 collections、savedSearches、tags）                                                                       |
| `parentRef`     | string  | —                       | 仅用于 `collections`：父合集 ref；省略则列出顶层合集                                                                    |
| `tagScope`      | string  | —                       | 仅用于 `tags`：统计范围，支持 `library`、`collection`、`publications`（`publications` 仅限个人库）                      |
| `tagCollection` | string  | —                       | 仅用于 `tags` 且 `tagScope="collection"`：合集 ref 或精确名称                                                           |
| `itemLevel`     | string  | `"top"`                 | 仅用于带作用域的 `tags`：`top` 仅统计文献条目；`all` 包含子条目（仅 `library`/`collection` 范围）                       |
| `itemQuery`     | string  | —                       | 仅用于带作用域的 `tags`：仅统计匹配该查询词的条目标签                                                                   |
| `itemQueryMode` | string  | `"titleCreatorYear"`    | 仅用于带作用域的 `tags`：`itemQuery` 的条目查询模式，支持 `titleCreatorYear` 或 `everything`（默认 `titleCreatorYear`） |
| `itemType`      | string  | —                       | 仅用于 `itemFields`：查询字段与创作者类型的条目类型名                                                                   |
| `q`             | string  | —                       | 标签名称的子串过滤词                                                                                                    |
| `match`         | string  | `"contains"`            | 标签过滤匹配方式：`contains` 或 `startsWith`                                                                            |
| `offset`        | integer | `0`                     | 分页偏移量                                                                                                              |
| `limit`         | integer | `20`                    | 返回条目数量上限（受配置项 `maxBrowseResults` 限制，默认 50）                                                           |

### 输出

各 `kind` 返回对应的结构化数组：

- `libraries`：`{library, name}`
- `collections`：`{ref, name, parentRef?, path, depth}`
- `savedSearches`：`{ref, name, conditions?}`
- `tags`：`{tag, count?}`
- `itemTypes`：`{itemType, localized?}`
- `itemFields`：`{field, localized?}` 或 `{creatorType, localized?}`

### 示例

```text
zotero_browse(kind="collections", library={type:"group", id:42}, limit=20)
zotero_browse(kind="tags", q="review", match="contains")
```

---

## zotero_children

列出文献条目或附件的下属子对象。

### 参数

| 参数      | 类型     | 必填 | 说明                                                                    |
| --------- | -------- | ---- | ----------------------------------------------------------------------- |
| `ref`     | string   | ✓    | 文献条目 ref 或附件 ref                                                 |
| `include` | string[] | —    | 包含的子类型：`notes`、`attachments`、`annotations`（省略返回全部三类） |

### 输出

返回 `{ref, itemType?, serverId?, notes?, attachments?, annotations?}`，每类对象包含 `total`、`returned` 与 `items` 列表。

### 说明

若条目在本地无任何下属子条目，底层 `/children` 接口返回空响应时按空子列表处理。

### 示例

```text
zotero_children(ref="zotero://user/0/item/ABC123", include=["annotations"])
```

---

## zotero_changes

基于本地事务版本获取文献库的增量更新与删除记录。

### 参数

| 参数                | 类型     | 默认值                  | 说明                                                                                                                                                    |
| ------------------- | -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `library`           | object   | `{type: "user", id: 0}` | 目标库标识                                                                                                                                              |
| `since`             | object   | —                       | 起始游标 `{serverId, library, version, include, unserved}`；省略则获取初始基线                                                                          |
| `include`           | string[] | 除 fulltext 外全部      | 监测范围：`items`、`collections`、`savedSearches`、`fulltext`、`deleted`                                                                                |
| `run_in_background` | boolean  | `false`                 | 是否作为后台任务启动（由 Harness `ctx.jobs` 管理；参数恒定声明，当 `enableRunInBackground=false` 或宿主未挂载 `jobs` 服务时传 `true` 会得到结构化拒绝） |

### 输出

前台同步完成时返回：
`{library, serverId?, fromVersion?, cursor?, libraryChanged?, versionUnavailable?, changed, deleted?, totals?, unobservable?, truncated?}`。

- `changed`：按资源类型列出变更对象（`items`、`childItems`、`trashedItems`、`collections`、`savedSearches`、`fulltextAttachments`）；
- `deleted`：包含已删除条目的 key 或标签名；
- `cursor`：仅在当前批次完整读取且期间未发生并发写入时返回，用于后续增量请求。`cursor.include` 仅包含当前 Zotero 版本实际支持跟踪的资源类别；未提供对应端点的类别（如缺少 `/deleted` 路由的旧版本）会记入 `cursor.unserved`，不计入覆盖声明，但后续增量请求仍可原样带回；
- `unobservable`：标明因版本或端点限制无法观测的资源类别及原因。端点未提供（`not-served`）不影响游标生成；若存在不支持的键范围（`range-not-covered`）或读取失败（`unreadable`），当前批次将不返回游标，防止推进游标时遗漏未成功读取的变更行。

### 示例

```text
zotero_changes()
zotero_changes(since={serverId: "server1", library: {type: "user", id: 0}, version: 1234, include: ["items", "deleted"], unserved: []}, include=["items", "deleted"])
```

---

## zotero_create_note

创建独立研究笔记或挂载在指定条目下的子笔记。

### Markdown 语法支持

传入的 `markdown` 文本会在写入前转换为 Zotero 7+ 原生支持的受限 HTML 白名单（未知语法均安全退化为字面文本，无属性发明与原始 HTML 穿透）：

- 段落与标题：空行分隔段落，软折行以空格拼接；支持 ATX `#`–`####` 标题（五级及以上保留字面文本）；
- 强调与高亮：`**粗体**`、`*斜体*`（下划线 `_` 保持字面文本以保护变量名）；`==高亮==` 转换为 `<mark>`；
- 数学公式：单行或多行 `$$...$$` 块转换为 `<math-display>`，行内 `$formula$` 转换为 `<math-inline>`（原生 KaTeX 渲染，公式内部保护不被强调标记篡改；货币符号如 `$100` 自动规避）；
- 列表与任务列表：`-`/`*` 无序列表与 `1.`/`1)` 有序列表；支持 `- [ ]` 未完成与 `- [x]` 已完成任务列表（生成带有 Checkbox 控件与 `task-list` 类名的原生列表，支持嵌套）；
- 代码：行内 `` `代码` `` 与 ``` 围栏代码块（内部特殊字符转义，不执行格式化）；
- 引用与表格：`>` 引用段落；带 `---` 分割行的管道表格（表格行遵循 GFM 规范对齐表头：缺失单元格自动补空，多余单元格予以舍弃，表格列数统一以表头为准）；
- 链接与分割线：`[text](url)`（仅限 `https://`、`http://` 与 `zotero://` 协议）；`---` 与 `***` 水平分割线。

### 参数

| 参数          | 类型     | 必填 | 说明                                                                                                                                     |
| ------------- | -------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `parentItem`  | string   | —    | 父文献条目 ref；省略则创建独立笔记。流式生成中应在 `markdown` 前提供元数据字段                                                           |
| `collections` | string[] | —    | 所属合集 ref 或名称（仅限独立笔记；子笔记自动继承父条目合集）                                                                            |
| `tags`        | string[] | —    | 笔记关联的标签列表                                                                                                                       |
| `sourceRefs`  | string[] | —    | 关联来源条目 ref 列表，写入 `dc:relation` 关系（支持个人库与群组库条目，群组条目自动映射至 `http://zotero.org/groups/<id>/items/<key>`） |
| `markdown`    | string   | ✓    | 笔记正文 Markdown（字符上限受 `writeNoteMaxChars` 限制，默认 65536）                                                                     |

### 输出

- 成功创建：`{kind: "applied", ref, key, version, parentItem?, collections, tags, sourceRefs, libraryVersion, serverId?}`；
- 用户在计划卡拒绝：`{kind: "declined"}`；
- 写入提交但状态未核验：`{kind: "committed-unverified", committed: true, retryable: false, reason}`。

### 示例

```text
zotero_create_note(parentItem="zotero://user/0/item/ABCD1234", tags=["综述"], markdown="## 方法总结\n- 要点一\n- 要点二")
```

---

## zotero_update_item_tags

在一次调用中完成条目标签的增删。读-合并-写语义：`add` 与 `remove` 同时生效，已存在的标签及其类型（彩色/自动）保留，`remove` 对同时出现在两个列表中的已存标签优先生效。

### 参数

| 参数     | 类型     | 必填 | 说明                                         |
| -------- | -------- | ---- | -------------------------------------------- |
| `ref`    | string   | ✓    | 目标条目 ref（`zotero://user/0/item/<KEY>`） |
| `add`    | string[] | —    | 要新增的标签；与现有标签合并，重复项折叠     |
| `remove` | string[] | —    | 要移除的标签，精确匹配；不存在的名称被忽略   |

`add` 与 `remove` 之间至少要有一项（受 `writeListMaxItems` 限制，默认 50），否则拒绝。

### 输出

- 实际发生变更：`{kind: "applied", ref, version, tags, added, removed, unchanged: false, libraryVersion, serverId?}`；
- 请求未造成变化：`{kind: "applied", ..., unchanged: true}`，不发起 PATCH，`version` 为读到的版本；
- 计划卡拒绝：`{kind: "declined"}`。

### 示例

```text
zotero_update_item_tags(ref="zotero://user/0/item/ABCD1234", add=["深度学习", "精读"], remove=["待读"])
```

---

## zotero_update_item_collections

在一次调用中完成条目在合集之间的加入与退出。合集参数可以是 `zotero://user/0/collection/<KEY>` ref 或精确名称（`zotero_browse` 可列出）；名称解析失败先于任何写入。

### 参数

| 参数     | 类型     | 必填 | 说明                                            |
| -------- | -------- | ---- | ----------------------------------------------- |
| `ref`    | string   | ✓    | 目标条目 ref                                    |
| `add`    | string[] | —    | 要加入的合集 ref 或精确名称                     |
| `remove` | string[] | —    | 要退出的合集 ref 或精确名称；不存在的归属被忽略 |

`add` 与 `remove` 之间至少要有一项（受 `writeListMaxItems` 限制），否则拒绝。

### 输出

- 实际发生变更：`{kind: "applied", ref, version, collections, added, removed, unchanged: false, libraryVersion, serverId?}`；
- 归属本就一致：`{kind: "applied", ..., unchanged: true}`，不发起 PATCH；
- 计划卡拒绝：`{kind: "declined"}`。

### 示例

```text
zotero_update_item_collections(ref="zotero://user/0/item/ABCD1234", add=["方法论"], remove=["旧合集"])
```

---

## zotero_create_collection

创建合集（顶层或挂在某个父合集之下）。

### 参数

| 参数     | 类型   | 必填 | 说明                                                                          |
| -------- | ------ | ---- | ----------------------------------------------------------------------------- |
| `name`   | string | ✓    | 新合集名称（非空白）；同级同名时拒绝本次写入                                  |
| `parent` | string | —    | 父合集：`zotero://user/0/collection/<KEY>` ref 或精确名称；省略则创建顶层合集 |

### 输出

- 成功创建：`{kind: "applied", ref, key, version, name, parentRef?, libraryVersion, serverId?}`；
- 创建已提交但保存状态无法核验：`{kind: "committed-unverified", committed: true, retryable: false, reason: "saved-state-unverified" | "commit-unknown", ...}`，**不可重试**，请按 key/ref 在 Zotero 中核对；
- 计划卡拒绝：`{kind: "declined"}`。

### 示例

```text
zotero_create_collection(name="田野笔记", parent="方法论")
```

---

## zotero_delete_collection

删除合集。**不可逆**：合集的组织结构被移除，条目仍保留在文献库中，子合集随父合集一起删除。计划卡会先列出该合集的条目数与子合集数（读取失败时显示 `unknown`），删除携带前置读到的库版本。

### 参数

| 参数         | 类型   | 必填 | 说明                                                            |
| ------------ | ------ | ---- | --------------------------------------------------------------- |
| `collection` | string | ✓    | 要删除的合集：`zotero://user/0/collection/<KEY>` ref 或精确名称 |

### 输出

- 删除成功：`{kind: "deleted", ref, key, deleted: true, libraryVersion, serverId?}`；
- 计划卡拒绝：`{kind: "declined"}`。

### 示例

```text
zotero_delete_collection(collection="田野笔记")
```

---

## zotero_create_item

从闭合字段集创建文献条目。Zotero 的 `POST /items` 只接受 Zotero 条目 JSON，因此没有 BibTeX/CSL-JSON 入口，字段逐个装配，闭集之外的内容不会离开本模块。

### 参数

| 参数               | 类型     | 必填 | 说明                                                                                                         |
| ------------------ | -------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| `itemType`         | string   | ✓    | 条目类型：`webpage`、`journalArticle`、`book`、`conferencePaper`、`report`、`thesis`、`document`、`preprint` |
| `title`            | string   | —    | 标题；`title` 与 `url` 至少提供其一                                                                          |
| `url`              | string   | —    | 链接；`title` 与 `url` 至少提供其一                                                                          |
| `date`             | string   | —    | 出版日期（按 Zotero 的存储形式）                                                                             |
| `doi`              | string   | —    | DOI（写入 `DOI` 字段）                                                                                       |
| `abstractNote`     | string   | —    | 摘要                                                                                                         |
| `publicationTitle` | string   | —    | 刊名 / 会议录 / 站点名                                                                                       |
| `creators`         | object[] | —    | 每项含 `creatorType`，以及 `name` 或 `firstName`/`lastName` 组合                                             |
| `tags`             | string[] | —    | 创建后直接写入的标签                                                                                         |
| `collections`      | string[] | —    | 要加入的合集 ref 或精确名称                                                                                  |

### 输出

- 成功创建：`{kind: "applied", ref, key, version, itemType, title?, tags, collections, libraryVersion, serverId?}`；
- 已提交但状态未核验：`{kind: "committed-unverified", committed: true, retryable: false, reason, ...}`，**不可重试**；
- 计划卡拒绝：`{kind: "declined"}`。

### 示例

```text
zotero_create_item(itemType="journalArticle", title="Attention Is All You Need", date="2017", doi="10.48550/arXiv.1706.03762", creators=[{"creatorType": "author", "name": "Vaswani, Ashish"}])
```

---

## zotero_update_note

使用 Markdown 替换现有 Zotero 笔记正文。写入前读取笔记版本，并在 PATCH 中转换为 Zotero 安全 HTML；目标必须是 `itemType="note"`。

支持独立笔记和子笔记，读取版本不要求子对象具有合集字段。创建和更新均在审批前校验原始 Markdown 的 `writeNoteMaxChars` 上限，按 JavaScript 字符串长度计数，包含空白和标记，不自动截断。

### 参数与输出

| 参数       | 类型   | 必填 | 说明               |
| ---------- | ------ | ---- | ------------------ |
| `ref`      | string | ✓    | 笔记条目 ref       |
| `markdown` | string | ✓    | 新的 Markdown 正文 |

成功返回 `{kind: "applied", ref, version, libraryVersion, serverId?}`；拒绝计划卡返回 `{kind: "declined"}`，版本冲突返回 `ZOTERO_WRITE_CONFLICT`。

---

## zotero_update_collection

更新合集名称或父合集。`name` 与 `parent` 均未提供、名称为空、目标不存在、父合集不属于个人库或版本前置条件失效时拒绝写入；`parent` 省略表示保留现有父级，原生调用可传 `null` 将其移到顶层。

### 参数与输出

| 参数         | 类型   | 必填 | 说明         |
| ------------ | ------ | ---- | ------------ |
| `collection` | string | ✓    | 合集 ref     |
| `name`       | string | —    | 新名称       |
| `parent`     | string | —    | 新父合集 ref |

成功返回 `{kind: "applied", ref, version, libraryVersion, serverId?}`；计划卡拒绝返回 `{kind: "declined"}`。

---

## zotero_restore_items

将个人库 Trash 中指定的条目恢复为活动状态。每个条目独立读取版本并 PATCH `deleted: 0`，逐项返回成功或失败，最多 50 项。

### 参数与输出

| 参数   | 类型     | 必填 | 说明                  |
| ------ | -------- | ---- | --------------------- |
| `refs` | string[] | ✓    | 要恢复的条目 ref 列表 |

输出为 `{kind: "restored", restored, failed, serverId?}`；不会自动重试版本冲突。

支持子笔记、子附件和批注。结果正文完整列出成功对象的 ref、版本、库版本，以及失败对象的 ref、错误码和原因；卡片根据实际结果显示恢复数与失败数，部分失败显示警示。

---

## Zotero saved search 工具

`zotero_create_saved_search`、`zotero_update_saved_search`、`zotero_delete_saved_search` 使用 Zotero 原生 saved-search 条件。创建至少需要一个条件；创建响应丢失或回显无法核验时返回 `committed-unverified`（`retryable: false`），必须先按 search ref/key 核对，不能重复创建。

创建参数为 `name` 与 `conditions`（每项含 `condition`、`operator`、`value`）；更新参数为 `search` 以及至少一个 `name` 或 `conditions`；删除参数为 `search`。更新和删除均使用对象/库版本前置条件。

创建的未核验回执区分 `commit-unknown` 和 `saved-state-unverified`，正文和展示元数据保留已知 ref、key、版本与服务器身份。无已知身份时先检查 Zotero，不重复创建。

## scholarly_save_to_zotero

将学术检索结果通过本地写入审批流程保存到个人库。输出为 `declined`、`applied` 或 `committed-unverified` 的联合类型。仅 `applied` 附带成功保存的 `papers`，并保留创建条目的 ref、key、版本、标签、合集与库版本；未核验结果保留原始身份及原因，禁止重试。卡片和会话回放通过持久化的正文与状态元数据区分三种结果。

---

## zotero_update_item

订正条目的标量元数据。字段合法性以 Zotero 的 `itemTypeFields` 为准：某字段不被该条目类型接受时，在任何 PATCH 之前拒绝；值必须是非空文本。写入携带条目版本前置条件（`If-Unmodified-Since-Version`）。

### 参数

| 参数  | 类型   | 必填 | 说明                                                                                     |
| ----- | ------ | ---- | ---------------------------------------------------------------------------------------- |
| `ref` | string | ✓    | 目标条目 ref（`zotero://user/0/item/<KEY>`）                                             |
| `set` | object | ✓    | 至少一个字段：`title`、`date`、`url`、`doi`、`abstractNote`、`publicationTitle`、`extra` |

### 输出

- 实际发生变更：`{kind: "applied", ref, version, changed, libraryVersion, serverId?}`（`changed` 为实际提交的字段名，按字典序）；
- 计划卡拒绝：`{kind: "declined"}`；
- 版本前置失败：`ZOTERO_WRITE_CONFLICT`。对象已被并发修改，重跑一次工具即可（重跑会重新读取版本）。

### 示例

```text
zotero_update_item(ref="zotero://user/0/item/ABCD1234", set={"title": "Attention Is All You Need (2017)", "doi": "10.48550/arXiv.1706.03762"})
```

---

## zotero_delete_library_tags

按名称在全库范围删除标签。**不可逆**：标签会从文献库中的每个条目上移除。计划卡先翻页扫描整个标签列表，再列出每个标签的条目数：列表携带该标签但未给计数时显示 `unknown items`；只有整个列表都未出现的名称才会被列为「确证无效（proven no-ops）」，因此绝不会把第一页之外的标签误判为无效。读取失败时各项显示 `unknown items`，删除仍携带前置读到的库版本；未命中的名称被 Zotero 静默跳过，因此重试是幂等的。

### 参数

| 参数   | 类型     | 必填 | 说明                                                              |
| ------ | -------- | ---- | ----------------------------------------------------------------- |
| `tags` | string[] | ✓    | 要删除的标签名（1..`writeListMaxItems`，单次不超过服务端上限 50） |

### 输出

- 删除成功：`{kind: "deleted", deletedTags, libraryVersion, serverId?}`（`deletedTags` 为按名称排序的请求列表）；
- 计划卡拒绝：`{kind: "declined"}`。

### 示例

```text
zotero_delete_library_tags(tags=["旧标签", "废弃"])
```

---

## zotero_batch_items

在单次调用中批量创建文献、更新标签与合集归属，或将条目及其子笔记、附件和批注移至回收站。条目删除通过版本化 PATCH 将整个对象图标记为已删除，完成后重新读取并核验；部分失败时 `failed.completedRefs` 列出已确认移入回收站的对象。此操作可从 Zotero 回收站恢复，不是永久擦除。所有操作合并为一张计划卡确认；卡片完整列出每个创建请求的全部字段（包括合集归属），不会省略第 11 项及之后的条目。

单次操作总数（创建、更新与删除之和）受 `writeListMaxItems` 限制（默认 50 项）。每项创建的回执按输入索引列出 Zotero 保存后的 ref、key、版本及可用的标题/URL。若某项创建的提交或已保存状态无法核实，它会出现在 `unverified` 中并标记 `retryable: false`；不得再次提交，应按 ref/key 核对。未返回、重复、矛盾或越界的批次索引不会被静默丢弃，而会作为未核实结果报告。单个条目的版本冲突（HTTP 412）会记录到 `failed` 数组中，不影响其余条目执行。

### 参数

| 参数     | 类型     | 必填 | 说明                                                                                                                          |
| -------- | -------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| `create` | object[] | —    | 批量创建的条目列表。每项包含 `itemType`（必填）、`title` 或 `url`，可选提供 `tags`、`collections`、`creators` 等字段          |
| `update` | object[] | —    | 批量更新标签或合集的条目列表。每项包含 `ref`（必填），可选提供 `addTags`、`removeTags`、`addCollections`、`removeCollections` |
| `delete` | string[] | —    | 移至回收站（Trash）的条目 ref 列表（`zotero://user/0/item/<KEY>`）                                                            |
| `reason` | string   | —    | 操作说明，展示在计划卡中                                                                                                      |

`create`、`update` 与 `delete` 至少提供一项，总数不得超过上限。

### 输出

- 批量执行结果：`{kind: "applied", total, created: [...], updated: [...], deleted: [...], unverified: [...], failed: [...], libraryVersion?, serverId?}`；
  - `created`: `[{index, ref, key, version, itemType, title?, url?}]`，字段来自 Zotero 保存后的对象；
  - `updated`: `[{ref, unchanged, addedTags, removedTags, addedCollections, removedCollections}]`
  - `deleted`: `[{ref, key, deleted: true, version, children: [ref...]}]`，列出已核验移入回收站的根条目与所有后代；
  - `unverified`: `[{op: "create", index, committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}]`；
  - `failed`: `[{op, index?, ref?, code, message, completedRefs?}]`，记录单项失败；删除部分完成时 `completedRefs` 列出已确认移入回收站的对象；
- 计划卡拒绝：`{kind: "declined"}`。

### 示例

```text
zotero_batch_items(
  reason="整理机器学习相关文献并清理废弃草稿",
  create=[
    {"itemType": "journalArticle", "title": "Attention Is All You Need", "tags": ["Transformer"]}
  ],
  update=[
    {"ref": "zotero://user/0/item/ABCD1234", "addTags": ["LLM", "Survey"], "removeTags": ["ToRead"]}
  ],
  delete=["zotero://user/0/item/OLD00001"]
)
```

---

## 写入边界与安全机制

写入工具默认不注册，需在配置中显式开启 `writeEnabled`，且仅操作个人库（`zotero://user/0/`）。

1. 双层确认机制：
   - 会话审批策略（`ctx.approval.request`）：遵循会话策略；若策略为 `never` 则自动拒绝。提示文案按影响面区分：普通新增/修改、可恢复的移入回收站、不可撤销的删除；
   - 计划审查卡：向用户展示具体变更内容 Markdown，经用户确认后执行；未获批准返回 `{kind: "declined"}`。计划正文只使用宿主渲染器支持的 Markdown 子集。
2. 本地 API 鉴权：
   - 写操作必须提供 Zotero 本地签发的 API key；
   - 首次写入需在 Zotero 本地授权弹窗中确认（允许、始终允许或拒绝）；
   - 开启 `writePersistKey` 时，“始终允许”签发的持久密钥会安全保存在宿主凭据管理器中。
3. Shell 写入拦截：
   - 监听器检测指向本地 API 的写命令，拦截并提升为 Harness 审批请求，防止未授权脚本修改文献库。

   检测只读命令文本，无法覆盖所有路径。下列路径无法被检出：
   - 写入脚本文件后再执行（`bash build.sh`）；
   - 命令文本中不出现端点的解释器调用（URL 在运行时拼出时的 `python -c '...'`、`node -e '...'`）；命令文本中写明端点的解释器调用仍会被检出；
   - 藏在环境变量、heredoc 或编码中的 URL；
   - 配置端口之外的 loopback 端口（例外：对 `/api/users/` 的写请求与 authorize 调用在任意 loopback 端口都会被检出）；
   - 用户自有的任何二进制。

   系统提示约束模型只使用写工具；绕开写工具的 shell 直写，由上述拦截与审批把关。若要 shell 完全无法触碰文献库，应让会话不带无约束 shell：按 agent 使用 `tools.restrict({ deny: ["bash"] })`，或使用不含 shell 的预设。另外，被确认放行的原始写入完全绕开插件的写域：没有计划卡、没有版本前置、没有 Markdown 到笔记 HTML 的转换，也没有 provenance。这是用户当场确认时接受的代价。

---

## 错误码

| 错误码                              | 说明                                                    |
| ----------------------------------- | ------------------------------------------------------- |
| `ZOTERO_NOT_RUNNING`                | Zotero 未运行或本地端口不可达                           |
| `ZOTERO_API_DISABLED`               | Zotero 运行中，但高级设置中未启用本地 API（403）        |
| `ZOTERO_API_VERSION`                | 本地 API 版本不受支持                                   |
| `ZOTERO_NOT_IMPLEMENTED`            | 本地 API 明确返回 501，端点或格式在本版本中未实现       |
| `ZOTERO_SERVER_MISMATCH`            | 引用的 Server ID 与当前运行的 Zotero 实例不匹配         |
| `ZOTERO_NOT_FOUND`                  | 引用的条目、合集或保存搜索不存在                        |
| `ZOTERO_RANGE_UNSUPPORTED`          | 服务端未保留所请求版本至今的历史记录（409）             |
| `ZOTERO_NO_ATTACHMENT`              | 条目下不存在指定类型的附件                              |
| `ZOTERO_NO_FULLTEXT`                | 附件未建立全文索引                                      |
| `ZOTERO_FILE_MISSING`               | 记录的本地附件文件在磁盘上不存在                        |
| `ZOTERO_INVALID_REF`                | ref 格式不符合 `zotero://` 语法规范或引用了不受支持的库 |
| `ZOTERO_INVALID_ARGUMENT`           | 参数违反领域约束规则                                    |
| `ZOTERO_SCOPE_AMBIGUOUS`            | 合集或保存搜索名称匹配到多个同名对象                    |
| `ZOTERO_TIMEOUT`                    | 提供方请求超时                                          |
| `ZOTERO_RESPONSE_TOO_LARGE`         | API 响应数据流超出读取上限                              |
| `ZOTERO_OUTPUT_TOO_LARGE`           | 导出内容超出字符数上限                                  |
| `ZOTERO_CAPABILITY_UNAVAILABLE`     | 当前 Provider 未声明所需能力                            |
| `ZOTERO_PROVIDER_UNAVAILABLE`       | 配置的 Provider 未注册或方法未实现                      |
| `ZOTERO_UNEXPECTED`                 | 响应数据格式异常或未预期行为                            |
| `ZOTERO_WRITE_UNAUTHORIZED`         | 写入未获授权：密钥缺失、失效或在授权弹窗中被拒绝        |
| `ZOTERO_WRITE_APPROVAL_UNAVAILABLE` | 计划审查卡无法发起交互（无交互通道或系统级异常）        |
| `ZOTERO_WRITE_CONFLICT`             | 写入版本前置条件冲突（412），对象已被外部修改           |
| `ZOTERO_WRITE_RATE_LIMITED`         | Zotero 授权端点限速（429）                              |

---

## 学术文献检索组件工具 (`dsh-zotero/scholarly`)

bundle 组件 `dsh-zotero/scholarly` 随包发布但默认关闭。在插件管理器「包含的组件」中启用该组件即挂载它，并提供以下 7 个模型工具：

### scholarly_search

跨 arXiv、OpenAlex、Crossref、Semantic Scholar、PubMed、Europe PMC 与 DBLP 的多源文献检索。支持语义自动路由、多路 RRF 融合去重，并自动检查当前本地 Zotero 库中的收藏状态。

#### 参数

| 参数          | 类型     | 默认值        | 说明                                                                                                                                  |
| ------------- | -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `query`       | string   | — (必填)      | 检索主题词、论文标题或作者名                                                                                                          |
| `sources`     | string[] | —             | 可选限制检索的数据源列表（`arxiv`、`openalex`、`crossref`、`semanticscholar`、`pubmed`、`europepmc`、`dblp`）；默认按主题语义自动路由 |
| `year_from`   | integer  | —             | 发表起始年份；`sort="date"` 且省略此参数时，默认只取上一年                                                                            |
| `year_to`     | integer  | —             | 发表截止年份                                                                                                                          |
| `open_access` | boolean  | —             | 是否仅返回具有免费开放获取全文的文献                                                                                                  |
| `sort`        | string   | `"relevance"` | 排序方式：`relevance`（相关度）、`date`（最新优先，省略 `year_from` 时默认只取上一年）、`citations`（引用最多优先）                   |
| `categories`  | string[] | —             | arXiv 分类过滤（如 `cs.CL`、`stat.ML`）                                                                                               |
| `limit`       | integer  | `8`           | 返回论文数量上限                                                                                                                      |
| `abstract`    | string   | `"snippet"`   | 摘要展示程度：`none`、`snippet`、`full`                                                                                               |

---

### scholarly_get

通过 DOI、arXiv ID、PMID、PMCID、URL 或精确标题直接聚合获取单篇论文的完整学术图谱元数据（作者、出版物、摘要、引用次数、开放获取全文链接与本地 Zotero 库匹配状态）。

#### 参数

| 参数 | 类型   | 默认值   | 说明                                                                                     |
| ---- | ------ | -------- | ---------------------------------------------------------------------------------------- |
| `id` | string | — (必填) | DOI（如 `10.1038/nature1234`）、arXiv ID（如 `2301.07041`）、PMID、PMCID、URL 或精确标题 |

#### 失败语义

某个索引无法应答（限流、超时、服务错误）时，结果中会以 `Unanswered sources: <索引名> (<原因>)` 列出该索引，成功命中的结果附带 `Notice: <索引名> (<原因>)`。索引不可用不等于论文不存在：只有全部索引均正常应答且无匹配时，才提示核对标识符。

---

### scholarly_citations

追踪论文引文网络：检索引用该文献的论文列表（citations）、该文献的参考文献列表（references）或相似关联文献（related）。

#### 参数

| 参数        | 类型    | 默认值   | 说明                                                                                                       |
| ----------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `id`        | string  | — (必填) | DOI、arXiv ID 或 PMID                                                                                      |
| `direction` | string  | — (必填) | 追溯方向：`citations`（引用该论文的文献）、`references`（该论文引用的参考文献）、`related`（语义关联论文） |
| `limit`     | integer | `10`     | 返回论文数量上限                                                                                           |

---

### scholarly_read

合法开放获取全文分层读取与段落级 BM25 证据定位。支持目录大纲提取（outline）、章节精准读取（section）与基于自然语言问题的 BM25 证据段落匹配（query）。

#### 参数

| 参数        | 类型    | 默认值   | 说明                                                             |
| ----------- | ------- | -------- | ---------------------------------------------------------------- |
| `id`        | string  | — (必填) | arXiv ID、DOI、PMID、PMCID 或 PDF 直链                           |
| `outline`   | boolean | —        | 设为 `true` 仅返回多级章节目录与字符跨度                         |
| `section`   | string  | —        | 指定章节编号或标题进行精读（如 `"2"` 或 `"Methodology"`）        |
| `query`     | string  | —        | 自然语言问题，基于 BM25 算法在全文段落中排序检索最相关的证据片段 |
| `passages`  | integer | `5`      | `query` 模式下返回的最优段落数量（1-12）                         |
| `start`     | integer | `0`      | 分块阅读起始字符偏移量                                           |
| `max_chars` | integer | 配置上限 | 单次读取的最大字符数                                             |

#### 网络边界

检索类工具（`scholarly_search` / `scholarly_get` / `scholarly_citations` / `scholarly_verify`）只访问固定的学术索引主机白名单（`src/scholarly/transport/hosts.ts`），并拒绝回环与私网地址。全文解析是例外：开放获取 PDF 与 PDF 直链托管在出版商自己的域名上，因此该路径只做公网/回环地址校验，「不走主机白名单」，重定向最多 5 跳。这意味着 `id` 传入的 URL 或其解析出的 PDF 地址可以是任意公网主机，请只读取可信来源的文献链接。

---

### scholarly_cite

从 DOI 官方注册中心（Crossref、DataCite）通过内容协商直接获取标准引用格式。

#### 参数

| 参数     | 类型     | 默认值   | 说明                                                                                                                |
| -------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `ids`    | string[] | — (必填) | DOI、arXiv ID 或 PMID 列表（单次最多 30 篇；超出即报错，不会静默截断）                                              |
| `format` | string   | — (必填) | 引用格式：`bibtex`、`ris`、`csljson`、`text`（格式化引文）                                                          |
| `style`  | string   | `"apa"`  | 当 `format="text"` 时的 CSL 样式 ID（如 `apa`、`ieee`、`nature`、`china-national-standard-gb-t-7714-2015-numeric`） |
| `locale` | string   | —        | 语言代码（如 `zh-CN`、`en-US`）                                                                                     |

---

### scholarly_verify

参考文献真实性与准确性核验工具。解析参考文献文本中的作者、年份、标题与 DOI，对照 Crossref 官方注册数据库进行逐项比对，检测伪造文献、DOI 错配、年份差错及撤稿状态。

#### 参数

| 参数         | 类型     | 默认值   | 说明                                                                 |
| ------------ | -------- | -------- | -------------------------------------------------------------------- |
| `references` | string[] | — (必填) | 待核验的参考文献文本列表（单次最多 40 篇；超出即报错，不会静默截断） |

#### 核验结论

每条参考文献返回四态之一：`VERIFIED`（注册记录存在且各字段一致）、`CHECK`（记录存在但存在差异或已撤稿）、`NOT FOUND`（注册库已应答且无此记录）、`UNVERIFIED`（注册库不可达，对该条目无任何结论）。注册库不可达永远不会报告为 `NOT FOUND`。
