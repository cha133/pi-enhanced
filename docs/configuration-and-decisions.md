# 配置与决策记录

## 配置

本包没有专用模型路由配置。`read` 直接使用 pi 原生工具，图片自动缩放等设置由 pi 管理。原全局或可信项目 settings 中的顶层 `vision` 已不再被本包读取或校验，可删除；本次变更不修改用户配置文件。

## MCP 配置

从 pi 1.1.0 起由内置 MCP 扩展管理：全局仍为 `~/.pi/agent/mcp.json`，可信项目改为 `<cwd>/.pi/mcp.json`。原全局 `mcpServers` 中的 HTTP `url` 与 stdio `command/args/env` 可直接沿用；本包不再读取或验证这些配置。旧项目 `.mcp.json` 需合并迁入新路径。

默认 `codemode` exposure 与自动启用由 pi 管理；也可通过 pi 的 `/mcp` 选择 `direct` / `deferred`。本包不覆盖内置 MCP 或额外维护迁移器。旧 `mcp_search` / `mcp_call` 提示需要更新，历史调用不再有本包的专用渲染器。

### 不建议保留的配置

- 不增加 PowerShell 路径配置：直接沿用 pi 原生 PATH 解析，7 优先、5.1 fallback。
- 不增加 session title 模型配置：标题固定请求第一条消息触发时的当前模型。

## 已确认决策

| ID | 决策 | 来源 |
| --- | --- | --- |
| D-001 | 项目聚焦极简有效的原生增强，不延续 `pi-extensions` 的功能堆叠目标 | 用户需求 |
| D-002 | 交付只暴露一个扩展入口 | 用户需求 |
| D-003 | Windows 且有 PowerShell 7 时提供 `pwsh` 并禁用 `bash`；否则使用原生 `bash`（已由 D-046 取代） | 用户需求 |
| D-004 | 覆盖 `edit`，并允许批量 replacements 部分成功 | 用户需求 |
| D-005 | 单独提供 `view_image`，兼容多模态与 vision fallback（已由 D-031 取代） | 用户需求 |
| D-006 | vision fallback 期间用户可看到模型实时进展（read 相关部分已由 D-043 取代） | 用户需求 |
| D-008 | 单入口允许导入内部模块，package manifest 只暴露一个扩展入口 | 用户确认 |
| D-009 | 所有平台禁用 `read`；fallback 环境静默保留并增强原生 `bash` 的 prompt metadata（已由 D-031 取代） | 用户确认 |
| D-010 | `view_image` 使用 path/query/detail；多模态原生消费，纯文本走明确标识的外挂 vision，prompt metadata 随模型能力变化（已由 D-031 取代） | 用户确认 |
| D-011 | vision fallback 失败返回普通结果，不抛工具错误（read 相关部分已由 D-043 取代） | 用户确认 |
| D-013 | 包名 `pi-enhanced`、MIT、GitHub 直接安装；首个完成版本为 0.1.0；最低 pi 1.1.0（2026-10-09 升级） | 用户确认；用户要求跟进最新 pi |
| D-014 | edit 重叠组全部拒绝，其他正确项合并成一次原子写盘 | 用户确认 |
| D-015 | edit rejected 仅回传索引、错误信息和明确标注为不完整的有界预览 | 用户确认 |
| D-016 | vision fallback 使用紧凑单行实时状态（read 相关部分已由 D-043 取代） | 用户确认 |
| D-017 | 图片 detail 只控制分析深度；图片沿用 pi 自动等比缩放，不提供原始分辨率开关（read 相关部分已由 D-043 取代） | 用户确认 |
| D-018 | pwsh 7 加载用户 profile 并注入 `TERM=dumb`（已由 D-046 取代） | 用户确认 |
| D-019 | edit 的参数级错误局部拒绝；即使全部 rejected 也返回普通结果，只有 I/O、取消或内部错误抛 tool error | 对齐结论 |
| D-020 | 移植 `pi-extensions` session info，在首轮固定时间与模型并跨模型切换、session resume 复用（模型注入与提示词注入方式已由 D-045 取代） | 用户需求 |
| D-021 | 新空会话在首条用户消息后立即异步请求当前模型生成标题；不阻塞主回答，失败不重试且不覆盖手工名称 | 用户确认 |
| D-022 | 标题跟随首条消息语言，清洗为无 Markdown/引号的纯文本并限制为 60 个 Unicode 字符；纯图片首条消息不生成 | 用户确认 |
| D-023 | fork 不请求模型；继承标题追加或递增末尾 ` (n)`，未命名 fork 保持 pi 默认名称 | 用户确认 |
| D-024 | 标题模型请求不设置输出 token 上限；对强制推理模型只用提示词与结果清洗限制最终标题长度，避免 thinking 在标题文本前耗尽请求额度 | 用户确认 |
| D-025 | MCP 初版只支持 Streamable HTTP 与 stdio，配置路径固定为全局 `~/.pi/agent/mcp.json` 和可信项目 `<cwd>/.mcp.json`（MCP 部分已由 D-042 取代） | 用户确认 |
| D-026 | MCP tools 直接作为普通模型工具暴露（已由 D-037 取代）（已由 D-042 取代） | 用户确认 |
| D-027 | MCP discovery 在 session 启动时后台执行；动态直接工具面已由 D-037 取代（已由 D-042 取代） | 用户确认 |
| D-029 | MCP 使用官方 TypeScript SDK，原始 inputSchema 保留于内部目录，call 前复用 Pi 的 raw JSON Schema 验证路径；不自行转换 schema（已由 D-042 取代） | 对齐结论 |
| D-030 | MCP 模型侧文本统一限制为 50 KB / 2,000 行并把完整超限文本写入临时文件；TUI 独立折叠为 3 行/约 800 字符，展开不绕过模型侧硬上限（已由 D-042 取代） | 用户确认 |
| D-031 | 不再指导模型通过 shell 读取文件；以同名增强 `read` 覆盖原生工具，完整保留原生文本/图片行为，仅为纯文本模型增加 `image.query/detail` vision fallback；删除 `view_image`，且不引入 hashline（read 相关部分已由 D-043 取代） | 用户确认 |
| D-032 | 标题 prompt 要求中文与英文单词之间保留一个空格；暂不增加确定性后处理，依赖当前模型遵循排版要求 | 用户确认 |
| D-033 | 临时同名覆盖 `write`，保留原生 contract，仅修复 Bun/Windows 对带只读属性现有父目录错误抛出 `EEXIST`；官方 pi 或 Bun 修复后删除该覆盖（已由 D-044 取代） | 用户确认 |
| D-035 | MCP client 在 `session_start` 后异步导入，避免 SDK 解析阻塞扩展加载；`PI_TIMING=1` 时额外记录 MCP 模块导入耗时（已由 D-042 取代） | 冷启动性能诊断 |
| D-036 | 移除低频且无法由用户即时干预的子代理工具、顾问模型配置和全部子会话适配层 | 用户需求 |
| D-037 | MCP 固定暴露 `mcp_search` / `mcp_call`，工具 schema 按需返回；轻量加权关键词搜索加完整可遍历目录兜底，无动态直接工具注册（MCP 部分已由 D-042 取代） | 用户确认 |
| D-038 | MCP 目录只读取静态配置名称与可选 `hint`，启动时固定排序；不读取服务器简介、不自动生成、不维护独立缓存，连接状态不改变 prompt（hint 部分已由 D-040 取代）（MCP 部分已由 D-042 取代） | 用户确认 |
| D-039 | `/mcp-gen-hints [server]` 逐个用当前模型补齐缺失 hint，显示可取消进度，按配置来源写回并保留手工修改；新 hint 下次 session 初始化生效；简介不设字符硬上限或额外输出 token 上限，仅提取 text，不保存 thinking（已由 D-040 取代）（已由 D-042 取代） | 用户确认 |
| D-040 | 移除 MCP hint 配置及生成命令；静态目录只显示 server 名，具体项目通过 `AGENTS.md` 等项目指令提示模型使用相关 MCP（MCP 部分已由 D-042 取代） | 用户需求 |
| D-042 | 删除本包全部 MCP 实现、依赖和专用测试，迁移到 pi 内置 MCP；全局配置沿用，项目改用 `.pi/mcp.json`；最低 pi 1.1.0 | 用户要求；2026-10-09 |
| D-043 | 移除纯文本模型读图兼容、vision 路由配置、流式进度与 image.query/detail；删除同名 read 覆盖及模型切换刷新，直接使用 pi 原生 read 并保留其启用状态 | 用户需求；2026-10-09 |
| D-044 | Windows 上 Bun 1.4.2 实测未复现只读目录 recursive mkdir 的 EEXIST；删除临时 write 覆盖、注册代码及专用兼容测试，恢复 pi 原生 write 并保留其启用状态 | 用户确认；2026-10-09 |
| D-045 | session info 改用 pi 1.1.0 的可变 `systemPromptOptions.sections.session_info` 注入，仅保留首轮固定时间与时区，移除首轮模型；恢复旧 entry 时保留原始时间但不注入模型文本，不改写历史数据 | 用户要求；2026-10-09 |
| D-046 | 改用原生 powershell 同名适配：按标准顺序显式加载 profiles、注入 TERM=dumb；Windows 自动只启用 powershell，非 Windows 自动只启用 bash，停用旧 pwsh；允许原生 7 优先/5.1 fallback，默认补充 5.1 兼容语法与 rg 搜索指导（语法指导已由 D-047 取代），保留其他工具状态 | 用户要求；2026-10-09 |
| D-047 | 按原生选择的 PowerShell 实际主版本分别注入指导：7+ 使用 && / ||，5.1 使用显式条件检查；标准引用及 rg 指导共用。初始化查询进程 timeout 5 秒且无 profile；成功/失败缓存于扩展实例，reload 后重新探测；失败不阻断工具，使用明确版本未知的兼容指导 | 用户要求；2026-10-09 |
| D-048 | PowerShell 的可执行文件、启动参数与版本在初始化时一起缓存，后续调用固定执行该文件；description/snippet/guidelines 同步明确实际版本与语法，不再描述可能 fallback。原生 operations 不支持固定路径，最小适配其进程生命周期并记录 pi 1.1.0 来源；profile/TERM、流式/超时/取消/进程树清理与原生 renderer/schema 保留 | 用户报告会话版本漂移；2026-10-09 |
| D-049 | 补强 PowerShell 引用指导：JSON 编码一次、单引号加倍、双引号反引号转义、避免嵌套插值/内联脚本，并区分原生命令参数层；破坏性文件操作须验证最终绝对路径、使用 LiteralPath、显式失败中止、不跨 shell 删除（文件操作指导已由 D-050 取代）。属于 prompt 指导，不自动改写命令或宣称强制安全拦截 | 用户报告两条 session 引号错误与删除风险；2026-10-09 |
| D-050 | 文件操作指导缩为一条：删除/移动使用 LiteralPath，递归删除检查解析后的目标位于预期目录内，验证失败停止；移除泛化危险措辞与版本指导中的重复强调，避免普通能力问答带出安全承诺，保留引用与版本语法指导 | 用户报告问候 session 出现危险操作声明并确认调整；2026-10-10 |

## 待确认决策

无。实现中出现新的兼容性或产品取舍时，从 `Q-011` 继续编号。

## 决策维护

出现新的兼容性或产品取舍时，从 `Q-011` 开始记录待确认问题；确认后写为新的 `D-xxx` 或更新既有决策，并同步更新工具矩阵与行为契约。
