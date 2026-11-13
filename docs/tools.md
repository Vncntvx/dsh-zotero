<p align="right"><a href="tools.en.md"><b>English</b></a></p>

# 工具参考

dsh-zotero 注册 23 个本地工具（8 个读工具 + 15 个写工具），通过本地 Zotero HTTP API 与文献库交互。其中 15 个写入工具默认关闭，需在设置中显式启用 `writeEnabled`，且只操作个人库（`zotero://user/0/`）。另有 7 个学术检索工具属于单独的 `dsh-zotero/scholarly` 组件，随包发布但默认关闭；启用该组件即启用这些工具。所有文献引用（ref）均为 `zotero://user/0/item/<KEY>`（个人库）或 `zotero://group/<ID>/item/<KEY>`（群组库）格式的稳定标识符。

八个本地读取工具共用交付结构：`{delivery:"inline", data:…}` 在两项预算内返回完整领域结果；`{delivery:"file", version:1, tool, sessionId, callId, summary, file, facts}` 返回有界事实及标准 Harness FileBlock。不可变 JSON 文件保存 `{version:1, tool, request, data}`，其中 `data` 是完整领域结果。分页完整性（`page` 或 `complete`）与交付方式独立。长单行字段应由官方 `run_code` 的 Node 文件接口解析；逐行预览可能截断长行。

参数校验失败（例如把 `refs` 写成 `ref`）时，所有 dsh-zotero 工具（8 个本地读工具、15 个写入工具与 scholarly 组件工具）都会在管线的 `invalid arguments` 错误后附一条纠错提示，同时指明被拒绝的参数名与声明的参数名。匹配忽略大小写与 `_`/`-`，相邻字符换位计为一次编辑。提示只在唯一近似匹配时出现，不改变错误码，不发起请求，也不自动重试。

正文使用 `AttachmentStore.saveFileStream`，校验后的回执写入 `zotero_results` storage domain。超预算或受管理后台结果需要这两项服务；保存、索引、取消及完整性校验失败均明确报错，不回退全文内联。所属 Zotero 后台任务成功后，`job_output` 追加同一文件引用并保留官方 canonical value。PTC 嵌套调用传递标准文件附加上下文。原始后台确认保留 `resultSessionId`；重启后可按持久回执读取已保存结果，但不会恢复运行任务。

认证端点 `GET /api/zotero/result?sessionId=<id>&seq=<event>&index=<file>` 仅读取持久事件坐标指向的文件，或该事件后台确认对应的已核实回执，不接收任意路径或附件 ID。复制和下载须等待流完整结束并通过校验。附件遵循宿主生命周期，可能在会话结束后继续占用磁盘；插件不自行删除共享文件。

---

## zotero_search

检索文献库中的条目。支持元数据匹配与全文检索模式。

### 参数

| 参数          | 类型                           | 默认值              | 说明                                                                                                                                                      |
| ------------- | ------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`       | string                         | —                   | 自由文本查询词；省略则浏览全部条目                                                                                                                        |
| `mode`        | `"metadata"` \| `"everything"` | `"metadata"`        | 搜索模式：`metadata` 匹配标题/作者/年份；`everything` 同时检索全文索引                                                                                    |
| `scope`       | object                         | `{kind: "library"}` | 搜索范围：`{kind:"library"}`、`{kind:"collection", refOrName}`、`{kind:"savedSearch", refOrName}` 或 `{kind:"publications"}`（`publications` 仅限个人库） |
| `library`     | object                         | —                   | 目标库：`{type:"user", id:0}` 或 `{type:"group", id}`；当 `scope` 传名称时用于指定上下文                                                                  |
| `itemTypes`   | string[]                       | —                   | Zotero 条目类型列表（如 `journalArticle`），按 OR 组合                                                                                                    |
| `tags`        | string[]                       | —                   | 标签列表，由 `tagMatch` 决定组合逻辑                                                                                                                      |
| `tagMatch`    | `"all"` \| `"any"`             | `"all"`             | 多标签匹配逻辑：`all` 为 AND，`any` 为 OR（需与 `tags` 配合使用）                                                                                         |
| `excludeTags` | string[]                       | —                   | 排除的标签列表（NOT）                                                                                                                                     |
| `itemLevel`   | `"top"` \| `"all"`             | `"top"`             | 条目层级：`top` 仅检索顶层条目；`all` 同时检索子条目与附件（仅 `library`/`collection` 范围；`publications` 与已存搜索为单一列表）                         |
| `sort`        | string                         | `"dateModified"`    | 排序字段：`dateModified`、`dateAdded`、`date`、`title`、`creator`                                                                                         |
| `direction`   | `"asc"` \| `"desc"`            | `"desc"`            | 排序方向                                                                                                                                                  |
| `offset`      | integer                        | `0`                 | 分页偏移量                                                                                                                                                |
| `limit`       | integer                        | `10`                | 返回条目数量上限（受配置项 `maxSearchResults` 限制，默认 20）                                                                                             |

### 输出

返回对象包含 `normalizedQuery`、`queryWasEmpty`、`maximum`、`scope`、`items`（包含 ref、title、creatorSummary、authors、venue、year、itemType、parentRef、bestAttachmentRef、bestAttachmentType、attachmentSize、extra、citationKey、citationKeySource、citationKeyConflict、doi）、`total`、`offset`、`returned`、`nextOffset`，以及可选的 `nextActions` 和 `supplemental`（包含笔记命中内容 `{kind:"noteBody", items, scanned, truncated}`）。模型不能通过此工具访问回收站；回收站只在文献面板显示。原生 `citationKey` 优先于 `extra` 中的 citekey，冲突会显式返回。

### 说明

在初次查询（offset 0）且搜索范围为 `library`、`publications` 或 `collection` 时，插件会扫描笔记正文，命中条目列入 `supplemental.items`。`items` 与 `total` 仅统计主结果条目。

### 示例

```text
zotero_search(query="transformer attention", mode="everything", tags=["deep-learning"], limit=5)
```

---

## zotero_get

读取单篇文献或附件的详细元数据、本地文件路径与关联子内容。
`ref` 是单个字符串；读取多个已知条目时传 `refs[]` 给 `zotero_get_batch`。

### 参数

| 参数         | 类型                                        | 必填 | 说明                                                                                                                                              |
| ------------ | ------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref`        | string                                      | ✓    | 文献条目 ref 或附件 ref（`zotero://user/0/item/<KEY>` 或 `zotero://user/0/attachment/<KEY>`）                                                     |
| `include`    | `("notes"\|"annotations"\|"attachments")[]` | —    | 需包含的子内容类型（条目包含 direct 与批注；附件包含其自身批注）                                                                                  |
| `fields`     | `"standard"` \| `"all"`                     | —    | 返回字段范围：`standard`（默认）返回规范化字段模型；`all` 额外包含 `extraFields`                                                                  |
| `locations`  | `"none"` \| `"best"` \| `"included"`        | 否   | 默认 `none` 只读元数据；`best` 解析目标附件或条目的最佳附件；`included` 仅解析本次返回附件且要求 include attachments。附件 ref 只接受 none/best。 |
| `childPages` | object                                      | 否   | 按 notes/annotations/attachments 独立指定 `{offset,limit}`；未指定窗口的请求种类读取全部记录及完整规范化正文。                                    |

### 输出

返回条目详细对象：

- `ref`、`itemType`、`title`；
- `creators`：创作者对象列表（每个创作者包含 `creatorType`，以及可选的 `name`、`firstName`、`lastName`）；
- `citationKey`：独立的一等字段，包含 Zotero 原生 citekey 或从 `extra` 提取的 citekey；`citationKeySource` 标明来源，冲突时 `citationKeyConflict` 同时保留两值；
- `extra`：附加元数据（如 arXiv ID、PMID 等）；
- `date`、`year`、`venue`、`doi`、`url`、`abstract`、`abstractTruncated`；
- `tags`、`collections`、`children`、`bestAttachment`、`relations`；
- 本地文件路径 `path` 与内容类型 `contentType`（已核实本地磁盘存在）；
- `fields="all"` 时的原生附加字段 `extraFields`；
- 请求的子项集合：`notes`、`annotations`、`attachments`（含 completeness、total、returned、items；指定页另含 offset、limit、nextOffset。位置只在显式请求时解析）。

### 示例

```text
zotero_get(ref="zotero://user/0/item/ABCD1234", include=["notes", "annotations", "attachments"])
```

---

## zotero_get_batch

按输入顺序批量读取已知条目或附件 ref。每条结果独立报告成功或失败；最多 50 条唯一 ref，最多 8 路并发。单条 `zotero_get` 用于一个 ref；多个 ref 使用本工具。

### 参数

| 参数      | 类型     | 默认值       | 说明                                                                                                                    |
| --------- | -------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `refs`    | string[] | —            | 1–50 个唯一条目或附件 ref，按此顺序返回                                                                                 |
| `fields`  | string   | `"standard"` | `standard` 或 `all`；后者保留未消费的 Zotero 数据字段                                                                   |
| `include` | object   | —            | `children` 包含笔记、标注和附件；`attachments` 仅包含附件；`relations:true` 返回关联；`bestAttachment` 解析最佳附件位置 |

### 输出

`{items, counts}`。`items` 与 `refs` 同序，每项为 `{ref, status:"ok", item}` 或 `{ref, status:"error", code, message, next?}`；`counts` 含 `requested`、`succeeded`、`failed`。

### 示例

```text
zotero_get_batch(refs=["zotero://user/0/item/ABCD1234", "zotero://user/0/item/EFGH5678"], fields="standard")
```

---

## zotero_match_references

将 BibTeX、DOI 或参考文献字段与本地 Zotero 库对账。仅访问本地库，不调用 scholarly，也不写入。DOI 精确匹配会在每次调用中分页读取一次全部顶层条目的元数据，因为 Zotero 快速搜索不检索 DOI 字段。每次最多 50 条；超过上限时分批。唯一高置信匹配才返回 `matched`；候选不唯一或证据不足时返回 `ambiguous`，citekey 来源冲突时返回 `conflict`。

### 参数

| 参数               | 类型     | 默认值  | 说明                                                                                                  |
| ------------------ | -------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `references`       | object[] | —       | 1–50 条，`inputId` 必须唯一；每条至少提供 `doi` 或 `title`，可附 `bibKey`、`authors`、`year`、`venue` |
| `includeFieldDiff` | boolean  | `false` | 唯一匹配时返回可比较的标题、DOI、年份、作者和来源差异                                                 |

### 输出

`{items}` 与输入同序。每项包含 `inputId`、`status`，搜索页不完整时附 `reason` 并且不会报告 `matched`；匹配项和候选包含 `ref`、`citationKey`、`citationKeySource`（可用时）、`title`、作者、年份、DOI、来源、匹配方法和置信度；`citationKeyConflict` 会阻止静默选中。`fieldDiff` 返回可比较的标题、DOI、年份、作者和来源差异，可用于审阅 Bib/TeX 修改。

### 示例

```text
zotero_match_references(references=[{inputId:"ref-1", bibKey:"doe2024", doi:"10.1000/example", title:"A Paper"}, {inputId:"ref-2", title:"Another Paper", authors:["Jane Doe"], year:2023}, {inputId:"ref-3", doi:"10.1000/third"}], includeFieldDiff=true)
```

---

## zotero_retrieve

从单篇文献的多数据源中提取与查询相关的原文片段并排序：核心使用词面 BM25；启用文档解析组件的本地语义检索后，排序经词面+语义双路线 RRF 融合，每段结果标注 `matchKind`。

### 参数

| 参数               | 类型     | 默认值    | 说明                                                                                                                              |
| ------------------ | -------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `ref`              | string   | —         | 文献条目 ref（必填）                                                                                                              |
| `query`            | string   | —         | 排序关键词（必填）                                                                                                                |
| `queryVariants`    | string[] | —         | 同一问题的其他措辞（同义词、领域术语），至多 4 个；超限报错，因为每个措辞都是一次完整评分。逐措辞独立排序，段落取各措辞的最好成绩 |
| `sources`          | string[] | 全部 4 种 | 检索源：`annotation`、`note`、`abstract`、`fulltext`                                                                              |
| `passages`         | integer  | `4`       | 返回段落数量上限（受 `maxEvidencePassages` 限制，默认 4）                                                                         |
| `attachmentPolicy` | string   | `"best"`  | 全文附件选取策略：`best`、`allIndexed`、`specified`                                                                               |
| `attachmentRefs`   | string[] | —         | 当 `attachmentPolicy="specified"` 时指定的附件 ref 列表                                                                           |

### 输出

返回结构包含：`ref`、`attachmentRef`、`attachmentContentType`、`coverage`（全文覆盖信息）、`attachments`（各附件检索状态）、`evidence`（段落列表，每项包含 source、sourceRef、attachmentRef、text、chunkIndex、chunkCount、comment、pageLabel、`matchKind`、matchedFields）、`truncated`、`sourcesSkipped`、`queryTerms`（词面路线实际计分的折叠词项）、`rankedRoutes`（实际运行的路线：`lexical`，启用语义后含 `semantic`）、`noMatch`（空结果成因：`no-overlap` 有语料无命中；`no-sources` 无可排序语料）。

### 说明

- `matchKind` 标注每段返回原因：`lexical`（原文含查询词，可照原文引用）、`semantic`（仅语义匹配，不按含查询词的原文引用）、`hybrid`（两者）；
- 仅 `annotation` 来源包含页码标签（`pageLabel`）；全文段落不提供页码；
- 不可用或未建立索引的来源记入 `sourcesSkipped`；`noMatch` 不表示"该条目没有相关内容"；
- 批注内容将高亮原文与用户评论一并纳入排序，`matchedFields` 标注匹配来源为 `text` 或 `comment`；语义命中的段落不标注字段（措辞无重合）；
- 多附件策略下，未索引的附件明确标注为 `unindexed`，未读取的附件标注为 `unread`。

### 示例

```text
zotero_retrieve(ref="zotero://user/0/item/ABCD1234", query="attention mechanism", sources=["annotation", "fulltext"], passages=6)
```

---

## zotero_export

文件导出可传 `outputFile`（非空路径，适用于书目、translator 文本及 `csv` 格式，不适用于 `citation`）。文件路径按调用会话的当前工作目录解析，由 Harness 文件系统按该会话的沙箱策略写入；写入失败会使工具或后台任务失败。前台、显式后台和超时提升均在文件写入与超预算或后台所需的内部持久化完成后才结束。写盘不等于会话交付：需要把文件列入本次会话的交付物时，由模型另行调用 Harness 的 `present` 工具声明该路径。

生成格式化引用或导出数据文件。

### 参数

| 参数         | 类型     | 默认值                       | 说明                                                                                        |
| ------------ | -------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `refs`       | string[] | —                            | 条目 ref 列表（必填，单次受 `maxExportRefs` 限制，默认 50）                                 |
| `format`     | string   | —                            | 导出格式：`citation`、`bibliography`、`bibtex`、`biblatex`、`ris`、`csljson`、`csv`（必填） |
| `style`      | string   | 配置默认值                   | CSL 样式标识（仅用于 citation 和 bibliography）                                             |
| `locale`     | string   | 配置默认值（默认 `"en-US"`） | CSL 语言环境（仅用于 citation 和 bibliography；默认取配置 `defaultLocale`）                 |
| `outputFile` | string   | —                            | 可选的会话工作区路径，把书目、translator 文本或 CSV 写入该文件（`citation` 不接受）         |

`run_in_background` 不是恒声明参数：仅当 `enableRunInBackground=true` 且宿主挂载了 `jobs` 服务时才出现在参数中；未声明时传 `true` 仍会得到结构化拒绝（`JOB_BACKGROUND_DISABLED` / `TOOL_CONTEXT_UNAVAILABLE`）。

### 输出

前台同步完成时：

- `citation`：`{citations: [{ref, text}]}`；
- `bibliography`：`{text}`；
- `bibtex` / `biblatex` / `ris` / `csljson`：`{text, items: [{ref, citationKey, exportKey, title, entryIndex, start, end}]}`；`citationKey` 是 Zotero 原生/extra citekey，`exportKey` 是 translator 生成词条键；
- `csv`：`{text}`（Zotero 自身的整表导出，无逐条目定位）。

后台执行（或前台等待超时自动提升）时：
返回 `{kind: "background", jobId}` 或 `{kind: "promoted", jobId, timeoutMs, message}`。任务进度在 Web 会话顶栏与日志中展示，完成后结果写入 Job 产物。

### 说明

- refs 总数先受 `maxExportRefs` 拦截（默认 50）。除 `citation` 外的 6 种格式（`bibliography`、`bibtex`、`biblatex`、`ris`、`csljson`、`csv`）单次调用最多 50 条：这是插件为保持 Zotero translator 的全局排序而设的批边界，不是 Zotero `itemKey` 请求自身的上限，超出即报错，不会自动分批；
- `citation` 是唯一会分批的格式：refs 数超过 50 时按 50 一组分批请求。默认 `maxExportRefs` 同为 50，因此需先将该配置调至 50 以上，分批才会实际发生；
- `bibtex`、`biblatex`、`ris`、`csljson` 各使用 1 次 translator 请求和 1 次有界原始元数据批处理，用于 citekey 与字段对齐。返回内容在内存中解析，每条记录按 key 或元数据指纹与 ref 配对，不按位置猜测；无法定位的 ref 在结果中只保留自身。元数据请求失败（如 Zotero 返回 5xx）时导出照常完成：正文原样返回，未能配对的 ref 保持仅有 `ref` 的裸形状。调用方取消（abort）仍会抛出。单次调用最多支持 50 条；
- 单次导出仅允许同一 library 的 refs，不支持跨库混合导出。

### 示例

```text
zotero_export(refs=["zotero://user/0/item/ABCD1234", "zotero://user/0/item/EFGH5678"], format="bibtex")
zotero_export(refs=["zotero://user/0/item/ABCD1234", "zotero://user/0/item/EFGH5678"], format="bibtex", run_in_background=true)
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
- `collections`：`{ref, name, parentRef?, path, depth, childCount?, itemCount?}`（`childCount`/`itemCount` 为 Zotero 报告的直属子合集数与直属条目数，缺省表示未报告；`childCount` 为 0 即确认无子合集）
- `savedSearches`：`{ref, name, conditions?}`
- `tags`：`{tag, count?}`
- `itemTypes`：`{itemType, localized?}`
- `itemFields`：`{field, localized?}` 或 `{creatorType, localized?}`

合集与保存搜索的结果还包含顶层 `libraryVersion`，来自有效的 `Last-Modified-Version` 响应头；缺失或非法版本会报错，不返回虚构版本。

### 示例

```text
zotero_browse(kind="collections", library={type:"group", id:42}, limit=20)
zotero_browse(kind="tags", q="review", match="contains")
```

---

## zotero_changes

基于本地事务版本获取文献库的增量更新与删除记录。

### 参数

| 参数      | 类型     | 默认值                  | 说明                                                                           |
| --------- | -------- | ----------------------- | ------------------------------------------------------------------------------ |
| `library` | object   | `{type: "user", id: 0}` | 目标库标识                                                                     |
| `since`   | object   | —                       | 起始游标 `{serverId, library, version, include, unserved}`；省略则获取初始基线 |
| `include` | string[] | 除 fulltext 外全部      | 监测范围：`items`、`collections`、`savedSearches`、`fulltext`、`deleted`       |

`run_in_background` 不是恒声明参数：仅当 `enableRunInBackground=true` 且宿主挂载了 `jobs` 服务时才出现在参数中；未声明时传 `true` 仍会得到结构化拒绝（`JOB_BACKGROUND_DISABLED` / `TOOL_CONTEXT_UNAVAILABLE`）。

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
- 创建已提交但保存状态无法核验：`{kind: "committed-unverified", committed: true, retryable: false, reason: "saved-state-unverified" | "commit-unknown" | "receipt-unknown", ...}`，**不可重试**，请按 key/ref 在 Zotero 中核对；
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
- 已提交但状态未核验：`{kind: "committed-unverified", committed: true, retryable: false, reason: "saved-state-unverified" | "commit-unknown" | "receipt-unknown", ...}`，**不可重试**；
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

### 示例

```text
zotero_update_note(ref="zotero://user/0/item/NOTE1234", markdown="## 方法总结\n- 要点一")
```

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

### 示例

```text
zotero_update_collection(collection="zotero://user/0/collection/COLL0001", name="田野笔记（2026）")
```

---

## zotero_restore_items

将个人库 Trash 中指定的条目恢复为活动状态。每个条目独立读取版本并 PATCH `deleted: 0`，逐项返回成功或失败，最多 50 项。

### 参数与输出

| 参数   | 类型     | 必填 | 说明                  |
| ------ | -------- | ---- | --------------------- |
| `refs` | string[] | ✓    | 要恢复的条目 ref 列表 |

输出为 `{kind: "restored", restored, unverified, failed, serverId?}`；版本冲突记录在 `failed`，回执未知记录在 `unverified`，两者都不会自动重试。

支持子笔记、子附件和批注。结果正文完整列出成功对象的 ref、版本、库版本，以及失败和未核验对象的 ref、错误码或原因；卡片根据实际结果显示恢复数、未核验数与失败数，未核验回执必须先按 ref/key 核对，禁止重试。

### 示例

```text
zotero_restore_items(refs=["zotero://user/0/item/ABCD1234", "zotero://user/0/item/EFGH5678"])
```

---

## zotero_create_saved_search

使用明确的条件在个人库中创建 Zotero 保存的搜索（Saved Search）。创建至少需要一个条件；创建响应丢失或回显无法核验时返回 `committed-unverified`（`retryable: false`），必须先按 search ref/key 核对，禁止重复创建。

### 参数

| 参数         | 类型     | 必填 | 说明                                                                                   |
| ------------ | -------- | ---- | -------------------------------------------------------------------------------------- |
| `name`       | string   | ✓    | 保存搜索的名称（非空文本）                                                             |
| `conditions` | object[] | ✓    | 搜索条件列表，每项包含 `condition`（字段名）、`operator`（操作符）与 `value`（匹配值） |

### 输出

- 成功创建：`{kind: "applied", ref, key, version, name, conditions, libraryVersion, serverId?}`；
- 提交未核验：`{kind: "committed-unverified", reason, key?, ref?, version?, libraryVersion?, serverId?}`；
- 计划卡拒绝：`{kind: "declined"}`。

### 示例

```text
zotero_create_saved_search(name="Recent ML Papers", conditions=[{"condition": "itemType", "operator": "is", "value": "journalArticle"}])
```

---

## zotero_update_saved_search

更新个人库中已有保存搜索的名称或匹配条件。写入携带对象版本与库版本前置条件。

### 参数

| 参数         | 类型     | 必填 | 说明                                                                |
| ------------ | -------- | ---- | ------------------------------------------------------------------- |
| `search`     | string   | ✓    | 目标保存搜索 ref（`zotero://user/0/search/<KEY>`）                  |
| `name`       | string   | —    | 新名称（可选；提供时须为非空文本）                                  |
| `conditions` | object[] | —    | 新搜索条件列表（可选；每项包含 `condition`、`operator` 与 `value`） |

`name` 与 `conditions` 至少需要提供一项。

### 输出

- 成功更新：`{kind: "applied", ref, key, version, name?, conditions?, libraryVersion, serverId?}`；
- 提交未核验：`{kind: "committed-unverified", reason, key?, ref?, version?, libraryVersion?, serverId?}`；
- 计划卡拒绝：`{kind: "declined"}`。

### 示例

```text
zotero_update_saved_search(search="zotero://user/0/search/SRCH1234", name="Updated ML Papers")
```

---

## zotero_delete_saved_search

删除个人库中的指定保存搜索。**不可逆**：删除操作仅移除保存搜索定义本身，文献库中的条目不受影响。写入携带对象版本与库版本前置条件。

### 参数

| 参数     | 类型   | 必填 | 说明                                                   |
| -------- | ------ | ---- | ------------------------------------------------------ |
| `search` | string | ✓    | 待删除的保存搜索 ref（`zotero://user/0/search/<KEY>`） |

### 输出

- 成功删除：`{kind: "deleted", ref, key, deleted: true, libraryVersion, serverId?}`；
- 提交未核验：`{kind: "committed-unverified", reason, key?, ref?, version?, libraryVersion?, serverId?}`；
- 计划卡拒绝：`{kind: "declined"}`。

### 示例

```text
zotero_delete_saved_search(search="zotero://user/0/search/SRCH1234")
```

## scholarly_save_to_zotero

### 参数

| 参数               | 类型     | 必填 | 说明                                                |
| ------------------ | -------- | ---- | --------------------------------------------------- |
| `itemType`         | string   | —    | 默认 `journalArticle`，支持核心创建工具的条目类型   |
| `title`            | string   | ✓    | 文献标题                                            |
| `authors`          | string[] | —    | 作者姓名                                            |
| `year`             | integer  | —    | 发表年份                                            |
| `doi`              | string   | —    | DOI                                                 |
| `url`              | string   | —    | 文献链接                                            |
| `abstract`         | string   | —    | 摘要（批量核心创建使用 `abstractNote`，不是此字段） |
| `publicationTitle` | string   | —    | 刊物或会议名称                                      |
| `tags`             | string[] | —    | 创建时添加的标签                                    |
| `collections`      | string[] | —    | 目标合集 ref 或精确名称                             |

该工具只在本地 Zotero 组件已挂载且 `writeEnabled=true` 时进入模型的工具清单；写入关闭时它不注册到当前 step 的工具集合，模型不会看到一个只能回答「写入已关闭」的工具。

将学术检索结果通过本地写入审批流程保存到个人库。输出为 `declined`、`applied` 或 `committed-unverified` 的联合类型。仅 `applied` 附带成功保存的 `papers`，并保留创建条目的 ref、key、版本、标签、合集与库版本；未核验结果保留原始身份及原因，禁止重试。卡片和会话回放通过持久化的正文与状态元数据区分三种结果。

#### 示例

```text
scholarly_save_to_zotero(itemType="journalArticle", title="Attention Is All You Need", doi="10.48550/arXiv.1706.03762")
```

---

## zotero_update_item

订正条目的标量元数据。字段合法性以 Zotero 的 `itemTypeFields` 为准：某字段不被该条目类型接受时，在任何 PATCH 之前拒绝；值必须是非空文本。写入携带条目版本前置条件（`If-Unmodified-Since-Version`）。

标量更新先校验全部字段适用于条目类型，再严格比较规范化 wire 值，仅 PATCH 差异。已满足请求返回 `{kind: "applied", unchanged: true, changed: []}` 及实际读取的条目 `version`，不报告新的 `libraryVersion`，不获取写凭据。能力门与两级审批仍适用。

### 参数

| 参数  | 类型   | 必填 | 说明                                                                                     |
| ----- | ------ | ---- | ---------------------------------------------------------------------------------------- |
| `ref` | string | ✓    | 目标条目 ref（`zotero://user/0/item/<KEY>`）                                             |
| `set` | object | ✓    | 至少一个字段：`title`、`date`、`url`、`doi`、`abstractNote`、`publicationTitle`、`extra` |

### 输出

- 实际发生变更：`{kind: "applied", ref, version, changed, libraryVersion, serverId?}`（`changed` 为实际提交的字段名，按字典序）；
- 无需变更：`{kind: "applied", unchanged: true, changed: []}`；
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
   - 开启 `writePersistKey` 时，“始终允许”签发的持久密钥会安全保存在宿主凭据管理器中；设置页「基础设置 → 写入」分组提供撤销入口，撤销只删除宿主保存的密钥，下一次写入会重新弹窗。
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

| 错误码                                     | 说明                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `ZOTERO_NOT_RUNNING`                       | Zotero 未运行或本地端口不可达                                                                  |
| `ZOTERO_API_DISABLED`                      | Zotero 运行中，但高级设置中未启用本地 API（403）                                               |
| `ZOTERO_API_VERSION`                       | 本地 API 版本不受支持                                                                          |
| `ZOTERO_NOT_IMPLEMENTED`                   | 本地 API 明确返回 501，端点或格式在本版本中未实现                                              |
| `ZOTERO_SERVER_MISMATCH`                   | 引用的 Server ID 与当前运行的 Zotero 实例不匹配                                                |
| `ZOTERO_NOT_FOUND`                         | 引用的条目、合集或保存搜索不存在                                                               |
| `ZOTERO_RANGE_UNSUPPORTED`                 | 服务端未保留所请求版本至今的历史记录（409）                                                    |
| `ZOTERO_NO_ATTACHMENT`                     | 条目下不存在指定类型的附件                                                                     |
| `ZOTERO_NO_FULLTEXT`                       | 附件未建立全文索引                                                                             |
| `ZOTERO_SOURCE_PAGE_STALE`                 | 文献轨迹翻页期间轨迹已变化，分页参数（offset + revision）失效（刷新后重试）                    |
| `ZOTERO_URL_PDF_DISABLED`                  | 文献面板未开启 URL PDF 阅读授权                                                                |
| `ZOTERO_URL_PDF_BUSY`                      | 已有两个 URL PDF 下载在运行（文献面板端点）                                                    |
| `ZOTERO_URL_PDF_NOT_URL`                   | 该附件不是 URL PDF（文献面板端点）                                                             |
| `ZOTERO_URL_PDF_REDIRECT`                  | PDF 重定向次数超限、缺少 Location 或 HTTPS 降级（文献面板端点）                                |
| `ZOTERO_URL_PDF_HTTP`                      | PDF 源站返回非成功状态（文献面板端点）                                                         |
| `ZOTERO_URL_PDF_NOT_PDF`                   | 响应不是 PDF：媒体类型或文件头不符（文献面板端点）                                             |
| `ZOTERO_URL_PDF_TIMEOUT`                   | PDF 下载超过 60 秒（文献面板端点）                                                             |
| `ZOTERO_URL_PDF_FORBIDDEN_TARGET`          | PDF 地址未通过公网地址校验（本机、内网或私有地址）（文献面板端点）                             |
| `ZOTERO_URL_PDF_TOO_LARGE`                 | PDF 超过 32 MiB 读取上限（文献面板端点）                                                       |
| `ZOTERO_URL_PDF_NETWORK`                   | PDF 下载在传输层失败（不回显原始 URL）（文献面板端点）                                         |
| `ZOTERO_FILE_MISSING`                      | 记录的本地附件文件在磁盘上不存在                                                               |
| `ZOTERO_FILE_UNREADABLE`                   | 本地附件路径无法解析或文件不可读（`zotero_get` 的 `locations` 会把它降级为 `location.reason`） |
| `ZOTERO_INVALID_REF`                       | ref 格式不符合 `zotero://` 语法规范或引用了不受支持的库                                        |
| `ZOTERO_INVALID_ARGUMENT`                  | 参数违反领域约束规则                                                                           |
| `ZOTERO_SCOPE_AMBIGUOUS`                   | 合集或保存搜索名称匹配到多个同名对象                                                           |
| `ZOTERO_TIMEOUT`                           | 提供方请求超时                                                                                 |
| `ZOTERO_RESPONSE_TOO_LARGE`                | API 响应数据流超出读取上限                                                                     |
| `ZOTERO_OUTPUT_TOO_LARGE`                  | 导出内容超出字符数上限                                                                         |
| `ZOTERO_CAPABILITY_UNAVAILABLE`            | 当前 Provider 未声明所需能力                                                                   |
| `ZOTERO_SCHOLARLY_NO_FULLTEXT`             | 学术全文解析没有找到可读副本（细分原因在消息里；不会冒充本地全文缺失）                         |
| `ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE` | 学术检索配置了凭据引用，但宿主未装载凭据服务                                                   |
| `ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED`   | 学术检索的凭据引用非法或没有值（不会降级为匿名）                                               |
| `ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED`  | MinerU 精准模式配置的 Token 凭据引用无法解析（fail-closed，不降级免费/匿名）                   |
| `ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE`       | 主动解析需要会话所属 `ctx.jobs` 与会话控制器，但当前不可用                                     |
| `ZOTERO_ENRICHMENT_OPERATION_CONFLICT`     | 同一操作 id 被以不同目标或配置快照重放                                                         |
| `ZOTERO_ENRICHMENT_TASK_FAILED`            | MinerU 报告解析任务失败（附带其自身原因）                                                      |
| `ZOTERO_ENRICHMENT_OUTPUT_INVALID`         | 解析产物输出目录校验失败                                                                       |
| `ZOTERO_ENRICHMENT_ARCHIVE_INVALID`        | MinerU 返回归档包结构或 zip 安全校验失败                                                       |
| `ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT`      | 文档超过所选接口的体积上限或不是 PDF                                                           |
| `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE`   | 语义检索已开启，但模型缺失/损坏或本地推理运行时不可用（fail-closed，不回退 BM25）              |
| `ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED`  | 本地语义模型在所有镜像源下载失败                                                               |
| `ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_TIMEOUT` | 本地语义模型下载超过总时限                                                                     |
| `ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED`    | 本地语义模型删除失败或路径不安全                                                               |
| `ZOTERO_JOBS_LIMIT_REACHED`                | 解析端点：会话的后台解析任务数已达上限，需要先取回或取消一个未用任务再重试                     |
| `ZOTERO_PROVIDER_UNAVAILABLE`              | 配置的 Provider 未注册或方法未实现                                                             |
| `ZOTERO_UNEXPECTED`                        | 响应数据格式异常或未预期行为                                                                   |
| `ZOTERO_WRITE_UNAUTHORIZED`                | 写入未获授权：密钥缺失、失效或在授权弹窗中被拒绝                                               |
| `ZOTERO_WRITE_APPROVAL_UNAVAILABLE`        | 计划审查卡无法发起交互（无交互通道或系统级异常）                                               |
| `ZOTERO_WRITE_CONFLICT`                    | 写入版本前置条件冲突（412），对象已被外部修改                                                  |
| `ZOTERO_WRITE_RATE_LIMITED`                | Zotero 授权端点限速（429）                                                                     |

---

## 状态码

以下值是状态视图里的告警，不是工具错误：

| 状态码                            | 说明                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| `ZOTERO_SOURCE_PROJECTION_FAILED` | 全量文献轨迹投影注册失败；面板显示降级状态，本地读取仍可用。 |

## 学术文献检索组件工具 (`dsh-zotero/scholarly`)

bundle 组件 `dsh-zotero/scholarly` 随包发布但默认关闭。在插件管理器「包含的组件」中启用该组件即挂载它，并提供以下 7 个模型工具：

其中 `scholarly_search`、`scholarly_read`、`scholarly_verify` 声明 `run_in_background`：结果要么是普通文本，要么是 `{ kind: "background", jobId }` / `{ kind: "promoted", jobId, timeoutMs, message }` 两种作业臂；用 `job_output` 取回结果、`job_kill` 取消。显式后台在 `enableRunInBackground=false` 或宿主未挂载 `jobs` 服务时被结构化拒绝；前台等待超过 `foregroundWaitMs` 自动提升为后台（`promoteOnTimeout=true`），作业结果文本由 `JobOutcome.result` 提供。

### scholarly_search

跨 arXiv、OpenAlex、Crossref、Semantic Scholar、PubMed、Europe PMC 与 DBLP 的多源文献检索。支持主题短语路由、多路 RRF 融合去重，并自动检查当前本地 Zotero 库中的收藏状态。

#### 参数

| 参数                | 类型     | 默认值        | 说明                                                                                                                                                                             |
| ------------------- | -------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`             | string   | — (必填)      | 检索主题词、论文标题或作者名                                                                                                                                                     |
| `sources`           | string[] | —             | 可选限制检索的数据源列表（`arxiv`、`openalex`、`crossref`、`semanticscholar`、`pubmed`、`europepmc`、`dblp`）；默认按主题短语表路由                                              |
| `year_from`         | integer  | —             | 发表起始年份；`sort="date"` 且省略此参数时，默认只取上一年                                                                                                                       |
| `year_to`           | integer  | —             | 发表截止年份                                                                                                                                                                     |
| `open_access`       | boolean  | —             | 是否仅返回具有免费开放获取全文的文献                                                                                                                                             |
| `sort`              | string   | `"relevance"` | 排序方式：`relevance`（相关度）、`date`（最新优先，省略 `year_from` 时默认只取上一年）、`citations`（引用最多优先）                                                              |
| `categories`        | string[] | —             | arXiv 分类过滤（如 `cs.CL`、`stat.ML`）                                                                                                                                          |
| `limit`             | integer  | `8`           | 返回论文数量上限                                                                                                                                                                 |
| `abstract`          | string   | `"snippet"`   | 摘要展示程度：`none`、`snippet`、`full`                                                                                                                                          |
| `run_in_background` | boolean  | `false`       | 是否作为后台任务启动（由 Harness `ctx.jobs` 管理，作业 kind 为 `scholarly`；仅在 `enableRunInBackground=true` 且宿主挂载 `jobs` 服务时声明，未声明时传 `true` 会得到结构化拒绝） |

#### 示例

```text
scholarly_search(query="transformer attention", limit=5)
```

---

### scholarly_get

通过 DOI、arXiv ID、PMID、PMCID、URL 或精确标题直接聚合获取单篇论文的完整学术图谱元数据（作者、出版物、摘要、引用次数、开放获取全文链接与本地 Zotero 库匹配状态）。

#### 参数

| 参数 | 类型   | 默认值   | 说明                                                                                     |
| ---- | ------ | -------- | ---------------------------------------------------------------------------------------- |
| `id` | string | — (必填) | DOI（如 `10.1038/nature1234`）、arXiv ID（如 `2301.07041`）、PMID、PMCID、URL 或精确标题 |

#### 示例

```text
scholarly_get(id="10.1038/nature1234")
```

#### 失败语义

某个索引无法应答（限流、超时、服务错误）时，结果中会以 `Unanswered sources: <索引名> (<原因>)` 列出该索引，成功命中的结果附带 `Notice: <索引名> (<原因>)`。原因会带上底层传输 code（如 `fetch failed (UND_ERR_INVALID_ARG)`、`fetch failed (ECONNRESET)`），便于区分本地组合错误与网络故障。索引不可用不等于论文不存在：只有全部索引均正常应答且无匹配时，才提示核对标识符。

---

### scholarly_citations

追踪论文引文网络：检索引用该文献的论文列表（citations）、该文献的参考文献列表（references）或相似关联文献（related）。

#### 参数

| 参数        | 类型    | 默认值   | 说明                                                                                                       |
| ----------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `id`        | string  | — (必填) | DOI、arXiv ID 或 PMID                                                                                      |
| `direction` | string  | — (必填) | 追溯方向：`citations`（引用该论文的文献）、`references`（该论文引用的参考文献）、`related`（语义关联论文） |
| `limit`     | integer | `10`     | 返回论文数量上限                                                                                           |

#### 示例

```text
scholarly_citations(id="2301.07041", direction="citations", limit=5)
```

---

### scholarly_read

合法开放获取全文分层读取与段落级证据定位。支持目录大纲提取（outline）、章节精准读取（section）与基于自然语言问题的证据段落匹配（query）。

#### 参数

| 参数                | 类型     | 默认值   | 说明                                                                                                                                                                             |
| ------------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | string   | — (必填) | arXiv ID、DOI、PMID、PMCID 或 PDF 直链                                                                                                                                           |
| `outline`           | boolean  | —        | 设为 `true` 仅返回多级章节目录与字符跨度                                                                                                                                         |
| `section`           | string   | —        | 指定章节编号或标题进行精读（如 `"2"` 或 `"Methodology"`）                                                                                                                        |
| `query`             | string   | —        | 自然语言问题，在全文段落中排序检索最相关的证据片段（与 `zotero_retrieve` 同一排序策略与同一切分边界）                                                                            |
| `queryVariants`     | string[] | —        | 同一问题的其他措辞（同义词、领域术语），至多 4 个；超限报错。逐措辞独立排序，段落取各措辞的最好成绩                                                                              |
| `passages`          | integer  | `5`      | `query` 模式下返回的最优段落数量（1-12）                                                                                                                                         |
| `start`             | integer  | `0`      | 分块阅读起始字符偏移量                                                                                                                                                           |
| `max_chars`         | integer  | 配置上限 | 单次读取的最大字符数                                                                                                                                                             |
| `run_in_background` | boolean  | `false`  | 是否作为后台任务启动（由 Harness `ctx.jobs` 管理，作业 kind 为 `scholarly`；仅在 `enableRunInBackground=true` 且宿主挂载 `jobs` 服务时声明，未声明时传 `true` 会得到结构化拒绝） |

#### 示例

```text
scholarly_read(id="2301.07041", query="attention mechanism")
```

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

#### 示例

```text
scholarly_cite(ids=["10.1038/nature1234"], format="bibtex")
```

---

### scholarly_verify

参考文献真实性与准确性核验工具。解析参考文献文本中的作者、年份、标题与 DOI，对照 Crossref 官方注册数据库进行逐项比对，检测伪造文献、DOI 错配、年份差错及撤稿状态。

#### 参数

| 参数                | 类型     | 默认值   | 说明                                                                                                                                                                             |
| ------------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `references`        | string[] | — (必填) | 待核验的参考文献文本列表（单次最多 40 篇；超出即报错，不会静默截断）                                                                                                             |
| `run_in_background` | boolean  | `false`  | 是否作为后台任务启动（由 Harness `ctx.jobs` 管理，作业 kind 为 `scholarly`；仅在 `enableRunInBackground=true` 且宿主挂载 `jobs` 服务时声明，未声明时传 `true` 会得到结构化拒绝） |

#### 核验结论

每条参考文献返回四态之一：`VERIFIED`（注册记录存在且各字段一致）、`CHECK`（记录存在但存在差异或已撤稿）、`NOT FOUND`（注册库已应答且无此记录）、`UNVERIFIED`（注册库不可达，对该条目无任何结论）。注册库不可达永远不会报告为 `NOT FOUND`。

#### 示例

```text
scholarly_verify(references=["Vaswani et al. 2017, Attention Is All You Need"])
```
