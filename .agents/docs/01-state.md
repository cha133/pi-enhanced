# 当前状态与待办

最后更新：2026-08-02

## 当前阶段

`0.0.1 首版实现完成，等待真实模型验收`。单入口、四个增强工具、测试和用户 README 已落地。

## 已完成

- [x] 盘点 `../pi` 的扩展 API、内置 `bash` / `read` / `edit` 实现和工具启停机制。
- [x] 盘点 `../pi-extensions` 的 PowerShell override、shell guidance、vision fallback 与 subagent 实现。
- [x] 盘点 `../codex` 中 PowerShell 只读命令及 `view_image` 相关设计线索。
- [x] 建立 `.agents/docs/` 文档体系。
- [x] 记录首版产品范围、架构草案、工具契约和配置草案。

## 待对齐（开始编码前）

无。当前产品范围、工具语义、配置结构和首版发布目标均已确认；实现中若发现 pi API 限制，再新增决策项。

## 实现待办

- [x] 建立 `package.json`、`tsconfig.json`、单入口与内部源码布局。
- [x] 编写平台探测与 PowerShell 7 版本验证。
- [x] 实现工具激活协调器，在 session/model 生命周期中稳定应用有效工具集。
- [x] 实现 `pwsh`，并在 fallback 环境覆盖原生 `bash` 的 prompt metadata；两者均复用 pi shell 执行、截断、取消和渲染能力。
- [x] 合并通用 shell guidance，以及各自适用的 PowerShell / bash 文件分段读取指导。
- [x] 实现可部分成功的批量 `edit`，保留 pi 的换行、BOM 和 Unicode/fuzzy 归一化语义。
- [x] 实现 `view_image` 原生多模态路径与流式 vision fallback。
- [x] 移植并收敛 `subagent`，适配扁平配置和增强工具表面。
- [x] 为工具注册、平台矩阵、部分 edit、vision/subagent 状态和配置合并补测试。
- [x] 编写用户 README、配置示例和安装说明。
- [x] 运行 typecheck、单元测试、package dry-run、真实文件 edit 与 Windows pwsh 冒烟。

## 发布前待办

- [ ] 在已认证的多模态主模型上验收 `view_image` 原生图片返回。
- [ ] 在纯文本主模型 + 已配置 vision 模型上验收 fallback、usage 与取消。
- [ ] 在 peer/advisor 各跑一次真实 subagent，验收 child 工具集、transcript 和取消清理。
- [ ] 在非 Windows 环境做一次原生 bash 实际执行验收；当前已有平台无关单元测试。
- [ ] 根据验收修复问题，版本从 `0.0.1` bump 到 `0.1.0` 并打 GitHub tag。

## 风险

- pi 的 override 会继承内置 renderer，但 prompt metadata 不会继承；每个 override 必须显式设置 prompt 信息。
- `setActiveTools()` 是整个 session 的工具集合操作，必须保留其他扩展注册并已激活的工具，不能写死完整列表。
- `edit` 的部分成功会改变“失败即未写盘”的既有直觉；返回值必须清楚列出 applied/rejected，且不能把部分成功伪装成工具错误。
- vision fallback 是嵌套模型调用，必须上报 usage、传播取消、限流 UI 更新并截断最终文本。
- 直接复制相邻仓库实现会快速漂移；优先使用 pi 已导出的构造器和类型，只复制无法复用的最小逻辑。
