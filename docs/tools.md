<p align="right"><a href="tools.en.md"><b>English</b></a></p>

# dsh-zotero 工具参考

dsh-zotero 注册 5 个工具，通过本地 Zotero HTTP API 操作用户的文献库。所有 ref 均为 `zotero://user/0/item/<KEY>` 格式的稳定标识符。

---

## zotero_search

在文献库中发现候选条目。metadata 模式搜索标题/作者/年份，everything 模式同时搜索全文索引。

### 参数

| 参数        | 类型                           | 默认值              | 说明                                                                                      |
| ----------- | ------------------------------ | ------------------- | ----------------------------------------------------------------------------------------- |
| `query`     | string                         | —                   | 自由文本查询；省略则浏览全库                                                              |
| `mode`      | `"metadata"` \| `"everything"` | `"metadata"`        | 搜索范围                                                                                  |
| `scope`     | object                         | `{kind: "library"}` | `{kind:"library"}` / `{kind:"collection", refOrName}` / `{kind:"savedSearch", refOrName}` |
| `itemTypes` | string[]                       | —                   | Zotero 条目类型名（如 `journalArticle`），OR 组合                                         |
| `tags`      | string[]                       | —                   | 标签名，AND 语义                                                                          |
| `sort`      | string                         | `"dateModified"`    | 排序字段：`dateModified` / `dateAdded` / `date` / `title` / `creator`                     |
| `direction` | `"asc"` \| `"desc"`            | `"desc"`            | 排序方向                                                                                  |
| `offset`    | integer                        | `0`                 | 分页偏移                                                                                  |
| `limit`     | integer                        | `10`                | 返回数量上限（受 `maxSearchResults` 限制，默认 20）                                       |

### 输出

`scope`, `items`（ref, title, creatorSummary, year, itemType, bestAttachmentRef, bestAttachmentType）, `total`, `offset`, `returned`, `nextOffset`, `noteMatches`

### 注意事项

首次查询（offset 0）时，客户端扫描笔记正文并合并到结果中（最多 `limit` 条）。`noteMatches` 报告其中来自笔记扫描的数量，这部分不计入分页总数。

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

`ref`, `itemType`, `title`, `creators`, `date`, `year`, `venue`, `doi`, `url`, `abstract`, `abstractTruncated`, `noteBody`（笔记条目）, `tags`, `collections`, `children`, `bestAttachment`, 以及请求的 `notes`/`annotations`/`attachments`（含 total、returned、items）

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

### 示例

```
zotero_export(refs=["zotero://user/0/item/ABC123", "zotero://user/0/item/DEF456"], format="bibtex")
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
