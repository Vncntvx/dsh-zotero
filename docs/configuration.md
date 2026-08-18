<p align="right"><a href="configuration.en.md"><b>English</b></a></p>

# dsh-zotero 配置参考

所有配置字段均定义在 `src/config.ts`，由 Schemastery schema 提供默认值，`resolveConfig` 在插件加载时做运行时校验。配置不合法会阻止插件加载。

## 字段一览

| 字段                   | 默认值                       | 说明                                        |
| ---------------------- | ---------------------------- | ------------------------------------------- |
| `baseUrl`              | `http://127.0.0.1:23119/api` | Zotero Local API 地址，必须为 loopback HTTP |
| `provider`             | `local`                      | 选择的 provider id                          |
| `timeoutMs`            | `5000`                       | 单次请求超时（毫秒）                        |
| `maxSearchResults`     | `20`                         | `zotero_search` 返回条目上限                |
| `maxNoteScanRecords`   | `200`                        | 搜索笔记内容时扫描的笔记条目上限            |
| `maxEvidenceChars`     | `6000`                       | 证据段落总字符预算                          |
| `maxEvidencePassages`  | `4`                          | 证据段落数量上限                            |
| `maxDetailChars`       | `3000`                       | `zotero_get` 摘要预览字符预算               |
| `maxNoteBodyChars`     | `30000`                      | 笔记自身正文字符预算                        |
| `maxNoteChars`         | `2000`                       | `zotero_get` 单条笔记预览字符预算           |
| `maxNoteRecords`       | `50`                         | `zotero_get` 返回笔记条数上限               |
| `maxAnnotationRecords` | `100`                        | `zotero_get` 返回批注条数上限               |
| `fulltextChunkWords`   | `200`                        | 进入排名的全文分块词数                      |
| `maxFulltextChars`     | `250000`                     | `zotero_retrieve` 排名接受的最大全文字符数  |
| `maxResponseBytes`     | `16777216`                   | 单次 API 响应流式读取字节上限（16 MiB）     |
| `maxExportChars`       | `1000000`                    | 导出输出硬上限（100 万字符）                |
| `maxExportRefs`        | `50`                         | 单次 `zotero_export` 引用条数上限           |
| `defaultStyle`         | `apa`                        | CSL 引用样式（需 Zotero 内置）              |
| `defaultLocale`        | `en-US`                      | CSL 引用语言                                |
| `webEnabled`           | `true`                       | 是否在 dsh web 中启用 Zotero 会话标签页     |

## 校验规则

`resolveConfig` 在加载时执行以下检查，不合法则抛出错误：

- `baseUrl` 必须使用 `http:` 协议（Zotero Local API 不支持 HTTPS）
- `baseUrl` 主机名必须为 loopback 地址：`127.0.0.1`、`localhost`、`::1`、`[::1]`
- `timeoutMs` 必须为正有限数
- 所有数值型上限字段必须为正整数
- `provider`、`defaultStyle`、`defaultLocale` 必须为非空字符串

## 配置优先级

```
Schema 默认值 → composition 入口配置 → settings.yaml 用户层
```

用户层（settings document）始终覆盖底层。patch 入口配置是 base 层，用户层可任意覆盖。

## Settings 配置卡片

插件在 Settings → Plugins → Plugin configuration 下注册一个配置卡片，绑定 `zotero` settings namespace。

- 写入生效于 `$DSH_HOME/settings.yaml` 的 `zotero:` 段
- 保存即时生效：transport 和 provider 按新值重建
- 无效值在写入前被拒绝，卡片保留上次有效值的草稿
- 被 settings document 覆盖的字段显示「Overridden」标记，一键可重置
- `settings.yaml` 的外部编辑同样热生效

## 热更新行为

- 设置修改后自动重建 HTTP client 和 local provider
- 下一次工具调用或 `/zotero status` 即使用新值，无需重启
- `webEnabled` 开关即时生效：标签页立即显示/隐藏

## 无 settings 服务的组合

headless 组合（未包含 settings 服务）不会注册配置卡片，插件以 patch 入口配置中的值运行。
