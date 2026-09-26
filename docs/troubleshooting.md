<p align="right"><a href="troubleshooting.en.md"><b>English</b></a></p>

# dsh-zotero 故障排查

---

**1. Zotero 无法连接**

- **症状**：工具调用返回 `ZOTERO_NOT_RUNNING` 错误
- **原因**：Zotero 未运行，或本地 API 未启用
- **处理**：启动 Zotero，进入设置 → 高级 → 勾选"允许其他应用程序与 Zotero 通信"

---

**2. Local API 被拒绝 (403)**

- **症状**：返回 `ZOTERO_API_DISABLED` 错误
- **原因**：本地 API 在 Zotero 设置中被禁用
- **处理**：在 Zotero 设置 → 高级中启用本地 API

---

**3. API 版本不兼容**

- **症状**：返回 `ZOTERO_API_VERSION` 错误，提示本地 API 版本 3 未被实现
- **原因**：Zotero 与插件没有共同的本地 API 版本。Zotero 过旧（低于 3），或该 Zotero 比当前插件线更新（例如已只提供版本 4）。错误信息给出实际作答的版本号，据此判断方向
- **处理**：旧于版本 3 时升级 Zotero；新于版本 3 时更新 dsh-zotero
- 与 `ZOTERO_NOT_IMPLEMENTED` 的区别：后者是 Zotero 以 501 明确表示"该端点或输出格式未实现"，不是版本问题，也不建议升级

---

**4. 安装后当前 session 看不到 Zotero 工具**

- **症状**：Agent 不知道 Zotero 工具的存在
- **原因**：session 在插件加载前创建
- **处理**：新建一个 session

---

**5. 搜索有结果但 retrieve 没有全文证据**

- **症状**：`zotero_retrieve` 返回空 evidence 或 sourcesSkipped 包含 `"fulltext"`
- **原因**：Zotero 尚未对该 PDF 建立全文索引
- **处理**：在 Zotero 中右键该附件 → "重新建立索引"；或使用 `zotero_attachment` 获取文件路径

---

**6. zotero:// 深链无法打开**

- **症状**：点击"在 Zotero 中打开"无反应
- **原因**：浏览器或系统不支持 `zotero://` 协议跳转
- **处理**：复制 ref 或路径，手动在 Zotero 中搜索；深链行为因浏览器和系统而异

---

**7. 安装报 `nothing installable`（构建被拦截，或没有预构建产物）**

- **症状**：`dsh plugin add` 失败并提示 `nothing installable: the plugin(s) need a build step (blocked by default, see allowBuilds) or ship no prebuilt artifacts`
- **原因**：从 GitHub 通道安装会拉取源码，包内没有 `lib/` 构建产物，必须由 `prepare` 现场构建；pnpm ≥ 10 默认拦截依赖的构建脚本，于是既没有可用的构建产物、构建也没获授权
- **处理**：二选一
  - 授权构建：把 `add` 输出里 pnpm 打印的包键写进 **该 profile** 的 `pnpm-workspace.yaml`，然后重跑：
    ```yaml
    allowBuilds:
      dsh-zotero: true
    ```
  - 换成预构建通道（推荐）：从 npm 包名或本地 tarball 安装，两者都携带已构建的 `lib/`，不需要任何授权

---

**8. Zotero 标签页不显示**

- **症状**：`dsh web` 会话顶部没有 Zotero Sources 标签
- **原因**：`webEnabled` 被设为 false，或插件未加载
- **处理**：在设置面板左侧导航的 Zotero 配置页中检查 webEnabled 开关；确认插件已安装并加载

---

**9. 导出超过 50 篇限制**

- **症状**：返回 `ZOTERO_INVALID_ARGUMENT` 错误，提示 refs 超过 50
- **原因**：BibTeX/BibLaTeX/RIS/CSL JSON 格式单次最多 50 篇
- **处理**：分批调用 `zotero_export`，每批不超过 50 篇；citation 格式自动分批

---

**10. Server ID/ref 不匹配**

- **症状**：返回 `ZOTERO_SERVER_MISMATCH` 错误
- **原因**：ref 来自另一个 Zotero 实例（例如切换了 Zotero 数据库）
- **处理**：重新搜索获取新的 ref，不要复用旧 ref

---

**11. 配置修改后不生效**

- **症状**：修改 `settings.yaml` 后工具行为未变
- **原因**：配置文件路径错误，或 YAML 格式有误
- **处理**：确认修改的是 `$DSH_HOME/settings.yaml` 中的 `zotero:` 小节；运行 `/zotero` 验证
