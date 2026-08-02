# pi-enhanced 开发文档索引

## 文档职责

本目录是 `pi-enhanced` 开发期间的事实来源。代码与文档冲突时，应先确认设计是否变化，再同步更新对应文档。

| 文档 | 用途 | 更新时机 |
| --- | --- | --- |
| [01-state.md](./01-state.md) | 当前状态、待办、阻塞项和待对齐决策 | 每次完成任务或改变优先级后 |
| [02-handoff.md](./02-handoff.md) | 跨会话恢复所需的最小上下文 | 每次结束开发会话前 |
| [10-product-scope.md](./10-product-scope.md) | 产品定位、边界、工具表面与成功标准 | 产品范围变化时 |
| [11-architecture.md](./11-architecture.md) | 单入口架构、生命周期、平台分支和共享基础设施 | 架构或目录设计变化时 |
| [12-tool-specs.md](./12-tool-specs.md) | `pwsh`、`edit`、`view_image`、`subagent` 的行为契约 | 工具 schema 或语义变化时 |
| [13-configuration-and-decisions.md](./13-configuration-and-decisions.md) | 配置结构、已定决策、待定问题和建议默认值 | 每次设计对齐后 |

## 阅读顺序

新会话按以下顺序恢复：

1. 阅读本索引。
2. 阅读 [01-state.md](./01-state.md) 获取当前工作面。
3. 阅读 [02-handoff.md](./02-handoff.md) 获取上一会话结论与下一步。
4. 仅按当前任务打开 `10` 之后的专题文档。

## 文档约定

- 状态标记仅使用：`[ ]` 未开始、`[-]` 进行中、`[x]` 完成、`[?]` 待决策。
- “已确认”表示来自用户明确要求；“建议”不是既定需求。
- 设计引用尽量链接到本机相邻仓库中的具体实现，避免复制后失去来源。
- 本项目对接的基线暂为 `@earendil-works/pi-coding-agent@0.83.0`；升级依赖时必须重新审查内部工具契约。

