<p align="right"><a href="getting-started.en.md"><b>English</b></a></p>

# dsh-zotero 快速入门

dsh-zotero 是一个 DSH 插件，让 Agent 能够搜索、阅读和引用本地 Zotero 文献库。

## 前置条件

- Zotero >= 7 桌面版已安装
- 本地 API 已启用：设置 -> 高级 -> 勾选「允许此计算机上的其他应用程序与 Zotero 通信」
- Node.js >= 22.19 或 >= 24
- DSH 0.1.7-rc.1（恰好该版本：`engines.dsh` 与全部 `@deepseek-ai/dsh-*` peer 均为 exact pin，不兼容其他 dsh 版本）

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
Zotero version: 10.0.2-beta.9+c77df79af
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

**npm 包名与 tarball 两条通道不需要任何授权**：它们分发的是已构建产物（`lib/` 随包发布），装完即可用。若之前从 GitHub 装过并失败，改用这两条通道即可直接绕过下面的构建授权。

**GitHub 通道会拉取源码**，因此要在你的机器上跑一次 `prepare`（即 `npm run build`）：先类型检查 Node 端再打包浏览器端。pnpm ≥ 10 默认拦截依赖的构建脚本，所以首次 `add` 会失败并打印需要授权的包键；把该键写进**这个 profile 的** `pnpm-workspace.yaml` 后重跑：

```yaml
allowBuilds:
  dsh-zotero: true
```

（键名请用 pnpm 输出的那个；pnpm 10 中该设置的旧名为 `onlyBuiltDependencies`，取值是数组。文件位置即 `~/.dsh/profiles/<profile-name>/pnpm-workspace.yaml`。）

> 看到 `nothing installable … need a build step (blocked by default, see allowBuilds) or ship no prebuilt artifacts` 就是这条：请二选一——按上面的片段授权构建，或改用 npm/tarball 通道。

建议锁定到特定 commit 以确保可复现性：

```sh
dsh plugin --profile <profile-name> add github:Vncntvx/dsh-zotero#<commit-hash>
```

从 tarball 安装不需要额外配置，直接指向本地 `.tgz` 文件即可：
