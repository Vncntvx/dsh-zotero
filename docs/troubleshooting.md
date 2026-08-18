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

- **症状**：返回 `ZOTERO_API_VERSION` 错误，提示需要版本 3
- **原因**：Zotero 版本过旧，本地 API 不支持版本 3
- **处理**：升级 Zotero 到支持 API 版本 3 的版本

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

**7. GitHub 安装遇到 pnpm allowBuilds 错误**

- **症状**：首次 add 失败，提示 pnpm 拒绝运行 prepare
- **原因**：pnpm ≥ 10 默认拒绝 git 依赖的 prepare
- **处理**：在 profile 的 `pnpm-workspace.yaml` 中添加 allowBuilds 配置

---

**8. Zotero 标签页不显示**

- **症状**：`dsh web` 会话顶部没有 Zotero Sources 标签
- **原因**：`webEnabled` 被设为 false，或插件未加载
- **处理**：检查配置卡片中 webEnabled 开关；确认插件已安装并加载

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
- **处理**：确认修改的是 `$DSH_HOME/settings.yaml` 中的 `zotero:` 小节；运行 `/zotero status` 验证
