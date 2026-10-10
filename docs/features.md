<p align="right"><a href="features.en.md"><b>English</b></a></p>

# 功能概览

dsh-zotero 让 DSH 的 LLM 对话能够直接查询和引用 Zotero 文献库。16 个工具（8 个读工具 + 8 个写工具）覆盖文献搜索、原文片段检索、原文定位、格式化导出，以及笔记、标签、合集、条目与全库标签的写入；8 个个人库写入工具默认关闭，启用后需经过会话审批与计划审查卡。Web 端 Sources 面板提供会话文献、原文片段与引用的汇总展示。

## 搜索文献

`zotero_search` 调用 Zotero 本地快速搜索：

- 搜索模式：
  - `metadata`（默认）：匹配标题、作者与年份；
  - `everything`：同时检索已索引的全文内容。
- 搜索范围：
  - 整个文献库（默认）；
  - 个人出版物（`publications`）；
  - 按名称或 ref 指定集合（`collection`）；
  - 按名称或 ref 指定保存的搜索（`savedSearch`）。

首次查询（offset 0）会分批扫描笔记正文，命中条目列入 `supplemental`，不计入分页总数。搜索结果返回稳定的 `zotero://` 引用标识供后续工具使用。

![文献来源概览：搜索结果列表与条目操作面板](images/zotero-sources-overview.png)

## 查看元数据与笔记

`zotero_get` 读取单篇文献的结构化元数据。默认返回标题、创作者、出版年、期刊/会议、DOI、URL 与摘要等基础字段。

通过 `include` 参数可选择性加载子内容：

- `notes`：子笔记列表及其正文；
- `annotations`：PDF 批注、高亮文本、读者评论与页码；
- `attachments`：关联附件列表（文件类型与链接模式）。

笔记正文超出字符预算时标记 `truncated: true`，摘要被截断时标记 `abstractTruncated: true`。

![原文片段视图：按来源聚合的论文文本片段](images/zotero-evidence-passages.png)

## 检索原文片段

`zotero_retrieve` 从文献的多来源中提取文本片段，并通过 BM25 算法按相关度排序：

| 来源         | 说明                                                                                 |
| ------------ | ------------------------------------------------------------------------------------ |
| `annotation` | PDF 批注：高亮原文与用户评论共同参与排序，附带页码标签；`matchedFields` 标注命中字段 |
| `note`       | 子笔记分块正文                                                                       |
| `abstract`   | 文献条目摘要                                                                         |
| `fulltext`   | Zotero 索引的全文分块文本                                                            |

全文索引覆盖度通过 `coverage` 字段返回。未建立索引或不可用的来源记录在 `sourcesSkipped` 中。

在多附件检索策略（`allIndexed` 或 `specified`）下，`attachments` 列表对每个附件报告具体状态：`indexed`（已读取全文及覆盖率）、`unindexed`（Zotero 未建立全文索引）或 `unread`（超出附件数量上限未读取）。

![对话中的多步工具调用流程](images/zotero-chat-workflow.png)

## 原文定位

`zotero_attachment` 将附件 ref 解析为本地路径或链接：

- 本地文件：返回经校验存在的磁盘绝对路径；
- 链接附件：返回对应 URL。

传入条目 ref 时，Zotero 自动选取最佳附件；传入附件 ref 时，精确定位该附件。

说明：读取 PDF 文本内容取决于宿主环境的文件读取能力，dsh-zotero 负责解析与校验路径。

## 导出引用

`zotero_export` 支持以下格式导出：

| 格式           | 输出内容                                 |
| -------------- | ---------------------------------------- |
| `citation`     | 逐条 HTML 格式引用，按输入 refs 顺序排列 |
| `bibliography` | CSL 排序的合并参考文献列表               |
| `bibtex`       | BibTeX 词条                              |
| `biblatex`     | BibLaTeX 词条                            |
| `ris`          | RIS 格式文本                             |
| `csljson`      | CSL-JSON 数据                            |

可选通过 `style` 和 `locale` 参数指定引用样式与语言环境。`citation` 模式超过 50 个 key 时自动分批请求。

## 写入个人库（可选）

在设置中显式启用 `writeEnabled` 后，插件注册 8 个仅面向个人库（`zotero://user/0/`）的写入工具：

- `zotero_create_note`：创建独立研究笔记或关联至条目的子笔记，支持标签、合集归属与 `dc:relation` 关联；
- `zotero_update_item_tags`：`add`/`remove` 在一次调用内读-合并-写标签，保留既有标签类型，提交携带条目版本前置；
- `zotero_update_item_collections`：`add`/`remove` 在一次调用内增删合集归属，名称解析失败先于任何写入；
- `zotero_create_collection`：创建顶层或子合集，同级同名拒绝；
- `zotero_delete_collection`：删除合集（不可逆：结构被移除、子合集随之删除，条目保留），计划卡先给出条目数与子合集数；
- `zotero_create_item`：从闭合字段集建档（无 BibTeX/CSL-JSON 入口），未知类型或缺 title/url 一律拒绝；
- `zotero_update_item`：订正标量元数据，字段合法性以 Zotero 的 `itemTypeFields` 为准；
- `zotero_delete_library_tags`：按名称全库删除标签（不可逆），计划卡先给出每个标签的条目数，未命中的名称被忽略因而重试幂等。

每次写入均需通过会话审批策略并确认计划卡片；两个删除工具的计划卡明确标注不可逆。Zotero 10 在首次写入时通过本地对话框请求授权。

## 对话工具调用卡片（Toolviews）

DSH 对话中，Zotero 工具调用由专用只读卡片（`tool.call.toolview`）呈现：

- **搜索（`zotero_search`）**：展示查询词与命中总数，展开呈现文献卡片（题名、作者、年份徽标、类型与 PDF 标识）及直达链接；
- **原文片段检索（`zotero_retrieve`）**：折叠摘要行显示提取片段总数，展开呈现排序后的原文片段、页码标签与全文覆盖信息；
- **导出（`zotero_export`）**：展示导出格式、引用样式、条数徽标，支持文本复制与按格式下载；
- **条目详情（`zotero_get`）**：展示基础元数据、发表信息、子项数量统计及内容预览；
- **子对象（`zotero_children`）**：按类型分区展示子笔记、附件与带颜色高亮的 PDF 批注；
- **库结构与变更（`zotero_browse` / `zotero_changes`）**：`zotero_browse` 展示层级合集树、标签列表及分页信息；`zotero_changes` 展示版本区间内的增量条目、删除记录及安全游标；
- **原文定位（`zotero_attachment`）**：展示定位到的文件路径或链接，提供复制与快速打开选项；
- **个人库写操作（8 个写工具）**：展示目标条目、笔记摘要、计划中的标签与合集增删、合集/条目创建与删除，以及全库标签删除；回执区分“已生效”“无变化（No change）”“结果未核验”与“已拒绝”，不可逆删除在计划卡上先行声明。

卡片默认采用紧凑折叠摘要，展开时惰性渲染详情，并同步反映工具执行生命周期。

## Slash 命令状态卡片（Commandview）

在会话输入框执行 `/zotero`（或 `/zotero status`）时，命令输出通过专用卡片呈现：

- 连接状态指示灯（在线/离线）与简要状态；
- 本地探测端点地址、Zotero 版本、API 与 Schema 版本、数据库 Server ID 及个人库写入权限状态；断连时依然显示端点地址，便于排查连接目标；
- 底部提供刷新（Refresh）按钮，可直接重新发起本地探活检测；
- 断连或异常时展示针对性排查建议。

## 插件管理与启用引导

插件适配 Harness 插件系统插槽：

- **启用引导（`plugins.bundle.activation`）**：在插件管理列表中启用时弹出引导弹窗，自动执行本地连通性检查，并提示在 Zotero 高级设置中开启通信权限；
- **详情页状态区（`plugins.bundle.config` / `plugins.detail.section`）**：在插件详情页提供 Sources 面板开关与写入开关（`writeEnabled`），并给出实时运行状态卡片，报告连接状态、Zotero 版本与排查建议。

## 会话来源面板

DSH Web 界面的 Zotero 标签页包含两个视图（Sources、Exports）；原文片段（Passages）作为条目检查器中的面板呈现，并在会话包含多篇文献片段时提供会话级总览入口：

- **Sources（文献）**：展示当前会话中通过搜索与读取工具引用的文献条目列表，条目检查器内含原文片段面板（按条目分组展示 `zotero_retrieve` 检索的原文片段）；
- **Exports（导出）**：列出会话中所有导出操作生成的文本内容，支持复制与下载。

## 设计边界

- **默认只读**：`writeEnabled` 默认关闭；开启后仅可写入个人库，并受双层确认与版本前置保护；
- **词频排序**：原文片段检索使用 BM25 词频匹配，不使用向量语义检索；
- **文本导出**：引用与参考文献以标准文本格式输出；
- **会话隔离**：Sources 面板记录当前会话的引用快照；
- **依赖全文索引**：全文检索与段落提取依赖 Zotero 本地已建立的索引数据。
