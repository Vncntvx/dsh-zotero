<p align="right"><a href="configuration.en.md"><b>English</b></a></p>

# dsh-zotero 配置参考

所有配置字段均定义在 `src/config.ts`，由 Schemastery schema 提供默认值，`resolveConfig` 在插件加载时做运行时校验。配置不合法会阻止插件加载。

## 字段一览

| 字段                   | 默认值                       | 说明                                                                         |
| ---------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| `baseUrl`              | `http://127.0.0.1:23119/api` | Zotero Local API 地址，必须为 loopback HTTP 且路径为 `/api`                  |
| `provider`             | `local`                      | 选择的 provider id                                                           |
| `timeoutMs`            | `5000`                       | 单次请求超时（毫秒）                                                         |
| `maxSearchResults`     | `20`                         | `zotero_search` 返回条目上限                                                 |
| `maxNoteScanRecords`   | `200`                        | 搜索笔记内容时扫描的笔记条目上限                                             |
| `maxEvidenceChars`     | `6000`                       | 证据段落总字符预算                                                           |
| `maxEvidencePassages`  | `4`                          | 证据段落数量上限                                                             |
| `maxDetailChars`       | `3000`                       | `zotero_get` 摘要预览字符预算                                                |
| `maxNoteBodyChars`     | `30000`                      | 笔记自身正文字符预算                                                         |
| `maxNoteChars`         | `2000`                       | `zotero_get` 单条笔记预览字符预算                                            |
| `maxNoteRecords`       | `50`                         | `zotero_get` 返回笔记条数上限                                                |
| `maxAnnotationRecords` | `100`                        | `zotero_get` 返回批注条数上限                                                |
| `fulltextChunkWords`   | `200`                        | 进入排名的全文分块词数                                                       |
| `maxFulltextChars`     | `250000`                     | `zotero_retrieve` **单次调用**接受的最大全文字符数（多附件时在各附件间均分） |
| `maxResponseBytes`     | `16777216`                   | 单次 API 响应流式读取字节上限（16 MiB）                                      |
| `maxExportChars`       | `1000000`                    | 导出输出硬上限（100 万字符）                                                 |
| `maxExportRefs`        | `50`                         | 单次 `zotero_export` 引用条数上限                                            |
| `maxBrowseResults`     | `50`                         | 单次 `zotero_browse` 返回条目上限                                            |
| `maxChangesResults`    | `50`                         | 单次 `zotero_changes` 每种资源列出的条目上限（仅呈现；读取始终整批）         |
| `defaultStyle`         | `apa`                        | CSL 引用样式（需 Zotero 内置）                                               |
| `defaultLocale`        | `en-US`                      | CSL 引用语言                                                                 |
| `writeEnabled`         | `false`                      | 是否注册并允许三个个人库写工具                                               |
| `writeConfirm`         | `true`                       | 每次写入前是否展示 dsh 计划批准卡                                            |
| `writePersistKey`      | `true`                       | Always-Allow 写 key 是否保存到宿主 credentials store                         |
| `webEnabled`           | `true`                       | 是否在 dsh web 中启用 Zotero 会话标签页                                      |

## 校验规则

`resolveConfig` 在加载时执行以下检查，不合法则抛出错误：

- `baseUrl` 必须使用 `http:` 协议（Zotero Local API 不支持 HTTPS）
- `baseUrl` 主机名必须为 loopback 地址：`127.0.0.1`、`localhost`、`::1`、`[::1]`
- `baseUrl` 路径必须为 Local API 根（`/api`）
- `timeoutMs` 必须为正有限数
- 所有数值型上限字段必须为正整数
- `provider`、`defaultStyle`、`defaultLocale` 必须为非空字符串

## 配置优先级

```
Schema 默认值 → composition 入口配置 → settings.yaml 用户层
```

用户层（settings document）始终覆盖底层。patch 入口配置是 base 层，用户层可任意覆盖。

## Settings 配置页

插件在 Settings 面板的左侧导航中注册一个 **Zotero** 配置页（与 General、Models、Plugins 并列），绑定 `zotero` settings namespace。

- 写入生效于 `$DSH_HOME/settings.yaml` 的 `zotero:` 段
- 保存即时生效：结构性 transport 或写入开关在同一服务实例上重建 transport/provider/写工具；provider id 仍由下一次调用实时选择，纯限额字段由 provider 实时读取
- 无效值在写入前被拒绝，配置页保留上次有效值的草稿
- 被 settings document 覆盖的字段显示「Overridden」标记，一键可重置
- `settings.yaml` 的外部编辑同样热生效

## 热更新行为

- transport 字段或写入开关变化时，在同一 `ZoteroService` 实例上重建 HTTP client、local provider 与写工具集；provider id 变化只影响下一次选择
- 仅限额变化时由 provider 的实时 getter 在下一次调用读取，无需重建 transport
- 下一次工具调用或 `/zotero status` 即使用新值，无需重启
- `webEnabled` 开关即时生效：标签页立即显示/隐藏

## 无 settings 服务的组合

headless 组合（未包含 settings 服务）不会提供配置页的内容，插件以 patch 入口配置中的值运行；设置面板中该页仍会出现，并说明本部署没有提供 Zotero 设置项。
