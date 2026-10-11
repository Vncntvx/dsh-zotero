<div align="center">

# dsh-zotero

<img
  src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=500&size=20&pause=2000&color=CC2936&center=true&vCenter=true&width=760&lines=%3E+Search%2C+read%2C+and+cite+papers+from+local+Zotero."
  alt="dsh-zotero"
/>
<p align="center">
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/v/dsh-zotero" alt="npm version" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/dm/dsh-zotero" alt="npm downloads" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/l/dsh-zotero" alt="license" style="max-width:100%;"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.2"><img src="https://img.shields.io/badge/dsh-0.2.1--alpha.2-blue" alt="dsh 版本" style="max-width:100%;"></a>
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome DSH Plugin"></a>
</p>
</div>

<p align="center">
  <a href="README.en.md"><b>English</b></a> · <b>中文</b>
</p>

dsh-zotero 是面向 DeepSeek Harness 的本地 Zotero 插件。模型可以直接检索文献库、读取 PDF 全文与笔记、定位原文片段并生成学术引用。

所有操作均通过 Zotero 本地 API（`127.0.0.1:23119`）与桌面端交互，读取无需配置 API Key。

## 主要功能

- **文献检索与发现**：按标题、作者、年份、标签或全文搜索文献，支持限定合集分类或查找最近导入的条目。
- **PDF 全文与笔记阅读**：模型可直接读取文献元数据、摘要、用户笔记，并解析本地 PDF 附件全文。
- **段落级原文检索**：围绕具体研究问题检索论文全文、批注与笔记，定位相关段落；PDF 批注附带原始页码与直达跳转，便于核验。
- **引用生成与导出**：一键生成标准学术引用，支持以 BibTeX、RIS、CSL JSON 或文本参考文献格式复制与下载。
- **会话文献标签页（Sources）**：对话中引用的文献会自动同步到会话顶部的「Zotero」专属标签页，可集中查看条目详情、回溯原文片段与打开本地 PDF。
- **双向笔记与标签管理**：支持让模型创建读书笔记、添加标签和整理分类；所有写入操作均提供计划审查卡片并需手动确认。

## 安装

从 npm 安装（推荐）：

```sh
dsh plugin --profile <name> add dsh-zotero
```

从 GitHub 预构建分支安装：

```sh
dsh plugin --profile <name> add github:Vncntvx/dsh-zotero#release
```

安装完成后新建会话即可使用。插件在 **设置 → Zotero** 中提供配置表单，支持调整 API 地址、并发限制与检索参数。

> 提示：从 main 源码分支直接安装需要本地执行构建。pnpm 默认拦截依赖构建，使用 `#release` 分支可免除构建配置直接安装。

## 前置条件

1. 安装并运行 Zotero 7 及以上桌面版（写入功能需 Zotero 10）。
2. 在 Zotero 中开启本地 API：**设置 → 高级 → 勾选“允许此计算机上的其他应用程序与 Zotero 通信”**。

## 使用示例

Agent 在对话中按需调用工具，检索结果会作为上下文并同步沉淀到 Sources 面板：

```text
用户：帮我找 Risk 相关的论文
Agent → zotero_search(query: "Risk", itemTypes: ["journalArticle"])
       返回 5 篇匹配结果，条目同步到会话顶部的 Zotero 标签页

用户：第一篇的摘要说了什么？
Agent → zotero_get(ref: "zotero://user/0/item/ABCD1234")
       返回文献元数据与摘要全文

用户：这篇里关于方法论的讨论，帮我找出来
Agent → zotero_retrieve(ref: "zotero://user/0/item/ABCD1234", query: "methodology",
                        sources: ["annotation", "fulltext"])
       返回排序段落与来源标注（批注附带原始页码）

用户：把这三篇导出为 BibTeX
Agent → zotero_export(refs: ["zotero://user/0/item/ABCD1234",
                             "zotero://user/0/item/EFGH5678",
                             "zotero://user/0/item/IJKL9012"], format: "bibtex")
       生成 BibTeX 条目，支持在界面中复制或下载
```

## 工具一览

插件提供 8 个读取工具与 8 个写入工具。写入工具默认关闭，可在配置中开启 `writeEnabled`。

| 工具                | 用途                                                       |
| ------------------- | ---------------------------------------------------------- |
| `zotero_search`     | 按标题、作者、年份或全文搜索文献，支持按分类与标签筛选     |
| `zotero_browse`     | 浏览文献库结构，包括分类合集树、标签列表和保存的搜索       |
| `zotero_get`        | 读取单篇文献的元数据详情、摘要、附件与笔记列表             |
| `zotero_children`   | 查看文献关联的子条目，包括独立笔记、PDF 附件和阅读批注     |
| `zotero_retrieve`   | 围绕问题从全文、笔记与批注中检索相关段落（批注保留页码）   |
| `zotero_changes`    | 检查文献库最近的新增、修改或删除记录                       |
| `zotero_attachment` | 获取文献关联的本地 PDF 文件路径                            |
| `zotero_export`     | 生成格式化引用、参考文献列表，或导出 BibTeX、RIS、CSL JSON |

全部 16 个工具的参数定义见 [工具参考](docs/tools.md)。

## 安全与隐私

- 本地通信：插件仅向本地 Zotero 接口（`http://127.0.0.1:23119/api`）发起请求，不调用 Zotero 官方云端服务。
- 文件访问：仅读取本地附件文件状态，不执行系统 shell 命令，不启动后台常驻守护进程。
- 写入确认：写入工具默认禁用。开启后，每次修改文献库都会在界面展示审批卡片，经用户确认后才执行。

## 说明文档

| 文档                                | 内容                                   |
| ----------------------------------- | -------------------------------------- |
| [快速入门](docs/getting-started.md) | 安装步骤、前置条件与连接验证           |
| [功能概览](docs/features.md)        | Sources 来源面板、对话集成与导出工作流 |
| [工具参考](docs/tools.md)           | 全部 16 个工具的参数、返回值与错误码   |
| [配置参考](docs/configuration.md)   | 35 个配置项说明与默认值                |
| [系统架构](docs/architecture.md)    | 数据流、分层职责与设计边界             |
| [开发指南](docs/development.md)     | 构建、测试、调试与发布流程             |
| [使用场景](docs/scenarios.md)       | 典型对话用例与使用示例                 |
| [故障排查](docs/troubleshooting.md) | 常见连接问题诊断与处理方法             |

## 许可证

[MIT](./LICENSE)
