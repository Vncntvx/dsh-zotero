<p align="right"><a href="configuration.en.md"><b>English</b></a></p>

# 配置参考

dsh-zotero 的配置按三个设置命名空间分开定义，字段默认值由各自的 Schemastery schema 提供，加载或保存时经校验；不合法的值会阻止插件加载或该命名空间的配置写入。

- 核心 `zotero` 命名空间：`src/config.ts`，37 个字段，由 `resolveConfig` 执行运行时校验；
- 文献面板 `library` 命名空间：`src/library/config.ts`，1 个字段；
- 学术检索 `scholarly` 命名空间：`src/scholarly/config.ts`，6 个字段。

三组合计 44 个字段。所有字段都声明为 `volatile`，配置写入落在当前 profile 的 `cordis.patch.yml` 对应条目（`zotero` / `library` / `scholarly`）的 `config` 下。

## 设置页标签与字段归属

插件详情页的配置区是一个 6 标签页表单，同时编辑上述三个命名空间。标签、命名空间与字段的对应关系如下：

| 标签     | 设置命名空间 | 字段数 | 分组与字段                                                                                                                                                                                                                                                                                                                                          |
| -------- | ------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 基础设置 | `zotero`     | 8      | 文献轨迹：`webEnabled`；写入：`writeEnabled`、`writePersistKey`、`writeNoteMaxChars`、`writeListMaxItems`、`writeAuthorizeDeadlineMs`；引文默认值：`defaultStyle`、`defaultLocale`                                                                                                                                                                  |
| 本地连接 | `zotero`     | 5      | 连接：`baseUrl`、`provider`、`timeoutMs`、`maxInFlightRequests`、`scopeListingTtlMs`                                                                                                                                                                                                                                                                |
| 检索提取 | `zotero`     | 15     | 检索与并发：`maxSearchResults`、`maxNoteScanRecords`、`searchConcurrency`、`graphConcurrency`、`retrieveAttachmentCap`；片段与全文提取：`maxEvidenceChars`、`maxEvidencePassages`、`maxDetailChars`、`maxNoteBodyChars`、`maxNoteChars`、`maxNoteRecords`、`maxAnnotationRecords`、`maxAttachmentRecords`、`fulltextChunkWords`、`maxFulltextChars` |
| 文献面板 | `library`    | 1      | 侧边栏显示设置：`rightSidebarEnabled`                                                                                                                                                                                                                                                                                                               |
| 学术检索 | `scholarly`  | 6      | 数据源身份与密钥：`email`、`s2Key`、`ncbiKey`、`openalexKey`；学术检索与全文配额：`maxResults`、`maxContentChars`                                                                                                                                                                                                                                   |
| 高级选项 | `zotero`     | 9      | 输出限制：`maxResponseBytes`、`maxExportChars`、`maxExportRefs`、`maxBrowseResults`、`maxChangesResults`；后台任务：`enableRunInBackground`、`promoteOnTimeout`、`foregroundWaitMs`；诊断：`debug`                                                                                                                                                  |

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
| `maxDetailChars`           | `3000`                       | `zotero_get` 摘要预览字符预算                                                                                                                                                 |
| `maxNoteBodyChars`         | `30000`                      | 笔记正文字符预算                                                                                                                                                              |
| `maxNoteChars`             | `2000`                       | `zotero_get` 单条笔记预览字符预算                                                                                                                                             |
| `maxNoteRecords`           | `50`                         | `zotero_get` 返回笔记条数上限                                                                                                                                                 |
| `maxAnnotationRecords`     | `100`                        | `zotero_get` 返回批注条数上限                                                                                                                                                 |
| `maxAttachmentRecords`     | `50`                         | `zotero_get`/`zotero_children` 返回附件条数上限                                                                                                                               |
| `fulltextChunkWords`       | `200`                        | 进入排名的全文分块词数                                                                                                                                                        |
| `maxFulltextChars`         | `250000`                     | `zotero_retrieve` 单次调用接受的最大全文字符数（多附件时均分）                                                                                                                |
| `retrieveAttachmentCap`    | `16`                         | 单次 `zotero_retrieve` 参与全文排名的附件数上限                                                                                                                               |
| `graphConcurrency`         | `4`                          | `zotero_retrieve` 读取附件的并发数                                                                                                                                            |
| `maxResponseBytes`         | `16777216`                   | 单次 API 响应流式读取字节上限（16 MiB）                                                                                                                                       |
| `maxExportChars`           | `1000000`                    | 导出输出字符硬上限（100 万字符）                                                                                                                                              |
| `maxExportRefs`            | `50`                         | 单次 `zotero_export` 调用的引用条数上限；文献面板的 `zotero/export` 端点共用这一上限                                                                                          |
| `maxBrowseResults`         | `50`                         | 单次 `zotero_browse` 返回条目上限；同时钳制文献面板的浏览页大小（集合树/标签/保存搜索，响应携带实际生效的 `limit`）                                                           |
| `maxChangesResults`        | `50`                         | 单次 `zotero_changes` 每种资源列出的条目上限（仅影响展示）                                                                                                                    |
| `scopeListingTtlMs`        | `30000`                      | 合集与检索范围列表的信任时长（毫秒），超时后重新读取                                                                                                                          |
| `defaultStyle`             | `apa`                        | CSL 引用样式（需 Zotero 内置）；用于 `citation` 与 `bibliography`，工具导出与文献面板复制引用共用                                                                             |
| `defaultLocale`            | `en-US`                      | CSL 引用语言；用于 `citation` 与 `bibliography`，工具导出与文献面板复制引用共用                                                                                               |
| `writeEnabled`             | `false`                      | 是否注册并启用个人库写入工具                                                                                                                                                  |
| `writePersistKey`          | `true`                       | 是否将 Always-Allow 写入密钥保存到宿主凭据管理器                                                                                                                              |
| `writeNoteMaxChars`        | `65536`                      | 单条研究笔记正文字符上限                                                                                                                                                      |
| `writeListMaxItems`        | `50`                         | 列表类写入参数的条目上限：`update_item_tags`/`update_item_collections` 的 `add`/`remove`、`delete_library_tags` 的 `tags`、`create_note` 的 `collections`/`tags`/`sourceRefs` |
| `writeAuthorizeDeadlineMs` | `120000`                     | 写入时等待 Zotero 授权弹窗的时限（毫秒）                                                                                                                                      |
| `webEnabled`               | `true`                       | 是否显示会话顶部的文献轨迹标签页；同时是右侧边栏文献面板的门控之一                                                                                                            |
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

文献面板与学术检索的 schema 由组件自身在挂载时校验：`rightSidebarEnabled` 必须为布尔值；`maxResults` 必须是 1–100 的整数；`maxContentChars` 必须是 1,000–50,000 的整数；密钥字段必须为字符串。

## 配置优先级

```text
Schema 默认值 → Composition 入口配置 → 当前 profile 的 Cordis patch 覆盖层
```

三个命名空间遵循同一顺序。覆盖层（当前 profile 的 `cordis.patch.yml` 中对应条目的 `config`）优先级最高，覆盖 Schema 默认值与入口配置；home patch 与命令行 overlay 优先于它，会被它们覆盖的表单写入将被拒绝。

## 插件配置页

在插件管理器中打开 **dsh-zotero** 的详情页，其配置区承载完整的 6 标签页表单（通过 harness 官方 `SettingsForm` 与 `SettingsFormModel`），一次编辑 `zotero`、`library` 与 `scholarly` 三个命名空间：

- 修改结果写入当前 profile 的 `cordis.patch.yml` 中对应条目的 `config` 覆盖层；
- 保存即时生效：传输层配置与写入开关变更时在服务实例内重建对应组件，纯限额字段由 provider 实时读取；
- 无效配置在写入前会被拦截，配置页保留有效配置草稿；
- 被覆盖层显式设置的字段显示标记，支持一键重置；
- 表单写入受 revision 栅栏保护（过期草稿会被拒绝）；home patch 与命令行 overlay 会覆盖的写入同样不会落盘。

同一份表单状态还有两处入口，三者关系如下：

1. **统一设置页标签页**：插件详情页配置区的 6 标签页表单；
2. **组件行配置**：「包含的组件」中 `dsh-zotero#library` 与 `dsh-zotero#scholarly` 行的「配置」按钮，分别编辑对应命名空间；
3. **配置文件**：直接编辑当前 profile 的 `cordis.patch.yml` 中对应条目的 `config`。

前两处是同一份 `ConfigForm` 状态的两个视图，双通道实时同步；第三处是配置覆盖层，表单写入会以它为最高优先级。组件行未组合时，设置页的对应标签页只显示一条指向「包含的组件」的禁用提示，不渲染任何字段，组件行配置入口也不会注册。

## 热重载行为

- 传输层配置或写入开关变更时，在同一 `ZoteroService` 实例上重建 HTTP 客户端、local provider 与写入工具集；
- 限额配置变更由 provider 在下次调用时直接读取，无需重建传输层；
- `webEnabled` 开关保存后即时显示或隐藏文献轨迹标签页与文献面板；
- `rightSidebarEnabled` 开关保存后即时显示或隐藏右侧边栏的文献面板；
- `debug` 开关保存后即时生效，控制详情页底部诊断面板的显示与诊断日志保留，无需重新初始化组件；
- 其余配置更新均在下一次工具调用时生效，无需重启宿主。

## 无设置服务的运行环境

在未集成设置服务的无界面（headless）环境中，插件以入口配置参数运行。

---

## 学术检索组件配置 (`dsh-zotero/scholarly`)

组件随包发布，默认关闭。开关只有插件管理器「包含的组件」里的 `dsh-zotero/scholarly` 那一行：启用该行即挂载组件，注册它的 7 个模型工具，并允许向显式允许列表中的外部学术索引发请求。组件未挂载时，服务、传输层与工具都不存在，宿主无法发出任何外部请求；手改等价路径是在当前 profile 的 `cordis.patch.yml` 中写 `- id: scholarly` + `disabled: false`。外部检索的授权边界见[产品模型](product-model.md)的「四条边界」。

组件字段有三处入口：统一设置页的「学术检索」标签页、插件列表中 `dsh-zotero#scholarly` 行的「配置」按钮，或当前 profile 的 `cordis.patch.yml` 中该行的 `config`。前两处是同一份表单状态的两个视图，双通道实时同步；第三处是配置覆盖层。字段变更在下一次工具调用时生效，无需重启 profile：

| 字段              | 默认值  | 说明                                                                                               |
| ----------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `email`           | —       | 联系邮箱，附加于 Crossref、OpenAlex 和 NCBI/Europe PMC 请求头（加入 Polite Pool 获得更优限速配额） |
| `s2Key`           | —       | Semantic Scholar API Key（可选，避免共享 IP 池限速）                                               |
| `ncbiKey`         | —       | NCBI / PubMed API Key（可选，将每秒请求上限从 3 提升至 10）                                        |
| `openalexKey`     | —       | OpenAlex API Key（可选，将每秒请求上限提升至 100）                                                 |
| `maxResults`      | `20`    | 单次检索返回的最大论文数量（1-100）                                                                |
| `maxContentChars` | `12000` | 全文分块读取字符数上限（1,000-50,000）                                                             |

组件未启用时，设置页的「学术检索」标签页只显示一条指向「包含的组件」的提示，不渲染任何字段，组件行配置入口也不会注册；组件启用后该标签页才成为可编辑表单。全文缓存在 `$DSH_HOME/cache/zotero-scholarly/` 下按 key 存一份 JSON 正文（不受本表控制，无独立开关）。

---

## 文献面板组件配置 (`dsh-zotero/library`)

文献面板是独立的 DSH bundle 子组件，随包发布并在默认 profile 中启用（`cordis.patch.yml` 包含 `- id: library` / `name: dsh-zotero/library`）。它提供全库浏览、检索、条目检视与复制引用，作为右侧边栏标签页与会话并排显示。

组件字段有三处入口：

1. **统一设置页「文献面板」标签页**：在插件详情页的 6 标签页表单中切换至「文献面板」；
2. **包含的组件列表行配置**：在「包含的组件」中点击 `dsh-zotero#library` 行的「配置」按钮；
3. **配置文件**：在当前 profile 的 `cordis.patch.yml` 对应条目的 `config` 下声明。

前两处是同一份表单状态的两个视图，双通道实时同步；第三处是配置覆盖层。

| 字段                  | 默认值 | 说明                                                                                                            |
| --------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `rightSidebarEnabled` | `true` | 是否在右侧边栏显示文献面板标签页与快捷入口（`sidebarRightTabs` + `sidebar.right.pane.tab`），可边对话边查阅文献 |

文献面板要出现，需要以下三处同时成立：

1. `dsh-zotero/library` 组件行已组合：行未启用时不注册任何面板表面，也不发起 `zotero/browse|collectionPath|search|item|childPage|export|write` 请求；
2. 核心 `webEnabled` 开启（「基础设置 → 文献轨迹 → 显示文献轨迹」）；
3. 本组件的 `rightSidebarEnabled` 开启。

面板只浏览与检索本地文献库；面板发起的写入与工具写入走同一条审批接缝，且要求所属会话正在运行。外部检索不属于面板，见[产品模型](product-model.md)的「四条边界」。
