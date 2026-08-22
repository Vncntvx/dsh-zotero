<p align="right"><a href="tools.en.md"><b>English</b></a></p>

# dsh-zotero 工具参考

dsh-zotero 注册 6 个工具，通过本地 Zotero HTTP API 操作用户的文献库。所有 ref 均为 `zotero://user/0/item/<KEY>`（个人库）或 `zotero://group/<ID>/item/<KEY>`（群组库）格式的稳定标识符，个人库恒为 `user/0` canonical。

---

## zotero_search

在文献库中发现候选条目。metadata 模式搜索标题/作者/年份，everything 模式同时搜索全文索引。

### 参数

| 参数             | 类型                           | 默认值              | 说明                                                                                              |
| ---------------- | ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------- |
| `query`          | string                         | —                   | 自由文本查询；省略则浏览全库                                                                      |
| `mode`           | `"metadata"` \| `"everything"` | `"metadata"`        | 搜索范围                                                                                          |
| `scope`          | object                         | `{kind: "library"}` | `{kind:"library"}` / `{kind:"collection", refOrName}` / `{kind:"savedSearch", refOrName}`         |
| `library`        | object                         | —                   | 库：`{type:"user",id:0}` 或 `{type:"group",id}`；`scope` 为 name 时作解析上下文，`ref` 时必须一致 |
| `itemTypes`      | string[]                       | —                   | Zotero 条目类型名（如 `journalArticle`），OR 组合                                                 |
| `tags`           | string[]                       | —                   | 标签名，`tagMatch` 控制 AND/OR                                                                    |
| `tagMatch`       | `"all"` \| `"any"`             | `"all"`             | 多标签组合：`all`=AND，`any`=OR                                                                   |
| `excludeTags`    | string[]                       | —                   | 需排除的标签（NOT）                                                                               |
| `includeTrashed` | boolean                        | `false`             | 是否包含已删除条目（仅 `library` scope 允许）                                                     |
| `sort`           | string                         | `"dateModified"`    | 排序字段：`dateModified` / `dateAdded` / `date` / `title` / `creator`                             |
| `direction`      | `"asc"` \| `"desc"`            | `"desc"`            | 排序方向                                                                                          |
| `offset`         | integer                        | `0`                 | 分页偏移                                                                                          |
| `limit`          | integer                        | `10`                | 返回数量上限（受 `maxSearchResults` 限制，默认 20）                                               |

### 输出

`scope`（`library` scope 含 `library` 字段，便于分页回放）, `items`（仅主结果：ref, title, creatorSummary, year, itemType, bestAttachmentRef, bestAttachmentType）, `total`, `offset`, `returned`, `nextOffset`, `supplemental`（可选：`{kind:"noteBody", items, scanned, truncated}`）

### 注意事项

首次查询（offset 0）且 scope 为 `library`/`collection` 时（`savedSearch` 不扫描），客户端扫描笔记正文，命中的笔记列入 `supplemental.items`（按 dateModified 降序、最多填满 `limit` 剩余额度、受 `maxNoteScanRecords` 限制）。`items`/`total`/`returned`/`nextOffset` 只描述主结果集合，`returned` 永远不会大于 `total`；collection scope 下子笔记通过父条目判定归属（子笔记自身不携带 collections）。`tagMatch` 必须与 `tags` 同现，否则报参数错误。

### 示例

```
zotero_search(query="transformer attention", mode="everything", tags=["deep-learning"], limit=5)
```

---

## zotero_get

读取单个条目的完整元数据。默认仅返回元数据；指定 `include` 后额外请求一次 `/children` 接口获取子内容。

### 参数

| 参数      | 类型                                        | 必填 | 说明                 |
| --------- | ------------------------------------------- | ---- | -------------------- |
| `ref`     | string                                      | ✓    | 条目 ref             |
| `include` | `("notes"\|"annotations"\|"attachments")[]` | —    | 需要包含的子内容类型 |

### 输出

`ref`, `itemType`, `title`, `creators`, `date`, `year`, `venue`, `doi`, `url`, `abstract`, `abstractTruncated`, `noteBody`（笔记条目）, `tags`, `collections`, `children`, `bestAttachment`, `relations`（如 `dc:relation` 等，`targetRef` 仅同库可证时出现）, 以及请求的 `notes`/`annotations`/`attachments`（含 total、returned、items）

### 示例

```
zotero_get(ref="zotero://user/0/item/ABC123", include=["notes", "annotations"])
```

---

## zotero_retrieve

为单个条目收集并按查询排序证据段落。来源包括：Zotero 批注（带页码）、笔记、摘要、全文分块（BM25 排序）。

### 参数

| 参数       | 类型     | 默认值    | 说明                                                    |
| ---------- | -------- | --------- | ------------------------------------------------------- |
| `ref`      | string   | —         | 条目 ref（必填）                                        |
| `query`    | string   | —         | 用于排序证据的查询词（必填）                            |
| `sources`  | string[] | 全部 4 种 | `annotation` / `note` / `abstract` / `fulltext`         |
| `passages` | integer  | `4`       | 返回段落数上限（受 `maxEvidencePassages` 限制，默认 4） |

### 输出

`ref`, `attachmentRef`, `attachmentContentType`, `coverage`（indexedChars/totalChars/complete 等）, `evidence`（source, sourceRef, text, chunkIndex, chunkCount, comment, pageLabel）, `truncated`, `sourcesSkipped`

### 注意事项

- 仅 Zotero 批注携带页码标签，全文段落不会有虚构的页码
- 不可用的来源跳过并在 `sourcesSkipped` 中报告，不视为错误
- 只有 `annotation` 来源有 `pageLabel`；全文段落永远不携带页码
- `truncated` 为 true 表示有更多证据被截断

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

- `{kind: "file", path, ref, title, contentType}` — 本地文件（经 `existsSync` 验证存在）
- `{kind: "url", url, ref, title, contentType}` — 链接型附件

条目 ref 首先跟随 Zotero 的 best-attachment 链接，回退到最早的 PDF 子项。

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

分页诚实性对所有分页列表端点统一生效：`zotero_search`、`zotero_browse` 与 `zotero_changes` 的列表读取都要求响应携带合法的 `Total-Results` 头，缺失或非法时整个调用以 `ZOTERO_UNEXPECTED` 失败，而不是用响应体长度猜测总数。

| 参数      | 类型                                                             | 默认值     | 说明                                                                        |
| --------- | ---------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------- |
| `kind`    | `libraries`\|`collections`\|`savedSearches`\|`tags`\|`itemTypes` | —          | 浏览类型                                                                    |
| `library` | object `{type, id}`                                              | `user/0`   | 目标库（`collections/savedSearches/tags` 有效；`libraries/itemTypes` 忽略） |
| `q`       | string                                                           | —          | `tags` 时 substring 过滤                                                    |
| `match`   | `contains`\|`startsWith`                                         | `contains` | `tags` 时 `q` 的匹配方式（需 `q`）                                          |
| `offset`  | integer                                                          | `0`        | 分页偏移                                                                    |
| `limit`   | integer                                                          | `20`       | 返回上限                                                                    |

### 输出

- `libraries`：`{library, name}`（个人库固定 `My Library`，群组名来自 `GET /users/0/groups`，`serverId` 在顶层）
- `collections`：`{ref, name, parentRef?, path: string[], depth}`（完整集合图共享 30s TTL 快照——面包屑需要全部祖先；`path` 为根到叶子）
- `savedSearches`：`{ref, name, conditions?}`（`conditions` 原样透传；服务器端 `start/limit` 分页，缺 `Total-Results` 头则 fail-closed）
- `tags`：`{tag, count?}`（`count` 仅服务端提供时；服务器端分页）
- `itemTypes`：`{itemType, localized?}`

各 `kind` 的行结构在工具 output schema 中以判别式 `oneOf` 声明；`collections` 渲染为 `A / B / C — ref` 面包屑，`tags` 带 `— N items`，`savedSearches` 带 `— N conditions`。`q` 提供时必须非空白，否则报参数错误。

### 示例

```
zotero_browse(kind="collections", library={type:"group", id:42}, limit=20)
zotero_browse(kind="tags", q="review", match="contains")
```

---

## 错误码

| 错误码                          | 说明                                                |
| ------------------------------- | --------------------------------------------------- |
| `ZOTERO_NOT_RUNNING`            | Zotero 未运行或本地 API 不可达                      |
| `ZOTERO_API_DISABLED`           | Zotero 运行中但本地 API 被禁用（403）               |
| `ZOTERO_API_VERSION`            | Zotero API 版本不受支持                             |
| `ZOTERO_SERVER_MISMATCH`        | ref 来自不同的 Zotero 实例                          |
| `ZOTERO_NOT_FOUND`              | 引用的条目、集合或保存搜索不存在                    |
| `ZOTERO_NO_ATTACHMENT`          | 条目没有指定类型的附件                              |
| `ZOTERO_NO_FULLTEXT`            | 附件没有全文索引                                    |
| `ZOTERO_FILE_MISSING`           | Zotero 报告的本地文件在磁盘上不存在                 |
| `ZOTERO_INVALID_REF`            | ref 字符串不符合 `zotero://` 语法或引用了不支持的库 |
| `ZOTERO_INVALID_ARGUMENT`       | 参数违反了 schema 无法表达的领域约束                |
| `ZOTERO_SCOPE_AMBIGUOUS`        | 集合或保存搜索名称匹配到多个对象                    |
| `ZOTERO_TIMEOUT`                | 提供方自身超时                                      |
| `ZOTERO_RESPONSE_TOO_LARGE`     | 响应流式传输超出资源限制                            |
| `ZOTERO_OUTPUT_TOO_LARGE`       | 导出输出超过提供方硬上限                            |
| `ZOTERO_CAPABILITY_UNAVAILABLE` | 提供方未声明所需能力                                |
| `ZOTERO_PROVIDER_UNAVAILABLE`   | 配置的提供方未注册                                  |
| `ZOTERO_UNEXPECTED`             | 响应无法解析或行为异常                              |
