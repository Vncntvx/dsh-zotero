<p align="right"><a href="getting-started.en.md"><b>English</b></a></p>

# 快速入门

dsh-zotero 是面向 DeepSeek Harness 的 Zotero 插件，让 Agent 能够搜索、阅读和引用本地 Zotero 文献库。

## 前置条件

- Zotero ≥ 7 桌面版已安装（读取需 Zotero ≥ 7，写入需 Zotero 10）
- 本地 API 已启用：**设置 → 高级 → 勾选“允许此计算机上的其他应用程序与 Zotero 通信”**
- Node.js ≥ 22.19 或 ≥ 24
- 宿主 dsh >= 0.2.0-rc.2

版本对照：

| 插件版本 | 最低 dsh 版本               |
| -------- | --------------------------- |
| 0.5.1    | 0.1.1-rc.2                  |
| 0.5.2    | 0.1.2-alpha.1               |
| 0.6.0    | 0.1.2-alpha.5               |
| 0.7.0    | 0.1.3-alpha.1               |
| 0.7.1    | 0.1.3-alpha.1               |
| 0.8.0    | 0.1.5-alpha.1               |
| 0.8.1    | 0.1.5-rc.1                  |
| 0.8.2    | 0.1.5-rc.2                  |
| 0.8.3    | 0.1.5-rc.2                  |
| 0.8.4    | 0.1.5-rc.2                  |
| 0.9.0    | 0.1.5-rc.1 或 0.1.6-alpha.2 |
| 0.9.1    | 0.1.7-alpha.2               |
| 0.10.0   | 0.1.7-rc.1                  |
| 0.10.1   | 0.1.7-rc.2                  |
| 0.11.0   | 0.1.7-rc.2                  |
| 0.12.0   | 0.2.0-rc.2                  |

## 安装插件

从 npm 安装（推荐）：

```sh
dsh plugin --profile <profile-name> add dsh-zotero
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

从 GitHub `main` 源码分支安装时，由于需要在本地执行 `prepare` 构建脚本，而 pnpm 默认拦截依赖构建，需在 profile 对应的 `~/.dsh/profiles/<profile-name>/pnpm-workspace.yaml` 中配置 `allowBuilds`：

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
Zotero version: 10.0.2-beta.9+c77df79af
API version: 12
Schema version: 11
Server ID: abc123def456
```

若提示无法连接，请检查：

1. Zotero 桌面版是否正常运行；
2. Zotero 设置的高级面板中是否已勾选允许通信选项。

## 使用示例

在对话中向 Agent 提问：

> 帮我找 FlashAttention 相关论文

Agent 会调用 `zotero_search` 检索文献库并返回匹配条目。随后可通过 `zotero_get` 读取文献元数据、摘要与笔记，或通过 `zotero_retrieve` 按问题提取正文与批注中的相关证据。
