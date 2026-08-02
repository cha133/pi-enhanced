# 当前状态与待办

最后更新：2026-08-02

## 当前阶段

`设计已对齐，等待开始实现`。设计基线已提交；当前尚未创建包结构或实现代码。

## 已完成

- [x] 盘点 `../pi` 的扩展 API、内置 `bash` / `read` / `edit` 实现和工具启停机制。
- [x] 盘点 `../pi-extensions` 的 PowerShell override、shell guidance、vision fallback 与 subagent 实现。
- [x] 盘点 `../codex` 中 PowerShell 只读命令及 `view_image` 相关设计线索。
- [x] 建立 `.agents/docs/` 文档体系。
- [x] 记录首版产品范围、架构草案、工具契约和配置草案。

## 待对齐（开始编码前）

无。当前产品范围、工具语义、配置结构和首版发布目标均已确认；实现中若发现 pi API 限制，再新增决策项。

## 实现待办

- [ ] 建立 `package.json`、`tsconfig.json`、单入口与内部源码布局。
- [ ] 编写平台探测与 PowerShell 7 版本验证。
- [ ] 实现工具激活协调器，在 session/model 生命周期中稳定应用有效工具集。
- [ ] 实现 `pwsh`，并在 fallback 环境覆盖原生 `bash` 的 prompt metadata；两者均复用 pi shell 执行、截断、取消和渲染能力。
- [ ] 合并通用 shell guidance，以及各自适用的 PowerShell / bash 文件分段读取指导。
- [ ] 实现可部分成功的批量 `edit`，保留 pi 的换行、BOM 和 Unicode/fuzzy 归一化语义。
- [ ] 实现 `view_image` 原生多模态路径与流式 vision fallback。
- [ ] 移植并收敛 `subagent`，适配扁平配置和增强工具表面。
- [ ] 为工具注册、平台矩阵、部分 edit、vision streaming、配置合并和取消清理补测试。
- [ ] 编写用户 README、配置示例和安装说明。
- [ ] 运行 typecheck、单元测试，并用真实 pi 做 Windows 与 fallback 冒烟测试。

## 风险

- pi 的 override 会继承内置 renderer，但 prompt metadata 不会继承；每个 override 必须显式设置 prompt 信息。
- `setActiveTools()` 是整个 session 的工具集合操作，必须保留其他扩展注册并已激活的工具，不能写死完整列表。
- `edit` 的部分成功会改变“失败即未写盘”的既有直觉；返回值必须清楚列出 applied/rejected，且不能把部分成功伪装成工具错误。
- vision fallback 是嵌套模型调用，必须上报 usage、传播取消、限流 UI 更新并截断最终文本。
- 直接复制相邻仓库实现会快速漂移；优先使用 pi 已导出的构造器和类型，只复制无法复用的最小逻辑。
