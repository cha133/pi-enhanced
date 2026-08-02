# 当前状态与待办

最后更新：2026-08-02

## 当前阶段

`设计对齐`。仓库已执行 `git init`，尚无提交；当前只建立开发文档，未创建包结构或实现代码。

## 已完成

- [x] 盘点 `../pi` 的扩展 API、内置 `bash` / `read` / `edit` 实现和工具启停机制。
- [x] 盘点 `../pi-extensions` 的 PowerShell override、shell guidance、vision fallback 与 subagent 实现。
- [x] 盘点 `../codex` 中 PowerShell 只读命令及 `view_image` 相关设计线索。
- [x] 建立 `.agents/docs/` 文档体系。
- [x] 记录首版产品范围、架构草案、工具契约和配置草案。

## 待对齐（开始编码前）

- [?] 确认“单个扩展入口”的含义：建议只暴露一个入口文件，但允许入口导入内部模块。
- [?] 确认入口工具启停的精确矩阵，尤其是非 Windows / Windows 无 pwsh 7 时是否仍禁用 `read`。
- [?] 确认 Windows 无 pwsh 7 时的体验：静默保留原生 `bash`，还是显示一次非阻塞提示。
- [?] 确认 `edit` 部分成功的粒度与错误返回 schema；当前建议按单文件、单次调用进行一次原子写盘。
- [?] 确认 `edit` 中重复匹配、未匹配、重叠、空 `oldText`、无变化分别是否都只淘汰对应 edit。
- [?] 确认 `view_image` 的输入 schema（建议 `path`、可选 `query`、可选 `detail`）。
- [?] 确认多模态模型路径是否直接返回 image content，让当前模型原生消费，而不额外调用模型。
- [?] 确认 vision fallback 失败应返回普通工具结果还是抛出工具错误；当前建议返回清晰的普通结果，避免中断并允许模型恢复。
- [?] 确认 subagent 是否完整保留 `peer` / `advisor` tier，只把模型设置从 `subagent.advisor` 扁平化为顶层 `advisor`。
- [?] 确认子 agent 的工具表面应使用增强工具名（`pwsh`、`edit`、`view_image`）还是继承其运行平台的有效主工具集。
- [?] 确认包名、许可证、发布目标与最低支持的 pi 版本。

## 实现待办

- [ ] 建立 `package.json`、`tsconfig.json`、单入口与内部源码布局。
- [ ] 编写平台探测与 PowerShell 7 版本验证。
- [ ] 实现工具激活协调器，在 session/model 生命周期中稳定应用有效工具集。
- [ ] 实现 `pwsh`，复用 pi shell 执行、截断、取消和渲染能力。
- [ ] 合并 shell guidance 与 PowerShell 文件读取指导。
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

