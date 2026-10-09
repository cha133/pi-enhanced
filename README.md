# pi-enhanced

`pi-enhanced` is a single-entry pi package that keeps pi's native tool surface small while improving file reading and writing, batch editing, and image inspection.

Requires pi `1.1.0` or newer.

## Tools

| Tool | Behavior |
| --- | --- |
| `pwsh` | On Windows with PowerShell 7, replaces `bash`; loads the user profile, injects `TERM=dumb`, and includes PowerShell and ripgrep guidance. |
| `bash` | On other systems, keeps pi's native execution and adds ripgrep workflow guidance. |
| `read` | Replaces pi's reader while preserving native text pagination, image processing, and rendering; text-only models transparently delegate image inspection to the configured vision model. |
| `write` | Temporarily replaces pi's writer with its native contract plus a Bun/Windows workaround for existing read-only parent directories. |
| `edit` | Replaces pi's edit with partial-success batch replacement. Valid disjoint entries are applied atomically; invalid and overlapping entries are returned by index with bounded previews. |

The built-in `read` and `write` names remain active and are overridden by enhanced definitions. The `write` override is a temporary compatibility fix and should be removed once pi or Bun handles recursive creation of existing read-only Windows directories correctly. There is no separate image-viewing tool.

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

No configuration is required for shell, edit, or multimodal image inspection. The optional vision route lives at the top level of `~/.pi/agent/settings.json`:

```json
{
  "vision": {
    "provider": "openai",
    "model": "image-capable-model-id"
  }
}
```

Trusted projects may override individual fields in `.pi/settings.json`.

- `vision` is required only when the current model cannot consume images. It must resolve to an image-capable model already registered in pi.

## Built-in MCP

MCP is managed by pi itself. This package no longer registers `mcp_search` / `mcp_call`, opens MCP connections, or renders historical MCP tools. It preserves active tools owned by pi and other extensions, including codemode and tool search.

Existing `~/.pi/agent/mcp.json` configurations with `mcpServers` work unchanged. Move legacy project `.mcp.json` entries to `.pi/mcp.json` (merge existing entries carefully). Project configuration still requires trust. Remove instructions that call the old tools and use pi's built-in MCP discovery/calls instead.

Pi defaults servers to `codemode` exposure and automatically activates codemode when they connect. Use `/mcp` to inspect servers and `pi mcp list` to verify connections; run `/reload` after configuration changes. See pi's bundled `docs/mcp.md` for exposure, OAuth, and resource support.

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
