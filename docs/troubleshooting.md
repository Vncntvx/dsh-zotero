<p align="right"><a href="troubleshooting.en.md"><b>English</b></a></p>

# 故障排查

本文档列出使用 dsh-zotero 时的常见问题、可能原因与对应处理方式。

## 1. Zotero 无法连接

- **现象**：工具调用返回 `ZOTERO_NOT_RUNNING` 错误。
- **原因**：Zotero 桌面端未运行，或本地端口未处于监听状态。
- **排查**：启动 Zotero 桌面版，在 **设置 → 高级** 中确认已勾选“允许此计算机上的其他应用程序与 Zotero 通信”。

## 2. 本地 API 请求被拒绝 (403)

- **现象**：工具调用返回 `ZOTERO_API_DISABLED` 错误。
- **原因**：Zotero 运行中，但本地 API 通信权限被关闭。
- **排查**：进入 Zotero **设置 → 高级**，勾选“允许此计算机上的其他应用程序与 Zotero 通信”。

## 3. API 版本不兼容

- **现象**：工具调用返回 `ZOTERO_API_VERSION` 错误。
- **原因**：Zotero 本地 API 版本与插件支持的版本不一致。
- **排查**：根据错误信息提示的版本号判断，若 Zotero 版本过低，请升级 Zotero；若 Zotero 本地 API 升级，请更新 dsh-zotero 插件。

## 4. 安装后当前会话看不到 Zotero 工具

- **现象**：Agent 无法识别或调用 Zotero 相关工具。
- **原因**：当前会话创建于插件加载之前。
- **排查**：新建对话会话即可使新安装的工具生效。

## 5. 搜索有结果但无全文证据

- **现象**：`zotero_retrieve` 返回空证据列表，或 `sourcesSkipped` 中包含 `"fulltext"`。
- **原因**：目标 PDF 在 Zotero 中尚未建立全文索引。
- **排查**：在 Zotero 客户端中右键点击该附件，选择“重新建立索引”；或使用 `zotero_attachment` 获取本地文件路径进行查阅。

## 6. zotero:// 链接无法打开

- **现象**：点击“在 Zotero 中打开”或对应链接无响应。
- **原因**：操作系统或浏览器未正确关联 `zotero://` 协议处理程序。
- **排查**：复制条目 ref 或文件路径，在 Zotero 中通过搜索快速定位。

## 7. 安装提示 nothing installable

- **现象**：执行 `dsh plugin add` 时报错 `nothing installable: the plugin(s) need a build step`。
- **原因**：从 GitHub 源码分支安装时需在本地编译，而 pnpm 默认拦截依赖构建。
- **排查**：
  - 推荐：改用 npm 包名或 GitHub `#release` 预构建分支安装；
  - 若需从源码构建：在当前 profile 的 `pnpm-workspace.yaml` 中将 `dsh-zotero` 加入 `allowBuilds` 列表后重试。

## 8. Zotero 标签页不显示

- **现象**：Web 界面顶部未显示 Zotero 标签页。
- **原因**：配置项 `webEnabled` 被设置为 `false`，或插件未成功加载。
- **排查**：在 **设置 → Zotero** 中检查 `webEnabled` 开关，确认插件处于已启用状态。

## 9. 单次导出超过 50 篇限制

- **现象**：工具调用返回 `ZOTERO_INVALID_ARGUMENT` 错误，提示 refs 数量超出限制。
- **原因**：BibTeX、BibLaTeX、RIS 与 CSL JSON 格式单次最多支持导出 50 篇条目。
- **排查**：分批次调用 `zotero_export`，每批控制在 50 篇以内；`citation` 格式会自动分批。

## 10. Server ID 或 ref 不匹配

- **现象**：工具调用返回 `ZOTERO_SERVER_MISMATCH` 错误。
- **原因**：使用的 ref 来自另一个 Zotero 实例（如更换了数据库路径或同步至新机器）。
- **排查**：重新执行搜索获取当前实例下的新 ref，避免跨实例复用历史 ref。

## 11. 配置文件修改后未生效

- **现象**：修改 `settings.yaml` 后插件行为未发生改变。
- **原因**：配置路径不正确，或 YAML 缩进格式有误。
- **排查**：确认修改的是 `$DSH_HOME/settings.yaml` 中的 `zotero:` 配置段，并在会话中执行 `/zotero` 验证状态。

## 12. 对话中工具卡片未直接展开

- **现象**：模型调用了工具，但消息流中仅显示一条摘要栏（如“已调用工具 · 2.1s”）。
- **原因**：DSH 通用设置中的“工作步骤展示”默认为标准模式，执行完毕后自动折叠过程卡片。
- **排查**：点击消息上方的过程摘要栏即可就地展开卡片；若需始终默认展开，可在 **设置 → 通用设置 → 工作步骤展示**（`Settings → General → Work details`）中选择 **完全展开**（`verbose`）。
