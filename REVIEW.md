# Implementation review

Updated 2026-10-16. This document separates completed fixes, verified behavior, and remaining work.

## Fixed and verified

1. **Lifetime counters surviving retention.** Sessions independently accumulate calls, successes, errors, pending work, checks, tokens, and total events. The 5000-event limit applies only to details. Duplicate IDs, token accounting, refresh, SSE reconnect, session switching, Canvas summaries, and demo isolation are covered. Removed inputs/results are explicitly unavailable.
2. **Incomplete model responses failing correctly.** Chat Completions and Messages validate termination reasons consistently for JSON and SSE. Token limits, errors, filtering, and missing/unknown reasons fail explicitly. Truncated tool arguments are never executed. Nonstandard providers must report a supported termination reason; automatic `pause_turn` continuation is not implemented.
3. **Proxy telemetry recovery.** A FIFO queue retries with exponential backoff and stable event IDs. The server acknowledges/deduplicates by source, run, and ID. Actual MCP subprocess, HTTP event delivery, lost acknowledgements, and queue overflow tests confirm that retries do not re-execute tools or alter MCP stdout.
4. **Readable work layouts and results.** A responsive five-node live pipeline provides readable text and larger results. REA views show actual counts, provenance, and coverage, with collapsible structured details, raw JSON, and arguments. Markdown, highlighting, and copying work. Model deltas preserve selected tool details; updates preserve reading position.
5. **Distinct lifecycle states.** Working, waiting, completed, failed, cancelled, and disconnected states differ visually. Terminal states, disconnection, and reduced-motion settings stop Canvas animation. External silence means waiting; it does not prove that the agent process is alive.
6. **Factory preview alignment.** Landscape/fit layouts fill the available width, maintain bottom padding, show rejection counters above moving cards, and reserve room for actions and logs. The avatar uses shared SVG/Canvas geometry.
7. **Cross-platform REA discovery.** Windows Node/NVM/APPDATA layouts, Unix global npm paths, Homebrew, nvm, custom prefixes, project-local installation, and an explicit script override are supported without shell/npm subprocess discovery.

The proxy queue is limited to 512 events / 4 MiB, with room reserved for completion notices. Overflow reports losses; shutdown waits at most six seconds. Queue state and acknowledgement IDs are not persisted. Each run retains 4096 acknowledgement IDs. Recovery after permanent disconnection, restart, or capacity overflow is not guaranteed; missing telemetry cannot be used to infer actual lost calls.

## Verified integration

- 83 automated tests passed, including real Chrome checks for long sessions, result interactions, lifecycle behavior, and cross-platform discovery logic.
- 16 browser layout combinations passed; 744 preview timestamps and 45 time boundaries passed.
- Real REA statically inspected a locally compiled .NET 10 DLL with 18 passing assertions for digest, metadata, CIL, call edges, constants, and strings.
- The dashboard displayed actual DLL results, lifetime counts, and JSON export. Demo exit restored the live session without browser errors.
- This Codex session manually submitted actual REA boundary inspection events and a public conclusion through the external event API. Global Codex hooks/MCP configuration was not modified. This does not validate the dashboard's built-in model API.
- The updated service runs at http://127.0.0.1:4319. The original 4318 service and its sessions were preserved. A managed foreground process was used after automatic approval review rejected process-management operations.
- Windows received host-level testing. macOS/Linux received code and injected-path tests, not machine-level acceptance testing.

## Remaining work

1. **Real model and user-target acceptance.** No real model API is configured, common local model ports were unavailable, and no user-selected software path was supplied. Controlled DLL checks do not replace model or target acceptance. Native decompiler integration remains unverified.
2. **Persistent history and configuration.** Restart clears in-memory tasks and settings. Export exists; history import and paginated history do not. Deduplication indexes grow with calls and are released when sessions are evicted.
3. **Continuation and context budgets.** New tasks do not inherit a prior conversation. Runs are limited to 12 rounds. Large results need on-demand reading and configurable budgets.
4. **Streaming performance and agent heartbeats.** SSE disconnection is explicit and views are cached by content. Streaming model text still replaces complete blocks; very long responses would benefit from incremental rendering. External agent activity lacks heartbeat semantics.
5. **Specialized analysis views.** Summaries, paginated tables, basic Markdown, and code highlighting exist. Call graphs, control-flow graphs, evidence relationship graphs, argument forms, and task comparison do not.

See [VALIDATION.md](VALIDATION.md) for evidence and scope. Test logs and real-tool reports are under `artifacts`.
