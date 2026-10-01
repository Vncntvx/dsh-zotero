<div align="center">

# dsh-zotero

<img
  src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=500&size=22&pause=2000&color=CC2936&center=true&vCenter=true&width=760&lines=%3E+Zotero+as+an+evidence+store+for+agents."
  alt="dsh-zotero"
/>
<p align="center">
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/v/dsh-zotero" alt="npm version" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/dm/dsh-zotero" alt="npm downloads" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/l/dsh-zotero" alt="license" style="max-width:100%;"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2"><img src="https://img.shields.io/badge/dsh-0.2.0--rc.2-blue" alt="dsh 版本" style="max-width:100%;"></a>
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome DSH Plugin"></a>
</p>
</div>

<p align="center">
  <a href="README.en.md"><b>English</b></a> · <b>中文</b>
</p>

dsh-zotero 是面向 Agent 研究工作流的 [Zotero](https://www.zotero.org) 插件。Agent 可以直接从你的文献库中搜索文献、查看元数据和笔记、提取与问题相关的证据段落、打开原文 PDF，并生成引用和参考文献表。

<p align="center">
  <img src="docs/images/header-collage.png" width="70%" alt="dsh-zotero 界面：来源面板、证据提取、导出视图">
</p>

## 工具

| 工具                | 用途                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `zotero_search`     | 按标题/作者/年份搜索（library/collection/savedSearch/publications 作用域），`everything` 模式连全文索引一起搜 |
| `zotero_browse`     | 发现库结构：库、合集树（层级导航）、保存的检索、标签 facet、条目类型及其字段                                  |
| `zotero_get`        | 读取单条文献的元数据，可选返回笔记、批注、附件清单；`fields:"all"` 保留全部元数据                             |
| `zotero_children`   | 探索单条文献的子对象图：直连笔记、附件，以及挂在 PDF 下的批注                                                 |
| `zotero_retrieve`   | 按查询词返回最相关的证据段落（批注/笔记/摘要/全文），支持多附件检索                                           |
| `zotero_changes`    | 基于本地事务版本的增量感知：哪些条目/合集/全文索引变了、什么被删除                                            |
| `zotero_attachment` | 将文献 ref 解析为已验证的磁盘路径或链接 URL                                                                   |
| `zotero_export`     | 生成引用、参考文献表、BibTeX/BibLaTeX/RIS/CSL JSON                                                            |

[完整工具参考 →](docs/tools.md)

## 安装

```sh
dsh plugin --profile <name> add dsh-zotero
```

从 GitHub 源码安装：

```sh
dsh plugin --profile <name> add github:Vncntvx/dsh-zotero
```

本地 tarball：

```sh
cd dsh-zotero && npm pack
dsh plugin --profile <name> add ./dsh-zotero-*.tgz
```

安装后重启新建会话，Agent 即可使用 Zotero 工具。

插件在 **设置 → Zotero** 中提供一个配置页（与 General、Models、Plugins 并列的左侧导航项），可调整 API 地址、并发限制、全文检索开关等参数，保存即生效。详见 [配置](docs/configuration.md)。

[安装详情 →](docs/getting-started.md)

## 前置条件

- Zotero ≥ 7 桌面版支持读取；写入需要 Zotero 10。启用本地 API：**设置 → 高级 → "允许其他应用程序与 Zotero 通信"**
- Node.js ≥ 22.19（或 ≥ 24）
- 宿主 dsh >= 0.2.0-rc.2（`engines.dsh` 与全部 `@deepseek-ai/dsh-*` peer 声明为 `>= 0.2.0-rc.2`，兼容该版本及后续更高版本）
- 本地 API 地址 `http://127.0.0.1:23119/api`；读取无需认证，Zotero 10 写入使用本地签发的 write key

## 使用示例

Agent 在对话中根据用户需求逐步调用工具，每次调用的结果作为下一步的上下文。

```text
用户：帮我找 Risk 相关的论文
Agent → zotero_search(query: "Risk", itemTypes: ["journalArticle"])
       5 篇匹配结果，用户选择前 3 篇

用户：第一篇的摘要说了什么？
Agent → zotero_get(ref: "zotero://user/0/item/ABCD1234")
       返回摘要全文（标准模型已含 abstract）

用户：这篇里关于方法论的讨论，帮我找出来
Agent → zotero_retrieve(ref: "zotero://user/0/item/ABCD1234", query: "methodology",
                        sources: ["fulltext", "note"])
       返回相关段落，带页码和来源

用户：把这三篇导出为 BibTeX
Agent → zotero_export(refs: ["zotero://user/0/item/ABCD1234",
                             "zotero://user/0/item/EFGH5678",
                             "zotero://user/0/item/IJKL9012"], format: "bibtex")
       生成 BibTeX 条目；界面可下载，模型读到同样的文本
```

更多示例见 [功能概览](docs/features.md)。

## 限制

- **只读保护**：默认只读。仅在显式开启 `writeEnabled` 后提供笔记创建、标签与合集管理工具；每次写入均需通过宿主审批卡和 Zotero 本地授权确认。
- **检索机制**：段落检索使用 BM25 关键词匹配，非向量语义搜索；全文段落依赖 Zotero 自身的本地索引，未索引的 PDF 无法提取文本。
- **附件处理**：`zotero_attachment` 仅解析并校验本地附件路径；阅读 PDF 具体内容取决于宿主是否具备相应文件解析能力。
- **导出形式**：导出工具返回纯文本（如 BibTeX、RIS、CSL JSON），支持在 Zotero 面板中直接复制或下载文件。

## 权限

- **网络访问**：仅向本地 `http://127.0.0.1:23119/api` 发起 HTTP 请求，强制绑定 loopback 环回地址，不跟随重定向，无任何外部网络访问。
- **文件与系统操作**：文件系统只读（仅通过异步 `stat` 校验附件路径存在性），不执行 shell 命令，不调用本地原生模块，不运行后台常驻进程。
- **数据持久化**：插件配置保存在 `$DSH_HOME/settings.yaml`；授权时若选择“始终允许”，写入密钥会保存在宿主凭据管理器中。
- **生命周期**：配置变更保存即生效（热更新）；安装或卸载插件需重启宿主生效。

## 文档

| 文档                                | 内容                                 |
| ----------------------------------- | ------------------------------------ |
| [快速上手](docs/getting-started.md) | 安装、前置条件、首次验证             |
| [功能概览](docs/features.md)        | 来源面板、对话集成、证据提取、导出   |
| [工具参考](docs/tools.md)           | 全部 11 个工具的参数、返回值、错误码 |
| [配置](docs/configuration.md)       | 24 个配置字段、默认值、热更新        |
| [架构](docs/architecture.md)        | 数据流、各层职责、设计边界           |
| [开发指南](docs/development.md)     | 构建、测试、本地开发                 |
| [使用情景](docs/scenarios.md)       | 真实对话验收用例与日常问法           |
| [问题排查](docs/troubleshooting.md) | 12 个常见问题的症状和处理            |

## 开发

```sh
npm install                  # 本仓库与 ../deepseek-harness 并列；仅嵌套在 harness 内时需加 --no-workspaces
npm test                      # 单元测试（vitest，mock Zotero 服务器）
npm run typecheck             # tsc --noEmit，覆盖 node、test、client 三个项目
npm run build                 # tsc 编译 node 部分到 lib/，esbuild 编译浏览器部分到 lib/client.js
npm run dev                   # tsc --watch，host half 热更新
npm run dev:client            # esbuild --watch，浏览器部分热更新
```

`lib/` 放 Node 侧代码，`lib/client.js` 放浏览器侧代码（设置页和 Zotero tab）。你用 `dev-lib.cordis.yml` overlay 跑完整插件流程，见[开发指南](docs/development.md)。本仓库与 `../deepseek-harness` 并列，属本地暂存布局。

## 许可证

[MIT](./LICENSE)：自由使用、修改和分发。
