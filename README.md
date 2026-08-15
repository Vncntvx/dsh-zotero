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
npm run test:integration
# 或：ZOTERO_INTEGRATION=1 npx vitest run tests/integration/zotero.integration.spec.ts
```

## 本地启动

插件可在两种环境中启动：dsh 源码 checkout，或 npm 安装的正式版 dsh。

### 从 dsh 源码启动

在 deepseek-harness 源码 checkout 中构建一次（`pnpm install && pnpm run build`），然后通过 dev overlay 加载插件源码：

```sh
pnpm dsh web --patch ./dsh-zotero/dev.cordis.yml
```

`dev.cordis.yml` 将插件入口指向绝对的 `src/index.ts`。dsh 的源码启动经 tsx 加载该 TypeScript 入口，插件因此无需预构建；若 checkout 路径不同，需同步修改文件中的绝对路径。

### 使用 npm 安装的 dsh

npm 安装的 dsh 提供两种运行方式。

**常驻实例**：打包为 tarball 并安装到 profile，插件以 tarball 中的副本运行；代码更新需重新打包安装。安装后运行生产栈 smoke 验证：

```sh
npm pack
dsh plugin --profile <name> add ./dsh-zotero-0.1.0.tgz
cd ~/.dsh/profiles/<name>
node --input-type=module < /path/to/dsh-zotero/scripts/smoke.mjs
```

smoke 需在 profile 目录内运行，裸导入由此从 profile 的扁平 `node_modules` 解析。脚本依次验证 `status`、`search`、`get`、`retrieve`、`export`、策略提示词分区与五个工具注册；输出 `SMOKE PASS` 表示打包后的插件通过安装路径验证。

**开发实例（热替换）**：`dev-lib.cordis.yml` 覆盖层禁用 profile 中的 tarball 副本（id `zotero`），插入 `zotero-dev` 指向本仓库的 `lib/index.js`，并重新启用 HMR。生产 web profile 默认禁用 loader HMR，且 HMR 的监视根位于 profile 目录，因此覆盖层显式设置了 `base`。构建输出变化后，HMR 在同一进程内销毁旧实例并重新构造插件，无需重启 dsh：

```sh
cd /Volumes/Work/deepseek-harness/dsh-zotero
npm run dev &                    # tsc --watch：修改 src 后自动重建 lib
dsh web --patch ./dev-lib.cordis.yml --port 3307
```

热替换仅作用于通过 `--patch` 启动的实例；常驻实例继续运行 tarball 版本。
