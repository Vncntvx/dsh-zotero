<p align="right"><a href="configuration.en.md"><b>English</b></a></p>

# 配置参考

dsh-zotero 的配置按四个设置命名空间分开定义，字段默认值由各自的 Schemastery schema 提供，加载或保存时经校验；不合法的值会阻止插件加载或该命名空间的配置写入。

- 核心 `zotero` 命名空间：`src/config.ts`，37 个字段，由 `resolveConfig` 执行运行时校验；
- 文献面板 `library` 命名空间：`src/library/config.ts`，11 个字段；
- 学术检索 `scholarly` 命名空间：`src/scholarly/config.ts`，9 个字段；
- 文档解析 `parsing` 命名空间：`src/parsing/config.ts`，4 个字段。

四组合计 61 个字段。所有字段都声明为 `volatile`，配置写入落在当前 profile 的 `cordis.patch.yml` 对应条目（`zotero` / `library` / `scholarly` / `parsing`）的 `config` 下。

## 设置页标签与字段归属

插件详情页的配置区是一个 7 标签页表单，同时编辑上述四个命名空间。标签、命名空间与字段的对应关系如下：

| 标签     | 设置命名空间        | 字段数 | 分组与字段                                                                                                                                                                                                                                                                                                    |
| -------- | ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 基础设置 | `zotero`            | 6      | 文献轨迹：`webEnabled`；写入：`writeEnabled`、`writePersistKey`、`writeNoteMaxChars`、`writeListMaxItems`、`writeAuthorizeDeadlineMs`                                                                                                                                                                         |
| 本地连接 | `zotero`            | 5      | 连接：`baseUrl`、`provider`、`timeoutMs`、`maxInFlightRequests`、`scopeListingTtlMs`                                                                                                                                                                                                                          |
| 检索提取 | `zotero`            | 13     | 检索与并发：`maxSearchResults`、`maxNoteScanRecords`、`searchConcurrency`、`graphConcurrency`、`retrieveAttachmentCap`；片段与全文提取：`maxEvidenceChars`、`maxEvidencePassages`、`maxNoteChars`、`maxNoteRecords`、`maxAnnotationRecords`、`maxAttachmentRecords`、`fulltextChunkWords`、`maxFulltextChars` |
| 文献面板 | `library`、`zotero` | 13     | 显示与详情、浏览、PDF 阅读、引用与对话共 11 项面板设置；引文默认值：`defaultStyle`、`defaultLocale`                                                                                                                                                                                                           |
| 学术检索 | `scholarly`         | 9      | 数据源身份与凭据引用名：`email`、`s2ApiKeyEnv`、`ncbiApiKeyEnv`、`openalexApiKeyEnv`；学术检索与全文配额：`maxResults`、`maxContentChars`；后台任务：`enableRunInBackground`、`promoteOnTimeout`、`foregroundWaitMs`                                                                                          |
| 文档解析 | `parsing`           | 4      | 解析模式与输出：`mode`、`mineruTokenRef`、`allowParsingUpload`、`outputDir`                                                                                                                                                                                                                                   |
| 高级选项 | `zotero`            | 11     | 输出限制：`maxInlineResultTokens`、`maxInlineResultBytes`、`maxResponseBytes`、`maxExportChars`、`maxExportRefs`、`maxBrowseResults`、`maxChangesResults`；后台任务：`enableRunInBackground`、`promoteOnTimeout`、`foregroundWaitMs`；诊断：`debug`                                                           |

`webEnabled` 位于「基础设置 → 文献轨迹」，开关名为「显示文献轨迹」；它决定会话顶部的文献轨迹标签页是否出现。文献面板还需要 `dsh-zotero/library` 组件行已组合、且本组件的 `rightSidebarEnabled` 开启，见下文《文献面板组件配置》。

## 核心字段（`zotero`，37 个）

| 字段                       | 默认值                       | 说明                                                                                                                                                                          |
| -------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`                  | `http://127.0.0.1:23119/api` | Zotero Local API 地址，必须为 loopback HTTP，路径以 `/api` 为前缀（`localhost` 运行时解析为 `127.0.0.1`）                                                                     |
| `provider`                 | `local`                      | 选用的 provider 标识                                                                                                                                                          |
| `timeoutMs`                | `5000`                       | 单次 HTTP 请求超时时间（毫秒）                                                                                                                                                |
| `maxInFlightRequests`      | `8`                          | 对 Local API 的并发在途请求数上限                                                                                                                                             |
| `maxSearchResults`         | `20`                         | `zotero_search` 返回条目上限；同时钳制文献面板的搜索页大小（响应携带实际生效的 `limit`）                                                                                      |
| `maxNoteScanRecords`       | `200`                        | 搜索笔记内容时扫描的笔记条目上限                                                                                                                                              |
| `searchConcurrency`        | `4`                          | `zotero_search` 归属查询的并发数                                                                                                                                              |
| `maxEvidenceChars`         | `6000`                       | 原文片段总字符预算                                                                                                                                                            |
| `maxEvidencePassages`      | `4`                          | 原文片段数量上限                                                                                                                                                              |
| `maxNoteChars`             | `2000`                       | 面板 childPage 笔记预览预算；工具完整正文不受其截断                                                                                                                           |
| `maxNoteRecords`           | `50`                         | 显式笔记页大小上限；完整读取不受其截断                                                                                                                                        |
| `maxAnnotationRecords`     | `100`                        | 显式批注页大小上限；完整读取不受其截断                                                                                                                                        |
| `maxAttachmentRecords`     | `50`                         | 显式附件页大小上限；完整读取不受其截断                                                                                                                                        |
| `fulltextChunkWords`       | `200`                        | 进入排名的全文分块词数                                                                                                                                                        |
| `maxFulltextChars`         | `250000`                     | `zotero_retrieve` 单次调用接受的最大全文字符数（多附件时均分）                                                                                                                |
| `retrieveAttachmentCap`    | `16`                         | 单次 `zotero_retrieve` 参与全文排名的附件数上限                                                                                                                               |
| `graphConcurrency`         | `4`                          | `zotero_retrieve` 读取附件的并发数                                                                                                                                            |
| `maxInlineResultTokens`    | `4000`                       | canonical 与展示结果的 Harness 官方 Token 估算上限，须为正安全整数。                                                                                                          |
| `maxInlineResultBytes`     | `65536`                      | 独立的内联序列化字节上限，超过任一预算必须持久化文件交付。                                                                                                                    |
| `maxResponseBytes`         | `16777216`                   | 单次 API 响应流式读取字节上限（16 MiB）                                                                                                                                       |
| `maxExportChars`           | `1000000`                    | 导出输出字符硬上限（100 万字符）                                                                                                                                              |
| `maxExportRefs`            | `50`                         | 单次 `zotero_export` 调用的引用条数上限；文献面板的 `zotero/export` 端点共用这一上限                                                                                          |
| `maxBrowseResults`         | `50`                         | 单次 `zotero_browse` 返回条目上限；同时钳制文献面板的浏览页大小（集合树/标签/保存搜索，响应携带实际生效的 `limit`）                                                           |
| `maxChangesResults`        | `50`                         | 单次 `zotero_changes` 每种资源列出的条目上限（仅影响展示）                                                                                                                    |
| `scopeListingTtlMs`        | `30000`                      | 合集与检索范围列表的信任时长（毫秒），超时后重新读取                                                                                                                          |
| `defaultStyle`             | `apa`                        | CSL 引用样式（需 Zotero 内置）；用于 `citation` 与 `bibliography`，工具导出与文献面板复制引用共用                                                                             |
| `defaultLocale`            | `en-US`                      | CSL 引用语言；用于 `citation` 与 `bibliography`，工具导出与文献面板复制引用共用                                                                                               |
| `writeEnabled`             | `false`                      | 是否注册并启用个人库写入工具                                                                                                                                                  |
| `writePersistKey`          | `true`                       | 是否将 Always-Allow 写入密钥保存到宿主凭据管理器；已保存的授权可在设置页「写入」分组撤销                                                                                      |
| `writeNoteMaxChars`        | `65536`                      | 单条研究笔记正文字符上限                                                                                                                                                      |
| `writeListMaxItems`        | `50`                         | 列表类写入参数的条目上限：`update_item_tags`/`update_item_collections` 的 `add`/`remove`、`delete_library_tags` 的 `tags`、`create_note` 的 `collections`/`tags`/`sourceRefs` |
| `writeAuthorizeDeadlineMs` | `120000`                     | 写入时等待 Zotero 授权弹窗的时限（毫秒）                                                                                                                                      |
| `webEnabled`               | `true`                       | 是否显示会话顶部的文献轨迹标签页                                                                                                                                              |
| `enableRunInBackground`    | `true`                       | 是否允许 `run_in_background: true` 的请求进入后台执行（参数恒声明，关闭时传 `true` 返回结构化拒绝）                                                                           |
| `promoteOnTimeout`         | `true`                       | 前台导出或变更同步超时时是否自动提升为后台任务                                                                                                                                |
| `foregroundWaitMs`         | `4000`                       | 前台执行等待上限（毫秒），超时后自动提升为后台 Job                                                                                                                            |
| `debug`                    | `false`                      | 是否开启诊断模式；开启后在插件详情页底部显示诊断面板并记录请求路径与工具调用细节；日志仅保存在进程内存中，不持久化到磁盘，亦不向外发送                                        |

说明：`foregroundWaitMs` 控制前台任务等待时长，超时后自动转为后台 Job；`timeoutMs` 控制单次 Zotero HTTP 请求超时，两者相互独立。

## 校验规则

`writeNoteMaxChars` 同时约束创建和更新笔记工具：审批前按原始 Markdown 的 JavaScript 字符串长度检查，包含空白和标记，不自动截断。

`resolveConfig` 在核心组件加载时执行以下校验：

- `baseUrl` 必须为字符串，且使用 `http:` 协议（Zotero Local API 不支持 HTTPS），不得包含凭据信息、查询字符串或 URL 片段；
- `baseUrl` 主机名必须为环回地址（`127.0.0.1`、`localhost`、`::1`、`[::1]`）；`localhost` 在运行时解析为 `127.0.0.1`；
- `baseUrl` 路径必须为 `/api` 或以 `/api/` 开头；
- `timeoutMs` 必须为正有限数；
- 其余数值字段（并发、各类上限、`scopeListingTtlMs`、`foregroundWaitMs`、`writeNoteMaxChars`、`writeListMaxItems`、`writeAuthorizeDeadlineMs`）均必须为正整数；
- `writeEnabled`、`writePersistKey`、`webEnabled`、`enableRunInBackground`、`promoteOnTimeout` 与 `debug` 必须为布尔值；
- `provider`、`defaultStyle` 与 `defaultLocale` 必须为非空字符串。

文献面板的 11 项配置按下表中的布尔值、枚举与无重复分区列表在挂载及每次提交时校验；学术检索的 schema 由组件自身校验：`maxResults` 必须是 1–100 的整数；`maxContentChars` 必须是 1,000–50,000 的整数；`enableRunInBackground` 与 `promoteOnTimeout` 必须为布尔值；`foregroundWaitMs` 必须是 1–240,000 的整数；凭据引用名为字符串，空串表示禁用该 key，非空值在每次工具调用前由 `src/scholarly/credentials.ts` 解析为合法环境变量名。

## 配置优先级

```text
Schema 默认值 → Composition 入口配置 → 当前 profile 的 Cordis patch 覆盖层
```

四个命名空间遵循同一顺序。覆盖层（当前 profile 的 `cordis.patch.yml` 中对应条目的 `config`）优先级最高，覆盖 Schema 默认值与入口配置；home patch 与命令行 overlay 优先于它，会被它们覆盖的表单写入将被拒绝。

## 插件配置页

在插件管理器中打开 **dsh-zotero** 的详情页，其配置区承载完整的 7 标签页表单（通过 harness 官方 `SettingsForm` 与 `SettingsFormModel`），一次编辑 `zotero`、`library`、`scholarly` 与 `parsing` 四个命名空间：

- 修改结果写入当前 profile 的 `cordis.patch.yml` 中对应条目的 `config` 覆盖层；
- 保存即时生效：传输层配置与写入开关变更时在服务实例内重建对应组件，纯限额字段由 provider 实时读取；
- 无效配置在写入前会被拦截，配置页保留有效配置草稿；
- 被覆盖层显式设置的字段显示标记，支持一键重置；
- 表单写入受 revision 栅栏保护（过期草稿会被拒绝）；home patch 与命令行 overlay 会覆盖的写入同样不会落盘。

同一份表单状态还有两处入口，三者关系如下：

1. **统一设置页标签页**：插件详情页配置区的 7 标签页表单；
2. **组件行配置**：「包含的组件」中 `dsh-zotero#library`、`dsh-zotero#scholarly` 与 `dsh-zotero#parsing` 行的「配置」按钮，分别编辑对应命名空间；
3. **配置文件**：直接编辑当前 profile 的 `cordis.patch.yml` 中对应条目的 `config`。

前两处是同一份 `ConfigForm` 状态的两个视图，双通道实时同步；第三处是配置覆盖层，表单写入会以它为最高优先级。组件行未组合时，设置页的对应标签页只显示一条指向「包含的组件」的禁用提示，不渲染任何字段，组件行配置入口也不会注册。

## 热重载行为

- 传输层配置或写入开关变更时，在同一 `ZoteroService` 实例上重建 HTTP 客户端、local provider 与写入工具集；
- 限额配置变更由 provider 在下次调用时直接读取，无需重建传输层；
- `webEnabled` 开关保存后即时显示或隐藏文献轨迹标签页；
- `rightSidebarEnabled` 开关保存后即时显示或隐藏右侧边栏的文献面板；
- `debug` 开关保存后即时生效，控制详情页底部诊断面板的显示与诊断日志保留，无需重新初始化组件；
- 其余配置更新均在下一次工具调用时生效，无需重启宿主。

## 无设置服务的运行环境

在未集成设置服务的无界面（headless）环境中，插件以入口配置参数运行。

---

## 学术检索组件配置 (`dsh-zotero/scholarly`)

组件随包发布，默认关闭。开关只有插件管理器「包含的组件」里的 `dsh-zotero/scholarly` 那一行：启用该行即挂载组件，注册它的 7 个模型工具，并允许发起外部请求——索引检索仅限显式允许列表中的外部学术索引，开放获取 PDF 全文臂是唯一例外（任意公网 HTTP(S) 主机，受公网地址双门校验）。组件未挂载时，其服务、传输层与工具都不存在，无法发起学术检索请求；手改等价路径是在当前 profile 的 `cordis.patch.yml` 中写 `- id: scholarly` + `disabled: false`。外部检索的授权边界见[产品模型](product-model.md)的「四条边界」。

组件字段有三处入口：统一设置页的「学术检索」标签页、插件列表中 `dsh-zotero#scholarly` 行的「配置」按钮，或当前 profile 的 `cordis.patch.yml` 中该行的 `config`。前两处是同一份表单状态的两个视图，双通道实时同步；第三处是配置覆盖层。字段变更在下一次工具调用时生效，无需重启 profile：

| 字段                    | 默认值  | 说明                                                                                                        |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `email`                 | —       | 联系邮箱，附加于 Crossref、OpenAlex 和 NCBI/Europe PMC 请求头（加入 Polite Pool 获得更优限速配额）          |
| `s2ApiKeyEnv`           | `''`    | Semantic Scholar API Key 的凭据引用名（建议 `S2_API_KEY`）；空串禁用该 key，配置后可避免共享 IP 池限速      |
| `ncbiApiKeyEnv`         | `''`    | NCBI / PubMed API Key 的凭据引用名（建议 `NCBI_API_KEY`）；空串禁用该 key，配置后每秒请求上限从 3 提升至 10 |
| `openalexApiKeyEnv`     | `''`    | OpenAlex API Key 的凭据引用名（建议 `OPENALEX_API_KEY`）；空串禁用该 key，配置后每秒请求上限提升至 100      |
| `maxResults`            | `20`    | 单次检索返回的最大论文数量（1-100）                                                                         |
| `maxContentChars`       | `12000` | 全文分块读取字符数上限（1,000-50,000）                                                                      |
| `enableRunInBackground` | `true`  | 是否允许 `scholarly_read` / `scholarly_search` / `scholarly_verify` 显式转入后台任务执行                    |
| `promoteOnTimeout`      | `true`  | 前台等待超时时是否自动提升为后台任务                                                                        |
| `foregroundWaitMs`      | `30000` | 前台等待毫秒数，超时后提升为后台任务（1-240,000）                                                           |

组件未启用时，设置页的「学术检索」标签页只显示一条指向「包含的组件」的提示，不渲染任何字段，组件行配置入口也不会注册；组件启用后该标签页才成为可编辑表单。全文缓存在 `$DSH_HOME/cache/zotero-scholarly/` 下按 key 存一份 JSON 正文（不受本表控制，无独立开关）。

密钥值写在哪里：配置只保存凭据引用名；设置页「学术检索 → 数据源身份与密钥」中的三个密码框把输入的密钥值写入宿主凭据存储（credentials seam），不进入配置。引用名解析失败时工具调用直接失败，不会静默降级为匿名请求。

从旧版升级：旧字段 `s2Key` / `ncbiKey` / `openalexKey` 已从 schema 移除。携带这些字段的 profile 会在组件挂载时被显式拒绝（错误消息列出字段与迁移步骤）。请从 profile 的 `cordis.patch.yml` 删除旧字段，在设置页把密钥重新输入到对应的密码框（引用名建议 `S2_API_KEY` / `NCBI_API_KEY` / `OPENALEX_API_KEY`），并轮换旧密钥：旧值曾以明文保存在配置里，不会自动迁移。

---

## 文献面板组件配置 (`dsh-zotero/library`)

文献面板是独立的 DSH bundle 子组件，随包发布并在默认 profile 中启用（`cordis.patch.yml` 包含 `- id: library` / `name: dsh-zotero/library`）。它提供全库浏览、检索、条目检视与复制引用，作为右侧边栏标签页与会话并排显示。

组件字段有三处入口：

1. **统一设置页「文献面板」标签页**：在插件详情页的 7 标签页表单中切换至「文献面板」；
2. **包含的组件列表行配置**：在「包含的组件」中点击 `dsh-zotero#library` 行的「配置」按钮；
3. **配置文件**：在当前 profile 的 `cordis.patch.yml` 对应条目的 `config` 下声明。

前两处是同一份表单状态的两个视图，双通道实时同步；第三处是配置覆盖层。

| 字段                     | 默认值                    | 取值与行为                                                                                   |
| ------------------------ | ------------------------- | -------------------------------------------------------------------------------------------- |
| `rightSidebarEnabled`    | `true`                    | 显示文献面板与快捷入口，独立于文献轨迹开关                                                   |
| `listDensity`            | `comfortable`             | `comfortable` / `compact`，使用宿主标准 / 紧凑按钮密度                                       |
| `titleLines`             | `2`                       | `1` / `2`，限制列表标题行数，完整标题可悬停查看                                              |
| `detailExpandedSections` | `[abstract, attachments]` | `abstract`、`attachments`、`notes`、`annotations` 的无重复数组；空数组全部折叠               |
| `localPdfOpenTarget`     | `sidebar`                 | `sidebar` / `float` / `zotero`                                                               |
| `urlPdfOpenTarget`       | `sidebar`                 | `sidebar` / `float`，通过宿主校验并下载后阅读                                                |
| `allowUrlPdfRead`        | `false`                   | 独立外网阅读授权，表单开启前需确认；不依赖 scholarly 组件                                    |
| `reopenBehavior`         | `restore`                 | `restore` 恢复上次位置；`allItems` 在新建标签页或刷新后从个人库全部条目开始                  |
| `scopeChangeBehavior`    | `preserve`                | `preserve` / `clear`；只影响同库合集与全部条目之间的关键词及附加筛选                         |
| `defaultCopyFormat`      | `citation`                | `citation` / `bibliography` / `bibtex` / `biblatex` / `ris` / `csljson` / `csv` / `itemInfo` |
| `chatInsertContent`      | `reference`               | `reference` 条目信息；`referenceAndAbstract` 另附摘要，缺失及截断均明确标注                  |

两个设置入口均使用暂存、保存、放弃、重置继承值的同一模型。实际面板只消费已保存的配置。修改显示、展开范围和默认动作会即时生效，不重挂载组件；当前条目手动调整过的展开状态优先。复制菜单选择只用于本次操作，不改变默认格式。CSL 样式和语言复用核心 `defaultStyle` / `defaultLocale`，完整编辑控件已移到文献面板的「引文默认值」分组，直接在本页保存与重置；该组独立保存，不提交其他标签页未保存的修改。基础设置不再显示这两个字段。

浏览位置使用 v3 格式，按浏览器、Zotero 实例 `serverId` 和会话隔离。保存库、范围、关键词、模式、排序、筛选、分页、展开前缀、选中条目、窄屏分区和滚动位置；不保存目录载荷。临时隐藏、切换会话或打开阅读器后返回，保留当前标签页的位置，`allItems` 也不会中途重置。清除会话浏览位置由面板标签菜单触发，与恢复配置继承值分开。存储读取或写入失败会就地显示错误与重置入口。切换库、保存搜索或回收站总是清空关键词与附加筛选，保留检索模式和排序。

URL PDF 只接受当前本机 Zotero 实例的已限定附件 ref；服务自行解析 URL，拒绝任意网址输入。每个主机都执行公网地址与 DNS 校验，使用固定解析地址连接，重定向逐跳校验并拒绝 HTTPS 降级；不发送浏览器 Cookie、认证或 Referer。下载上限为 32 MiB、60 秒、最多 5 次重定向和 2 个并发，检查媒体类型与 PDF 文件头，失败不返回截断文件、不自动重试；关闭授权会取消在途下载。完整 PDF 写入随机私有临时目录，通过宿主公开文件阅读器在原会话侧栏或浮窗打开；阅读标签关闭或插件卸载时释放文件，最多保留 16 个阅读文件。保存设置和恢复标签页都不会自动发起外网下载。浏览器保存附件来源 ref，恢复的 PDF 标签可从标签菜单显式「重新载入 PDF」，重新校验授权与来源并替换原会话标签；不持久化下载 URL。此授权不启用外部索引搜索、Agent 工具或 scholarly 提示词。

文献面板显示需要组件行已组合且 `rightSidebarEnabled` 开启；`webEnabled` 只控制文献轨迹。组件未组合时不注册面板，也不调用文献面板端点。面板写入仍走核心审批接缝，要求所属会话正在运行。

---

## 文档解析组件配置 (`dsh-zotero/parsing`)

文档解析是独立的 DSH bundle 子组件，随包发布但默认关闭（`cordis.patch.yml` 包含 `- id: parsing` / `name: dsh-zotero/parsing` / `disabled: true`）。启用该行即授权组件联系 MinerU；组件不注册模型工具、不注入提示词段，只通过核心服务的一个可选全文增强器槽接入 `zotero_retrieve` 与 `scholarly_read`，为 PDF 生成更高质量的 Markdown。组件未挂载时增强器槽为空，两条读取链路保持原有本地抽取路径不变。

发送文档字节还需要组件内的独立数据出境授权 `allowParsingUpload`（默认关闭，表单开启前需确认）。两条授权同时成立时，MinerU 才会收到 PDF 字节。外部请求全部由本组件发出，核心不持有 MinerU 传输、主机表或凭据。

组件字段有三处入口：

1. **统一设置页「文档解析」标签页**：在插件详情页的 7 标签页表单中切换至「文档解析」；
2. **包含的组件列表行配置**：在「包含的组件」中点击 `dsh-zotero#parsing` 行的「配置」按钮；
3. **配置文件**：在当前 profile 的 `cordis.patch.yml` 对应条目的 `config` 下声明。

| 字段                 | 默认值  | 取值与行为                                                                                                                                                                                  |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`               | `free`  | `free` 使用免 Token 的 Agent 轻量接口（IP 限频、API 侧 ≤10 MB、≤20 页）；`pro` 使用精准接口（API 侧 ≤200 MB、≤600 页），需配置 Token。页数与 API 字节上限由 MinerU 侧限制，客户端不预检页数 |
| `mineruTokenRef`     | `''`    | MinerU 精准接口 Token 的凭据引用名（建议 `MINERU_API_TOKEN`）；仅在 `pro` 模式解析，`free` 模式不解析凭据                                                                                   |
| `allowParsingUpload` | `false` | 数据出境授权：是否允许把本地附件与 URL PDF 的字节发送给 MinerU；与组件挂载相互独立                                                                                                          |
| `outputDir`          | `''`    | 解析产物目录的绝对路径（或以 `~/` 开头）；空串表示运行时解析默认位置 `~/.dsh/zotero-parsed`。相对路径在 Schema/表单保存时被拒绝                                                             |

模式开关与 Token 配置完全解耦：`mode` 是独立字段，host 按它分派接口，`free` 模式不解析 Token 凭据，因此已配置 Token 的用户仍可主动切回免费接口。`mode` 为 `pro` 且 `mineruTokenRef` 解析失败时按 fail-closed 报错（`ZOTERO_PARSING_CREDENTIAL_UNRESOLVED`），不会静默降级为免费接口或匿名请求。

解析产物按内容指纹（来源、模式与 PDF 字节的 SHA-256）写入 `<outputDir>/<sha256>/`，包含 `full.md`、`meta.json`（来源、模式、任务 ID、文件清单；`pro` 且 MinerU 返回 `total_pages` 时另含页数），精准模式另含 `content_list.json`；`meta.json` 最后写入，作为目录完整的提交标记。

缓存分两层：内容产物按指纹命中；源索引 `<outputDir>/sources/<sha256>/` 记录 `identity + mode` 对应的产物与源戳。本地附件只做 `stat`（大小 + 修改时间），时间/大小变化时回退到内容指纹；URL 源发一次不带凭据的 HEAD，用 ETag/Last-Modified/Content-Length 校验，匹配则直接读本地产物，**不下载 PDF、不请求 MinerU**；不匹配或 HEAD 失败才按 URL 身份读取或重新下载。原始 URL 的 query/fragment 不写入 `meta.json`（只保留 origin + path）。删除 `<outputDir>/sources` 下对应项可强制重新解析。

输出目录在首次解析时完整校验：相对路径由 Schema/表单拒绝；不存在、不可写、realpath 后指向敏感系统目录（含 macOS `/private/etc`、`/private/var` 与 `~/.ssh`、`~/.gnupg`）或经符号链接逃逸时，以 `ZOTERO_PARSING_OUTPUT_INVALID` **fatal** 失败，不回退。免费接口超限（>10 MiB）时本次读取回退本地抽取，原因携带 `ZOTERO_PARSING_UNSUPPORTED_INPUT`，不静默截断。

解析编排默认总时限 30 分钟、轮询 900 次（2 秒一次）；提交/单次轮询 60 秒，签名上传 20 分钟，结果下载 10 分钟，源 PDF 传输 20 分钟，缓存 HEAD 15 秒。低于 500 字符的解析结果按回退处理；同一份字节在同一 `ParsingService` 实例内只解析一次，某个调用者取消不会取消其他等待者。

错误分类：

| 错误码                                 | 分类     | 行为                                                     |
| -------------------------------------- | -------- | -------------------------------------------------------- |
| `ZOTERO_PARSING_CREDENTIAL_UNRESOLVED` | fatal    | pro Token 引用无法解析；读取失败                         |
| `ZOTERO_PARSING_OUTPUT_INVALID`        | fatal    | 输出目录配置不可用；读取失败，且不发送文档字节           |
| `ZOTERO_PARSING_TASK_FAILED`           | fallback | 提交/任务/轮询失败或超时；回退本地抽取                   |
| `ZOTERO_PARSING_ARCHIVE_INVALID`       | fallback | 结果 zip 结构或 zip 安全校验失败；回退本地抽取           |
| `ZOTERO_PARSING_UNSUPPORTED_INPUT`     | fallback | 超出所选接口字节上限或不是 PDF；回退本地抽取并保留错误码 |

`allowParsingUpload` 关闭时不发出新的文档字节，读取回退本地；已有本地产物仍可读取。凭据解析失败与输出目录不可用才按 fail-closed 中止；其余运行期失败带明确原因回退并记入诊断环。
