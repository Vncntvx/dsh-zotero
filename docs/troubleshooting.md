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

## 4. 学术检索工具不出现

- **现象**：模型看不到 `scholarly_search` 等 7 个学术工具，或设置页的「学术检索」标签页只显示一条提示、没有任何字段。
- **原因**：`dsh-zotero/scholarly` 组件未挂载。该组件随包发布但默认关闭，开关只有这一处：组件不挂载时，服务、传输层与工具都不存在，宿主也不会发出外部请求。
- **排查**：在插件管理器「包含的组件」中打开 `dsh-zotero/scholarly` 那一行；启用后无需重启，工具与设置页即时生效。外部检索的授权边界见[产品模型](product-model.md)。

## 5. 安装后当前会话看不到 Zotero 工具

- **现象**：Agent 无法识别或调用 Zotero 相关工具。
- **原因**：当前会话创建于插件加载之前。
- **排查**：新建对话会话即可使新安装的工具生效。

## 6. 搜索有结果但检索不到全文片段

- **现象**：`zotero_retrieve` 返回空片段列表，或 `sourcesSkipped` 中包含 `"fulltext"`。
- **原因**：目标 PDF 在 Zotero 中尚未建立全文索引。
- **排查**：在 Zotero 客户端中右键点击该附件，选择“重新建立索引”；或使用 `zotero_attachment` 获取本地文件路径进行查阅。

## 7. PDF 阅读与 Zotero 文献定位

- **原生阅读**：在文献面板、文献轨迹或工具卡片中点击「阅读 PDF」，本地附件会在 DeepSeek Harness 右侧边栏的阅读栏打开，无须跳转外部应用程序；桌面端和 Web 端行为一致。文献面板的阅读栏锚定面板所属会话，多会话时打开的是当前会话。
- **URL 附件**：附件本身是外部 URL（而不是本地 PDF 文件）时，「阅读 PDF」在浏览器新标签页打开该地址。
- **打开被拒绝**：宿主拒绝打开阅读栏或新标签页时，动作行就地显示行内提示，不会静默失败，也不会自动重试。
- **快速定位**：若需在 Zotero 本地客户端中查看对应条目，点击「复制标题」，粘贴到 Zotero 快捷搜索栏（快捷键 `Cmd+F` 或 `Ctrl+F`）即可定位；或点击「复制链接」，将规范深链（支持个人库与群组库）粘贴到外部笔记或地址栏。

## 8. 安装提示 nothing installable

- **现象**：执行 `dsh plugin --profile <profile> add` 时报错 `nothing installable: the plugin(s) need a build step`。
- **原因**：从 GitHub 源码分支安装时需在本地编译，而 pnpm 默认拦截依赖构建。
- **排查**：
  - 推荐：改用 npm 包名或 GitHub `#release` 预构建分支安装。
  - 若需从源码构建：在当前 profile 的 `pnpm-workspace.yaml` 中将 `dsh-zotero` 加入 `allowBuilds` 列表后重试。

## 9. 文献轨迹不显示

- **现象**：会话顶部没有「文献轨迹」标签页。
- **原因**：核心配置项 `webEnabled`（「基础设置 → 文献轨迹 → 显示文献轨迹」）被关闭；或核心 `dsh-zotero` 组件行未启用、插件加载失败（浏览器半侧装配失败会以入口 reject 结束，harness 将插件标记为加载失败）。
- **排查**：
  1. 在插件管理器中确认 `dsh-zotero` 行已启用，详情页没有加载失败提示；
  2. 打开 **dsh-zotero** 详情页配置区「基础设置 → 文献轨迹」，确认「显示文献轨迹」已开启并保存；该开关保存后即时生效，不需要刷新页面；
  3. 文献轨迹与文献面板不是同一条门控链：文献轨迹只跟随核心组件与 `webEnabled`；文献面板需要三闸同时成立（`dsh-zotero/library` 组件行 + `webEnabled` + `rightSidebarEnabled`），见第 19 项。

## 10. 单次导出超过 50 篇限制

- **现象**：工具调用返回 `ZOTERO_INVALID_ARGUMENT` 错误，提示 refs 数量超出限制。
- **原因**：除 `citation` 外的五种格式（`bibliography`、BibTeX、BibLaTeX、RIS 与 CSL JSON）单次最多导出 50 篇条目，来源是 Zotero `itemKey` 的请求上限。
- **排查**：分批次调用 `zotero_export`，每批控制在 50 篇以内；或改用 `citation` 格式，它按 50 一组自动分批，但需先将 `maxExportRefs` 调至 50 以上。

## 11. Server ID 或 ref 不匹配

- **现象**：工具调用返回 `ZOTERO_SERVER_MISMATCH` 错误。
- **原因**：使用的 ref 来自另一个 Zotero 实例（如更换了数据库路径或同步至新机器）。
- **排查**：重新执行搜索获取当前实例下的新 ref，避免跨实例复用历史 ref。

## 12. 配置文件修改后未生效

- **现象**：修改配置后插件行为未发生改变。
- **原因**：改错了文件或位置。用户层配置位于当前 profile 的 `cordis.patch.yml` 中对应条目（`zotero` / `library` / `scholarly`）的 `config`；也可能是 YAML 键层级写错，或该项被 home patch / 命令行 overlay 覆盖。
- **排查**：在插件管理器中打开 **dsh-zotero** 的配置区保存一次（写入落在当前 profile 的 `cordis.patch.yml`），并在会话中执行 `/zotero` 验证状态；确认修改的是当前启动所用 profile 的文件。

## 13. 对话中工具卡片未直接展开

- **现象**：模型调用了工具，但消息流中仅显示一条摘要栏（如“已调用工具 · 2.1s”）。
- **原因**：DSH 通用设置中的“工作步骤展示”默认为标准模式，执行完毕后自动折叠过程卡片。
- **排查**：点击消息上方的过程摘要栏即可就地展开卡片；若需始终默认展开，可在 **设置 → 通用设置 → 工作步骤展示**（`Settings → General → Work details`）中选择 **完全展开**（`verbose`）。

## 14. 写入被 `ZOTERO_INVALID_ARGUMENT` 拒绝

- **现象**：写工具立即返回 `ZOTERO_INVALID_ARGUMENT`，消息形如 `Unknown itemType "…"`、`A new item needs at least a title or a URL`、`add and remove must carry at least one entry between them`、`tags must carry at least one item`。
- **原因**：这类检查在工具层完成，先于任何网络请求；因此不弹出计划卡，Zotero 也不会收到写入。
- **排查**：按消息修正参数：`itemType` 使用闭集（`webpage` / `journalArticle` / `book` / `conferencePaper` / `report` / `thesis` / `document` / `preprint`）；列表参数非空；`set` 只写可更新字段。
- 另一类 `ZOTERO_INVALID_ARGUMENT` 需要先读取才能判定，因此出现在批准与读取之后：`A collection named "…" already exists at that level`、`Field "…" is not valid for item type "…"`。两者仍不发写入请求，但计划卡已弹出。

## 15. 删除计划卡上的数量显示 unknown

- **现象**：`zotero_delete_collection` 或 `zotero_delete_library_tags` 的计划卡中，条目数 / 子合集数 / 标签计数显示 `unknown`。
- **原因**：删除前的预览读取是尽力而为，读取失败不阻塞计划；删除本身仍携带读取到的库版本前置。
- **排查**：先用 `/zotero` 确认连接正常，可拒绝本次计划卡后重跑以取得准确计数。

## 16. 写入返回 ZOTERO_WRITE_CONFLICT (412)

- **现象**：写入提交被拒绝，返回 `ZOTERO_WRITE_CONFLICT`。
- **原因**：读取与提交之间对象被并发修改，版本前置条件未满足；这是预期的安全行为。
- **排查**：重跑一次工具；重跑会重新读取版本并重新执行合并。

## 17. 结果为 committed-unverified（写入已提交但未核验）

- **现象**：写工具返回 `committed-unverified`，卡片显示警示状态，不显示成功徽标。
- **原因**：Zotero 已接受写入，但响应无法证明最终状态（提交未知或保存状态未核验）。
- **排查**：不要重试；在 Zotero 中按 key/ref 核对对象是否已创建或变更。

## 18. 如何获取诊断信息

当报错信息不足以排查问题（如功能静默失效、卡片或标签页渲染异常、返回结果异常）时，可按以下步骤导出诊断日志：

1. 在插件管理器中打开 **dsh-zotero** 的详情页，在配置区「高级选项 → 诊断」分组中开启「开启诊断」并保存。
2. 开启后，详情页底部会出现「诊断」卡片；复现一次问题后，点击卡片中的「复制诊断信息」，将内容附在问题反馈中。
3. 导出的诊断包包含插件版本、Zotero 运行端点与版本、调试开关状态以及按时间倒序保存的日志条目（前端组件渲染异常也会自动汇总至此）。

注意：诊断记录仅保留在当前进程内存中，宿主重启后将被清空。如需保留排查信息，请在重启宿主前完成复制。

## 19. 文献面板不出现

- **现象**：右侧边栏没有「文献面板」标签页或快捷入口；设置页的「文献面板」标签页只显示一条指向「包含的组件」的提示。
- **原因**：文献面板要出现，需要三闸同时成立：`dsh-zotero/library` 组件行已组合；核心 `webEnabled`（「基础设置 → 文献轨迹 → 显示文献轨迹」）开启；组件自己的 `rightSidebarEnabled`（「文献面板 → 侧边栏显示设置 → 在右侧侧边栏显示」）开启。任意一处关闭都不会注册面板表面，也不会发起 `zotero/browse|search|item|childPage|export|write` 请求。
- **排查**：
  1. 在插件管理器「包含的组件」中确认 `dsh-zotero/library` 行已启用并重载插件；
  2. 确认核心 `webEnabled` 开启（见第 9 项）；
  3. 打开设置页「文献面板」标签页或 `dsh-zotero#library` 行的「配置」，确认「在右侧侧边栏显示」已开启并保存；该开关保存后即时生效；
  4. 三闸都满足仍不出现时，按第 18 项复制诊断信息，检查插件是否加载失败。

## 20. 文献面板离线

- **现象**：面板顶部状态灯显示「未连接」，工具栏以下替换为离线说明，浏览、检索与详情请求暂停。
- **原因**：本机 Zotero 未运行、本地 API 未启用、`baseUrl` 指向了错误的本机端口，或当前 Zotero 实例与面板引用的来源不一致（Server ID 不匹配）。
- **排查**：启动 Zotero 并在 **设置 → 高级** 中勾选“允许此计算机上的其他应用程序与 Zotero 通信”；核对配置区「本地连接 → 连接」中的 `baseUrl` 为当前实例地址；在面板点击「刷新」重新探测，恢复连接后列表与详情自动重载。状态灯与离线说明中的诊断文案可用于区分“未运行”与“本地 API 未启用”。

## 21. 复制引用失败

- **现象**：文献面板条目检视器动作行的「复制引用」「复制 BibTeX」或「更多格式」中的某一项失败，动作行内联显示「复制失败：<原因>」；或控件在请求期间显示「正在生成…」后没有产生剪贴板内容。
- **原因**：`zotero/export` 端点请求失败（本地 API 不可达、超时、导出内容超出限制、ref 或格式不受支持），或浏览器拒绝剪贴板写入（非安全上下文、无剪贴板权限）。面板不会自动重试。
- **排查**：确认 Zotero 连接正常（见第 1、2 项）后重新点击该格式一次；单条复制不受 `maxExportRefs` 影响，若错误信息指向导出内容过大，检查「高级选项 → 输出限制」中的 `maxExportChars` 与 `maxExportRefs`；剪贴板不可用时改用「复制Zotero链接」或「阅读 PDF」抄录。若失败持续，按第 18 项复制诊断信息。

## 22. 文献轨迹为空

- **现象**：文献轨迹标签页已出现，但「文献」视图显示「本会话还没有 Zotero 文献」。
- **原因**：本会话尚未调用任何读类工具（检索、浏览、详情、子对象、原文片段、附件定位、导出）；或会话创建于插件加载之前，Agent 没有可用的 Zotero 工具；；或只做了写入与库外学术检索。文献轨迹只记录读类工具与导出，不记录写入，也不含库外文献。
- **排查**：先在对话中让 Agent 检索或读取文献库（如 `zotero_search`、`zotero_get`）；确认会话在插件加载后创建并重试；确认核心 `webEnabled` 开启。学术检索结果需保存进 Zotero 文献库后才会出现在轨迹里。文献面板中的人工浏览不会写入轨迹，轨迹只反映 Agent 的工具调用。
