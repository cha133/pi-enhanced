# 配置与决策记录

## 配置来源

沿用 pi `SettingsManager`：

- 全局：`~/.pi/agent/settings.json`（实际路径通过 `getAgentDir()` 获取）。
- 项目：`<cwd>/.pi/settings.json`，仅在项目受信任时生效。
- 合并方式：对每个模型对象做浅合并，项目字段覆盖全局同名字段。
- 配置在调用时读取，允许不 reload 修改模型路由；模型注册表变化仍可能需要 `/reload`。

## 配置格式

```json
{
  "vision": {
    "provider": "openai",
    "model": "vision-model-id"
  }
}
```

### `vision`

- 可选；仅文本模型通过 `read` 读取图片时要求存在。
- 必须含非空字符串 `provider` 与 `model`。
- 指向的模型必须已在 pi model registry 中存在且声明 image input。

## MCP 配置

配置来源固定为：

- 全局：`~/.pi/agent/mcp.json`（实现通过 `getAgentDir()` 定位）；
- 项目：`<cwd>/.mcp.json`，仅在项目受信任时读取。

两者格式相同：

```json
{
  "mcpServers": {
    "exa": {
      "url": "https://mcp.exa.ai/mcp"
    },
    "blender": {
      "command": "uvx",
      "args": ["blender-mcp"],
      "env": {}
    }
  }
}
```

- 先读全局、再读项目；项目同名 server 完整替换全局项，不做字段深合并。
- `url` 与 `command` 必须且只能出现一个。`url` 只支持绝对 HTTP(S) Streamable HTTP endpoint。
- stdio 的 `args` 缺省为 `[]`；`env` 值必须都是字符串，并覆盖继承的 `process.env` 同名值；进程 cwd 固定为当前 Pi session cwd。
- `hint` 已移除。旧配置中的 `hint` 必须删除，否则该 server 会按不支持字段报告配置错误。
- 初版严格拒绝未支持字段；不支持 legacy SSE、headers、OAuth、`cwd` 与配置内环境变量插值。
- 文件不存在是正常状态。单个文件、server 配置或连接失败会报告路径/server，但不阻止其他合法 server。
- 配置每个 session 只读一次；修改后新开 session 生效。MCP server 自己发出的 `tools/list_changed` 仍动态生效。
- 初版不与 `pi-mcp-adapter` 协调连接所有权；若两者读取同一 `.mcp.json`，会各自连接并可能暴露重复能力，因此不应为同一配置同时启用。

### 不建议保留的配置

- 不增加 pwsh 路径配置：先自动探测；只有真实用户需求出现时再考虑 override。
- 不增加 session title 模型配置：标题固定请求第一条消息触发时的当前模型。

## 已确认决策

| ID | 决策 | 来源 |
| --- | --- | --- |
| D-001 | 项目聚焦极简有效的原生增强，不延续 `pi-extensions` 的功能堆叠目标 | 用户需求 |
| D-002 | 交付只暴露一个扩展入口 | 用户需求 |
| D-003 | Windows 且有 PowerShell 7 时提供 `pwsh` 并禁用 `bash`；否则使用原生 `bash` | 用户需求 |
| D-004 | 覆盖 `edit`，并允许批量 replacements 部分成功 | 用户需求 |
| D-005 | 单独提供 `view_image`，兼容多模态与 vision fallback（已由 D-031 取代） | 用户需求 |
| D-006 | vision fallback 期间用户可看到模型实时进展 | 用户需求 |
| D-008 | 单入口允许导入内部模块，package manifest 只暴露一个扩展入口 | 用户确认 |
| D-009 | 所有平台禁用 `read`；fallback 环境静默保留并增强原生 `bash` 的 prompt metadata（已由 D-031 取代） | 用户确认 |
| D-010 | `view_image` 使用 path/query/detail；多模态原生消费，纯文本走明确标识的外挂 vision，prompt metadata 随模型能力变化（已由 D-031 取代） | 用户确认 |
| D-011 | vision fallback 失败返回普通结果，不抛工具错误 | 用户确认 |
| D-013 | 包名 `pi-enhanced`、MIT、GitHub 直接安装；首个完成版本为 0.1.0；最低 pi 0.87.0（2026-09-22 从 0.85.1 升级） | 用户确认；用户要求跟进最新 pi |
| D-014 | edit 重叠组全部拒绝，其他正确项合并成一次原子写盘 | 用户确认 |
| D-015 | edit rejected 仅回传索引、错误信息和明确标注为不完整的有界预览 | 用户确认 |
| D-016 | vision fallback 使用紧凑单行实时状态 | 用户确认 |
| D-017 | 图片 detail 只控制分析深度；图片沿用 pi 自动等比缩放，不提供原始分辨率开关 | 用户确认 |
| D-018 | pwsh 7 加载用户 profile 并注入 `TERM=dumb` | 用户确认 |
| D-019 | edit 的参数级错误局部拒绝；即使全部 rejected 也返回普通结果，只有 I/O、取消或内部错误抛 tool error | 对齐结论 |
| D-020 | 移植 `pi-extensions` session info，在首轮固定时间与模型并跨模型切换、session resume 复用 | 用户需求 |
| D-021 | 新空会话在首条用户消息后立即异步请求当前模型生成标题；不阻塞主回答，失败不重试且不覆盖手工名称 | 用户确认 |
| D-022 | 标题跟随首条消息语言，清洗为无 Markdown/引号的纯文本并限制为 60 个 Unicode 字符；纯图片首条消息不生成 | 用户确认 |
| D-023 | fork 不请求模型；继承标题追加或递增末尾 ` (n)`，未命名 fork 保持 pi 默认名称 | 用户确认 |
| D-024 | 标题模型请求不设置输出 token 上限；对强制推理模型只用提示词与结果清洗限制最终标题长度，避免 thinking 在标题文本前耗尽请求额度 | 用户确认 |
| D-025 | MCP 初版只支持 Streamable HTTP 与 stdio，配置路径固定为全局 `~/.pi/agent/mcp.json` 和可信项目 `<cwd>/.mcp.json` | 用户确认 |
| D-026 | MCP tools 直接作为普通模型工具暴露（已由 D-037 取代） | 用户确认 |
| D-027 | MCP discovery 在 session 启动时后台执行；动态直接工具面已由 D-037 取代 | 用户确认 |
| D-029 | MCP 使用官方 TypeScript SDK，原始 inputSchema 保留于内部目录，call 前复用 Pi 的 raw JSON Schema 验证路径；不自行转换 schema | 对齐结论 |
| D-030 | MCP 模型侧文本统一限制为 50 KB / 2,000 行并把完整超限文本写入临时文件；TUI 独立折叠为 3 行/约 800 字符，展开不绕过模型侧硬上限 | 用户确认 |
| D-031 | 不再指导模型通过 shell 读取文件；以同名增强 `read` 覆盖原生工具，完整保留原生文本/图片行为，仅为纯文本模型增加 `image.query/detail` vision fallback；删除 `view_image`，且不引入 hashline | 用户确认 |
| D-032 | 标题 prompt 要求中文与英文单词之间保留一个空格；暂不增加确定性后处理，依赖当前模型遵循排版要求 | 用户确认 |
| D-033 | 临时同名覆盖 `write`，保留原生 contract，仅修复 Bun/Windows 对带只读属性现有父目录错误抛出 `EEXIST`；官方 pi 或 Bun 修复后删除该覆盖 | 用户确认 |
| D-035 | MCP client 在 `session_start` 后异步导入，避免 SDK 解析阻塞扩展加载；`PI_TIMING=1` 时额外记录 MCP 模块导入耗时 | 冷启动性能诊断 |
| D-036 | 移除低频且无法由用户即时干预的子代理工具、顾问模型配置和全部子会话适配层 | 用户需求 |
| D-037 | MCP 固定暴露 `mcp_search` / `mcp_call`，工具 schema 按需返回；轻量加权关键词搜索加完整可遍历目录兜底，无动态直接工具注册 | 用户确认 |
| D-038 | MCP 目录只读取静态配置名称与可选 `hint`，启动时固定排序；不读取服务器简介、不自动生成、不维护独立缓存，连接状态不改变 prompt（hint 部分已由 D-040 取代） | 用户确认 |
| D-039 | `/mcp-gen-hints [server]` 逐个用当前模型补齐缺失 hint，显示可取消进度，按配置来源写回并保留手工修改；新 hint 下次 session 初始化生效；简介不设字符硬上限或额外输出 token 上限，仅提取 text，不保存 thinking（已由 D-040 取代） | 用户确认 |
| D-040 | 移除 MCP hint 配置及生成命令；静态目录只显示 server 名，具体项目通过 `AGENTS.md` 等项目指令提示模型使用相关 MCP | 用户需求 |

## 待确认决策

无。实现中出现新的兼容性或产品取舍时，从 `Q-011` 继续编号。

## 决策维护

出现新的兼容性或产品取舍时，从 `Q-011` 开始记录待确认问题；确认后写为新的 `D-xxx` 或更新既有决策，并同步更新工具矩阵与行为契约。
