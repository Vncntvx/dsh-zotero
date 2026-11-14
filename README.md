<div align="center">

# dsh-zotero

<img
  src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=500&size=18&pause=2000&color=CC2936&center=true&vCenter=true&width=760&lines=%3E+Search%2C+read%2C+and+trace+citations+from+local+Zotero.%3B%3E+Audit+every+source+and+passage+in+the+Literature+Trail.%3B%3E+Browse+collections+and+cite+instantly+in+the+Literature+Panel."
  alt="dsh-zotero"
/>
<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&amp;logo=deepseek&amp;logoColor=white" alt="powered by dsh" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/v/dsh-zotero" alt="npm version" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/dm/dsh-zotero" alt="npm downloads" style="max-width:100%;"></a>
  <a href="https://www.npmjs.com/package/dsh-zotero"><img src="https://img.shields.io/npm/l/dsh-zotero" alt="license" style="max-width:100%;"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.2"><img src="https://img.shields.io/badge/dsh-0.2.2--rc.2-blue" alt="dsh 版本" style="max-width:100%;"></a>
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome DSH Plugin"></a>
  <a href="https://github.com/hashgraph-online/hol-guard"><img src="https://img.shields.io/badge/HOL%20Guard-passing-00a67e" alt="HOL Guard Scanner"></a>
</p>
</div>

<p align="center">
  <a href="README.en.md"><b>English</b></a> · <b>中文</b>
</p>

dsh-zotero 是面向 DeepSeek Harness 的本地 Zotero 插件。Agent 在对话里检索、阅读、引用并按需修改文献库；你在文献面板里浏览整个库并复制引用；文献轨迹展示 Agent 在当前会话中查到的文献、原文片段与导出内容，方便核对。

所有操作均通过 Zotero 本地 API（`127.0.0.1:23119`）与桌面端交互，读取无需配置 API Key。

## 主要功能

Agent 在对话里用工具检索、阅读与引用文献；文献轨迹核对它在这个会话做过的事；文献面板由你独立翻阅整个库。

- **对话**
  - 检索与浏览：按标题、作者、年份、标签或全文检索，范围可限定全库、我的出版物、某个合集或某个保存的搜索；合集树、标签与保存的搜索可直接浏览；已知 ref 支持批量读取，每条结果单独报告。
  - 原文定位：围绕具体问题从全文、笔记与批注中取回片段。每条片段标明来源，批注保留 Zotero 页码，结果同时报告全文覆盖度与被跳过的来源。
  - 排序与命中：默认 BM25 词面排序；可选本地语义排序，六档本地嵌入模型在 CPU 上运行，结果与 BM25 经 RRF 融合，每条片段标注词法、语义或混合命中。一次最多给四种问法分别打分，每条片段取最高分；空结果会说明是没有词面重合，还是没有可用来源。
  - 引用与导出：按 CSL 样式生成行内引用或合并参考文献表，导出 BibTeX、BibLaTeX、RIS 与 CSL-JSON，样式与语言沿用配置默认值。
  - 对账与变更：用 DOI、BibTeX 键或文献字段与本地库对账，返回 ref、citekey、置信度与可审阅的字段差异；按库版本号报告新增、修改与删除，回收站单列。
  - 研究 SOP：八个按需加载的分阶段流程，常驻提示词里只有名称与短描述，每个流程都带阶段预算与停止条件。核心组件带四个（单篇速读、证据比较、写作对账、文库治理），启用学术检索组件后另有四个（主题版图、引文脉络、真伪审查、文献入库）。
- **文献轨迹（会话顶部）**
  - 检索条件：按调用列出查询词、范围（库、我的出版物、合集、保存搜索）、模式（元数据或全文）、筛选条件与命中数，总数与笔记命中分开计。
  - 原文核对：按条目聚合读过的片段与批注，带来源、页码与覆盖度；被拒绝或取消的调用同样记录。
  - 导出汇总：跨条目汇总本轮生成的全部引用与 BibTeX，按格式分段、自动去重，可复制或下载；失败的导出单独列出。
  - 长会话：历史窗口截断不影响早期条目；长列表分页，切换时直接读已有结果。
- **文献面板（右侧边栏）**
  - 浏览与筛选：多库切换、按需展开的合集树、保存的搜索、我的出版物与回收站；条目列表支持元数据与全文两种检索模式、多种排序，并能按类型、标签、年份、有无附件筛选。
  - 详情与阅读：条目元数据、合集与标签、笔记/附件/批注三个子集合分别分页；本地 PDF 在右侧阅读栏打开，开启 `allowUrlPdfRead` 后也能读取库内已有的 URL 附件。
  - 引用与联动：动作行复制引用、参考文献表或 BibTeX；选中文献可填入对话草稿；输入框的 Zotero 按钮与书目交付物都能直接打开面板。
  - 状态恢复：按 Zotero 实例记住选中条目、当前分段与展开的合集分支，滚动位置与子条目分页一并保留。
  - 解析结果：启用文档解析组件后，条目动作行可打开以论文标题命名的解析标签页（全文、插图、选段解释）；工具栏的「解析文档管理」页列出全部产物，支持筛选、逐行打开或重新解析，以及整页批量删除。
- **可选能力（默认关闭）**
  - 写入文献库：开启 `writeEnabled` 后注册 15 个只写个人库的工具，覆盖笔记、标签与合集归属、合集、条目、保存搜索、Trash 恢复、全库标签与批量操作；每次写入都经过能力检查、会话审批与计划审查卡，提交结果未核验时显示「已提交未确认」。
  - 学术检索（`dsh-zotero/scholarly`）：7 个工具覆盖 arXiv、OpenAlex、Crossref、Semantic Scholar、PubMed、Europe PMC 与 DBLP，结果融合去重并标出「已在本地库」。可按 DOI、arXiv ID、PMID、PMCID 读开放获取全文、追踪引文网络、从 DOI 注册中心取权威引用、核验参考文献与撤稿状态（分为已核实、需人工确认、注册表说没有、无法核验四种结论），并在你明确要求时保存进个人库。
  - 文档解析与语义排序（`dsh-zotero/enrichment`）：启用即表示接受向 MinerU 外发你主动提交的文档；解析需要你针对一个具体的 Zotero PDF 附件或公开 PDF URL 显式提交，成功后普通检索与学术全文精读自动复用 Markdown 产物，插图一并保留；本地语义排序的六档模型可在这里下载、校验与删除。

交互方式、界面分工与运行边界详见[产品模型](docs/product-model.md)。

## 安装

### 桌面端安装（插件管理器）

在 DeepSeek Harness 桌面端打开侧栏的**插件**，点击**添加插件**，输入对应标识：

- 最新版（推荐）：`dsh-zotero`
- 指定版本：`dsh-zotero@1.0.1`
- GitHub 预构建分支：`github:Vncntvx/dsh-zotero#release`

### 命令行安装

```sh
# npm 安装最新版（推荐）
dsh plugin --profile <name> add dsh-zotero

# 安装指定版本
dsh plugin --profile <name> add dsh-zotero@<version>

# 从 GitHub 预构建分支安装
dsh plugin --profile <name> add github:Vncntvx/dsh-zotero#release
```

安装完成后新建会话即可使用。在插件管理器中打开 **dsh-zotero** 详情页，其配置区提供完整配置表单。

> 提示：从 `main` 源码分支直接安装需要本地执行 `prepare` 构建，并在 profile 的 `pnpm-workspace.yaml` 中允许 `dsh-zotero` 的构建脚本；改用 `#release` 分支或 npm 包可免除这一步。另外，npm、`#release` 与本地 tarball 安装在 pnpm 11 上需要一次性批准传递依赖 `protobufjs` 的安装脚本，详见[快速入门](docs/getting-started.md)。

## 前置条件

1. 安装并运行 Zotero 7 及以上桌面版（写入功能需 Zotero 10）。
2. 在 Zotero 中开启本地 API：**设置 → 高级 → 勾选“允许此计算机上的其他应用程序与 Zotero 通信”**。

## 使用示例

### 1. 在对话中研读与定位出处

在日常会话中直接围绕研究问题提问，Agent 会自动调取本地文献库检索、精读全文并抓取带页码的原文段落：

- **文献检索与问答**：向 Agent 询问某个研究方向，Agent 检索本地文献库，结合文献摘要与元数据生成回答。
  ```text
  Agent → zotero_search(query: "Risk", itemTypes: ["journalArticle"])
  ```
- **定位原文段落**：深入追问论文细节，Agent 从本地 PDF 全文与批注中提取相关段落，并附带原始页码标注。
  ```text
  Agent → zotero_retrieve(ref: "zotero://user/0/item/ABCD1234", query: "methodology", sources: ["annotation", "fulltext"])
  ```
- **生成标准引用**：要求格式化输出时，Agent 直接生成 BibTeX 条目或指定样式的 CSL 引用。
  ```text
  Agent → zotero_export(refs: ["zotero://user/0/item/ABCD1234"], format: "bibtex")
  ```

### 2. 在文献轨迹中核对出处与导出

对话结束后，点击会话顶部的**文献轨迹**标签页，集中查看与核验本次对话调用的所有文献：

- **查看检索条件**：首屏展示 Agent 在当前会话中每次调用的查询词、检索范围（全库/合集/保存搜索）、筛选条件与命中篇数。
- **逐条核对出处**：在条目检查器中核对引用的原文段落，比对原始页码与批注，确认论据真实无误。
- **去重汇总导出**：在「导出」视图中集中查看本轮会话生成的全部引用与 BibTeX，跨条目自动去重，支持一键批量复制或下载。

### 3. 在文献面板中自主查阅与即时引用

写论文或独立整理文献时，直接在右侧边栏使用**「文献面板」**，无需通过 Agent 对话：

- **自主翻阅与筛选**：浏览 Zotero 分类合集树、标签体系、保存的搜索与回收站，支持按年份与条目类型组合筛选。
- **检视详情与阅读 PDF**：点击条目查看详细元数据与关联笔记，在右侧阅读栏直接打开本地 PDF。
- **一键引用与对话联动**：在动作行点击「复制 BibTeX」或「复制引用」直接粘贴到论文源文件；点击「提问」或「加入对话」可将选中文献一键送入会话草稿，展开定向讨论。

## 工具一览

插件注册 23 个本地工具（8 个读工具 + 15 个写工具）以及 7 个学术检索工具。本地写入工具默认关闭，可在配置中开启 `writeEnabled`；学术检索工具随 `dsh-zotero/scholarly` 组件启用。

### 本地读取工具（8 个）

| 工具                      | 用途                                                         |
| ------------------------- | ------------------------------------------------------------ |
| `zotero_search`           | 按标题、作者、年份、标签或全文搜索文献，支持按分类与标签筛选 |
| `zotero_browse`           | 浏览文献库结构，包括分类合集树、标签列表和保存的搜索         |
| `zotero_get`              | 读取单篇文献的元数据详情、摘要、附件与笔记列表               |
| `zotero_get_batch`        | 按顺序批量读取已知文献 ref，逐条报告结果                     |
| `zotero_match_references` | 将 DOI/BibTeX/文献字段与本地条目对账                         |
| `zotero_retrieve`         | 围绕问题从全文、笔记与批注中检索相关段落（批注保留页码）     |
| `zotero_changes`          | 检查文献库最近的新增、修改或删除记录                         |
| `zotero_export`           | 生成格式化引用、参考文献列表，或导出 BibTeX、RIS、CSL JSON   |

### 学术检索工具（7 个，可选组件 `dsh-zotero/scholarly`）

| 工具                       | 用途                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| `scholarly_search`         | 跨 arXiv、OpenAlex、Crossref、S2、PubMed、Europe PMC、DBLP 检索并融合去重 |
| `scholarly_get`            | 获取外部文献元数据详情与开放获取全文直链                                  |
| `scholarly_citations`      | 追踪论文的引用与被引网络                                                  |
| `scholarly_read`           | 开放获取 PDF 全文精读与段落证据提取（支持 outline/section/query）         |
| `scholarly_cite`           | 从 DOI 注册中心获取权威 BibTeX、RIS 与格式化引用                          |
| `scholarly_verify`         | 对照 Crossref 官方数据库核验参考文献真实性与撤稿状态                      |
| `scholarly_save_to_zotero` | 将外部检索到的文献保存至本地 Zotero 个人库（写操作，需审批）              |

15 个写入工具（笔记、标签与合集归属、合集、条目、保存搜索、Trash 恢复、全库标签、批量操作）默认关闭，开启后仅写入个人库，且每次写入都需要审批。全部 23 个本地工具与 7 个学术工具的完整契约见[工具参考](docs/tools.md)。

## 说明文档

### 使用

| 文档                                | 内容                                                   |
| ----------------------------------- | ------------------------------------------------------ |
| [快速入门](docs/getting-started.md) | 安装、连接验证与第一个任务                             |
| [产品模型](docs/product-model.md)   | 两个入口、两大视图、组件分工与系统边界                 |
| [功能概览](docs/features.md)        | 对话能力、文献轨迹、文献面板、写入、学术检索与文档解析 |
| [研究 SOP 技能](docs/skills.md)     | 八个按需研究流程、批处理预算与证据边界                 |
| [故障排查](docs/troubleshooting.md) | 常见问题、诊断步骤与处理方法                           |

### 维护

| 文档                              | 内容                                               |
| --------------------------------- | -------------------------------------------------- |
| [系统架构](docs/architecture.md)  | 数据流、分层职责、组件边界与设计边界               |
| [工具参考](docs/tools.md)         | 23 个本地工具与 7 个学术工具的参数、返回值与错误码 |
| [配置参考](docs/configuration.md) | 各设置命名空间的字段、默认值与热更新机制           |
| [开发指南](docs/development.md)   | 构建、测试、调试与发布流程                         |

## 许可证

本项目遵循 [MIT 许可证](./LICENSE)。
