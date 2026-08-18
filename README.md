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

| 工具                | 用途                                                    |
| ------------------- | ------------------------------------------------------- |
| `zotero_search`     | 按标题/作者/年份搜索，`everything` 模式连全文索引一起搜 |
| `zotero_get`        | 读取单条文献的元数据，可选返回笔记、批注、附件清单      |
| `zotero_retrieve`   | 按查询词返回最相关的证据段落（批注/笔记/摘要/全文）     |
| `zotero_attachment` | 将文献 ref 解析为已验证的磁盘路径或链接 URL             |
| `zotero_export`     | 生成引用、参考文献表、BibTeX/BibLaTeX/RIS/CSL JSON      |

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

插件在 **Settings → Plugins** 中提供配置卡片，可调整 API 地址、并发限制、全文检索开关等参数，保存即生效。详见 [配置](docs/configuration.md)。

[安装详情 →](docs/getting-started.md)

## 前置条件

- Zotero ≥ 7 桌面版，启用本地 API：**设置 → 高级 → "允许其他应用程序与 Zotero 通信"**
- Node.js ≥ 22.19（或 ≥ 24）
- 宿主 dsh 0.1.0-rc.7 系列（`@deepseek-ai/dsh-*` peer 依赖均为 `^0.1.0-rc.7`）
- 本地 API 地址 `http://127.0.0.1:23119/api`，无认证，只读

## 使用示例

Agent 在对话中根据用户需求逐步调用工具，每次调用的结果作为下一步的上下文。

```text
用户：帮我找 Risk 相关的论文
Agent → zotero_search(query: "Risk", itemType: "journalArticle")
       5 篇匹配结果，用户选择前 3 篇

用户：第一篇的摘要说了什么？
Agent → zotero_get(ref: 1, fields: ["abstractNote"])
       返回摘要全文

用户：这篇里关于方法论的讨论，帮我找出来
Agent → zotero_retrieve(query: "methodology", sources: ["fulltext", "notes"])
       返回相关段落，带页码和来源

用户：把这三篇导出为 BibTeX
Agent → zotero_export(refs: [1,2,3], format: "bibtex")
       生成 BibTeX 条目，可复制或下载
```

更多示例见 [功能概览](docs/features.md)。

## 限制

- **只读文献库**：所有操作均为读取，不修改条目、笔记、标签或分类
- **只访问本机**：网络请求仅发往 `127.0.0.1:23119`
- **证据排序是词项相关性**：基于 BM25，按查询词与 passage 的词频匹配度排序
- **导出是静态文本**：以文本形式返回，需要手动复制到目标位置
- **全文证据依赖 Zotero 索引**：未索引的 PDF 无法提供全文段落
- **附件深度取决于宿主**：`zotero_attachment` 返回文件位置，继续阅读 PDF 需要宿主具备对应能力

## 权限与外部副作用

- **网络**：只向 `http://127.0.0.1:23119/api` 发起 HTTP 请求（不跟随重定向），`resolveConfig` 强制 loopback 地址
- **文件**：只读——`zotero_attachment` 用 `existsSync` 校验 Zotero 返回的附件路径，不写文件系统
- **持久化**：唯一写入来自 Settings → Plugins 中的配置卡片，保存到 `$DSH_HOME/settings.yaml` 的 `zotero:` 用户层
- **无 Shell / native / 后台任务**：插件不执行 shell 命令、不加载 native 模块、不启动常驻进程
- **重启**：安装或卸载插件后需要重启 dsh 并新建会话；配置修改保存即热更新，无需重启

## 文档

| 文档                                | 内容                               |
| ----------------------------------- | ---------------------------------- |
| [快速上手](docs/getting-started.md) | 安装、前置条件、首次验证           |
| [功能概览](docs/features.md)        | 来源面板、对话集成、证据提取、导出 |
| [工具参考](docs/tools.md)           | 5 个工具的参数、返回值、错误码     |
| [配置](docs/configuration.md)       | 20 个配置字段、默认值、热更新      |
| [架构](docs/architecture.md)        | 数据流、各层职责、设计边界         |
| [开发指南](docs/development.md)     | 构建、测试、本地开发               |
| [问题排查](docs/troubleshooting.md) | 11 个常见问题的症状和处理          |

## 开发

```sh
npm install --no-workspaces   # 本仓库在 deepseek-harness 工作区内，需要加 --no-workspaces
npm test                      # 单元测试（vitest，mock Zotero 服务器）
npm run typecheck             # tsc --noEmit，覆盖 node、test、client 三个项目
npm run build                 # tsc 编译 node 部分到 lib/，esbuild 编译浏览器部分到 lib/client.js
npm run dev                   # tsc --watch，host half 热更新
npm run dev:client            # esbuild --watch，浏览器部分热更新
```

构建产物分两部分：`lib/` 是 Node 侧代码，`lib/client.js` 是浏览器侧（settings 卡片 + Zotero tab）。本地开发推荐用 `dev-lib.cordis.yml` overlay 实现完整插件流程，详见 [开发指南](docs/development.md)。

## 许可证

[MIT](./LICENSE) — 自由使用、修改和分发。
