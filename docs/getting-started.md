<p align="right"><a href="getting-started.en.md"><b>English</b></a></p>

# dsh-zotero 快速入门

dsh-zotero 是一个 DSH 插件，让 Agent 能够搜索、阅读和引用本地 Zotero 文献库。

## 前置条件

- Zotero >= 7 桌面版已安装
- 本地 API 已启用：设置 -> 高级 -> 勾选「允许此计算机上的其他应用程序与 Zotero 通信」
- Node.js >= 22.19 或 >= 24
- DSH 运行时（peer dependencies 见 package.json）

## 安装插件

从 npm 包名安装（推荐）：

```sh
dsh plugin --profile <profile-name> add dsh-zotero
```

从 GitHub 安装：

```sh
dsh plugin --profile <profile-name> add github:Vncntvx/dsh-zotero
```

从本地 tarball 安装：

```sh
npm pack
dsh plugin --profile <profile-name> add ./dsh-zotero-*.tgz
```

安装后插件以 id `zotero` 挂载，下次启动 dsh 时生效。如果当前会话是在插件加载之前创建的，安装/启用后需要新开一个会话。

## 验证连接

在会话中执行：

```
/zotero status
```

正常输出示例：

```
Zotero local API: connected
API version: 12
Schema version: 11
Server ID: abc123def456
```

常见问题：

- **Zotero 未运行**：确保 Zotero 桌面版已打开
- **本地 API 未启用**：回到 Zotero 设置确认勾选了「允许其他应用程序通信」选项

## 第一个示例

在会话中告诉 Agent：

> 帮我找 FlashAttention 相关论文

Agent 会调用 `zotero_search` 搜索你的文献库，返回匹配的条目列表。然后可以用 `zotero_get` 查看摘要、笔记和附件详情，用 `zotero_retrieve` 按问题提取论文中的具体证据。

## 从 GitHub 或 tarball 安装的特殊事项

从 GitHub 安装时会拉取源码并执行 `prepare`（即 `npm run build`）。pnpm >= 10 需要在 pnpm-workspace.yaml 中配置 `allowBuilds`：

```yaml
onlyBuiltDependencies:
  - dsh-zotero
```

建议锁定到特定 commit 以确保可复现性：

```sh
dsh plugin --profile <profile-name> add github:Vncntvx/dsh-zotero#<commit-hash>
```

从 tarball 安装不需要额外配置，直接指向本地 `.tgz` 文件即可。
