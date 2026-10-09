# 产品范围

## 定位

`pi-enhanced` 是一个面向日常编码的单入口 pi 扩展包。它不追求尽可能多的 agent tools，而是在 pi 原生四工具表面上做少量、高收益、可解释的增强；MCP 能力由 pi 内置扩展提供。

设计取向：

- 极简：只增加解决明确缺口的工具。
- 原生感：尽量复用 pi 的执行、渲染、截断、取消、配置和模型注册能力。
- 可恢复：失败结果应给模型足够信息自行检查和重试。
- 平台诚实：只在 Windows + PowerShell 7 可用时暴露 `pwsh`。
- 用户可见：异步 session metadata 请求以最终名称作为结果反馈。
- 克制复制：借鉴 `pi-extensions` 与 Codex，但不把探索性复杂度整体搬入本项目。

工具之外，package 还提供两项轻量 session 增强：首轮固定时间/模型 metadata，以及用首条用户消息异步生成的会话标题。

## 工具表面

### 目标有效工具矩阵

| 环境 | 原生 `bash` | 原生 `read` | 原生 `write` | 原生 `edit` | `pwsh` | 增强 `edit` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Windows + pwsh 7 | 禁用 | 启用 | 启用 | 被覆盖 | 启用 | 启用 |
| Windows，无 pwsh 7 | 提示词被覆盖 | 启用 | 启用 | 被覆盖 | 不注册/不启用 | 启用 |
| 非 Windows | 提示词被覆盖 | 启用 | 启用 | 被覆盖 | 不注册/不启用 | 启用 |

说明：

- `write` 直接使用 pi 原生工具；本包不覆盖其执行或注册，保留其现有启用或禁用状态。矩阵中的启用表示默认状态。
- 文本与图片统一通过 pi 原生 `read`；本包不覆盖其执行、schema、提示词或渲染，不兼容纯文本模型读图。矩阵中的启用表示默认状态，用户已有的禁用状态保持不变。
- fallback 环境保留原生 `bash` 执行实现，但同名 override 只增加通用 shell/ripgrep guidance，不指导模型用 shell 读取文件。
- `read` 不引入 `pi-extensions` 的 hashline 格式或 session grounding 状态。
- 自定义工具只应调整自己负责的内置工具名，不得意外移除其他扩展的有效工具。
- MCP 由 pi 内置扩展管理，本包不连接服务器或注册 MCP 工具，保留其有效工具。

## 非目标

- 不构建 `grep`、`find`、`ls` 等 shell 命令的工具包装层。
- 不提供复杂工具搜索、codegraph、web search/fetch 等独立能力。
- 不引入 hashline edit 协议或 session grounding 状态。
- 不实现通用多 shell 抽象；`pwsh` 只面向 Windows PowerShell 7。
- 不复刻 Codex sandbox、审批策略或 unified exec 协议。
- 不实现 MCP client、配置验证、工具搜索或历史 MCP 渲染。

## 成功标准

- 安装一个 pi package 只加载一个扩展入口。
- Windows + pwsh 7 启动后，模型只看到 `pwsh` 而非 `bash`，且能可靠搜索、分段读文件和执行常用开发命令。
- fallback 环境仍能使用 pi 原生 `bash`，扩展不会因缺少 pwsh 而启动失败。
- 一次包含多个 replacements 的 `edit` 调用中，单个坏参数不会迫使模型重发已经成功的参数。
- 支持读图的当前模型通过原生 `read` 直接查看图片，无额外视觉模型调用。
- 启动和模型切换均保留 pi 内置 MCP、codemode 与其他扩展工具。
- 原生工具继续保留 pi 的取消和资源清理行为。
- 新空会话的首条文本消息不会因标题生成增加首轮等待；成功后名称持久化，手工名称、失败请求和纯图片消息均保持可预测的退化行为。
