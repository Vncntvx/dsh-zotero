# dsh-zotero

<p align="center">
  <a href="README.en.md"><b>English</b></a> · <b>中文</b>
</p>

让 Agents 搜索、阅读并引用你的本地 [Zotero](https://www.zotero.org) 文献库：找文献、查看笔记与批注、按问题取证、打开原文、生成引用。

在会话里用自然语言描述需求，Agent 自动按需调用下面的工具；唯一的手动命令是 `/zotero status`。

## 工具

| 工具                | 用途                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `zotero_search`     | 发现：按标题/作者/年份搜索库里的资料，`everything` 模式连全文索引一起搜；可限定某个分类或已保存搜索                        |
| `zotero_get`        | 检查：读取一条资料的结构化核心元数据，可选检查笔记、注释、附件的清单与预览。                                               |
| `zotero_retrieve`   | 取证：按问题返回最相关的有界证据片段（注释、笔记、摘要、全文分块）                                                         |
| `zotero_attachment` | 原文：解析条目或附件 ref，返回原始附件已验证的磁盘路径或链接 URL                                                           |
| `zotero_export`     | 引用：让 Zotero 按自己的 citation/export 能力生成结果（引用、CSL 参考文献表、`bibtex` / `biblatex` / `ris` / `csljson`）。 |

## 使用示例

Agent 按需求逐层深入，一段典型对话：

> 用户：「帮我找 FlashAttention 相关论文」
> Agent → `zotero_search`，返回候选条目与 ref。
>
> 用户：「第一篇是什么？我以前读过吗？」
> Agent → `zotero_get`：元数据、17 条批注、2 条笔记与有限预览。
>
> 用户：「我当时对 evaluation 有什么意见？」
> Agent → `zotero_retrieve(query:"evaluation", sources:["annotations","notes"])`，返回相关笔记与批注证据。
>
> 用户：「论文自己怎么解释 memory efficiency？」
> Agent → `zotero_retrieve(query:"memory efficiency", sources:["fulltext","abstract"])`，返回摘要与全文片段。
>
> 用户：「我要看原 PDF」
> Agent → `zotero_attachment(条目 ref)`，返回已验证的文件路径；若当前 Harness 配置了 PDF/file 读取能力，再交给该能力继续分析。
>
> 用户：「把这三篇生成 APA 参考文献表」
> Agent → `zotero_export(format:"bibliography", style:"apa")`。

## 命令

`/zotero status` 报告连通性、API/schema 版本和数据库身份标识（Server ID，Zotero 10+）。这是唯一的健康检查。普通调用失败时返回带类型的领域错误。

## 按需工作与连接失败交互

- 插件常驻但完全请求驱动：加载、闲置、卸载都不会发起任何请求（无探测、无轮询、无后台任务）。只有两种入口会触达 Zotero：Agent 在用户明确要求时调用五个工具，或用户手动执行 `/zotero status`。
- 工具调用遇到连接类失败（`ZOTERO_NOT_RUNNING` 未运行 / `ZOTERO_API_DISABLED` 本地 API 被禁用 / `ZOTERO_API_VERSION` 版本过旧 / `ZOTERO_TIMEOUT` 超时）时，会通过交互式问题卡片询问用户怎么处理：第一个选项是带 `(Recommended)` 的推荐操作（如"我已启动 Zotero，重试"），选择后插件按原参数重试一次；再失败或选择"放弃这次查询"时返回原类型化错误，绝不反复询问。
- 无交互能力的环境（headless 组合、无 UI provider）自动降级：不询问，直接返回类型化错误。询问机制自身故障也绝不掩盖原始连接错误。

## 限制

- 对文献库只读：没有任何修改条目、笔记、标签、分类等文献库数据的路径。
- 全文证据依赖 Zotero 的全文索引：`everything` 搜索和 `retrieve` 的全文片段都以索引为前提。
- 笔记正文搜索是插件侧补扫：仅库/分类范围、仅结果首页、受 `maxNoteScanRecords` 上限约束，超出上限的笔记不参与匹配。
- 附件深度分析取决于当前 Harness 配置：`zotero_attachment` 返回文件位置，能否继续读取该 PDF 由 composition 里是否有相应文件/PDF 能力决定。
- 证据排序是词项相关度检索，不是 embedding 或语义搜索。

## 环境要求

- 已安装 Zotero 桌面版，并启用本地 API：**设置 → 高级 → “Allow other applications on this computer to communicate with Zotero”**。
- 本地 API 为无认证读取，地址为 `http://127.0.0.1:23119/api`。V1 没有任何修改文献库数据（条目、笔记、标签、分类等）的路径。
- Zotero ≥ 7，本地 API 版本为 3。如果 status 命令报告版本不匹配，请升级。

## 安装

### 按包名安装

```sh
dsh plugin --profile <name> add dsh-zotero
```

tarball 内含已构建的 `lib/`，无需本地构建。

### 本地 tarball

```sh
cd dsh-zotero
npm pack
dsh plugin --profile <name> add ./dsh-zotero-0.1.0.tgz
```

`npm pack` 先运行 `prepare` 构建 `lib/`，适合未发布或本地试装。

### 从 GitHub 源码安装

```sh
dsh plugin --profile <name> add github:Vncntvx/dsh-zotero
```

git 安装拉取源码而非构建产物，pnpm 安装依赖后运行本包的 `prepare` 现场构建（TypeScript 与 `@types/node` 在 `dependencies` 中）。pnpm ≥ 10 默认拒绝运行 git 依赖的 `prepare`，首次 `add` 会失败并提示：把包名加进 profile 的 `pnpm-workspace.yaml` 后重新执行：

```yaml
allowBuilds:
  dsh-zotero: true
```

`allowBuilds` 授权该包在安装时执行代码，只允许你信任的来源，建议固定到具体提交（`github:Vncntvx/dsh-zotero#<sha>`）。

插件以 id `zotero` 挂载，下次启动 dsh 时生效。安装或启用插件后，如果当前会话创建于插件加载之前，请新建会话，确保 Agent 获得 Zotero 工具。

## 配置

所有值都是 `Config` 字段，可在 bundle 的 `config` 块中修改（例如通过 `dsh plugin config`）。以下为默认值。

| 字段                   | 默认值                       | 含义                                                                      |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `baseUrl`              | `http://127.0.0.1:23119/api` | 本地 API 基础 URL。仅支持纯回环 HTTP。                                    |
| `provider`             | `local`                      | 要选择的 provider id。                                                    |
| `timeoutMs`            | `5000`                       | 每个请求的 provider 超时时间。                                            |
| `maxSearchResults`     | `20`                         | `zotero_search` `limit` 的上限。                                          |
| `maxNoteScanRecords`   | `200`                        | `zotero_search` 补扫笔记正文的笔记数量上限。                              |
| `maxEvidenceChars`     | `6000`                       | 检索证据的总字符预算。                                                    |
| `maxEvidencePassages`  | `4`                          | 证据片段数量的上限。                                                      |
| `maxDetailChars`       | `3000`                       | `zotero_get` 摘要预览的字符预算。                                         |
| `maxNoteBodyChars`     | `30000`                      | `zotero_get` 返回 note 条目自身正文的字符预算。                           |
| `maxNoteChars`         | `2000`                       | `zotero_get` 单条笔记预览的字符预算。                                     |
| `maxNoteRecords`       | `50`                         | `zotero_get` 返回笔记数量的上限。                                         |
| `maxAnnotationRecords` | `100`                        | `zotero_get` 返回批注数量的上限。                                         |
| `fulltextChunkWords`   | `200`                        | 进入证据排序的全文片段词数。                                              |
| `maxFulltextChars`     | `250000`                     | 进入证据排序的全文大小上限。                                              |
| `maxResponseBytes`     | `16777216`                   | 每个 API 响应的流式字节上限。                                             |
| `maxExportChars`       | `1000000`                    | 导出输出的硬上限。不会中途截断。                                          |
| `maxExportRefs`        | `1000`                       | 单次 `zotero_export` 的 refs 数量上限，保护请求行不超服务器 HTTP 头限制。 |
| `defaultStyle`         | `apa`                        | 引用/参考文献使用的 CSL 样式。                                            |
| `defaultLocale`        | `en-US`                      | 引用/参考文献使用的 CSL locale。                                          |

## 开发

### 命令

```sh
npm install                      # 使用本地 npm 缓存
npm test                         # 单元测试（mock Zotero server）
npm run test:coverage            # 对 src/ 的 100% 覆盖率门禁
npm run typecheck                # tsc --noEmit，app + test 项目
npm run build                    # 生成 lib/
npm run format                   # prettier --write 全仓格式化
npm run format:check             # 校验格式化（提交前执行）
```

集成测试面向真实 Zotero，默认跳过，需显式开启：

```sh
npm run test:integration
# 或：ZOTERO_INTEGRATION=1 npx vitest run tests/integration/zotero.integration.spec.ts
```

### 本地启动

#### 从 dsh 源码启动

在 deepseek-harness 源码 checkout 中构建一次（`pnpm install && pnpm run build`），然后通过 dev overlay 加载插件源码：

```sh
pnpm dsh web --patch ./dsh-zotero/dev.cordis.yml
```

`dev.cordis.yml` 将插件入口指向绝对的 `src/index.ts`。dsh 的源码启动经 tsx 加载该 TypeScript 入口，插件因此无需预构建；若 checkout 路径不同，需同步修改文件中的绝对路径。

#### 使用 npm 安装的 dsh

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

## 许可证

本插件以 [MIT](./LICENSE) 许可证发布。
