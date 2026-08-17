<div align="center">

# dsh-zotero

<img
  src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=500&size=18&pause=2000&color=CC2936&center=true&vCenter=true&width=760&lines=%3E+Zotero+as+an+evidence+store+for+agents."
  alt="dsh-zotero"
/>
<p align="center">
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/v/dsh-zotero" alt="npm version" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/dm/dsh-zotero" alt="npm downloads" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/l/dsh-zotero" alt="license" style="max-width:100%;"></a>
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome DSH Plugin"></a>
</p>
</div>

<p align="center">
  <a href="README.en.md"><b>English</b></a> · <b>中文</b>
</p>

让 Agent 从你的 [Zotero](https://www.zotero.org) 文献库中发现来源、提取与问题相关的证据，并始终保留证据与原始文献之间的联系。

dsh-zotero 面向 Agent 的研究工作流设计：从文献检索、元数据与笔记查看，到证据检索、原文打开和引用生成，Agent 可以根据当前任务逐步获取所需信息，而不必一次读取整篇文献或整个文献库。

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

## 环境要求

- 已安装 Zotero 桌面版，并启用本地 API：**设置 → 高级 → “Allow other applications on this computer to communicate with Zotero”**。
- 本地 API 为无认证读取，地址为 `http://127.0.0.1:23119/api`。V1 没有任何修改文献库数据（条目、笔记、标签、分类等）的路径。
- Zotero ≥ 7，本地 API 版本为 3。如果 status 命令报告版本不匹配，请升级。
- Node.js ≥ 22.19（或 24+）；宿主 dsh 运行时为 rc.7 系。运行时依赖（peer）见 `package.json` 的 `peerDependencies`（`@deepseek-ai/cordis` ≥ 4、`dsh-tools`、`dsh-llm`、`dsh-settings`、`dsh-user-questions`、`dsh-typert-protocol`、`dsh-typert-registry`、`dsh-api-remotes`、`dsh-commands`、`dsh-timeout`），当前均声明为 `^0.1.0-rc.7`。

### 能力边界与副作用

- 网络：只访问强制回环的 `http://127.0.0.1:23119/api`（拒绝重定向、流式字节上限）；没有任何外部网络调用。
- 文件：仅读取附件磁盘路径的存在性（`existsSync`），不写入、不执行。
- 进程：无 Shell 调用、无 native 模块、无常驻后台任务或定时器——所有请求都由工具调用驱动，加载插件不会探测 Zotero。
- 外部副作用：唯一的持久化写入是设置卡片保存时对 `$DSH_HOME/settings.yaml` 中 `zotero:` 小节（用户层）的更新；无遥测、无埋点。

## 安装

### 按包名安装

```sh
dsh plugin --profile <name> add dsh-zotero
```

tarball 内含已构建的 `lib/`（node 半与浏览器半 `lib/client.js`），无需本地构建。浏览器半边是配置卡片：dsh web 会扫描到包内声明的 `dsh.client` 清单并自动挂载，无需额外配置。

### 本地 tarball

```sh
cd dsh-zotero
npm pack
dsh plugin --profile <name> add ./dsh-zotero-0.3.1.tgz
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

| 字段                   | 默认值                       | 含义                                                                                                     |
| ---------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `baseUrl`              | `http://127.0.0.1:23119/api` | 本地 API 基础 URL。仅支持纯回环 HTTP。                                                                   |
| `provider`             | `local`                      | 要选择的 provider id。                                                                                   |
| `timeoutMs`            | `5000`                       | 每个请求的 provider 超时时间。                                                                           |
| `maxSearchResults`     | `20`                         | `zotero_search` `limit` 的上限。                                                                         |
| `maxNoteScanRecords`   | `200`                        | `zotero_search` 补扫笔记正文的笔记数量上限。                                                             |
| `maxEvidenceChars`     | `6000`                       | 检索证据的总字符预算。                                                                                   |
| `maxEvidencePassages`  | `4`                          | 证据片段数量的上限。                                                                                     |
| `maxDetailChars`       | `3000`                       | `zotero_get` 摘要预览的字符预算。                                                                        |
| `maxNoteBodyChars`     | `30000`                      | `zotero_get` 返回 note 条目自身正文的字符预算。                                                          |
| `maxNoteChars`         | `2000`                       | `zotero_get` 单条笔记预览的字符预算。                                                                    |
| `maxNoteRecords`       | `50`                         | `zotero_get` 返回笔记数量的上限。                                                                        |
| `maxAnnotationRecords` | `100`                        | `zotero_get` 返回批注数量的上限。                                                                        |
| `fulltextChunkWords`   | `200`                        | 进入证据排序的全文片段词数。                                                                             |
| `maxFulltextChars`     | `250000`                     | 进入证据排序的全文大小上限。                                                                             |
| `maxResponseBytes`     | `16777216`                   | 每个 API 响应的流式字节上限。                                                                            |
| `maxExportChars`       | `1000000`                    | 导出输出的硬上限。不会中途截断。                                                                         |
| `maxExportRefs`        | `50`                         | 单次 `zotero_export` 的 refs 数量上限；citation 分批到该上限，其余格式单次最多 50。                      |
| `defaultStyle`         | `apa`                        | 引用/参考文献使用的 CSL 样式。                                                                           |
| `defaultLocale`        | `en-US`                      | 引用/参考文献使用的 CSL locale。                                                                         |
| `webEnabled`           | `true`                       | 是否在会话顶部显示 Zotero 来源标签页（来源、证据、导出）；开关即时生效，关闭后立即隐藏标签页，无需刷新。 |

### Web 配置

插件在 dsh web 的 **Settings → Plugins → Plugin configuration** 页面注册一张 "Zotero" 卡片，列出上表全部字段。卡片绑定 `zotero` 设置命名空间：写入落在 `$DSH_HOME/settings.yaml` 的 `zotero:` 小节（叠加在 patch 条目 `config` 之上，用户层优先），**保存即时生效**——传输层与 provider 按新值重建，下一次工具调用或 `/zotero status` 无需重启 dsh 即可使用。

- 非法值（非回环 `baseUrl`、非正数上限）在写入前被拒绝；卡片提示保存失败并保留草稿，插件继续运行在最后一个合法值上。
- 每个字段显示有效值；被设置文档覆盖的字段带有 "Overridden" 徽标，提供一键重置（清除用户层，回到 patch 条目值）。
- 直接编辑设置文档（如手工修改 `settings.yaml`）同样热生效。
- 没有设置服务的组合（纯 headless）不会注册命名空间，插件行为与未配置时完全一致。

### Web 视图：来源面板

dsh web 的会话视图是标签页环（Chat、Trajectory、…）。插件注册一个专属 **来源** 标签页（`conversation.view`，id `zotero`，位于 Trajectory 与 dsh-context 之后），不触碰 dsh 自带的聊天与轨迹视图。它是**本会话的 Zotero 来源快照**——汇总 Agent 在当前会话中找到、查看和取证的文献，用于核查证据、回到原文和导出引用；它不是文献库浏览器，也不会自动扫描整个库。整个页面完全由会话快照重放驱动，Zotero 离线时仍可浏览历史会话的来源。

- 标签页顶部是**连接条**：打开标签页时探测一次、每次手动刷新再探测一次（请求驱动，无轮询定时器）。正常时只显示"已连接到 Zotero"；API/Schema 版本与 Server ID（Zotero 10+）收在可折叠的诊断详情里；Zotero 不可用时显示诊断信息与恢复提示。
- **来源**（默认）：本会话全部成功检索命中与直接引用条目的稳定并集——查看一篇不会让其他候选消失，多次检索互不覆盖；支持筛选（全部/有证据/已导出/有附件/操作失败），有界投影未逐条列出的结果会明确计数提示。
- **证据**：按文献聚合本会话取得的证据段落（批注/笔记/摘要/全文），显示 Zotero 自带的页码、索引覆盖、全局预算截断与各来源可用性；多次检索取得的同一段落会去重并保留每次来源。页面只表述"本会话取得的证据"，不声称这些内容被最终回答采用。
- **导出**：只展示成功产生的导出产物（格式、样式、locale、文献范围，可展开复制全文；BibTeX 附带 `\cite{}` 便利）；进行中/失败/停止的导出单独列出，不计为成果。静态导出不会插入或更新 Word、Google Docs、LibreOffice 文档。
- **回到原文**：来源与证据卡提供"在 Zotero 中打开"、"打开 PDF"、"打开批注"。这些是 `zotero://` 深链（由 Zotero 桌面在系统层注册，经 Zotero 源码核实，但官方没有文档页，浏览器跳转行为可能因浏览器/系统而异）；ref 与当前 Server ID 明确不匹配时阻止打开并提示，无法验证时允许尝试并标注；复制 ref/路径/URL 始终作为备用动作。
- 行内动作（"问这篇"、"导出引用"）与空状态引导只**预填**输入框，不自动提交；调用级调试交给 dsh 自带的 Trajectory 视图。
- 设置页的 **来源面板 → Zotero 来源标签页** 开关（`webEnabled`，默认开启）控制标签页的注册；开关即时生效——打开立即显示、关闭立即隐藏，无需刷新页面。关闭后，Zotero 调用在轨迹中显示为 dsh 内置的通用卡片。

### 限制

- 只读文献库：没有任何路径会修改条目、笔记、标签或合集。
- 隐私模型：所有请求都发往本机的 Zotero 本地 API；插件在加载时不做任何探测，唯一的连通性检查发生在用户打开来源标签页或点击刷新时。
- 全文证据依赖 Zotero 的索引：`everything` 搜索与 `retrieve` 的全文段落都需要已建立索引。
- 笔记正文搜索是客户端扫描：仅限 library/collection 作用域与第一页结果（offset 0），受 `maxNoteScanRecords` 限制；命中并入第一页直到 `limit`，计数在返回的 `noteMatches` 字段中，不计入分页 `total`。
- 附件深度取决于宿主组合：`zotero_attachment` 返回文件位置；继续阅读该 PDF 需要宿主具备对应的文件/PDF 能力。
- 证据排序是基于词项的相关性，而非向量或语义检索。
- 导出是静态文本产物：不会插入或更新 Word、Google Docs、LibreOffice 等文档，也不会跟踪文档中的引用。

## 开发

### 命令

```sh
npm install                      # 使用本地 npm 缓存（见下方 workspace 说明）
npm test                         # 单元测试（mock Zotero server + 浏览器卡片测试）
npm run test:coverage            # 对 src/ 的 100% 覆盖率门禁
npm run typecheck                # tsc --noEmit，node / test / client 三个项目
npm run build                    # tsc 生成 node 半 lib/ + esbuild 生成浏览器半 lib/client.js
npm run build:client             # 只重建浏览器半（含 loader 交接格式自检）
npm run dev:client               # 浏览器半 watch 模式（配合热替换 overlay）
npm run format                   # prettier --write 全仓格式化
npm run format:check             # 校验格式化（提交前执行）
```

> 本仓库位于 deepseek-harness workspace 树内：父目录 `package.json` 声明了 `workspaces`，npm 会向上找到它并尝试安装整个 workspace。请使用 `npm install --no-workspaces`（或在本仓库放置含 `workspaces=false` 的 `.npmrc`）。

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

本插件分两部分构建：**Node 端**（`lib/`，由 `tsc` 生成，包含服务、工具、provider 等逻辑）与**浏览器端**（`lib/client.js`，由 `esbuild` 生成，包含 dsh web 的配置卡片与 Zotero 标签视图）。下面三种开发流程覆盖了不同场景。

**① 常驻实例验证（tarball 安装）**

打包为 tarball 并安装到 profile，插件以 tarball 内的构建产物运行；代码更新后需重新打包安装。安装后通过生产栈 smoke 脚本验证：

```sh
npm pack
dsh plugin --profile <name> add ./dsh-zotero-0.3.1.tgz
cd ~/.dsh/profiles/<name>
node --input-type=module < /path/to/dsh-zotero/scripts/smoke.mjs
```

smoke 脚本必须在 profile 目录内运行，这样裸导入才能从 profile 的扁平 `node_modules` 中解析。脚本依次验证 `status`、`search`、`get`、`retrieve`、`export`、策略提示词分区，以及五个工具的注册情况；输出 `SMOKE PASS` 表示打包后的插件通过了安装路径验证。

**② Node 端热替换开发**

`dev-lib.cordis.yml` 覆盖层会禁用 profile 中的 tarball 行（id `zotero`），转而插入 `zotero-dev` 行指向本仓库的 `lib/index.js`，并重新启用 HMR。生产 web profile 默认关闭 loader HMR，且 HMR 的监视根位于 profile 目录，因此覆盖层显式设置了 `base`。构建产物变化后，HMR 会在同一进程内销毁旧实例并重新构造插件，无需重启 dsh：

```sh
cd ./dsh-zotero                 # 从 deepseek-harness checkout 进入本仓库
npm run dev &                    # tsc --watch：修改 src 后自动重建 lib
dsh web --patch ./dev-lib.cordis.yml --port 3307
```

热替换仅对通过 `--patch` 启动的实例生效；常驻实例仍运行 tarball 版本，互不影响。

**③ 浏览器端开发**

dsh web 只会扫描 Loader 行中 `name` 为裸包名（npm 能解析到 `package.json`）的条目来加载浏览器端 bundle。`dev-lib.cordis.yml` 使用的是绝对路径行，不会触发浏览器端加载，因此卡片不会出现在 ② 的 dev 实例中。开发卡片时需要先把本仓库装进 profile（`npm install <本仓库路径>` 作为 `file:` 依赖，或 `npm pack` 后安装 tarball），再配合 `npm run dev:client`（esbuild watch）与热替换 overlay 一起使用：浏览器 bundle 变化会触发 HMR 重新拉取 `/plugins/dsh-zotero/client.js`。

## 许可证

本插件以 [MIT](./LICENSE) 许可证发布。
