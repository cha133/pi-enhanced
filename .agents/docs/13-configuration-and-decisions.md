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
| D-008 | 单入口允许导入内部模块，package manifest 只暴露一个扩展入口 | 用户确认 |
| D-009 | 所有平台禁用 `read`；fallback 环境静默保留并增强原生 `bash` 的 prompt metadata | 用户确认 |
| D-010 | `view_image` 使用 path/query/detail；多模态原生消费，纯文本走明确标识的外挂 vision，prompt metadata 随模型能力变化 | 用户确认 |
| D-011 | vision fallback 失败返回普通结果，不抛工具错误 | 用户确认 |
| D-012 | subagent 保留 peer/advisor tier，advisor 配置扁平化，子 agent 继承平台有效工具集 | 用户确认 |
| D-013 | 包名 `pi-enhanced`、MIT、GitHub 直接安装；当前 0.0.1，完成后发布 0.1.0；最低 pi 0.83.0 | 用户确认 |
| D-014 | edit 重叠组全部拒绝，其他正确项合并成一次原子写盘 | 用户确认 |
| D-015 | edit rejected 仅回传索引、错误信息和明确标注为不完整的有界预览 | 用户确认 |
| D-016 | vision fallback 使用与 read vision/subagent 一致的紧凑单行实时状态 | 用户确认 |
| D-017 | `view_image.detail` 只控制分析深度；图片沿用 pi 自动等比缩放，不提供原始分辨率开关 | 用户确认 |
| D-018 | pwsh 7 加载用户 profile 并注入 `TERM=dumb` | 用户确认 |
| D-019 | edit 的参数级错误局部拒绝；即使全部 rejected 也返回普通结果，只有 I/O、取消或内部错误抛 tool error | 对齐结论 |

## 待确认决策

无。实现中出现新的兼容性或产品取舍时，从 `Q-011` 继续编号。

## 对齐后动作

每确认一项：

1. 将结论写为新的 `D-xxx` 或更新既有决策。
2. 从本节移除对应问题。
3. 更新工具矩阵/契约。
4. 更新 [01-state.md](./01-state.md) 的待对齐清单。
