# 产品范围

## 定位

`pi-enhanced` 是一个面向日常编码的单入口 pi 扩展包。它不追求尽可能多的 agent tools，而是在 pi 原生四工具表面上做少量、高收益、可解释的增强。

设计取向：

- 极简：只增加解决明确缺口的工具。
- 原生感：尽量复用 pi 的执行、渲染、截断、取消、配置和模型注册能力。
- 可恢复：失败结果应给模型足够信息自行检查和重试。
- 平台诚实：只在 Windows + PowerShell 7 可用时暴露 `pwsh`。
- 用户可见：嵌套模型调用不能成为无反馈的黑盒。
- 克制复制：借鉴 `pi-extensions` 与 Codex，但不把探索性复杂度整体搬入本项目。

## 工具表面

### 目标有效工具矩阵

| 环境 | 原生 `bash` | 原生 `read` | 原生 `write` | 原生 `edit` | `pwsh` | 增强 `edit` | `view_image` | `subagent` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Windows + pwsh 7 | 禁用 | 待确认：建议禁用 | 保留 | 被覆盖 | 启用 | 启用 | 启用 | 启用 |
| Windows，无 pwsh 7 | 保留 | 待确认：建议禁用 | 保留 | 被覆盖 | 不注册/不启用 | 启用 | 启用 | 启用 |
| 非 Windows | 保留 | 待确认：建议禁用 | 保留 | 被覆盖 | 不注册/不启用 | 启用 | 启用 | 启用 |

说明：

- `write` 保持原生，负责新建或完整重写文件。
- 文本文件读取由有效 shell 承担；Windows 增强路径使用 PowerShell 7。
- 图片读取与文本读取分离，统一使用 `view_image`。
- 自定义工具只应调整自己负责的内置工具名，不得意外移除其他扩展的有效工具。

## 非目标

- 不构建 `grep`、`find`、`ls` 等 shell 命令的工具包装层。
- 不提供复杂工具搜索、codegraph、web search/fetch 等独立能力。
- 不引入 hashline edit 协议或 session grounding 状态。
- 不实现通用多 shell 抽象；`pwsh` 只面向 Windows PowerShell 7。
- 不让 subagent 递归生成更多 subagent。
- 不复刻 Codex sandbox、审批策略或 unified exec 协议。

## 成功标准

- 安装一个 pi package 只加载一个扩展入口。
- Windows + pwsh 7 启动后，模型只看到 `pwsh` 而非 `bash`，且能可靠搜索、分段读文件和执行常用开发命令。
- fallback 环境仍能使用 pi 原生 `bash`，扩展不会因缺少 pwsh 而启动失败。
- 一次包含多个 replacements 的 `edit` 调用中，单个坏参数不会迫使模型重发已经成功的参数。
- 多模态与文本模型都通过同一个 `view_image` schema 读取图片，文本模型 fallback 期间用户持续看到活动状态。
- subagent 默认无配置可用；配置 advisor 后按能力动态暴露 advisor tier。
- 所有嵌套调用都传播取消、清理资源，并正确计入 usage。

