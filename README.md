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
  <a href="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.3"><img src="https://img.shields.io/badge/dsh-0.2.1--rc.3-blue" alt="dsh 版本" style="max-width:100%;"></a>
  <a href="https://awesome-dsh-plugin.com"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="Awesome DSH Plugin"></a>
</p>
</div>

<p align="center">
  <a href="README.en.md"><b>English</b></a> · <b>中文</b>
</p>

dsh-zotero 是面向 DeepSeek Harness 的本地 Zotero 插件。Agent 在对话里检索、阅读、引用并按需修改文献库；你在文献面板里浏览整个库并复制引用；文献轨迹展示 Agent 在当前会话中查到的文献、原文片段与导出内容，方便核对。

所有操作均通过 Zotero 本地 API（`127.0.0.1:23119`）与桌面端交互，读取无需配置 API Key。

## 主要功能

- **对话检索**
  - 检索阅读：按标题、作者、年份或全文搜索文献，读取元数据、个人笔记与本地 PDF 全文。
  - 原文定位：围绕具体问题从全文、批注和笔记中提取相关段落，PDF 批注附带原始页码。
  - 引用导出：按 CSL 样式生成行内引用或参考文献表，支持导出 BibTeX、RIS 与 CSL-JSON。
  - 写入扩展（可选）：开启后可创建笔记、修改标签与合集（每次均需会话审批）；启用学术检索组件后可跨 7 个外部索引检索文献并核验引用。
- **文献轨迹**
  - 检索记录：会话顶部首屏显示每次调用的查询词、范围、筛选条件与命中数。
  - 原文核对：按文献条目整理提取出的段落与批注，标明出处与原始页码，方便核对。
  - 导出汇总：跨条目汇总当前会话生成的所有引用与 BibTeX，自动去重，可直接复制或下载。
- **文献面板**
  - 全库浏览：在右侧边栏浏览 Zotero 合集树、标签、保存的搜索与回收站，支持多条件组合筛选。
  - 详情与阅读：查看条目元数据、关联笔记与附件列表，支持在右侧阅读栏直接打开本地 PDF。
  - 引用与联动：动作行直接复制 BibTeX、CSL 引用或条目信息；支持将选中文献一键填入对话输入框。

交互方式、界面分工与运行边界详见[产品模型](docs/product-model.md)。

## 安装

### 桌面端安装（插件管理器）

在 DeepSeek Harness 桌面端打开侧栏的**插件**，点击**添加插件**，输入对应标识：

- 最新版（推荐）：`dsh-zotero`
- 指定版本：`dsh-zotero@0.14.1`
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

> 提示：从 `main` 源码分支直接安装需要本地执行构建。pnpm 默认拦截依赖构建，使用 `#release` 分支可免除构建配置直接安装。

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

插件提供 8 个读取工具与 15 个写入工具。写入工具默认关闭，可在配置中开启 `writeEnabled`。

| 工具                | 用途                                                         |
| ------------------- | ------------------------------------------------------------ |
| `zotero_search`     | 按标题、作者、年份、标签或全文搜索文献，支持按分类与标签筛选 |
| `zotero_browse`     | 浏览文献库结构，包括分类合集树、标签列表和保存的搜索         |
| `zotero_get`        | 读取单篇文献的元数据详情、摘要、附件与笔记列表               |
| `zotero_children`   | 查看文献关联的子条目，包括独立笔记、PDF 附件和阅读批注       |
| `zotero_retrieve`   | 围绕问题从全文、笔记与批注中检索相关段落（批注保留页码）     |
| `zotero_changes`    | 检查文献库最近的新增、修改或删除记录                         |
| `zotero_attachment` | 获取文献关联的本地 PDF 文件路径                              |
| `zotero_export`     | 生成格式化引用、参考文献列表，或导出 BibTeX、RIS、CSL JSON   |

15 个写入工具（笔记、标签与合集归属、合集、条目、保存搜索、Trash 恢复、全库标签、批量操作）默认关闭，开启后仅写入个人库，且每次写入都需要审批。全部 23 个工具的完整契约见[工具参考](docs/tools.md)。

## 说明文档

### 使用

| 文档                                | 内容                                         |
| ----------------------------------- | -------------------------------------------- |
| [快速入门](docs/getting-started.md) | 安装、连接验证与第一个任务                   |
| [产品模型](docs/product-model.md)   | 两个入口、两大视图、组件分工与系统边界       |
| [功能概览](docs/features.md)        | 对话能力、文献轨迹、文献面板、写入与学术检索 |
| [故障排查](docs/troubleshooting.md) | 常见问题、诊断步骤与处理方法                 |

### 维护

| 文档                              | 内容                                               |
| --------------------------------- | -------------------------------------------------- |
| [系统架构](docs/architecture.md)  | 数据流、分层职责、组件边界与设计边界               |
| [工具参考](docs/tools.md)         | 23 个本地工具与 7 个学术工具的参数、返回值与错误码 |
| [配置参考](docs/configuration.md) | 各设置命名空间的字段、默认值与热更新机制           |
| [开发指南](docs/development.md)   | 构建、测试、调试与发布流程                         |

## 许可证

本项目遵循 [MIT 许可证](./LICENSE)。
