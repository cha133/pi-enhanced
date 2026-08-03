# pi-enhanced

`pi-enhanced` is a single-entry pi package that keeps pi's native tool surface small while improving file reading, batch editing, image inspection, focused delegation, and direct MCP tool access.

Requires pi `0.83.0` or newer.

## Tools

| Tool | Behavior |
| --- | --- |
| `pwsh` | On Windows with PowerShell 7, replaces `bash`; loads the user profile, injects `TERM=dumb`, and includes PowerShell and ripgrep guidance. |
| `bash` | On other systems, keeps pi's native execution and adds ripgrep workflow guidance. |
| `read` | Replaces pi's reader while preserving native text pagination, image processing, and rendering; text-only models transparently delegate image inspection to the configured vision model. |
| `edit` | Replaces pi's edit with partial-success batch replacement. Valid disjoint entries are applied atomically; invalid and overlapping entries are returned by index with bounded previews. |
| `subagent` | Runs isolated peer/advisor child sessions with the effective platform toolset, compact live status, cancellation, usage accounting, and transcript export. |
| `mcp_<server>_<tool>` | Exposes every discovered MCP tool directly to the model. The initial release supports Streamable HTTP and stdio servers; child agents reuse the parent's connections. |

The built-in `read` name remains active and is overridden by the enhanced reader. The built-in `write` tool remains active, and there is no separate image-viewing tool.

The extension also records the first user message's timestamp and first-turn model as fixed session metadata. It reuses that same information after later model switches and when the session is resumed.

For a new empty session, the first text prompt immediately starts a non-blocking request to the current model for a concise session name. Manual names are never overwritten, failures and pure-image prompts keep pi's default name, and forks increment an inherited trailing ` (n)` suffix without another model request.

## Install

From GitHub:

```bash
pi install git:github.com/cha133/pi-enhanced
```

From a local checkout:

```bash
pi install /absolute/path/to/pi-enhanced
```

The package manifest exposes only `extensions/pi-enhanced.ts`; its internal modules are not separate extension entry points.

## Configuration

No configuration is required for shell, edit, peer subagents, or multimodal image inspection. Optional model routes live at the top level of `~/.pi/agent/settings.json`:

```json
{
  "vision": {
    "provider": "openai",
    "model": "image-capable-model-id"
  },
  "advisor": {
    "provider": "anthropic",
    "model": "higher-capability-model-id"
  }
}
```

Trusted projects may override individual fields in `.pi/settings.json`.

- `vision` is required only when the current model cannot consume images. It must resolve to an image-capable model already registered in pi.
- `advisor` is optional. The advisor tier appears only when the configured model exists and differs from the current model.
- Peer subagents always inherit the current model and thinking level.

MCP servers use a separate `mcpServers` configuration. Global servers live in `~/.pi/agent/mcp.json`; trusted projects may add or replace servers by name in `<project>/.mcp.json`:

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

An entry must contain exactly one of `url` or `command`. HTTP URLs use Streamable HTTP; the initial release does not fall back to legacy SSE or implement OAuth/headers. For stdio, `args` and string-valued `env` are optional, configured environment variables override inherited process variables, and the process runs in the Pi session cwd. Project entries fully replace same-named global entries. Configuration is read once per session; restart or open a new session after editing it.

MCP discovery starts in the background and never delays the first user prompt. Tools that finish loading before a request are available to that request; later arrivals are added on the following model request. Tool-list change notifications refresh the direct tool surface dynamically.

Model-facing MCP text is capped across all returned text blocks at 50 KB or 2,000 lines. Oversized text keeps a head preview and an explicit truncation notice; the complete text is written to a private system-temporary file. Image blocks pass through separately. In the TUI, results are independently collapsed to three output rows and roughly 800 source characters until expanded with `Ctrl+O`.

This MCP client replaces the need for `pi-mcp-adapter` for the supported transports. Do not point both extensions at the same `.mcp.json`: each would open its own connection or stdio process and expose duplicate capabilities.

## Image behavior

`read` keeps pi's native `path`, `offset`, and `limit` parameters and adds optional image guidance:

```ts
{
  path: string;
  offset?: number;
  limit?: number;
  image?: {
    query?: string;
    detail?: "brief" | "standard" | "detailed";
  };
}
```

`image.detail` controls analysis depth, not image resolution. Both direct and delegated paths use pi's automatic aspect-ratio-preserving image resize setting; the tool does not expose an original-resolution mode. Text reads retain native pi behavior without hashline formatting.

For a text-only current model, the result is explicitly described as delegated evidence from the configured vision model. The TUI shows a throttled single-line thinking/reply status while that nested request streams.

## Edit behavior

Every `edits[]` entry is matched against one original file snapshot. Empty, missing, duplicate, no-op, and overlapping entries are rejected independently. Every member of an overlap group is rejected; all remaining entries are merged into one atomic write.

Rejected results include the original array index, an error code/message, and an explicitly incomplete bounded preview. They do not repeat full `oldText` or `newText`; retry only rejected indexes after reviewing the applied diff.

## Development

```bash
npm install
npm run typecheck
npm test
```

The current release is `0.1.0`.
