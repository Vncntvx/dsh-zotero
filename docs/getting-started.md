<p align="right"><a href="getting-started.en.md"><b>English</b></a></p>

# 快速入门

dsh-zotero 将本地 Zotero 文献库接入 DeepSeek Harness：Agent 在对话中检索与研读文献，你在文献面板中浏览全库，文献轨迹负责核对当前会话调用的文献与原文出处。

## 前置条件

- Zotero ≥ 7 桌面版已安装（读取需 Zotero ≥ 7，写入需 Zotero 10）。
- 本地 API 已启用：**设置 → 高级 → 勾选“允许此计算机上的其他应用程序与 Zotero 通信”**。
- Node.js ≥ 22.19 或 ≥ 24。
- 宿主 dsh ≥ 0.2.2-alpha.2；更早的历史对应关系见 GitHub Releases。

## 安装插件

### 桌面端安装（插件管理器）

在 DeepSeek Harness 桌面端的**插件**（或**设置 → 插件**）中点击**安装插件**，输入对应标识：

- npm 最新版（推荐）：`dsh-zotero`
- npm 指定版本：`dsh-zotero@<version>`（如 `dsh-zotero@0.14.1`）
- GitHub 预构建分支：`github:Vncntvx/dsh-zotero#release`
- GitHub 指定版本或 commit：`github:Vncntvx/dsh-zotero#v0.14.1` 或 `github:Vncntvx/dsh-zotero#<commit-hash>`

### 命令行安装

从 npm 安装（推荐）：

```sh
dsh plugin --profile <profile-name> add dsh-zotero
```

指定版本安装：

```sh
dsh plugin --profile <profile-name> add dsh-zotero@<version>
```

从 GitHub 预构建分支安装：

```sh
dsh plugin --profile <profile-name> add github:Vncntvx/dsh-zotero#release
```

从本地 tarball 安装：

```sh
cd dsh-zotero && npm pack
dsh plugin --profile <profile-name> add ./dsh-zotero-*.tgz
```

从 GitHub `main` 源码分支安装时，需要在本地执行 `prepare` 构建脚本；在 profile 对应的 `~/.dsh/profiles/<profile-name>/pnpm-workspace.yaml` 中允许该包的构建脚本：

```yaml
allowBuilds:
  dsh-zotero: true
```

若需固定特定版本或 commit，可在链接后附加 hash：

```sh
dsh plugin --profile <profile-name> add github:Vncntvx/dsh-zotero#<commit-hash>
```

安装后插件以 `zotero` 标识挂载。下次启动 dsh 时生效；若当前会话在插件加载前已存在，新建会话即可使用。

在 Harness 插件管理列表中启用插件时，系统会自动进行本地连接探活，检测 Zotero 本地 API 通信状态。

## 验证连接

在会话输入框执行状态命令：

```text
/zotero
```

或等价命令 `/zotero status`。

正常响应示例：

```text
Zotero local API: connected
Local API: 127.0.0.1:23119
Zotero version: 10.0.6-beta.4+4d4c2c141
API version: 3
Schema version: 44
Server ID: Cq1f76x70ESV
```

这些版本行取自 Zotero 应答的响应头，因此随你的 Zotero 版本变化。`API version` 是插件在每个请求上固定的本地 API 版本（3）；不支持该版本的 Zotero 构建会返回 501。

若提示无法连接，请检查：

1. Zotero 桌面版是否正常运行；
2. Zotero 设置的高级面板中是否已勾选允许通信选项。

## 第一个任务：检索并核对

在对话中提问：

> 帮我找 FlashAttention 相关论文

Agent 会调用 `zotero_search` 检索文献库并返回匹配条目；如果需要内容，它会继续调用 `zotero_get` 读取元数据与笔记，或调用 `zotero_retrieve` 按问题提取原文片段。

然后切到会话顶部的文献轨迹标签页，逐条核对：

- 首屏的检索条件（查询词、范围、模式、筛选）与命中数是否和你提问的意图一致；
- 检查器的「相关片段」里，Agent 引用的段落来自批注、笔记、摘要还是全文索引，批注是否带页码；
- 「导出」里是否产生过你在对话里要求的引用文本。

文献轨迹为只读视图，仅记录当前会话已完成的调用，不会发起新请求。

## 打开文献面板

文献面板挂在右侧边栏。确认三处都开启：

1. 插件列表「包含的组件」中 `dsh-zotero/library` 行已启用（默认启用）；
2. 设置页「基础设置 → 文献轨迹」中的 `webEnabled` 开启（默认开启）；
3. 设置页「文献面板」标签中的「在右侧侧边栏显示」（`rightSidebarEnabled`）开启（默认开启）。

打开面板后先用顶部搜索框检索，选中条目即可在检查器里查看详情，并从动作行复制引用或阅读 PDF。

下一步：[产品模型](product-model.md)深入介绍人机交互、界面视图与系统边界，[功能概览](features.md)逐项介绍能力。
