<p align="right"><a href="tools.en.md"><b>English</b></a></p>

# 工具参考

dsh-zotero 注册 23 个本地工具（8 个读工具 + 15 个写工具），通过本地 Zotero HTTP API 与文献库交互。其中 15 个写入工具默认关闭，需在设置中显式启用 `writeEnabled`，且只操作个人库（`zotero://user/0/`）。另有 7 个学术检索工具属于单独的 `dsh-zotero/scholarly` 组件，随包发布但默认关闭；启用该组件即启用这些工具。所有文献引用（ref）均为 `zotero://user/0/item/<KEY>`（个人库）或 `zotero://group/<ID>/item/<KEY>`（群组库）格式的稳定标识符。

八个本地读取工具共用交付结构：`{delivery:"inline", data:…}` 在两项预算内返回完整领域结果；`{delivery:"file", version:1, tool, sessionId, callId, summary, file, facts}` 返回有界事实及标准 Harness FileBlock。不可变 JSON 文件保存 `{version:1, tool, request, data}`，其中 `data` 是完整领域结果。分页完整性（`page` 或 `complete`）与交付方式独立。长单行字段应由官方 `run_code` 的 Node 文件接口解析；逐行预览可能截断长行。

参数校验失败（例如把 `refs` 写成 `ref`）时，所有 dsh-zotero 工具（8 个本地读工具、15 个写入工具与 scholarly 组件工具）都会在管线的 `invalid arguments` 错误后附一条纠错提示，同时指明被拒绝的参数名与声明的参数名。匹配忽略大小写与 `_`/`-`，相邻字符换位计为一次编辑。提示仅在存在唯一近似匹配时出现，标明拒绝与建议参数。

全部 30 个工具的参数根对象均关闭：任何未声明参数都会在执行、网络请求和审批之前以 `INVALID_ARGS` 拒绝。

所有写工具的 `{kind:"declined"}` 均可携带 `feedback`：用户在计划卡输入的修改意见会完整返回模型，并显示为独立的用户反馈正文。自由文本始终拒绝当前计划；模型需要根据意见重新制定计划并再次请求批准。

正文使用 `AttachmentStore.saveFileStream`，校验后的回执写入 `zotero_results` storage domain。超预算或受管理后台结果需要这两项服务；保存、索引、取消及完整性校验失败均明确报错。附件后端不支持文件时返回 `ZOTERO_OUTPUT_TOO_LARGE`，提示配置支持文件的后端后重新读取。所属 Zotero 后台任务成功后，`job_output` 追加同一文件引用并保留官方 canonical value。PTC 嵌套调用传递标准文件附加上下文。原始后台确认保留 `resultSessionId`；重启后可按持久回执读取已保存结果，但不会恢复运行任务。

认证端点 `GET /api/zotero/result?sessionId=<id>&seq=<event>&index=<file>` 仅读取持久事件坐标指向的文件，或该事件后台确认对应的已核实回执，不接收任意路径或附件 ID。复制和下载须等待流完整结束并通过校验。附件遵循宿主生命周期，可能在会话结束后继续占用磁盘；插件不自行删除共享文件。

---

## zotero_search

输出字段（按结果臂）： `items`、`maximum`、`nextActions`、`nextOffset`、`normalizedQuery`、`offset`、`queryWasEmpty`、`returned`、`scope`、`supplemental`、`total`。
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
| `limit`       | integer                        | `10`                | 每页条目数：1..`maxSearchResults`（默认上限 20），超出报错                                                                                                |

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

输出字段（按结果臂）： `abstract`、`abstractTruncated`、`annotations`、`attachments`、`bestAttachment`、`children`、`citationKey`、`citationKeyConflict`、`citationKeySource`、`collections`、`contentType`、`creators`、`date`、`doi`、`extra`、`extraFields`、`itemType`、`location`、`noteBody`、`notes`、`path`、`ref`、`relations`、`serverId`、`tags`、`title`、`url`、`venue`、`version`、`year`。
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

输出字段（按结果臂）： `counts`、`items`。
按输入顺序批量读取已知条目或附件 ref。每条结果独立报告成功或失败；最多 50 条唯一 ref，实际并发为 `max(1, min(8, graphConcurrency, maxInFlightRequests - 1))`，在传输容量允许时为交互读取保留一个槽位。单条 `zotero_get` 用于一个 ref；多个 ref 使用本工具。

### 参数

| 参数      | 类型     | 默认值       | 说明                                                                                                                    |
| --------- | -------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `refs`    | string[] | —            | 1–50 个唯一条目或附件 ref，按此顺序返回                                                                                 |
| `fields`  | string   | `"standard"` | `standard` 或 `all`；后者保留未消费的 Zotero 数据字段                                                                   |
| `include` | object   | —            | `children` 包含笔记、标注和附件；`attachments` 仅包含附件；`relations:true` 返回关联；`bestAttachment` 解析最佳附件位置 |

附件 ref 批次应将 `include.children` 和 `include.attachments` 保持为 false 或省略。任一选项为 true 时，请求会在发出网络请求前拒绝；条目与附件 ref 请拆分为不同调用。

### 输出

`{items, counts}`。`items` 与 `refs` 同序，每项为 `{ref, status:"ok", item}` 或 `{ref, status:"error", code, message, next?}`；`counts` 含 `requested`、`succeeded`、`failed`。

### 示例

```text
zotero_get_batch(refs=["zotero://user/0/item/ABCD1234", "zotero://user/0/item/EFGH5678"], fields="standard")
```

---

## zotero_match_references

输出字段（按结果臂）： `items`。
将 BibTeX、DOI 或参考文献字段与本地 Zotero 库对账，仅访问本地库。DOI 精确匹配会在每次调用中分页读取一次全部顶层条目的元数据，因为 Zotero 快速搜索不检索 DOI 字段。每次最多 50 条；超过上限时分批。唯一高置信匹配才返回 `matched`；候选不唯一或证据不足时返回 `ambiguous`，citekey 来源冲突时返回 `conflict`。

### 参数

| 参数               | 类型     | 默认值  | 说明                                                                                                  |
| ------------------ | -------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `references`       | object[] | —       | 1–50 条，`inputId` 必须唯一；每条至少提供 `doi` 或 `title`，可附 `bibKey`、`authors`、`year`、`venue` |
| `includeFieldDiff` | boolean  | `false` | 唯一匹配时返回可比较的标题、DOI、年份、作者和来源差异                                                 |

### 输出

`{items}` 与输入同序。每项包含 `inputId`、`status`，搜索页不完整时附 `reason` 且状态为未匹配；匹配项和候选包含 `ref`、`citationKey`、`citationKeySource`（可用时）、`title`、作者、年份、DOI、来源、匹配方法和置信度；`citationKeyConflict` 显式标明冲突。`fieldDiff` 返回可比较的标题、DOI、年份、作者和来源差异，可用于审阅 Bib/TeX 修改。

### 示例

```text
zotero_match_references(references=[{inputId:"ref-1", bibKey:"doe2024", doi:"10.1000/example", title:"A Paper"}, {inputId:"ref-2", title:"Another Paper", authors:["Jane Doe"], year:2023}, {inputId:"ref-3", doi:"10.1000/third"}], includeFieldDiff=true)
```

---

## zotero_retrieve

输出字段（按结果臂）： `artifact`、`attachmentContentType`、`attachmentRef`、`attachments`、`coverage`、`evidence`、`fulltext`、`mode`、`noMatch`、`queryTerms`、`rankedRoutes`、`ref`、`sourcesSkipped`、`textFormat`、`truncated`。
两个互斥模式：`evidence` 从单篇文献的多数据源提取与查询相关的原文片段并排序（核心词面 BM25；启用文档解析组件的本地语义检索后经词面+语义双路线 RRF 融合，每段标注 `matchKind`）；`fulltext` 按字符窗口顺序读取一篇文档（受 `maxFulltextChars` 约束），解析 Markdown 命中时优先使用，未命中回退 Zotero 索引文本。`fulltext` 的 `complete=true` 一次读取整篇有界文档并返回正文或整篇 spill 句柄；省略时按字符窗口顺序读取。

### 参数

| 参数               | 类型     | 默认值     | 说明                                                                                                                                                                                                                                          |
| ------------------ | -------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`             | string   | `evidence` | 读取模式，缺省为 `evidence`。`evidence` 按 query 排序证据片段；`fulltext` 按字符窗口读取一篇文档（受 `maxFulltextChars` 约束）。每个窗口调用都会重新读取来源全文，窗口数约为 `ceil(totalChars/maxChars)`；首个窗口可提供完整文档的 spill 引用 |
| `ref`              | string   | —          | `evidence` 模式：文献条目 ref                                                                                                                                                                                                                 |
| `query`            | string   | —          | `evidence` 模式：排序关键词，最多 2,000 个字符；超出时在读取前拒绝                                                                                                                                                                            |
| `queryVariants`    | string[] | —          | `evidence` 模式：同一问题的其他措辞（同义词、领域术语），至多 4 个；每项最多 2,000 个字符，逐措辞独立排序，段落取各措辞的最好成绩                                                                                                             |
| `sources`          | string[] | 全部 4 种  | `evidence` 模式：检索源 `annotation`、`note`、`abstract`、`fulltext`                                                                                                                                                                          |
| `passages`         | integer  | `4`        | 原文片段数：1..`maxEvidencePassages`，超出报错                                                                                                                                                                                                |
| `attachmentPolicy` | string   | `"best"`   | `evidence` 模式：全文附件选取策略 `best`、`allIndexed`、`specified`                                                                                                                                                                           |
| `attachmentRefs`   | string[] | —          | `evidence` 模式且 `attachmentPolicy="specified"` 时的附件 ref 列表                                                                                                                                                                            |
| `source`           | object   | —          | `fulltext` 模式：恰好一个来源。`kind="ref"` 用 `ref` 指定 Zotero 附件；`kind="artifactId"` 用 64 位小写十六进制 `artifactId` 指定已解析产物（格式不符按参数错误拒绝）                                                                         |
| `complete`         | boolean  | —          | `fulltext` 模式：一次读取整篇有界文档；结果为完整正文或整篇 `spillRef` 句柄。与 `start`、`maxChars`、`continuation` 互斥                                                                                                                      |
| `start`            | integer  | `0`        | `fulltext` 模式：本次窗口的起始字符偏移                                                                                                                                                                                                       |
| `maxChars`         | integer  | —          | `fulltext` 模式：每个窗口字符数，缺省取 `fulltextWindowChars`，不得超过它                                                                                                                                                                     |
| `continuation`     | string   | —          | `fulltext` 模式：上一窗口返回的续读令牌；`start > 0` 时必填。来源或解析代际变化时拒绝续读                                                                                                                                                     |

### 输出

返回结构包含：`mode`；`evidence` 模式含 `ref`、`attachmentRef`、`attachmentContentType`、`coverage`、`attachments`、`evidence`（段落列表，每项含 source、sourceRef、attachmentRef、text、chunkIndex、chunkCount、comment、pageLabel、`matchKind`、matchedFields）、`truncated`、`sourcesSkipped`、`queryTerms`、`rankedRoutes`、`noMatch`；`fulltext` 模式只含 `mode` 与 `fulltext`（`sourceKind`、`sourceLabel`、`item`、`attachmentContentType`、`textFormat`、`artifact`、`coverage`、`totalChars`、`inputTruncated`、`start`、`end`、`text`、`isTruncated`、`nextStart`、`continuation`、`attachmentRef`、`spillRef`、`spillAvailable`）。

### 说明

- `matchKind` 标注每段返回原因：`lexical`（原文含查询词，可照原文引用）、`semantic`（仅语义匹配，不按含查询词的原文引用）、`hybrid`（两者）；
- 每个本地附件全文窗口会重新验证附件元数据，有父条目时也验证父条目（每窗 1–2 次元数据读取）。不需要分页时用 `complete=true`；续读期间来源、正文或解析代际变化会返回 `ZOTERO_SOURCE_PAGE_STALE`，此时应从头读取。
- 仅 `annotation` 来源包含页码标签（`pageLabel`）；全文段落不提供页码；
- 不可用或未建立索引的来源记入 `sourcesSkipped`；`noMatch` 取值为 `no-overlap`（已读来源中没有匹配该查询的段落）或 `no-sources`（条目没有可排序段落），描述的是本次查询对本次读取的来源，不证明条目对主题沉默；
- 批注内容将高亮原文与用户评论一并纳入排序，`matchedFields` 标注匹配来源为 `text` 或 `comment`；语义命中的段落不标注字段（措辞无重合）；
- 多附件策略下，未索引的附件明确标注为 `unindexed`，未读取的附件标注为 `unread`；
- `fulltext` 的 `complete=true` 一次读取整篇有界文档：文档在交付预算内时返回完整正文；超出时由宿主 spill 存储给出整篇句柄（`spillRef`），此时 `text` 为空且 `spillAvailable` 为 `true`。`complete` 与 `start`、`maxChars`、`continuation` 互斥。省略 `complete` 时从 `start=0` 开始，按 `nextStart` 并携带上一窗口返回的 `continuation` 令牌续读直到 `isTruncated` 为 `false`；`start > 0` 须携带该令牌；来源标识、字符数或文本摘要不一致时拒绝续读以确保代际一致。`totalChars`、`start`、`end`、`nextStart` 均按 UTF-16 码元计数，窗口边界不拆分代理对；请求 1 码元且窗口从代理对开始时会返回完整的 2 码元。顺序拼接即完整文档（`inputTruncated` 为 `true` 时覆盖 `maxFulltextChars` 允许的有界部分）。`textFormat` 为 `markdown` 时来自解析产物，为 `text` 时来自 Zotero 全文索引；未命中产物时 `source.kind="ref"` 使用索引文本，`source.kind="artifactId"` 命中失败时返回明确错误。解析产物窗口没有 `coverage`；索引文本窗口带 Zotero 自身的索引覆盖率。首窗口在还有后续窗口、文档较长且宿主提供 spill 存储时会带 `spillRef`（`locator`、`bytes`、`retrievalHint`）与 `spillAvailable: true`，给出整篇有界文本的一次性取值句柄。默认窗口和交付预算下结果走内联交付，增大窗口或调低内联预算时可能落为 file 交付，文件保留完整窗口与后续位置。读取使用已有来源；解析、下载和上传由独立操作触发。

### 示例

```text
zotero_retrieve(mode="evidence", ref="zotero://user/0/item/ABCD1234", query="attention mechanism", sources=["annotation", "fulltext"], passages=6)
zotero_retrieve(mode="fulltext", source={kind: "ref", ref: "zotero://user/0/attachment/EFGH5678"}, start=0)
zotero_retrieve(mode="fulltext", source={kind: "ref", ref: "zotero://user/0/attachment/EFGH5678"}, complete=true)
```

---

## zotero_export

输出字段（按结果臂）： `citations`、`format`、`items`、`jobId`、`kind`、`locale`、`message`、`outputFile`、`resultSessionId`、`style`、`text`、`timeoutMs`。
文件导出可传 `outputFile`（非空路径，适用于书目、translator 文本及 `csv` 格式，不适用于 `citation`）。文件路径按调用会话的当前工作目录解析，由 Harness 文件系统按该会话的沙箱策略写入；写入失败会使工具或后台任务失败。前台、显式后台和超时提升均在文件写入与超预算或后台所需的内部持久化完成后才结束。写盘不等于会话交付：需要把文件列入本次会话的交付物时，由模型另行调用 Harness 的 `present` 工具声明该路径。

生成格式化引用或导出数据文件。

全部导出格式均要求 refs 中的条目身份唯一；同一库与 key 即使混用带 server 与不带 server 的 ref，也视为重复，在发起请求之前拒绝。

### 参数

| 参数         | 类型     | 默认值                       | 说明                                                                                        |
| ------------ | -------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `refs`       | string[] | —                            | 条目 ref 列表（必填，单次受配置文件字段 `maxExportRefs` 限制，默认 50）                     |
| `format`     | string   | —                            | 导出格式：`citation`、`bibliography`、`bibtex`、`biblatex`、`ris`、`csljson`、`csv`（必填） |
| `style`      | string   | 配置默认值                   | CSL 样式标识（仅用于 citation 和 bibliography）                                             |
| `locale`     | string   | 配置默认值（默认 `"en-US"`） | CSL 语言环境（仅用于 citation 和 bibliography；默认取配置 `defaultLocale`）                 |
| `outputFile` | string   | —                            | 可选的会话工作区路径，把书目、translator 文本或 CSV 写入该文件（`citation` 不接受）         |

`run_in_background` 不是恒声明参数：仅当 `enableRunInBackground=true` 且宿主挂载了 `jobs` 服务时才出现在参数中；未声明时传 `true` 仍会得到结构化拒绝（`INVALID_ARGS` / `TOOL_CONTEXT_UNAVAILABLE`）。

### 输出

前台同步完成时：

- `citation`：`{citations: [{ref, text}]}`；
- `bibliography`：`{text}`；
- `bibtex` / `biblatex` / `ris` / `csljson`：`{text, items: [{ref, citationKey, exportKey, title, entryIndex, start, end}]}`；`citationKey` 是 Zotero 原生/extra citekey，`exportKey` 是 translator 生成词条键；
- `csv`：`{text}`（Zotero 自身的整表导出，无逐条目定位）。

`start` 与 `end` 以 UTF-16 码元表示正文中的非空区间，并同时出现。CSL JSON 使用 `entryIndex` 定位，未能定位的条目保留 ref。

后台执行（或前台等待超时自动提升）时：
返回 `{kind: "background", jobId}` 或 `{kind: "promoted", jobId, timeoutMs, message}`。任务进度在 Web 会话顶栏与日志中展示，完成后结果写入 Job 产物。

### 说明

- refs 总数受配置文件字段 `maxExportRefs` 限制（默认 50）。除 `citation` 外的 6 种格式（`bibliography`、`bibtex`、`biblatex`、`ris`、`csljson`、`csv`）单次调用最多 50 条；超出时返回错误；
- `citation` 是唯一会分批的格式：refs 数超过 50 时按 50 一组分批请求。配置文件字段 `maxExportRefs` 默认同为 50，因此需先在配置文件中将该字段调至 50 以上，分批才会实际发生；
- `bibtex`、`biblatex`、`ris`、`csljson` 各使用 1 次 translator 请求和 1 次有界原始元数据批处理，用于 citekey 与字段对齐。返回内容在内存中解析，每条记录按 key 或元数据指纹与 ref 配对；无法定位的 ref 在结果中只保留自身。元数据请求失败（如 Zotero 返回 5xx）时导出照常完成：正文原样返回，未能配对的 ref 保持仅有 `ref` 的裸形状。调用方取消（abort）仍会抛出；
- 单次导出仅允许同一 library 的 refs，不支持跨库混合导出。

### 示例

```text
zotero_export(refs=["zotero://user/0/item/ABCD1234", "zotero://user/0/item/EFGH5678"], format="bibtex")
zotero_export(refs=["zotero://user/0/item/ABCD1234", "zotero://user/0/item/EFGH5678"], format="bibtex", run_in_background=true)
```

---

## zotero_browse

输出字段（按结果臂）： `items`、`kind`、`library`、`libraryVersion`、`maximum`、`nextOffset`、`offset`、`returned`、`serverId`、`total`。
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
| `limit`         | integer | `20`                    | 每页条目数：1..`maxBrowseResults`（默认上限 50），超出报错                                                              |

### 输出

所有浏览结果包含 `kind`、`items`、`total`、`offset`、`returned` 与配置上限 `maximum`，有下一页时含 `nextOffset`；合集和保存检索另有 `libraryVersion`。卡片按行数及字节预算显示完整行的前缀，并标明未展示数量；模型收到的规范页面不受卡片裁剪影响。

各 `kind` 返回对应的结构化数组：

- `libraries`：`{library, name}`
- `collections`：`{ref, name, parentRef?, path, depth, childCount?, itemCount?}`（`childCount`/`itemCount` 为 Zotero 报告的直属子合集数与直属条目数，缺省表示未报告；`childCount` 为 0 即确认无子合集）
- `savedSearches`：`{ref, name, conditions?}`
- `tags`：`{tag, count?}`
- `itemTypes`：`{itemType, localized?}`
- `itemFields`：`{field, localized?}` 或 `{creatorType, localized?}`

合集与保存搜索的结果还包含顶层 `libraryVersion`，来自有效的 `Last-Modified-Version` 响应头；缺失或非法版本会报错。

### 示例

```text
zotero_browse(kind="collections", library={type:"group", id:42}, limit=20)
zotero_browse(kind="tags", q="review", match="contains")
```

---

## zotero_changes

输出字段（按结果臂）： `changed`、`cursor`、`deleted`、`fromVersion`、`jobId`、`kind`、`library`、`libraryChanged`、`message`、`resultSessionId`、`serverId`、`timeoutMs`、`totals`、`truncated`、`unobservable`、`versionUnavailable`。
基于本地事务版本获取文献库的增量更新与删除记录。

### 参数

| 参数      | 类型     | 默认值                  | 说明                                                                           |
| --------- | -------- | ----------------------- | ------------------------------------------------------------------------------ |
| `library` | object   | `{type: "user", id: 0}` | 目标库标识                                                                     |
| `since`   | object   | —                       | 起始游标 `{serverId, library, version, include, unserved}`；省略则获取初始基线 |
| `include` | string[] | 除 fulltext 外全部      | 监测范围：`items`、`collections`、`savedSearches`、`fulltext`、`deleted`       |

`run_in_background` 不是恒声明参数：仅当 `enableRunInBackground=true` 且宿主挂载了 `jobs` 服务时才出现在参数中；未声明时传 `true` 仍会得到结构化拒绝（`INVALID_ARGS` / `TOOL_CONTEXT_UNAVAILABLE`）。

### 输出

超过前台等待预算时，执行转为后台并返回 `kind="promoted"`、`jobId`、`message`、`timeoutMs`；通过 `job_output` 获取最终结果。显式后台提交返回 `kind="background"`，最终业务结果不随这两种回执返回。

前台同步完成时返回：
`{library, serverId?, fromVersion?, cursor?, libraryChanged?, versionUnavailable?, changed, deleted?, totals?, unobservable?, truncated?}`。

- `changed`：按资源类型列出变更对象（`items`、`childItems`、`trashedItems`、`collections`、`savedSearches`、`fulltextAttachments`）；
- `include:["fulltext"]` 读取当前全文索引清单（`/fulltext?since=0`），返回各附件的全文索引版本；它不是从库事务游标计算的增量，不能据此判断附件何时重新索引。
- `deleted`：包含已删除条目的 key 或标签名；
- `cursor`：仅在当前批次完整读取且期间未发生并发写入时返回，用于后续增量请求。`cursor.include` 仅包含当前 Zotero 版本实际支持跟踪的资源类别；未提供对应端点的类别（如缺少 `/deleted` 路由的旧版本）会记入 `cursor.unserved`，不计入覆盖声明，但后续增量请求仍可原样带回；
- `unobservable`：标明因版本或端点限制无法观测的资源类别及原因。端点未提供（`not-served`）不影响游标生成；若存在不支持的键范围（`range-not-covered`）或读取失败（`unreadable`），当前批次将不返回游标，防止推进游标时遗漏未成功读取的变更行。

每个 `changed` / `deleted` 资源列表最多返回配置文件字段 `maxChangesResults` 条（默认 50），这会限制模型拿到的规范结果列表；`totals` 保留真实数量，`truncated` 标记超限。工具完整读取上游版本映射后才签发游标；列表截断只限制模型可见行数，不影响游标的签发。

较大的版本区间可能超过配置文件字段 `maxResponseBytes`，导致 `ZOTERO_RESPONSE_TOO_LARGE`，本次调用不返回新游标。需要保留该区间时，在配置文件中提高响应字节预算并使用原 `since` 重试。省略 `since` 只会建立当前基线，不会补回期间变更；全量重新同步后才可将该新基线用于后续增量。

### 示例

```text
zotero_changes()
zotero_changes(since={serverId: "server1", library: {type: "user", id: 0}, version: 1234, include: ["items", "deleted"], unserved: []}, include=["items", "deleted"])
```

---

## zotero_create_note

输出字段（按结果臂）： `collections`、`committed`、`completedRefs`、`feedback`、`key`、`kind`、`libraryVersion`、`parentItem`、`parentRef`、`reason`、`ref`、`retryable`、`serverId`、`sourceRefs`、`tags`、`version`。
创建独立研究笔记或挂载在指定条目下的子笔记。

### Markdown 语法支持

传入的 `markdown` 文本会在写入前转换为 Zotero 7+ 原生支持的受限 HTML 白名单（未知语法均安全退化为字面文本）：

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

`committed-unverified` 表示写入可能已经提交：不可重试；请按回执中的 ref、key 或服务器事实先核对 Zotero 的最终状态。

## zotero_update_item_tags

输出字段（按结果臂）： `added`、`committed`、`completedRefs`、`feedback`、`key`、`kind`、`libraryVersion`、`parentRef`、`reason`、`ref`、`removed`、`retryable`、`serverId`、`tags`、`unchanged`、`version`。
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

提交后无法核验时返回 `{kind: "committed-unverified", committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}`。须视为已经提交，在 Zotero 中核对，不可重试。

### 示例

```text
zotero_update_item_tags(ref="zotero://user/0/item/ABCD1234", add=["深度学习", "精读"], remove=["待读"])
```

---

## zotero_update_item_collections

输出字段（按结果臂）： `added`、`collections`、`committed`、`completedRefs`、`feedback`、`key`、`kind`、`libraryVersion`、`parentRef`、`reason`、`ref`、`removed`、`retryable`、`serverId`、`unchanged`、`version`。
在一次调用中完成条目在合集之间的加入与退出。合集参数可以是 `zotero://user/0/collection/<KEY>` ref 或精确名称（`zotero_browse` 可列出）；名称解析失败先于任何写入。

审批前读取目标，子条目继承父条目的合集归属，须改为修改父条目；批准后再次读取并使用当前版本写入。

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

提交后无法核验时返回 `{kind: "committed-unverified", committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}`。须视为已经提交，在 Zotero 中核对，不可重试。

### 示例

```text
zotero_update_item_collections(ref="zotero://user/0/item/ABCD1234", add=["方法论"], remove=["旧合集"])
```

---

## zotero_create_collection

输出字段（按结果臂）： `committed`、`completedRefs`、`feedback`、`key`、`kind`、`libraryVersion`、`name`、`parentRef`、`reason`、`ref`、`retryable`、`serverId`、`version`。
创建合集（顶层或挂在某个父合集之下）。

审批前读取父合集及完整同级列表，已存在同名合集时直接拒绝；批准后再次检查，防止审批期间新增同名合集。

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

输出字段（按结果臂）： `committed`、`completedRefs`、`deleted`、`feedback`、`key`、`kind`、`libraryVersion`、`parentRef`、`reason`、`ref`、`retryable`、`serverId`、`version`。
删除合集。**不可逆**：合集的组织结构被移除，条目仍保留在文献库中，子合集随父合集一起删除。计划卡会先列出该合集的直属条目数与全部层级的后代合集总数（任一层级读取失败会终止预检，不能进入删除审批），删除携带前置读到的库版本。

### 参数

| 参数         | 类型   | 必填 | 说明                                                            |
| ------------ | ------ | ---- | --------------------------------------------------------------- |
| `collection` | string | ✓    | 要删除的合集：`zotero://user/0/collection/<KEY>` ref 或精确名称 |

### 输出

- 删除成功：`{kind: "deleted", ref, key, deleted: true, libraryVersion, serverId?}`；
- 计划卡拒绝：`{kind: "declined"}`。

提交后无法核验时返回 `{kind: "committed-unverified", committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}`。须视为已经提交，在 Zotero 中核对，不可重试。

### 示例

```text
zotero_delete_collection(collection="田野笔记")
```

---

## zotero_create_item

输出字段（按结果臂）： `collections`、`committed`、`completedRefs`、`feedback`、`itemType`、`key`、`kind`、`libraryVersion`、`parentRef`、`reason`、`ref`、`retryable`、`serverId`、`tags`、`title`、`version`。
从闭合字段集创建文献条目。Zotero 的 `POST /items` 只接受 Zotero 条目 JSON，因此没有 BibTeX/CSL-JSON 入口，字段逐个装配。

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

输出字段（按结果臂）： `committed`、`completedRefs`、`feedback`、`key`、`kind`、`libraryVersion`、`parentRef`、`reason`、`ref`、`retryable`、`serverId`、`version`。
使用 Markdown 替换现有 Zotero 笔记正文。写入前读取笔记版本，并在 PATCH 中转换为 Zotero 安全 HTML；目标必须是 `itemType="note"`。

支持独立笔记和子笔记，读取版本不要求子对象具有合集字段。创建和更新均在审批前校验原始 Markdown 的 `writeNoteMaxChars` 上限，按 JavaScript 字符串长度计数，包含空白和标记，不自动截断。

审批前读取目标并核实其类型，非笔记直接拒绝；批准后再次读取并核实类型与版本。

### 参数与输出

| 参数       | 类型   | 必填 | 说明               |
| ---------- | ------ | ---- | ------------------ |
| `ref`      | string | ✓    | 笔记条目 ref       |
| `markdown` | string | ✓    | 新的 Markdown 正文 |

成功返回 `{kind: "applied", ref, version, libraryVersion, serverId?}`；拒绝计划卡返回 `{kind: "declined"}`，版本冲突返回 `ZOTERO_WRITE_CONFLICT`。

提交后无法核验时返回 `{kind: "committed-unverified", committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}`。须视为已经提交，在 Zotero 中核对，不可重试。

### 示例

```text
zotero_update_note(ref="zotero://user/0/item/NOTE1234", markdown="## 方法总结\n- 要点一")
```

---

## zotero_update_collection

输出字段（按结果臂）： `committed`、`completedRefs`、`feedback`、`key`、`kind`、`libraryVersion`、`name`、`parentRef`、`reason`、`ref`、`retryable`、`serverId`、`version`。
更新合集名称或父合集。`name` 与 `parent` 均未提供、名称为空、目标不存在、父合集不属于个人库或版本前置条件失效时拒绝写入；`parent` 省略表示保留现有父级，原生调用可传 `null` 将其移到顶层。

### 参数与输出

| 参数         | 类型   | 必填 | 说明         |
| ------------ | ------ | ---- | ------------ |
| `collection` | string | ✓    | 合集 ref     |
| `name`       | string | —    | 新名称       |
| `parent`     | string | —    | 新父合集 ref |

成功返回 `{kind: "applied", ref, version, libraryVersion, serverId?}`；计划卡拒绝返回 `{kind: "declined"}`。

提交后无法核验时返回 `{kind: "committed-unverified", committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}`。须视为已经提交，在 Zotero 中核对，不可重试。

### 示例

```text
zotero_update_collection(collection="zotero://user/0/collection/COLL0001", name="田野笔记（2026）")
```

---

## zotero_restore_items

输出字段（按结果臂）： `failed`、`feedback`、`kind`、`restored`、`serverId`、`unverified`。
将个人库 Trash 中指定的条目恢复为活动状态。按对象图读取版本，再按依赖层用原生批次（单个对象用 PATCH）写入 `deleted: 0`，逐项返回成功或失败，最多 50 个根条目。

### 参数与输出

| 参数   | 类型     | 必填 | 说明                  |
| ------ | -------- | ---- | --------------------- |
| `refs` | string[] | ✓    | 要恢复的条目 ref 列表 |

输出为 `{kind: "restored" | "partial" | "failed", restored, unverified, failed, serverId?}`；全部确认恢复或本来正常时为 `kind: "restored"`，含失败或未核验结果时为 `kind: "partial"`，全部明确失败时为 `kind: "failed"`。版本冲突记录在 `failed`，回执未知记录在 `unverified`。

支持子笔记、子附件和批注。结果正文完整列出成功对象的 ref、版本、库版本，以及失败和未核验对象的 ref、错误码或原因；卡片根据实际结果显示恢复数、未核验数与失败数，未核验回执必须先按 ref/key 核对，禁止重试。

未获批准返回 `{kind: "declined"}`，不执行写入。

### 示例

```text
zotero_restore_items(refs=["zotero://user/0/item/ABCD1234", "zotero://user/0/item/EFGH5678"])
```

---

## zotero_create_saved_search

输出字段（按结果臂）： `committed`、`completedRefs`、`conditions`、`feedback`、`key`、`kind`、`libraryVersion`、`name`、`parentRef`、`reason`、`ref`、`retryable`、`serverId`、`version`。
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

`committed-unverified` 表示写入可能已经提交：不可重试；请按回执中的 ref、key 或服务器事实先核对 Zotero 的最终状态。

## zotero_update_saved_search

输出字段（按结果臂）： `committed`、`completedRefs`、`conditions`、`feedback`、`key`、`kind`、`libraryVersion`、`name`、`parentRef`、`reason`、`ref`、`retryable`、`serverId`、`version`。
更新个人库中已有保存搜索的名称或匹配条件。更新使用对象版本前置条件；提供 `conditions` 时必须至少包含一条条件。

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

`committed-unverified` 表示写入可能已经提交：不可重试；请按回执中的 ref、key 或服务器事实先核对 Zotero 的最终状态。

## zotero_delete_saved_search

输出字段（按结果臂）： `committed`、`completedRefs`、`deleted`、`feedback`、`key`、`kind`、`libraryVersion`、`parentRef`、`reason`、`ref`、`retryable`、`serverId`、`version`。
删除个人库中的指定保存搜索。**不可逆**：删除操作仅移除保存搜索定义本身，文献库中的条目不受影响。删除使用库版本前置条件。

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

`committed-unverified` 表示写入可能已经提交：不可重试；请按回执中的 ref、key 或服务器事实先核对 Zotero 的最终状态。

## scholarly_save_to_zotero

输出字段（按结果臂）： `collections`、`committed`、`completedRefs`、`feedback`、`itemType`、`key`、`kind`、`libraryVersion`、`papers`、`parentRef`、`reason`、`ref`、`retryable`、`serverId`、`tags`、`title`、`version`。

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

该工具仅在本地 Zotero 组件挂载且 `writeEnabled=true` 时向模型注册。

将学术检索结果通过本地写入审批流程保存到个人库。输出为 `declined`、`applied` 或 `committed-unverified` 的联合类型。仅 `applied` 附带成功保存的 `papers`，并保留创建条目的 ref、key、版本、标签、合集与库版本；未核验结果保留原始身份及原因，并进入对账流程。卡片和会话回放通过持久化的正文与状态元数据区分三种结果。

#### 示例

```text
scholarly_save_to_zotero(itemType="journalArticle", title="Attention Is All You Need", doi="10.48550/arXiv.1706.03762")
```

---

`committed-unverified` 表示写入可能已经提交：不可重试；请按回执中的 ref、key 或服务器事实先核对 Zotero 的最终状态。

## zotero_update_item

输出字段（按结果臂）： `changed`、`committed`、`completedRefs`、`feedback`、`key`、`kind`、`libraryVersion`、`parentRef`、`reason`、`ref`、`retryable`、`serverId`、`unchanged`、`version`。
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

提交后无法核验时返回 `{kind: "committed-unverified", committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}`。须视为已经提交，在 Zotero 中核对，不可重试。

### 示例

```text
zotero_update_item(ref="zotero://user/0/item/ABCD1234", set={"title": "Attention Is All You Need (2017)", "doi": "10.48550/arXiv.1706.03762"})
```

---

## zotero_delete_library_tags

输出字段（按结果臂）： `absentTags`、`committed`、`completedRefs`、`deletedTags`、`feedback`、`key`、`kind`、`libraryVersion`、`parentRef`、`reason`、`ref`、`retryable`、`serverId`、`version`。
按名称在全库范围删除标签。**不可逆**：标签会从文献库中的每个条目上移除。计划卡按名称查询包含子条目的标签前缀列表，每个名称最多读取两页；列出精确匹配标签的条目数。标签未给计数或两页后仍有未读结果时显示 `unknown items`；只有完整读完该名称的筛选列表且仍无精确匹配，才列为「确证无效（proven no-ops）」。读取失败时各项显示 `unknown items`，删除前重新扫描标签并核对所有页的库版本；版本变化拒绝执行，只把确证存在的名称提交给 Zotero。未核验回执必须先核对，禁止重试。

### 参数

| 参数   | 类型     | 必填 | 说明                                                              |
| ------ | -------- | ---- | ----------------------------------------------------------------- |
| `tags` | string[] | ✓    | 要删除的标签名（1..`writeListMaxItems`，单次不超过服务端上限 50） |

### 输出

- 删除成功：`{kind: "deleted", deletedTags, absentTags?, libraryVersion, serverId?}`（`deletedTags` 仅列出同一库版本下确证存在并提交删除的名称，按名称排序；`absentTags` 单列确证不存在的名称，不计入删除数；全部不存在时不发起写入或授权）；
- 计划卡拒绝：`{kind: "declined"}`。

提交后无法核验时返回 `{kind: "committed-unverified", committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}`。须视为已经提交，在 Zotero 中核对，不可重试。

### 示例

```text
zotero_delete_library_tags(tags=["旧标签", "废弃"])
```

---

## zotero_batch_items

输出字段（按结果臂）： `created`、`deleted`、`failed`、`feedback`、`kind`、`libraryVersion`、`serverId`、`total`、`unverified`、`updated`。
在单次调用中批量创建文献、更新标签与合集归属，或将条目及其子笔记、附件和批注移至回收站。条目删除按依赖层用逐对象版本前置的原生批次（单个对象用 PATCH）将整个对象图标记为已删除，完成后重新读取并核验；部分失败时 `failed.completedRefs` 列出已确认移入回收站的对象。此操作可从 Zotero 回收站恢复。所有操作合并为一张计划卡确认，卡片完整列出每个创建请求的全部字段与合集归属。各项操作独立执行，整批可能只完成一部分；请按回执逐项核对结果。

单次操作总数（创建、更新与删除之和）受 `writeListMaxItems` 限制（默认 50 项）。每项创建的回执按输入索引列出 Zotero 保存后的 ref、key、版本及可用的标题/URL。若某项创建的提交或已保存状态无法核实，它会出现在 `unverified` 中并标记 `retryable: false`，应按 ref/key 核对。异常的批次索引作为未核实结果报告。单个条目的版本冲突（HTTP 412）记录到 `failed` 数组中，不影响其余条目执行。

### 参数

| 参数     | 类型     | 必填 | 说明                                                                                                                          |
| -------- | -------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| `create` | object[] | —    | 批量创建的条目列表。每项包含 `itemType`（必填）、`title` 或 `url`，可选提供 `tags`、`collections`、`creators` 等字段          |
| `update` | object[] | —    | 批量更新标签或合集的条目列表。每项包含 `ref`（必填），可选提供 `addTags`、`removeTags`、`addCollections`、`removeCollections` |
| `delete` | string[] | —    | 移至回收站（Trash）的条目 ref 列表（`zotero://user/0/item/<KEY>`）                                                            |

`create`、`update` 与 `delete` 至少提供一项，总数不得超过上限。

### 输出

- 批量执行结果：`{kind: "applied" | "partial" | "failed", total, created: [...], updated: [...], deleted: [...], unverified: [...], failed: [...], libraryVersion?, serverId?}`；
  - `kind: "partial"` 表示部分操作已完成，其余操作失败或待核验；`kind: "failed"` 表示所有操作均失败。
  - `created`: `[{index, ref, key, version, itemType, title?, url?}]`，字段来自 Zotero 保存后的对象；
  - `updated`: `[{ref, unchanged, addedTags, removedTags, addedCollections, removedCollections}]`
  - `deleted`: `[{ref, key, deleted: true, version, children: [ref...]}]`，列出已核验移入回收站的根条目与所有后代；
  - `unverified`: `[{op: "create" | "update" | "delete", index, committed: true, retryable: false, reason, key?, ref?, version?, libraryVersion?, serverId}]`；
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
   - 计划审查卡：完整展示提交字段和笔记正文，可控文本经转义或置于完整围栏中，无法引入新的计划指令；经用户确认后执行；未获批准返回 `{kind: "declined"}`。计划正文只使用宿主渲染器支持的 Markdown 子集。
2. 本地 API 鉴权：
   - 写操作必须提供 Zotero 本地签发的 API key；
   - 没有可复用授权时，每个请求均须在 Zotero 本地授权弹窗中确认（允许一次、始终允许或拒绝）。多个独立条目更新共用不超过 50 个对象的原生批次；回收站和恢复批次按子对象先于父对象的依赖顺序执行。一次性授权由一个请求独占；全部弹窗共用每分钟五次的滚动预算，超出时可取消地等待；
   - 开启 `writePersistKey` 时，“始终允许”签发的持久密钥会安全保存在宿主凭据管理器中；设置页「基础设置 → 写入」分组提供撤销入口，撤销在凭据原子修改中移除宿主保存的密钥，下一次写入会重新弹窗。
   - 审批通过后的整个操作有 15 分钟总时限，覆盖排队、授权、写入和核验。完整读改写周期跨传输重建串行执行；取消仍保留未知提交的核对要求。
3. Shell 写入检测（转审批）：
   - 监听器检测指向本地 API 的写命令，并在命令执行前把它转成一次 Harness 审批请求，防止未授权脚本修改文献库。这是 best-effort，不是边界。

   检测只读命令文本，无法覆盖所有路径。下列路径无法被检出：
   - 写入脚本文件后再执行（`bash build.sh`）；
   - 命令文本中不出现端点的解释器调用（URL 在运行时拼出时的 `python -c '...'`、`node -e '...'`）；命令文本中写明端点的解释器调用仍会被检出；
   - 藏在环境变量、heredoc 或编码中的 URL；
   - 配置端口之外的 loopback 端口（例外：对 `/api/users/` 的写请求与 authorize 调用在任意 loopback 端口都会被检出）；
   - `run_code` 的程序可在运行时构造网络请求，未进入 shell 文本检测；
   - 用户自有的任何二进制。

   系统提示约束模型只使用写工具；绕开写工具的 shell 直写，由上述检测转成的审批把关。若要 shell 完全无法触碰文献库，应让会话不带无约束 shell：按 agent 使用 `tools.restrict({ deny: ["bash"] })`，或使用不含 shell 的预设。另外，被确认放行的原始写入运行在插件写域之外，因此没有计划卡、版本前置、Markdown 到笔记 HTML 的转换或 provenance。用户确认时同时接受这一范围。

---

## 错误码

Remote 接口还提供按故障类别划分的 `zotero/*` reason，供宿主与外部客户端分流；`details.code` 保留本表的具体领域码。reason 是公开 wire 契约，插件界面显示消息时不必逐个分支。

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
| `ZOTERO_OUTPUT_TOO_LARGE`                  | 导出内容超出字符数上限，或读取结果的交付回执超出内联预算                                       |
| `ZOTERO_CAPABILITY_UNAVAILABLE`            | 当前 Provider 未声明所需能力                                                                   |
| `ZOTERO_SCHOLARLY_NO_FULLTEXT`             | 学术全文解析未找到可读副本，细分原因见错误消息                                                 |
| `ZOTERO_SCHOLARLY_CREDENTIALS_UNAVAILABLE` | 学术检索配置了凭据引用，但宿主未装载凭据服务                                                   |
| `ZOTERO_SCHOLARLY_CREDENTIAL_UNRESOLVED`   | 学术检索凭据引用非法或未提供有效值                                                             |
| `ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED`  | MinerU 精准模式配置的 Token 凭据引用无法解析                                                   |
| `ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE`       | 主动解析需要会话所属 `ctx.jobs` 与会话控制器，但当前不可用                                     |
| `ZOTERO_ENRICHMENT_OPERATION_CONFLICT`     | 同一操作 id 被以不同目标或配置快照重放                                                         |
| `ZOTERO_ENRICHMENT_TASK_FAILED`            | MinerU 报告解析任务失败（附带其自身原因）                                                      |
| `ZOTERO_ENRICHMENT_OUTPUT_INVALID`         | 解析产物输出目录校验失败                                                                       |
| `ZOTERO_ENRICHMENT_ARCHIVE_INVALID`        | MinerU 返回归档包结构或 zip 安全校验失败                                                       |
| `ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT`      | 文档超过所选接口的体积上限或不是 PDF                                                           |
| `ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE`   | 语义检索已开启，但模型缺失/损坏、随包发布的推理运行时文件缺失或推理失败                        |
| `ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED`  | 本地语义模型在所有镜像源下载失败                                                               |
| `ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_TIMEOUT` | 本地语义模型下载超过总时限                                                                     |
| `ZOTERO_ENRICHMENT_MODEL_DELETE_FAILED`    | 本地语义模型删除失败或路径不安全                                                               |
| `ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND`     | 解析产物编号没有对应的已提交产物                                                               |
| `ZOTERO_ENRICHMENT_ARTIFACT_DELETE_FAILED` | 解析产物清理失败或路径不安全                                                                   |
| `ZOTERO_JOBS_LIMIT_REACHED`                | 解析端点：会话的后台解析任务数已达上限，需要先取回或取消一个未用任务再重试                     |
| `ZOTERO_PROVIDER_UNAVAILABLE`              | 配置的 Provider 未注册或方法未实现                                                             |
| `ZOTERO_UNEXPECTED`                        | 响应数据格式异常或未预期行为                                                                   |
| `ZOTERO_WRITE_UNAUTHORIZED`                | 写入未获授权：密钥缺失、失效或在授权弹窗中被拒绝                                               |
| `ZOTERO_WRITE_APPROVAL_UNAVAILABLE`        | 会话审批或计划审查无法完成交互（无交互通道或系统级异常）                                       |
| `ZOTERO_WRITE_CONFLICT`                    | 写入版本前置条件冲突（412），对象已被外部修改                                                  |
| `ZOTERO_WRITE_RATE_LIMITED`                | Zotero 授权或数据写请求被限流（429）                                                           |

---

## 状态码

以下值是状态视图里的告警，不是工具错误：

| 状态码                            | 说明                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| `ZOTERO_SOURCE_PROJECTION_FAILED` | 全量文献轨迹投影注册失败；面板显示降级状态，本地读取仍可用。 |

## 学术文献检索组件工具 (`dsh-zotero/scholarly`)

bundle 组件 `dsh-zotero/scholarly` 随包发布但默认关闭。在插件管理器「包含的组件」中启用该组件即挂载它，并提供 7 个模型工具：前 6 个为检索、阅读与核验工具（详见下文），第 7 个为写库工具 [`scholarly_save_to_zotero`](#scholarly_save_to_zotero)（详见上文[写入工具](#scholarly_save_to_zotero)）：

其中 `scholarly_search`、`scholarly_read`、`scholarly_verify` 声明 `run_in_background`：结果要么是普通文本，要么是 `{ kind: "background", jobId }` / `{ kind: "promoted", jobId, timeoutMs, message }` 两种作业臂；用 `job_output` 取回结果、`job_kill` 取消。显式后台在 `enableRunInBackground=false` 或宿主未挂载 `jobs` 服务时被结构化拒绝；前台等待超过 `foregroundWaitMs` 自动提升为后台（`promoteOnTimeout=true`），作业结果文本由 `JobOutcome.result` 提供。

### scholarly_search

超过前台等待预算时，执行转为后台并返回 `kind="promoted"`、`jobId`、`message`、`timeoutMs`；通过 `job_output` 获取最终结果。显式后台提交返回 `kind="background"`，最终业务结果不随这两种回执返回。
输出字段（按结果臂）： `checks`、`citations`、`document`、`issues`、`jobId`、`kind`、`message`、`papers`、`resultSessionId`、`spill`、`text`、`timeoutMs`。
跨 arXiv、OpenAlex、Crossref、Semantic Scholar、PubMed、Europe PMC 与 DBLP 的多源文献检索。支持主题短语路由、多路 RRF 融合去重，并自动检查当前本地 Zotero 库中的收藏状态。记录共享正式 DOI、PMID、PMCID 或 arXiv ID 时合并；预印本与正式版等已核实的版本关系合并为一条，各自元数据保留在 `versions` 中。按标题匹配时，标题词集合、第一作者与年份必须一致（年份相差不超过一年）。

#### 参数

| 参数                | 类型     | 默认值        | 说明                                                                                                                                                                                    |
| ------------------- | -------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`             | string   | — (必填)      | 检索主题词、论文标题或作者名                                                                                                                                                            |
| `sources`           | string[] | —             | 可选限制检索的数据源列表（`arxiv`、`openalex`、`crossref`、`semanticscholar`、`pubmed`、`europepmc`、`dblp`）；默认按主题短语表路由                                                     |
| `year_from`         | integer  | —             | 发表起始年份；`sort="date"` 且省略此参数时，默认从上一年起检索                                                                                                                          |
| `year_to`           | integer  | —             | 发表截止年份                                                                                                                                                                            |
| `open_access`       | boolean  | —             | 是否仅返回具有免费开放获取全文的文献                                                                                                                                                    |
| `sort`              | string   | `"relevance"` | 排序方式：`relevance`（相关度）、`date`（按日期重排候选：arXiv 按提交日期召回，其余源取相关度前 `min(50, 3×limit)` 条；省略 `year_from` 时从上一年起检索）、`citations`（引用最多优先） |
| `categories`        | string[] | —             | arXiv 分类过滤（如 `cs.CL`、`stat.ML`）                                                                                                                                                 |
| `limit`             | integer  | `8`           | 返回论文数量上限                                                                                                                                                                        |
| `abstract`          | string   | `"snippet"`   | 摘要展示程度：`none`、`snippet`、`full`                                                                                                                                                 |
| `run_in_background` | boolean  | `false`       | 是否作为后台任务启动（由 Harness `ctx.jobs` 管理，作业 kind 为 `scholarly`；仅在 `enableRunInBackground=true` 且宿主挂载 `jobs` 服务时声明，未声明时传 `true` 会得到结构化拒绝）        |

#### 示例

```text
scholarly_search(query="transformer attention", limit=5)
```

---

### scholarly_get

输出字段（按结果臂）： `checks`、`citations`、`document`、`issues`、`papers`、`spill`、`text`。
通过 DOI、arXiv ID、PMID、PMCID、含这些标识符的 URL 或精确标题直接聚合获取单篇论文的完整学术图谱元数据（作者、出版物、摘要、引用次数、开放获取全文链接与本地 Zotero 库匹配状态）。同一论文的预印本/正式版等版本关系保留在 `versions` 中，各自携带标题、年份、venue、DOI、摘要与撤稿状态。

#### 参数

| 参数 | 类型   | 默认值   | 说明                                                                                                    |
| ---- | ------ | -------- | ------------------------------------------------------------------------------------------------------- |
| `id` | string | — (必填) | DOI（如 `10.1038/nature1234`）、arXiv ID（如 `2301.07041`）、PMID、PMCID、含这些标识符的 URL 或精确标题 |

#### 示例

```text
scholarly_get(id="10.1038/nature1234")
```

#### 失败语义

某个索引无法应答（限流、超时、服务错误）时，结果中会以 `Unanswered sources: <索引名> (<原因>)` 列出该索引，成功命中的结果附带 `Notice: <索引名> (<原因>)`。原因会带上底层传输 code（如 `fetch failed (UND_ERR_INVALID_ARG)`、`fetch failed (ECONNRESET)`），便于区分本地组合错误与网络故障。只有全部索引均正常应答且无匹配时，结果才提示核对标识符；部分索引缺失应答只说明本次覆盖不全。

---

### scholarly_citations

输出字段（按结果臂）： `checks`、`citations`、`document`、`issues`、`papers`、`spill`、`text`。
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

超过前台等待预算时，执行转为后台并返回 `kind="promoted"`、`jobId`、`message`、`timeoutMs`；通过 `job_output` 获取最终结果。显式后台提交返回 `kind="background"`，最终业务结果不随这两种回执返回。
输出字段（按结果臂）： `checks`、`citations`、`document`、`issues`、`jobId`、`kind`、`message`、`papers`、`resultSessionId`、`spill`、`text`、`timeoutMs`。
合法开放获取全文分层读取与段落级证据定位。支持目录大纲提取（outline）、章节精准读取（section）与基于自然语言问题的证据段落匹配（query）。

#### 参数

| 参数                | 类型     | 默认值   | 说明                                                                                                                                                                             |
| ------------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | string   | — (必填) | arXiv ID、DOI、PMID、PMCID 或 PDF 直链                                                                                                                                           |
| `outline`           | boolean  | —        | 设为 `true` 仅返回多级章节目录与字符跨度                                                                                                                                         |
| `section`           | string   | —        | 指定章节编号或标题进行精读（如 `"2"` 或 `"Methodology"`）                                                                                                                        |
| `query`             | string   | —        | 自然语言问题，在全文段落中排序检索最相关的证据片段（与 `zotero_retrieve` 同一排序策略与同一切分边界）；最多 2,000 字符，超出时在读取前拒绝                                       |
| `queryVariants`     | string[] | —        | 同一问题的其他措辞（同义词、领域术语），至多 4 个；每项最多 2,000 字符，逐措辞独立排序，段落取各措辞的最好成绩                                                                   |
| `passages`          | integer  | `5`      | `query` 模式下返回的最优段落数量（1-12）                                                                                                                                         |
| `start`             | integer  | `0`      | 分块阅读起始字符偏移量                                                                                                                                                           |
| `max_chars`         | integer  | 配置上限 | 单次读取的最大字符数，范围为 1 至配置上限；越界拒绝                                                                                                                              |
| `run_in_background` | boolean  | `false`  | 是否作为后台任务启动（由 Harness `ctx.jobs` 管理，作业 kind 为 `scholarly`；仅在 `enableRunInBackground=true` 且宿主挂载 `jobs` 服务时声明，未声明时传 `true` 会得到结构化拒绝） |

#### 示例

```text
scholarly_read(id="2301.07041", query="attention mechanism")
```

#### 网络边界

检索类工具（`scholarly_search` / `scholarly_get` / `scholarly_citations` / `scholarly_verify`）只访问固定的学术索引主机白名单（`src/scholarly/transport/hosts.ts`），索引臂只允许 HTTPS，并逐跳做公网地址双门校验（词法门 + 解析门），拒绝回环、私网与其他非公网单播地址。全文解析是例外：开放获取 PDF 与 PDF 直链托管在出版商自己的域名上，因此该路径「不走主机白名单」，但仍逐跳校验地址是否为公网（回环与私网答案一律拒绝），重定向最多 5 跳。本机 fake-IP 代理下，白名单索引主机与 HTTPS 全文目标接受 `198.18.0.0/15` 占位地址（身份由已审阅主机名与 TLS 绑定）；明文 HTTP 全文目标仍要求真实公网地址，不接受占位地址。这意味着 `id` 传入的 URL 或其解析出的 PDF 地址可以是任意公网主机，请只读取可信来源的文献链接。

---

### scholarly_cite

输出字段（按结果臂）： `checks`、`citations`、`document`、`issues`、`papers`、`spill`、`text`。
从 doi.org 通过内容协商（由 DOI 注册机构应答）获取标准引用格式。响应按请求格式解析成功并携带匹配 DOI 后，才会成为引用值。

#### 参数

| 参数     | 类型     | 默认值   | 说明                                                                                                                |
| -------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `ids`    | string[] | — (必填) | DOI、arXiv ID 或 PMID 列表（单次最多 30 篇；超出限制时返回错误）                                                    |
| `format` | string   | — (必填) | 引用格式：`bibtex`、`ris`、`csljson`、`text`（格式化引文）                                                          |
| `style`  | string   | `"apa"`  | 当 `format="text"` 时的 CSL 样式 ID（如 `apa`、`ieee`、`nature`、`china-national-standard-gb-t-7714-2015-numeric`） |
| `locale` | string   | —        | 语言代码（如 `zh-CN`、`en-US`）                                                                                     |

#### 校验与输出

- `csljson`：必须是可解析的单个 CSL 记录（或单元素数组），含非空标题与匹配 DOI。
- `bibtex`：必须具有 `@type{...}` 结构与配对花括号，并含匹配的 `doi` 字段。
- `ris`：必须以 `TY` 字段开始、以 `ER` 字段结束，并含匹配的 `DO` 字段。
- `text`：拒绝空正文、HTML 与明显错误页；纯文本没有可核对的 DOI，身份取请求的标识符。
- `citations` 与 `ids` 等长且保持输入顺序，每项为 `{inputIndex, requestedId, status, resolvedDoi?, value?, reason?}`；只有通过上述校验的项 `status="resolved"`。`issues` 用 `#<1-based index> <requestedId>: <原因>` 指向输入位置。

#### 示例

```text
scholarly_cite(ids=["10.1038/nature1234"], format="bibtex")
```

---

### scholarly_verify

超过前台等待预算时，执行转为后台并返回 `kind="promoted"`、`jobId`、`message`、`timeoutMs`；通过 `job_output` 获取最终结果。显式后台提交返回 `kind="background"`，最终业务结果不随这两种回执返回。
输出字段（按结果臂）： `checks`、`citations`、`document`、`issues`、`jobId`、`kind`、`message`、`papers`、`resultSessionId`、`spill`、`text`、`timeoutMs`。
参考文献真实性与准确性核验工具。每条 entry 可以是完整参考文献，也可以是裸 DOI 或 `doi.org` URL。完整参考文献比较其提供的标题、年份与第一作者；裸 DOI 核对标识符解析结果与撤稿状态，标题/作者/年份标为 `not-compared`。工具将书目信息与 Crossref 官方注册数据库比较，报告伪造文献、DOI 错配、年份差错及撤稿状态；它核对注册表事实，不评估论文是否支持某个论断。

#### 参数

| 参数                | 类型     | 默认值   | 说明                                                                                                                                                                             |
| ------------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `references`        | string[] | — (必填) | 待核验的参考文献或裸 DOI 列表（单次最多 40 条；超出限制时返回错误）                                                                                                              |
| `run_in_background` | boolean  | `false`  | 是否作为后台任务启动（由 Harness `ctx.jobs` 管理，作业 kind 为 `scholarly`；仅在 `enableRunInBackground=true` 且宿主挂载 `jobs` 服务时声明，未声明时传 `true` 会得到结构化拒绝） |

#### 输入形态与比较规则

- 裸 DOI / `doi.org` URL：解析成功且未撤稿为 `VERIFIED`；注册库 404 为 `NOT FOUND`；其余传输失败为 `UNVERIFIED`。
- DOI + 标题：只比较标题，未提供的年份与作者保持 `not-compared`。
- 完整参考文献：标题按 DOI 路径（明显不重合即 DOI 错配）或搜索路径（最近匹配）比较；年份相差不超过 1 年视为一致；第一作者支持机构全名、CJK 姓名、复姓与“名首字母 + 姓”形式。
- `checks` 的每一项包含 `inputKind`（`doi`/`reference`）、`verdict`、`doi`、`foundPaper`、`retracted`、`fields`（`title`/`authors`/`year` 各为 `match`、`mismatch` 或 `not-compared`）与 `notes`。

#### 核验结论

每条 entry 返回四态之一：`VERIFIED`（注册记录存在，且用户提供的字段都一致）、`CHECK`（记录存在但某个提供字段不一致，或已撤稿）、`NOT FOUND`（注册库已应答且无此记录）、`UNVERIFIED`（注册库不可达）。

#### 示例

```text
scholarly_verify(references=["Vaswani et al. 2017, Attention Is All You Need"])
```

所有非 citation 导出（包括面板文本导出和 CSV）会独立读取请求的条目键并核对完整集合。缺失键返回 `ZOTERO_NOT_FOUND`；元数据读取、协议或取消失败保持明确失败，不交付无法核实条目集合的正文。translator 省略某个已确认存在的条目时，该条目仍保留 ref-only 映射；CSV 仍采用 Zotero 的整表输出语义。

全文读取的本地附件会通过 Local API 核对附件元数据及其父条目；`fulltext.item` 携带已核实的父条目 ref、标题、作者摘要与可用年份/刊名，`attachmentContentType` 来自附件记录。独立附件不虚构父条目，URL 产物不读取本地条目。元数据或协议失败保持明确失败。轨迹按父条目合并本地全文读取，并保留实际附件入口；无 Zotero 身份的 URL 产物采用 `artifact:<id>` 键。
