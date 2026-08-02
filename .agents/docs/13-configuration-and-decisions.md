# 配置与决策记录

## 配置来源

沿用 pi `SettingsManager`：

- 全局：`~/.pi/agent/settings.json`（实际路径通过 `getAgentDir()` 获取）。
- 项目：`<cwd>/.pi/settings.json`，仅在项目受信任时生效。
- 合并方式：对每个模型对象做浅合并，项目字段覆盖全局同名字段。
- 配置在调用时读取，允许不 reload 修改模型路由；模型注册表变化仍可能需要 `/reload`。

## 建议配置

```json
{
  "vision": {
    "provider": "openai",
    "model": "vision-model-id"
  },
  "advisor": {
    "provider": "anthropic",
    "model": "advisor-model-id"
  }
}
```

### `vision`

- 可选；仅文本模型调用 `view_image` 时要求存在。
- 必须含非空字符串 `provider` 与 `model`。
- 指向的模型必须已在 pi model registry 中存在且声明 image input。

### `advisor`

- 可选；缺省时 subagent 只有继承当前模型的 peer。
- 必须含非空字符串 `provider` 与 `model`。
- advisor 与当前主模型按 provider + model id 一起比较；相同则不暴露 advisor tier。

### 不建议保留的配置

- 不保留 `subagent.peer`：peer 的定义就是当前模型，减少配置和概念。
- 不保留 `subagent.advisor`：按用户要求扁平为顶层 `advisor`。
- 不增加 pwsh 路径配置：先自动探测；只有真实用户需求出现时再考虑 override。

## 已确认决策

| ID | 决策 | 来源 |
| --- | --- | --- |
| D-001 | 项目聚焦极简有效的原生增强，不延续 `pi-extensions` 的功能堆叠目标 | 用户需求 |
| D-002 | 交付只暴露一个扩展入口 | 用户需求 |
| D-003 | Windows 且有 PowerShell 7 时提供 `pwsh` 并禁用 `bash`；否则使用原生 `bash` | 用户需求 |
| D-004 | 覆盖 `edit`，并允许批量 replacements 部分成功 | 用户需求 |
| D-005 | 单独提供 `view_image`，兼容多模态与 vision fallback | 用户需求 |
| D-006 | vision fallback 期间用户可看到模型实时进展 | 用户需求 |
| D-007 | 提供 `subagent`，advisor 与 vision 采用同层配置 | 用户需求 |

## 待确认决策

### Q-001：单入口是否允许内部模块

建议：允许。package manifest 只声明 `extensions/pi-enhanced.ts`，内部 `lib/` 不构成额外扩展入口。

### Q-002：fallback bash 环境是否禁用 `read`

建议：所有平台都禁用 `read`。理由是产品工具心智始终保持“shell 读文本，view_image 读图”；代价是非 Windows 模型必须可靠掌握 bash 文本读取。若只在 pwsh 环境禁用 read，跨平台工具表面会变化更大，但 fallback 体验更接近 pi 原生。

### Q-003：没有 pwsh 7 时是否提示

建议：正常静默 fallback，不抛错；TUI 可选只显示一次 muted 通知。默认静默最符合“否则还是用默认 bash”。

### Q-004：edit 重叠冲突如何取舍

建议：重叠组全部拒绝，其他不重叠 edits 正常应用。不要按数组先后选择赢家，否则参数排序会改变文件结果。

### Q-005：edit applied 为 0 是否算错误

建议：不算工具错误。只要文件可访问且分类完成，就返回 rejected 明细；I/O、abort 与内部一致性错误才抛出。

### Q-006：vision “实时看到回复”的展示强度

建议：沿用 `pi-extensions`，TUI 单行展示最新 reasoning/reply 摘要并节流，最终文本正常写入工具结果。不永久记录每个中间 token。

### Q-007：subagent 配置收敛程度

建议：peer 固定继承当前模型，仅保留顶层可选 `advisor`。工具 tier 语义不变：默认 peer，配置有效时才出现 advisor。

### Q-008：subagent 的工具集合

建议：子 session 加载同一个 `pi-enhanced` 入口，再明确移除 `subagent`，从而按平台获得 `pwsh` 或 bash、增强 `edit`、`view_image` 与原生 `write`。需要验证扩展绑定不会递归注册/激活 subagent。

### Q-009：PowerShell profile

参考实现通过 `TERM=dumb` 让用户 profile 自行短路交互逻辑，但仍加载 profile。建议保留兼容性并做无 profile 依赖的测试；若目标是完全可复现，则改用 `-NoProfile`，代价是失去用户环境初始化。需确认偏好。

### Q-010：公开包元数据

需确认 npm 包名、repository URL、license，以及是否锁定 pi `0.83.x` 或使用宽 peer dependency。

## 对齐后动作

每确认一项：

1. 将结论写为新的 `D-xxx` 或更新既有决策。
2. 从本节移除对应问题。
3. 更新工具矩阵/契约。
4. 更新 [01-state.md](./01-state.md) 的待对齐清单。

