<p align="right"><a href="configuration.en.md"><b>English</b></a></p>

# 配置参考

所有配置字段均定义在 `src/config.ts`，由 Schemastery schema 提供默认值，并在插件加载时通过 `resolveConfig` 执行运行时校验。配置不合法将阻止插件加载。

## 字段列表

| 字段                       | 默认值                       | 说明                                                                                                                                                                          |
| -------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`                  | `http://127.0.0.1:23119/api` | Zotero Local API 地址，必须为 loopback HTTP，路径以 `/api` 为前缀（`localhost` 运行时解析为 `127.0.0.1`）                                                                     |
| `provider`                 | `local`                      | 选用的 provider 标识                                                                                                                                                          |
| `timeoutMs`                | `5000`                       | 单次 HTTP 请求超时时间（毫秒）                                                                                                                                                |
| `maxInFlightRequests`      | `8`                          | 对 Local API 的并发在途请求数上限                                                                                                                                             |
| `maxSearchResults`         | `20`                         | `zotero_search` 返回条目上限                                                                                                                                                  |
| `maxNoteScanRecords`       | `200`                        | 搜索笔记内容时扫描的笔记条目上限                                                                                                                                              |
| `searchConcurrency`        | `4`                          | `zotero_search` 归属查询的并发数                                                                                                                                              |
| `maxEvidenceChars`         | `6000`                       | 原文片段总字符预算                                                                                                                                                            |
| `maxEvidencePassages`      | `4`                          | 原文片段数量上限                                                                                                                                                              |
| `maxDetailChars`           | `3000`                       | `zotero_get` 摘要预览字符预算                                                                                                                                                 |
| `maxNoteBodyChars`         | `30000`                      | 笔记正文字符预算                                                                                                                                                              |
| `maxNoteChars`             | `2000`                       | `zotero_get` 单条笔记预览字符预算                                                                                                                                             |
| `maxNoteRecords`           | `50`                         | `zotero_get` 返回笔记条数上限                                                                                                                                                 |
| `maxAnnotationRecords`     | `100`                        | `zotero_get` 返回批注条数上限                                                                                                                                                 |
| `fulltextChunkWords`       | `200`                        | 进入排名的全文分块词数                                                                                                                                                        |
| `maxFulltextChars`         | `250000`                     | `zotero_retrieve` 单次调用接受的最大全文字符数（多附件时均分）                                                                                                                |
| `retrieveAttachmentCap`    | `16`                         | 单次 `zotero_retrieve` 参与全文排名的附件数上限                                                                                                                               |
| `graphConcurrency`         | `4`                          | `zotero_retrieve` 读取附件的并发数                                                                                                                                            |
| `maxResponseBytes`         | `16777216`                   | 单次 API 响应流式读取字节上限（16 MiB）                                                                                                                                       |
| `maxExportChars`           | `1000000`                    | 导出输出字符硬上限（100 万字符）                                                                                                                                              |
| `maxExportRefs`            | `50`                         | 单次 `zotero_export` 引用条数上限                                                                                                                                             |
| `maxBrowseResults`         | `50`                         | 单次 `zotero_browse` 返回条目上限                                                                                                                                             |
| `maxChangesResults`        | `50`                         | 单次 `zotero_changes` 每种资源列出的条目上限（仅影响展示）                                                                                                                    |
| `scopeListingTtlMs`        | `30000`                      | 合集与检索范围列表的信任时长（毫秒），超时后重新读取                                                                                                                          |
| `defaultStyle`             | `apa`                        | CSL 引用样式（需 Zotero 内置）                                                                                                                                                |
| `defaultLocale`            | `en-US`                      | CSL 引用语言                                                                                                                                                                  |
| `writeEnabled`             | `false`                      | 是否注册并启用个人库写入工具                                                                                                                                                  |
| `writePersistKey`          | `true`                       | 是否将 Always-Allow 写入密钥保存到宿主凭据管理器                                                                                                                              |
| `writeNoteMaxChars`        | `65536`                      | 单条研究笔记正文字符上限                                                                                                                                                      |
| `writeListMaxItems`        | `50`                         | 列表类写入参数的条目上限：`update_item_tags`/`update_item_collections` 的 `add`/`remove`、`delete_library_tags` 的 `tags`、`create_note` 的 `collections`/`tags`/`sourceRefs` |
| `writeAuthorizeDeadlineMs` | `120000`                     | 写入时等待 Zotero 授权弹窗的时限（毫秒）                                                                                                                                      |
| `webEnabled`               | `true`                       | 是否在 DSH Web 中启用 Zotero 会话标签页                                                                                                                                       |
| `enableRunInBackground`    | `true`                       | 是否允许工具参数 `run_in_background` 显式放入后台                                                                                                                             |
| `promoteOnTimeout`         | `true`                       | 前台导出或变更同步超时时是否自动提升为后台任务                                                                                                                                |
| `foregroundWaitMs`         | `4000`                       | 前台执行等待上限（毫秒），超时后自动提升为后台 Job                                                                                                                            |

说明：`foregroundWaitMs` 控制前台任务等待时长，超时后自动转为后台 Job；`timeoutMs` 控制单次 Zotero HTTP 请求超时，两者相互独立。

## 校验规则

`resolveConfig` 在加载时执行以下校验：

- `baseUrl` 必须为字符串，且使用 `http:` 协议（Zotero Local API 不支持 HTTPS），不得包含凭据信息、查询字符串或 URL 片段；
- `baseUrl` 主机名必须为环回地址（`127.0.0.1`、`localhost`、`::1`、`[::1]`）；`localhost` 在运行时解析为 `127.0.0.1`；
- `baseUrl` 路径必须为 `/api` 或以 `/api/` 开头；
- `timeoutMs` 必须为正有限数；
- 其余数值字段（并发、各类上限、`scopeListingTtlMs`、`foregroundWaitMs`、`writeNoteMaxChars`、`writeListMaxItems`、`writeAuthorizeDeadlineMs`）均必须为正整数；
- `writeEnabled`、`writePersistKey`、`webEnabled`、`enableRunInBackground` 与 `promoteOnTimeout` 必须为布尔值；
- `provider`、`defaultStyle` 与 `defaultLocale` 必须为非空字符串。

## 配置优先级

```text
Schema 默认值 → Composition 入口配置 → settings.yaml 用户层
```

用户层（`settings.yaml`）配置优先级最高，覆盖底层默认值与入口配置。

## 设置页配置

插件在设置面板的左侧导航中注册 Zotero 配置页，绑定 `zotero` 命名空间：

- 修改结果保存至 `$DSH_HOME/settings.yaml` 的 `zotero:` 段；
- 保存即时生效：传输层配置与写入开关变更时在服务实例内重建对应组件，纯限额字段由 provider 实时读取；
- 无效配置在写入前会被拦截，设置页保留有效配置草稿；
- 被用户层覆盖的字段显示标记，支持一键重置；
- 直接编辑 `settings.yaml` 文件同样支持热重载。

## 热重载行为

- 传输层配置或写入开关变更时，在同一 `ZoteroService` 实例上重建 HTTP 客户端、local provider 与写入工具集；
- 限额配置变更由 provider 在下次调用时直接读取，无需重建传输层；
- `webEnabled` 开关保存后即时显示或隐藏对应标签页；
- 绝大多数配置更新均在下一次工具调用时生效，无需重启宿主。

## 无设置服务的运行环境

在未集成设置服务的无界面（headless）环境中，插件以入口配置参数运行。
