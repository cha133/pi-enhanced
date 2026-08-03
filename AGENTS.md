# AGENTS.md

## Project overview

`pi-enhanced` is a TypeScript pi package with one public extension entry point. It replaces or augments pi's shell, edit, image, and delegation tools while preserving a minimal active tool surface. The supported pi baseline is `0.83.0`.

Read `docs/README.md` first, then open only the design document relevant to the task. Treat `docs/tool-specs.md` as the behavioral contract and `docs/configuration-and-decisions.md` as the record of accepted product decisions.

## Repository layout

- `extensions/pi-enhanced.ts`: the only public extension entry point.
- `extensions/lib/`: internal implementations. Do not expose these files as additional package entries.
- `tests/`: Bun tests, generally mirroring the modules in `extensions/lib/`.
- `docs/`: durable product, architecture, contract, decision, and verification documentation.

## Working rules

- Preserve the single-entry package surface declared in `package.json`.
- Keep `read` active as a same-name override of pi's native reader, adding only automatic vision fallback for text-only models. Do not add hashline behavior or a separate `view_image` tool.
- Compute active tools from the existing active set and preserve tools registered by other extensions.
- On Windows, expose `pwsh` only when PowerShell 7 is found; otherwise preserve the enhanced native `bash` path.
- Preserve `edit` partial-success semantics: classify replacements against one snapshot, reject every member of an overlap group, and commit accepted edits in one write.
- Propagate cancellation and usage through nested vision and subagent calls, clean up resources in all terminal paths, and keep live progress compact.
- Do not allow child agents to register `subagent` recursively.
- Keep TypeScript strict and follow the existing tab-indented source style.
- Update the relevant durable documentation whenever behavior, configuration, architecture, or a recorded decision changes. Do not recreate `.agents/docs`; use temporary task notes outside the committed documentation when needed.

## Validation

Run the checks appropriate to the change, using the full set before release-oriented work:

```bash
npm run typecheck
npm test
npm pack --dry-run
```

Add or update focused Bun tests for behavior changes. Tests must not depend on user credentials or external model access unless the task explicitly concerns manual acceptance.
