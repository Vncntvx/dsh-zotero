# dsh-zotero

<p align="center">
  <a href="README.en.md"><b>English</b></a> · <b>中文</b>
</p>

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，让 Agent 渐进访问本地 [Zotero](https://www.zotero.org) 文献库：发现、元数据、证据、引用。它通过 Harness 已有扩展点提供五个工具、一个命令和一个提示词分区。

## 环境要求

- 已安装 Zotero 桌面版，并启用本地 API：**设置 → 高级 → “Allow other applications on this computer to communicate with Zotero”**。
- 本地 API 为无认证读取，地址为 `http://127.0.0.1:23119/api`。插件不会写入文献库（V1 只读）。
- Zotero ≥ 7，本地 API 版本为 3。如果 status 命令报告版本不匹配，请升级。

## 安装

在 dsh checkout 中构建并安装到 profile：

```sh
cd dsh-zotero
npm install
npm run build
dsh plugin --profile <name> add ./dsh-zotero
```

发布后可按包名安装：

```sh
dsh plugin --profile <name> add dsh-zotero
```

插件以 `zotero` 为 id、空配置挂载。下次运行 `dsh web` 或 headless 时使用默认配置加载。

## 工具

| 工具 | 用途 |
| --- | --- |
| `zotero_search` | 通过 Zotero 快速搜索发现候选条目（标题/作者/年份，或使用 `everything` 搜索全文索引）。可搜索整个文献库，也可按名称或 ref 限定到某个分类或已保存搜索。 |
| `zotero_get` | 读取单条条目的元数据；`include` 可附加子笔记、注释或附件（惰性请求）。 |
| `zotero_retrieve` | 使用 BM25 对证据片段（注释、笔记、摘要、全文分块）按查询排序。 |
| `zotero_attachment` | 将附件解析为已验证的本地磁盘路径或链接 URL。 |
| `zotero_export` | 按 ref 导出 HTML 引用、合并的 CSL 参考文献，或 `bibtex` / `biblatex` / `ris` / `csljson` 格式。 |

每个工具都返回形如 `zotero://user/0/<item|attachment|annotation|collection|search>/<KEY>` 的稳定 ref，并可用 `?server=<id>` 限定来源。该限定符记录 ref 来自哪个 Zotero 数据库。用于不同数据库时 fail closed，不解析同 key 对象。

## 命令

`/zotero status` 报告连通性、API/schema 版本和实例的 Server ID。这是唯一的健康检查。普通调用失败时返回带类型的领域错误。

## 配置

所有值都是 `Config` 字段，可在 bundle 的 `config` 块中修改（例如通过 `dsh plugin config`）。以下为默认值。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:23119/api` | 本地 API 基础 URL。仅支持纯回环 HTTP。 |
| `provider` | `local` | 要选择的 provider id。 |
| `timeoutMs` | `5000` | 每个请求的 provider 超时时间。 |
| `maxSearchResults` | `20` | `zotero_search` `limit` 的上限。 |
| `maxEvidenceChars` | `6000` | 检索证据的总字符预算。 |
| `maxEvidencePassages` | `4` | 证据片段数量的上限。 |
| `maxDetailChars` | `3000` | `zotero_get` 摘要预览的字符预算。 |
| `maxFulltextChars` | `250000` | 进入证据排序的全文大小上限。 |
| `maxResponseBytes` | `16777216` | 每个 API 响应的流式字节上限。 |
| `maxExportChars` | `1000000` | 导出输出的硬上限。不会中途截断。 |
| `defaultStyle` | `apa` | 引用/参考文献使用的 CSL 样式。 |
| `defaultLocale` | `en-US` | 引用/参考文献使用的 CSL locale。 |


## 开发

```sh
npm install                      # 使用本地 npm 缓存
npm test                         # 单元测试（mock Zotero server）
npm run test:coverage            # 对 src/ 的 100% 覆盖率门禁
npm run typecheck                # tsc --noEmit，app + test 项目
npm run build                    # 生成 lib/
```

针对真实 Zotero 运行（集成测试默认跳过，需显式开启）：

```sh
ZOTERO_INTEGRATION=1 npx vitest run tests/integration/zotero.integration.spec.ts
```

在 DeepSeek Harness 源码 checkout 中，可通过 dev overlay 直接加载插件，无需安装：

```sh
pnpm dsh web --patch ./dsh-zotero/dev.cordis.yml
```

`dev.cordis.yml` 指向绝对的 `src/index.ts` 路径。请按你的 checkout 路径调整。
