<p align="right"><a href="architecture.en.md"><b>English</b></a></p>

# 架构

## 概述

dsh-zotero 是一个 Cordis 服务插件，提供 `ctx.zotero` 服务边界。加载器将默认导出与行的验证配置一起挂载。

## 数据流

```mermaid
graph LR
    U[用户] --> A[Agent]
    A --> T[dsh Zotero 工具]
    T --> S[ZoteroService]
    S --> P[Provider]
    P --> Z[Zotero Local API<br/>127.0.0.1:23119]
    Z --> L[Zotero 文献库]
```

用户 → Agent → dsh Zotero 工具 → ZoteroService → Provider → 127.0.0.1 Zotero Local API → Zotero 文献库

## 关键层

### 服务层 (`src/service.ts`)

- `ZoteroService` 扩展 `Service`，注册为 `ctx.zotero`
- 负责 provider 选择、能力门控、领域方法
- 配置是实时的：附加时使用 settings section，否则使用 composition entry
- `rebuild()` 从当前配置创建 HTTP 客户端和 local provider
- 请求驱动：加载从不触及 Zotero

### Provider 层 (`src/provider-local.ts`)

- `LocalApiProvider` 实现 `ZoteroProvider`
- 能力：search、metadata、attachments、fulltext、citation
- 客户端侧解析作用域（Local API 无服务端名称搜索）
- 笔记体扫描：客户端侧第一页（offset 0），受 maxNoteScanRecords 限制
- 证据排名：基于 passage 语料库的 BM25（annotations、notes、abstract、fulltext chunks）
- 导出：引用批次遵循 API 的 50 键上限；translator 格式最多 50 条引用

### HTTP 传输层 (`src/http-client.ts`)

- 纯回环 fetch，固定 API 版本（`Zotero-API-Version: 3`）
- 实例身份保护（`Zotero-Server-ID` 头）
- 流式响应字节上限（`maxResponseBytes`）
- 不跟随重定向、不保持连接、无后台工作
- 超时通过 deadline 融合与调用者取消实现

### 证据管线 (`src/evidence.ts`)

- 分词：`Intl.Segmenter` 词分割（CJK 感知）
- BM25 排名（k1=1.2, b=0.75）在 passage 语料库上
- 文档频率是 passage 级别（在条目自身 passages 中越罕见得分越高）
- 平局保留调用者 passage 顺序（确定性）
- 零分 passage 排除（未命中查询词的 passage 不进入结果）

### 浏览器客户端 (`src/client/`)

- 配置卡片：Settings → Plugins tab，通过 `settingsScope` 绑定 `zotero` 命名空间
- Sources tab：`conversation.view` 插槽，文献/证据/导出的会话快照
  - Sources 子视图：搜索命中和引用条目的稳定联合
  - Evidence 子视图：按文献分组的段落，带 Zotero 的页标签
  - Exports 子视图：成功导出的产物，带格式/样式/区域设置
- 连接条：tab 打开时探测一次，刷新时再探测一次（无轮询）
- `zotero://` 深链接："在 Zotero 中打开"、"打开 PDF"、"打开批注"
- `webEnabled` 开关：实时生效，无需重新加载

### Remote/Typert

- `ZoteroRuntime` 通过 wire 命名空间为 web tab 提供实时连接性
- 严格 manifest 通过 Typert 注册表声明端点

### 设置

- 命名空间 `zotero` 在 `$DSH_HOME/settings.yaml` 中
- `installSettingsSection` 以 composition entry 作为基础层
- 热重载：`onChange` 重建 HTTP 客户端和 provider

## 设计边界

- **文献库**：只读。没有路径修改条目、笔记、标签、分类。
- **网络**：仅回环（127.0.0.1, localhost, ::1）。拒绝重定向。
- **无后台轮询**、无遥测、无常驻任务。
- **证据**：基于词项的 BM25，按查询词与 passage 的词频匹配度排序。
- **Sources tab**：会话快照，展示本次对话引用的条目。
- **导出**：静态文本，以文本形式返回，需要手动复制。
- **PDF 阅读**：附件返回路径/URL；进一步阅读需要宿主能力。
