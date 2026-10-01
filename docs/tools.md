<p align="right"><a href="tools.en.md"><b>English</b></a></p>

# 工具参考

dsh-zotero 注册 11 个工具，通过本地 Zotero HTTP API 与文献库交互。其中 3 个写入工具默认关闭，需在设置中显式启用 `writeEnabled`。所有文献引用（ref）均为 `zotero://user/0/item/<KEY>`（个人库）或 `zotero://group/<ID>/item/<KEY>`（群组库）格式的稳定标识符。

### 交互卡片（Toolviews）

在 DSH Web 对话流中，所有 11 个工具均配备结构化只读卡片（`tool.call.toolview`）。调用工具时，界面展示包含状态指示（准备中、运行中、成功、中断、错误、已拒绝）的结构化卡片，支持展开查看详细数据、复制内容以及通过 `zotero://` 链接在本地 Zotero 或 PDF 阅读器中打开。

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

返回对象包含：`scope`、`items`（包含 ref、title、creatorSummary、year、itemType、parentRef、bestAttachmentRef、bestAttachmentType、attachmentSize、extra）、`total`、`offset`、`returned`、`nextOffset`，以及可选的 `supplemental`（包含笔记命中内容 `{kind:"noteBody", items, scanned, truncated}`）。在卡片呈现中，若 `extra` 包含 Citation Key，会以 `[@citekey]` 形式显示。

### 说明

在初次查询（offset 0）且搜索范围为 `library` 或 `collection` 时，插件会扫描笔记正文，命中条目列入 `supplemental.items`。`items` 与 `total` 仅统计主结果条目。

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

从单篇文献的多数据源中提取与查询相关的文本证据片段，并基于 BM25 算法排序。

### 参数

| 参数               | 类型     | 默认值    | 说明                                                      |
| ------------------ | -------- | --------- | --------------------------------------------------------- |
| `ref`              | string   | —         | 文献条目 ref（必填）                                      |
| `query`            | string   | —         | 证据排序关键词（必填）                                    |
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

生成格式化引用或导出数据文件。

### 参数

| 参数                | 类型     | 默认值     | 说明                                                                                 |
| ------------------- | -------- | ---------- | ------------------------------------------------------------------------------------ |
| `refs`              | string[] | —          | 条目 ref 列表（必填，单次受 `maxExportRefs` 限制，默认 50）                          |
| `format`            | string   | —          | 导出格式：`citation`、`bibliography`、`bibtex`、`biblatex`、`ris`、`csljson`（必填） |
| `style`             | string   | 配置默认值 | CSL 样式标识（仅用于 citation 和 bibliography）                                      |
| `locale`            | string   | `"en-US"`  | CSL 语言环境（仅用于 citation 和 bibliography）                                      |
| `run_in_background` | boolean  | `false`    | 是否作为后台任务启动（由 Harness `ctx.jobs` 管理）                                   |

### 输出

前台同步完成时：

- `citation`：`{citations: [{ref, text}]}`；
- `bibliography`：`{text}`；
- `bibtex` / `biblatex` / `ris` / `csljson`：`{text, items: [{ref, key, title, entryIndex, start, end}]}`。

后台执行（或前台等待超时自动提升）时：
返回 `{kind: "background", jobId}` 或 `{kind: "promoted", jobId, timeoutMs, message}`。任务进度在 Web 会话顶栏与日志中展示，完成后结果写入 Job 产物。

### 说明

- `citation` 模式单次超过 50 个 key 时自动分批请求；
- `bibtex`、`biblatex`、`ris`、`csljson` 采用 Zero-N+1 内存切分引擎：批量导出仅发起单次本地 API 请求（$O(1)$ HTTP 请求），引擎在内存中对返回数据进行语法感知解析并与请求的 refs 精确匹配切分，单次调用最多支持 50 条；
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

| 参数            | 类型    | 默认值                  | 说明                                                                                                                         |
| --------------- | ------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `kind`          | string  | —                       | 浏览类别：`libraries`、`collections`、`savedSearches`、`tags`、`itemTypes`、`itemFields`（必填）                             |
| `library`       | object  | `{type: "user", id: 0}` | 目标库（适用于 collections、savedSearches、tags）                                                                            |
| `parentRef`     | string  | —                       | 仅用于 `collections`：父集合 ref；省略则列出顶层集合                                                                         |
| `tagScope`      | string  | `"library"`             | 仅用于 `tags`：统计范围，支持 `library`、`collection`、`publications`（`publications` 仅限个人库）                           |
| `tagCollection` | string  | —                       | 仅用于 `tags` 且 `tagScope="collection"`：集合 ref 或精确名称                                                                |
| `itemLevel`     | string  | `"top"`                 | 仅用于带作用域的 `tags`：`top` 仅统计文献条目；`all` 包含子条目（仅 `library`/`collection` 范围） |
| `itemQuery`     | string  | —                       | 仅用于带作用域的 `tags`：仅统计匹配该查询词的条目标签                                                                        |
| `itemQueryMode` | string  | `"titleCreatorYear"`    | 仅用于带作用域的 `tags`：`itemQuery` 的条目查询模式，支持 `titleCreatorYear` 或 `everything`（默认 `titleCreatorYear`）      |
| `itemType`      | string  | —                       | 仅用于 `itemFields`：查询字段与创作者类型的条目类型名                                                                        |
| `q`             | string  | —                       | 标签名称的子串过滤词                                                                                                         |
| `match`         | string  | `"contains"`            | 标签过滤匹配方式：`contains` 或 `startsWith`                                                                                 |
| `offset`        | integer | `0`                     | 分页偏移量                                                                                                                   |
| `limit`         | integer | `20`                    | 返回条目数量上限（受配置项 `maxBrowseResults` 限制，默认 50）                                                                |

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

### 示例

```text
zotero_children(ref="zotero://user/0/item/ABC123", include=["annotations"])
```

---

## zotero_changes

基于本地事务版本获取文献库的增量更新与删除记录。

### 参数

| 参数                | 类型     | 默认值                  | 说明                                                                     |
| ------------------- | -------- | ----------------------- | ------------------------------------------------------------------------ |
| `library`           | object   | `{type: "user", id: 0}` | 目标库标识                                                               |
| `since`             | object   | —                       | 起始游标 `{serverId, library, version}`；省略则获取初始基线              |
| `include`           | string[] | 除 fulltext 外全部      | 监测范围：`items`、`collections`、`savedSearches`、`fulltext`、`deleted` |
| `run_in_background` | boolean  | `false`                 | 是否作为后台任务启动                                                     |

### 输出

前台同步完成时返回：
`{library, serverId?, fromVersion?, cursor?, libraryChanged?, versionUnavailable?, changed, deleted?, totals?, unobservable?, truncated?}`。

- `changed`：按资源类型列出变更对象（`items`、`childItems`、`trashedItems`、`collections`、`savedSearches`、`fulltextAttachments`）；
- `deleted`：包含已删除条目的 key 或标签名；
- `cursor`：仅在当前批次完整读取且期间未发生并发写入时返回，用于后续增量请求；
- `unobservable`：标明因版本或端点原因无法观测的资源类别与原因。

### 示例

```text
zotero_changes()
zotero_changes(since={serverId: "server1", library: {type: "user", id: 0}, version: 1234}, include=["items", "deleted"])
```

---

## zotero_create_note

创建独立研究笔记或挂载在指定条目下的子笔记。

### 参数

| 参数          | 类型     | 必填 | 说明                                                                                                                                     |
| ------------- | -------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `markdown`    | string   | ✓    | 笔记正文 Markdown（字符上限受 `writeNoteMaxChars` 限制，默认 65536）                                                                     |
| `parentItem`  | string   | —    | 父文献条目 ref；省略则创建独立笔记                                                                                                       |
| `collections` | string[] | —    | 所属合集 ref 或名称（仅限独立笔记；子笔记自动继承父条目合集）                                                                            |
| `tags`        | string[] | —    | 笔记关联的标签列表                                                                                                                       |
| `sourceRefs`  | string[] | —    | 关联来源条目 ref 列表，写入 `dc:relation` 关系（支持个人库与群组库条目，群组条目自动映射至 `http://zotero.org/groups/<id>/items/<key>`） |

### 输出

- 成功创建：`{kind: "applied", ref, key, version, parentItem?, collections, tags, sourceRefs, libraryVersion, serverId?}`；
- 用户在计划卡拒绝：`{kind: "declined"}`；
- 写入提交但状态未核验：`{kind: "committed-unverified", committed: true, retryable: false, reason}`。

### 示例

```text
zotero_create_note(markdown="## 方法总结\n- 要点一\n- 要点二", parentItem="zotero://user/0/item/ABCD1234", tags=["综述"])
```

---

## zotero_add_tags

向指定文献条目添加标签。采用读-合并-写语义，保留现有标签及属性。

### 参数

| 参数   | 类型     | 必填 | 说明                                                    |
| ------ | -------- | ---- | ------------------------------------------------------- |
| `ref`  | string   | ✓    | 目标条目 ref                                            |
| `tags` | string[] | ✓    | 新增标签列表（受 `writeListMaxItems` 限制，默认 50 个） |

### 输出

返回 `{kind: "applied", ref, version, tags, added, unchanged, libraryVersion?, serverId?}`。若所请求标签均已存在，返回 `unchanged: true` 且不发起写入。

### 示例

```text
zotero_add_tags(ref="zotero://user/0/item/ABCD1234", tags=["深度学习", "精读"])
```

---

## zotero_add_to_collection

将文献条目添加至指定合集。采用读-合并-写语义，保留现有合集归属。

### 参数

| 参数         | 类型   | 必填 | 说明                    |
| ------------ | ------ | ---- | ----------------------- |
| `ref`        | string | ✓    | 目标条目 ref            |
| `collection` | string | ✓    | 目标合集 ref 或精确名称 |

### 输出

返回 `{kind: "applied", ref, version, collections, added, libraryVersion?, serverId?}`。若条目已在该合集中，返回 `added: false` 且不发起写入。

### 示例

```text
zotero_add_to_collection(ref="zotero://user/0/item/ABCD1234", collection="方法论")
```

---

## 写入边界与安全机制

写入工具默认不注册，需在配置中显式开启 `writeEnabled`，且仅操作个人库（`zotero://user/0/`）。

1. **双层确认机制**：
   - 会话审批策略（`ctx.approval.request`）：遵循会话策略；若策略为 `never` 则自动拒绝；
   - 计划审查卡：向用户展示具体变更内容 Markdown，经用户确认后执行；未获批准返回 `{kind: "declined"}`。
2. **本地 API 鉴权**：
   - 写操作必须提供 Zotero 本地签发的 API key；
   - 首次写入需在 Zotero 本地授权弹窗中确认（允许、始终允许或拒绝）；
   - 开启 `writePersistKey` 时，“始终允许”签发的持久密钥会安全保存在宿主凭据管理器中。
3. **Shell 写入拦截**：
   - 监听器检测指向本地 API 的写命令，拦截并提升为 Harness 审批请求，防止未授权脚本修改文献库。

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
