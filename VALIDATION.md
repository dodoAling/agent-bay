# Local verification record

Date: 2026-10-17. Host: Windows x64, Node 24.11.0, REA 6.5.0, Chrome, Rust 1.91.1.

## Settings, desktop previews, and video export (0.3.0)

- The complete automated suite passed 101 tests without failures or skips. Logs: `artifacts/settings-video-tests.txt` and `artifacts/settings-video-final-tests.txt`. New coverage includes three themed-menu interaction tests, six Settings/playback/export workflow tests, and actual WebCodecs encoding and cancellation tests. Three Rust tests cover native path handling, appearance validation, and video payload guards.
- Twenty native-layout captures at 980×720, 1366×768, 1600×1000, and 1080×1080 fill the client viewport with no outer padding, document overflow, or clipped actions. Browser recording geometry remains unchanged. Report: `artifacts/desktop-preview-layout.json`.
- The final NSIS build contains Node 24.11.0, 13 production packages and 1144 hash-verified assets. Installer: `src-tauri/target/release/bundle/nsis/Agent Bay_0.3.0_x64-setup.exe`, 26,482,938 bytes. SHA-256: `e049ecb205a755a1d04430938c293c1a2f9466e59d7f80d09b167da1e656505c`. The installer payload was extracted into a path containing spaces; its actual served HTML and application JavaScript matched the packaged manifest.
- Actual packaged WebView2 acceptance used mouse clicks on Settings and both appearance cards, retaining macOS afterward. Desktop playback filled the window, and Hide/Show restored its floating controls. A real H.264 MP4 was encoded and written through the native Save demo video dialog: 1080×1080, 30 fps, 60 frames, exactly two seconds. Saved bytes matched the encoded SHA-256. The main preview remained paused at 12000 ms. Report: `artifacts/desktop-video-native-verification.json`.
- The browser's actual Download video workflow produced the complete 24.8-second MP4: `artifacts/agent-bay-cleanroom-square-24.8s-30fps.mp4`. FFprobe confirmed H.264, 1080×1080, 30 fps and all 744 frames; a decoded 12-second cover was inspected. The paused preview retained its position, with zero browser errors and no POST requests. Report: `artifacts/demo-video-full-verification.json`.
- A controlled H.264 capability rejection also produced a valid portrait WebM: 1080×1920, VP9/VP8, three frames. Short export checks cover cancellation, removal of isolated frames, unchanged existing previews, full DOM/Canvas capture and retained simulation labels. In-app export requires WebCodecs support and renders offline at explicit timestamps; rendering time depends on the device and is shown through progress and cancellation controls.
- All native QA processes exited normally, released their ports, and left no backend process. Installer wizard/uninstall and native macOS/Linux acceptance remain outside these checks.

## Earlier desktop migration and spacing (0.2.0)

- 90 automated tests passed with no failures or skips. Log: `artifacts/desktop-tests.txt`. Five tests spawn actual desktop backend processes and verify readiness, API/SSE, model cancellation, MCP child cleanup, port release, stdin EOF, parent disappearance, staged paths, and safe startup errors.
- Two Chrome interaction tests exercise file/folder selection, cancellation, redacted native export, browser download fallback, both titlebar arrangements, minimize/maximize/restore/close routing, dragging, double-click behavior, and native appearance preference precedence and save routing.
- The prepared Windows package contains Node 24.11.0, 13 production packages, and 1132 hashed resources, including external-agent emitters and Node.js/Python examples. Asset verification imports the staged server with hooks that reject imports outside packaged resources; development dependencies are excluded. Generated resources and runtime binaries are ignored by Git.
- The square factory scene balances its actual top and bottom ink. Machines 01, 03, and 04 share a 10-logical-pixel conveyor clearance. Rejected counts sit inside the bin with eight pixels between stored slots, count glyphs, and the bin bottom; moving cards remain clear. Progress room labels have a 24-pixel right inset.
- Sixteen browser layout scenarios and all 744 canonical timestamps passed, including 45 time boundaries, independent Canvas glyph measurements, red-pixel checks, pause, seeking, and live restoration. No browser errors or preview POST requests occurred.
- Two Rust regression tests, Cargo check/build, formatting, and the release NSIS build passed. Installer: `src-tauri/target/release/bundle/nsis/Agent Bay_0.2.0_x64-setup.exe`, 26,343,114 bytes. SHA-256: `829dd7e818f9ed059c0772b82a58491f1fd0bc2247d7bd04750026fb20e14755`.
- The NSIS payload was extracted into `artifacts/desktop package 0.2.0/` and run directly, proving resource discovery from a path containing spaces. All 1132 packaged asset hashes and the bundled Node 24.11.0 hash/version matched. No installer wizard, registry installation, shortcut creation, or uninstall was exercised.
- Actual WebView2 acceptance passed for the frameless window, macOS-left/Windows-right controls, maximize/restore, minimize, close, persisted appearance loading on a fresh process/port, file selection, cancellation, folder selection, and native JSON save. Exported JSON was read back and validated. Browser errors: zero.
- The packaged app connected to actual REA, discovered 207 tools, and completed a read-only `binary_session` query. Its actual result and counts appeared in the desktop interface; preview exit restored the live session. This did not test native decompilation or a commercial model API.
- Native close exited with code 0, released the backend port, and left no backend process. Reports: `artifacts/desktop-package-verification.json` and `artifacts/desktop-debug-verification.json`. Screenshots include `desktop-titlebar-windows.png`, `desktop-titlebar-macos.png`, `desktop-native-rea.png`, and `desktop-native-preview.png`.
- macOS and Linux configuration and injected-path tests do not constitute native host acceptance; their application packages still require builds and GUI checks on those systems.

## English repository migration

Repository-authored UI, messages, documentation, examples, tests, comments, and verification scripts are maintained in English. Unicode transport fixtures retain their original characters through escape sequences. Current demo screenshots and videos are regenerated from the English interface. Older captures remain historical evidence. The source audit, 83 automated tests, 16 layout scenarios, and 744-frame timeline checks pass. The English factory export is `artifacts/promo-factory-en-square-24.8s.mp4`.

## Factory layouts and cross-platform update

- 83 automated tests passed without failures or skips. Log: `artifacts/alignment-v4-tests.txt`. Eight discovery tests cover Homebrew, system npm, nvm, custom prefixes, local installs, explicit scripts, and Windows layouts.
- `public/pixel-agent.js` generates shared SVG/Canvas geometry for the four legs, hat, facial features, pan, and palette. `build:ui` synchronizes the header SVG.
- `scripts/verify-factory-alignment.mjs` passed 16 combinations: factory/reverse scenes × square/landscape/fit/work modes × 12 seconds/end. It checks width coverage, padding, actual red counter pixels, moving-card separation, and complete action/log space. No browser errors or backend writes occurred.
- All 744 canonical timestamps and 45 boundaries passed, including pause, reverse seeking, and live restoration. Actual rejection-counter ink was checked at 0, 8, 12, and 24.7 seconds to catch counters hidden by later drawings.
- `artifacts/promo-factory-v4-square-24.8s.mp4` and its cover were exported with the updated avatar/counters: H.264, 1080×1080, 30fps, 744 frames, 24.8 seconds, limited-range BT.709, no audio.
- Node/npm startup is cross-platform. macOS/Linux discovery was verified with injected-platform paths, not actual host execution. The existing Windows REA connection and sessions were preserved.

## Work layout and result reading

- At this stage, 75 tests passed without failures, cancellations, or skips. Historical log: `artifacts/work-ui-tests.txt`.
- Thirteen result-reader tests cover provenance, coverage, reported counts, Observed/Derived/Unknown classification, truncation, preview limits, Markdown/code escaping, and safe links.
- Chrome checks verify summaries, collapsed details, raw/code copying, preserved DOM/expanded state/scroll position during incoming events, and no horizontal overflow at widths 1920, 1366, and 390.
- Final layout captures: `work-ui-final-1600.png`, `work-ui-final-1366.png`, and `work-ui-final-390.png`. At 1366×768 the result panel is 264px high with a 201px reading area and no outer workspace scroll. Measurements: `work-ui-final-layout.json`.
- Three actual SSE lifecycle tests cover waiting, execution, completion, failure, cancellation, disconnect/reconnect, and reduced motion. Failed/cancelled runs retain actual pending counts.
- An existing real `inspect_managed_members` result was reused without repeating analysis. Calls/success/pending/errors remained 1/1/0/0. Detail selection, export, and preview restoration passed without browser errors. Report: `reliability-real-rea-ui.json`.
- The 744-point preview regression also checks geometry, ending/reset behavior, existing scenes, and absence of model/tool POST or media requests.

## Initial integration

- Six initial tests covered authentication, cross-site restrictions, secret redaction/removal, fragmented SSE, Chat Completions/Messages tool loops, cancellation, truncation, and interrupted streams.
- A real browser connected to REA, discovered 207 tools, and successfully called `binary_session`. Inputs and actual results were visible.
- The SDK connected through the MCP proxy, listed 207 tools, and called `binary_session`; the dashboard received external tool events. Existing client configuration was not modified.
- A local protocol fixture requested a real REA tool call; the dashboard returned its result and displayed the fixture's streaming response. Two requests, one successful call, and fixture-reported usage were verified.
- JSON export contained actual tool results and no test API key.
- Desktop and 390px mobile layouts had no script errors or horizontal overflow.
- The PowerShell 5 launcher handled files without a BOM and found Node 24 through persistent NVM settings despite an older Node 25 PATH entry.

`artifacts/demo.png` is a labeled simulated capture. `rea-live.png` shows a real REA status query. `model-protocol-fixture.png` combines a local protocol fixture's response/usage with an actual REA result.

These checks did not use a commercial model account, analyze a user-selected target, validate native analysis engines, or configure client-specific hooks.

## Simulation controls

- The initial simulation upgrade raised the suite to eight tests covering closed event lifecycles, consistent scene counts, and virtual-time controls.
- Pause/resume, speed, restart, seeking to completion, control visibility, and live restoration passed browser checks.
- Square 1080×1080, landscape 1920×1080, portrait 1080×1920, and mobile previews had no overflow or script exceptions.
- Simulations generated no model/tool POST requests and left backend state unchanged.
- Recording mode retained DEMO and SIMULATED labels.
- Initial 30-second, 15fps H.264 square/portrait videos and covers were verified without audio.

## Factory composition and motion

- Titlebar, metrics, tool feed, signals, pipeline, progress, room actions, and two-line log were arranged as a complete terminal interface.
- The square window begins at (36,36), measures 1008×1008, and uses a 300px sidebar. The factory, progress, and action sections use distinct height budgets.
- Canvas motion includes scanning, scrolling instructions, cards, rollers, gears, scales, rejection indicators, source stacks, notes, and a matrix.
- Failure callouts at 8 and 15.2 seconds were checked. Matching virtual timestamps render deterministically; pause, seek, restart, and export share one clock.
- Square, landscape, portrait, and mobile captures were checked. Portrait keeps the 300px sidebar in the square composition.
- Real REA was reconnected: 207 tools and a successful `binary_session` call, with 1 call, 1 success, 0 pending, and no browser errors.
- The next square/portrait exports used H.264 at 30fps for 30 seconds and were retained separately from the earlier 15fps files.

## 744-frame timeline

- Measurements and methods are stored in `artifacts/REFERENCE-ANALYSIS.md` and the frame/motion JSON reports.
- The independent `cleanroom` preset follows read/matched/open/day/rejected/runtime/source-stack trajectories and preserves two matching-count reversals. Other scenes use their own event counts.
- Conveyor timing uses a 0.968-second beat: 0.480-second dwell, 0.488-second eased movement, approximately 87px per station. Source rotation, rejection arcs, matrix scans, callout transitions, and ending queue drain use virtual time.
- `scripts/verify-reference.mjs` validates all canonical samples, boundaries, pause, backward seeking, old scenes, and exit restoration. Window: 1008×1008; sidebar: 300px; Canvas: (348,266), 684×395; progress y661; actions y801.
- At that historical stage, nine tests passed and the existing REA connection was preserved.
- `promo-factory-v3-final-square-24.8s.mp4` used H.264, 30fps, 744 frames, 24.800 seconds, and limited-range BT.709.
- The local comparison page was checked for synchronized playback and seeking at 0, 18, and 24.7667 seconds. The application itself renders Canvas/DOM.

## Reliability and controlled-target evidence

- Lifetime counts survive detail trimming. Both model protocols reject incomplete JSON/SSE responses. Proxy events can be retried with stable IDs and server deduplication.
- At that stage all 58 tests passed. Log: `artifacts/reliability-test-output.txt`. Chrome coverage includes 5001 deltas, refresh, forced SSE reconnect, session switching, Canvas counts, and demo isolation.
- Actual proxy subprocess checks cover offline execution, byte-transparent transport, three lost acknowledgements, and idempotent retransmission. An overflow run returned all 180 tool calls, explicitly reported 32 lost telemetry events, and ended correctly after recovery.
- `scripts/verify-rea-managed.mjs` performed 18 real REA assertions against a controlled .NET 10 DLL. Digest, metadata, methods, CIL, call edges, constants, and strings are recorded in `artifacts/managed-acceptance-fixture/REPORT.md`.
- The updated UI on 4319 displayed actual managed-member results, 1/1/0/0 call statistics, export, and preview restoration. Reports: `reliability-real-rea-ui.json` and its PNG.
- This Codex session manually reported `inspect_managed_native_boundaries` and a public conclusion through the external event API. Report: `codex-external-live-ui.json`. This is separate from automatic hooks or a built-in model API acceptance test.
- The old 4318 process/session was preserved. Automatic approval review rejected process-management operations; the updated 4319 server runs in a managed foreground terminal.
- Real model credentials, a user-selected target, native decompilation, target execution, persistent storage, professional graphs, and full history reading remain outside the validated scope.
