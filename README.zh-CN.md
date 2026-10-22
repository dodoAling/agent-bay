# Agent Bay

**中文** | [English](README.md) · **[github.com/dodoAling/agent-bay](https://github.com/dodoAling/agent-bay)**

[![GitHub stars](https://img.shields.io/github/stars/dodoAling/agent-bay?style=flat&color=5d95f2)](https://github.com/dodoAling/agent-bay/stargazers)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-9aa7bd)](https://github.com/dodoAling/agent-bay)

Agent Bay 把 AI 智能体看不见的工作过程变成一块实时的"任务控制屏"：模型逐字输出、每一次工具调用的入参与结果、任务流水线逐轮推进——全部在本地、你自己的机器上。

它能做什么：

- **看智能体干活** —— 接一个模型 API（Chat Completions 或 Anthropic Messages）加上 MCP 工具，跑一个任务，逐轮看到推理、工具调用与结果。
- **驱动 REA** —— 从仪表盘直接使用 REA 的逆向工程工具，有没有模型账号都行。
- **观察外部智能体** —— 把内置 MCP 代理挡在现有服务器前面，或让任意语言的智能体 POST 事件进来，Codex 等客户端的活动实时上屏。
- **录成视频** —— 内置演示场景一键导出 MP4（方形 / 横版 / 竖版），数据为模拟，发文档和社媒都能用，无需 API key。

支持 Windows、macOS、Linux。密钥、任务与历史只存在本地服务器内存中，不出这台机器。

## 界面截图

![接入 REA 的实时任务界面：左侧为工具调用，中间是 context-model-tools-result 流水线，右侧为事件记录](docs/media/rea-live.png)

| 待机工作台 | 方形演示 | 竖版演示 | 外观设置 |
| --- | --- | --- | --- |
| ![等待首个工具调用的待机工作台](docs/media/standby.png) | ![方形比例演示预览，模拟调用数据](docs/media/preview-square.png) | ![竖版比例演示预览](docs/media/preview-portrait.png) | ![窗口控制选择卡的外观设置页](docs/media/settings-appearance-compact.png) |

## 演示视频

<video src="docs/media/agent-bay-cleanroom-square-24.8s-30fps.mp4" poster="docs/media/agent-bay-cleanroom-square-24.8s-30fps-cover.png" controls muted width="540"></video>

[播放洁净室演示](docs/media/agent-bay-cleanroom-square-24.8s-30fps.mp4) —— 24.8 秒、30 fps、方形 1080×1080、无音频。全部数据为模拟；参见[推广预览](#推广预览)实时运行。

## 启动

需要 Node.js 24.x 24.11 或更新版本。任意受支持的操作系统上：

```sh
cd /path/to/agent-bay
npm install
npm start
```

打开 http://127.0.0.1:4318。按 Ctrl+C 停止。macOS 或 Linux 上可用 `PORT=4319 npm start` 换端口。

Windows 上也可以双击 `start.cmd`，或运行：

```powershell
cd D:\src\dodoaling\code\agent-bay
.\start.ps1
```

Windows 启动器会安装缺失的依赖，并在配置了 NVM_SYMLINK 时使用它。默认端口被占用时用 `./start.ps1 -Port 4319`。应用要求 Node 22.19 或更高；REA 及其分析引擎有各自的依赖要求。

## 桌面应用

桌面版使用 Tauri 2 窗口和内置的 Node.js sidecar，运行同一套仪表盘与本地后端。它在自动分配的端口上启动自己的回环服务器，并在应用内打开该地址。与浏览器模式的服务及其会话相互独立；`npm start` 仍然可用。

窗口以 1200 × 800 逻辑像素居中打开，不超过主显示器可用工作区的 90%。显示缩放、任务栏或 Dock 占用的空间都计算在内。较小的显示器上最小尺寸也会相应调整，保证窗口留在可用空间内。

无边框窗口使用与仪表盘一致的标题栏。打开 **Settings → Appearance**，点击 **Windows** 或 **macOS** 选择卡，即可在右侧控制按钮与左侧红绿灯之间即时切换。初始布局跟随宿主平台；偏好保存在桌面应用的配置目录中，重启后恢复。最小化、最大化/还原、关闭控制原生窗口。拖动标题栏空白处移动窗口，双击最大化或还原。浏览器模式保留普通浏览器窗口。

已安装的桌面构建包含 Node.js 与服务器的生产依赖。REA、其他 MCP 服务器和分析引擎需要单独安装。桌面模式下，自定义 MCP 命令写 `node` 或 `node.exe` 会使用内置运行时；显式写可执行文件路径则按所配置的含义生效。

安装目录的 `resources/server/` 还包含 `scripts/emit.mjs`、`scripts/mcp-proxy.mjs` 以及 Node.js/Python 事件示例。将 `AGENT_BAY_URL` 设为桌面应用当前的回环源（不带 `/api/events`），`AGENT_BAY_BRIDGE_TOKEN` 设为当前 token。Windows 上系统没有 Node.js 时，桌面可执行文件旁的 `agent-bay-node.exe` 可以运行这些 Node.js 辅助脚本。

目标字段旁的 **Browse file** 和 **Browse folder** 打开原生选择对话框。**Export** 打开原生 JSON 保存对话框；浏览器模式则是下载。取消对话框会保留当前目标或会话。桌面导出最大 32 MiB。

关闭应用会停止其后端、中断进行中的模型请求、关闭持有的 MCP 连接和子进程。桌面父进程消失时后端也会退出。模型/MCP 设置、API 密钥、任务和事件历史只保存在内存中，后端退出即清空；需要留档请在关闭前导出会话。只有窗口外观偏好会被持久化存储。

### 开发与构建

使用 Node.js 24.x 24.11 或更新版本。桌面准备阶段接受 22.x 自 22.19、24.x 自 24.11、或 26+；拒绝 23.x 和 25.x。执行准备步骤的 Node 可执行文件会被复制进安装包，其操作系统与架构必须与 Rust 构建主机一致。

安装 Rust 1.90 或更新版本，以及对应平台的 Tauri 前置依赖：Windows 上为 Microsoft C++ Build Tools 和 WebView2，macOS 上为 Xcode Command Line Tools，Linux 上为发行版的 WebKitGTK 与开发包。具体步骤见 [Tauri 官方前置要求](https://v2.tauri.app/start/prerequisites/)。

```sh
npm install
npm run desktop:dev
```

开发与发布命令会自动准备 sidecar 资源。如需单独检查已准备的运行时与生产依赖闭包：

```sh
npm run desktop:prepare
npm run desktop:check
```

检查会验证内置运行时、源码哈希、资源清单、许可证与生产 import。修改源文件后请重新执行准备步骤。如果你的 Node 发行版把许可证放在别处，用 `AGENT_BAY_NODE_LICENSE` 指向它的许可证文件。

用 `npm run desktop:build` 构建发布版。在对应原生主机上选择打包格式：

| 构建主机 | 包格式 | 命令 |
| --- | --- | --- |
| Windows | NSIS 安装包 | `npm run desktop:build -- --bundles nsis` |
| macOS | 应用包与 DMG | `npm run desktop:build -- --bundles app,dmg` |
| Linux | Debian 包与 AppImage | `npm run desktop:build -- --bundles deb,appimage` |

产物通常在 `src-tauri/target/release/bundle/` 下。每种操作系统与架构都应在对应机器或 CI runner 上构建；准备步骤会拒绝不同的 Rust target，而不是打进不兼容的 Node 可执行文件。系统 webview 仍是平台依赖。Windows 安装包配置为在需要时引导安装 WebView2。

0.3.0 的 Windows NSIS 包已通过原生验收：鼠标操作 Settings/样式变更、深色菜单、占满窗口的演示、浮动播放控件、真实 H.264 编码与原生视频保存、位置保持、干净退出。更早的检查还覆盖文件/文件夹对话框、JSON 导出与真实 REA 连通性。全部 101 个自动化测试与三个 Rust 回归测试通过；完整的 24.8 秒应用内 MP4 下载恰好包含 30 fps 的 744 帧。macOS 与 Linux 原生包仍需主机级验收。证据与范围见 [VALIDATION.md](VALIDATION.md)。

## 设置与菜单

从工作台工具栏打开 **Settings**。桌面应用中标题栏齿轮也打开此页面，演示播放期间同样可用。**Appearance** 包含 Windows/macOS 窗口按钮选择卡与当前启用的 Midnight 主题。**Connections** 链到现有的模型 API、MCP 工具与外部智能体对话框。演示播放之外可编辑连接。从 Settings 返回会恢复演示的播放状态。

从工具栏或 **Settings → Help & setup** 打开 **Help**，其中有模型 API、无模型的手动 REA 分析、Codex 集成三篇指南。Codex 指南根据当前运行时的地址、内置 Node 可执行文件、代理脚本与检测到的 REA 安装生成 MCP 配置。**Copy config** 会带入当前桥接 token；页面预览中它保持隐藏。安装 REA 后刷新指南，重启 Agent Bay 后更新配置。该集成上报 MCP 工具活动；Codex 的其他活动需要单独的事件。

Settings 使用紧凑头部与分组的连接行。对话框、参数字段、帮助代码块、设置内容与下拉菜单共用深色轨道上的细蓝灰滚动条。

**Appearance** 下的 **Language** 卡在工作台、演示与录制之间切换 English 和中文。选择保存在浏览器中，无需重启即生效；任何文案缺翻译时回退到英文。中文文案在 `public/i18n-zh.tsv`，每条消息一行 `english<TAB>chinese`，以英文原文为 key —— 这样 `check:english` 的字节级覆盖保持不变。

任务选择、API 协议、MCP transport、手动工具、演示选项、播放速度与视频格式使用同一套深色菜单。点击选项，或用方向键、Home/End、直接输入查找、Enter 确认。Escape 关闭菜单；点击外部同样关闭。菜单在模态对话框内可用，反映禁用与动态更新的选项，并保留表单值、change 事件与必填校验。

## 接入模型 API

1. 打开 **Connect → Model API**，选择 Chat Completions 或 Anthropic Messages。
2. 填入 base URL、模型 ID 与 API key。base URL 通常带 `/v1`；完整的 `/chat/completions`、`/messages` 端点地址也可以用。
3. 在 **MCP tools** 下连接 REA 或其他服务器，选择要暴露的工具。最多可启用 32 个工具。
4. 输入任务与可选的目标路径，启动任务。

服务器流式发出请求、执行工具、回传结果并请求下一轮响应，最多 12 轮。活动、计数、耗时与输出均来自真实事件。不支持工具调用的模型可以产出文本，但不能假定它会执行工具。只提供 Responses、原生 Gemini 或其他专有 API 的服务需要协议适配层。

Ollama 使用 `http://127.0.0.1:11434/v1` 与本地已安装的、支持工具调用的模型。无需鉴权时密钥留空。

密钥、任务、日志与配置都保存在本地服务器内存中，重启即清空。可以导出 JSON，但没有实现历史导入。保存配置不会发起付费 API 请求。连通性在任务运行时才检查。

## 没有模型账号也能用 REA

打开 **Connect → MCP tools → Connect REA**。发现逻辑会检查本地安装、Node/NVM、PATH 与 npm 前缀下的 `rea-agents/scripts/rea.mjs`，支持 Windows 的 `node_modules` 和 Unix 的 `lib/node_modules`。自定义安装位置用 `AGENT_BAY_REA_SCRIPT` 指向脚本绝对路径，或手动配置 MCP。

展开手动工具区，选择 `binary_session`，提交 `{}` 执行一次真实状态查询。它不加载也不修改目标。

原生反编译需要分析引擎。工具列表成功并不说明已安装 Hopper、Ghidra 或 IDA。

自定义 stdio 服务器接受一个可执行文件与 JSON 参数数组。Streamable HTTP 服务器接受 URL 与可选的 bearer token。stdio 命令不做 shell 字符串拼接。未内置基于 OAuth 的 MCP 授权。

## 接入已有智能体

### MCP 代理

把代理放在已有 MCP 服务器之前。它原样转发 MCP 字节，并把工具入参、结果、耗时与生命周期事件发给 Agent Bay。仪表盘不可用时工具仍可继续执行。

从 **Connect → External agent** 复制桥接 token。按你的客户端改写以下配置：

```json
{
  "mcpServers": {
    "rea": {
      "command": "node",
      "args": [
        "/absolute/path/to/agent-bay/scripts/mcp-proxy.mjs",
        "--name", "REA",
        "--",
        "node",
        "/absolute/path/to/rea-agents/scripts/rea.mjs",
        "mcp"
      ],
      "env": {
        "AGENT_BAY_URL": "http://127.0.0.1:4318",
        "AGENT_BAY_BRIDGE_TOKEN": "paste-your-bridge-token"
      }
    }
  }
}
```

替换 `--` 之后的命令即可观察其他服务器。Windows 上使用与安装一致的路径，例如 `D:/tools/node.exe`。

桌面会话把示例中的 `http://127.0.0.1:4318` 换成应用当前的回环源。**Connect → External agent** 会显示端点与 token；设置 `AGENT_BAY_URL` 时不要带 `/api/events`。

代理捕获工具活动。模型文本、任务检查与其他活动需要单独的事件。它不会获取私有推理过程，也不会自动修改客户端配置。

事件按序缓冲并以指数退避重试。内存队列上限 512 条事件 / 4 MiB。关闭最多等待六秒。溢出与持续失败会上报 stderr；恢复时尝试上报缺口与任务完成。重试只重发遥测，不重新执行工具。队列不持久化。

桥接 token 在每次服务器启动时随机生成。启动前设置 `AGENT_BAY_BRIDGE_TOKEN` 可获得固定 token。不要把它提交进版本库。

### HTTP 事件与钩子

任意语言的智能体都可以提交事件：

```http
POST http://127.0.0.1:4318/api/events
Content-Type: application/json
Authorization: Bearer <bridge-token>
```

先发送 `run.start`，之后复用它的 `runId`：

```json
{"type":"run.start","runId":"my-run-001","source":"My Agent","title":"Analyze the target application","model":"your-model","target":"/path/to/sample"}
```

| 事件 | 字段 |
| --- | --- |
| `stage` | `stage`：`observe`、`reason`、`execute` 或 `verify`；可选 `message` |
| `log` | `message`；可选 `level`：`info` 或 `error` |
| `model.start` | `messageId`、`model` |
| `model.delta` | `messageId`、`text`；增量输出重复发送 |
| `model.end` | `messageId`；可选 `usage` |
| `tool.start` | `callId`、`name`、`args` |
| `tool.end` | 对应的 `callId`、`name`、`ok`、`durationMs`、`result` |
| `check` | `name`、`status`：`passed`、`failed` 或 `unknown` |
| `artifact` | `name`、`path`；显示在事件日志中 |
| `run.end` | `status`：`completed`、`failed` 或 `cancelled`；可选 `message` |

需要重试时，附带稳定 `eventId`，长度不超过 128，只允许字母、数字、连字符与下划线。重复的 ID 必须保持内容一致。服务器按来源、run 与 ID 去重，确认重复，冲突返回 HTTP 409。每个 run 的最近 4096 条确认保存在内存中。代理会自动补上 ID 与原始 `capturedAt` 时间戳。

示例使用 Node.js 或 Python 标准库：

```sh
export AGENT_BAY_BRIDGE_TOKEN='copy-from-the-dashboard'
node examples/agent-events.mjs
python3 examples/agent_events.py
```

PowerShell 中用 `$env:AGENT_BAY_BRIDGE_TOKEN = 'copy-from-the-dashboard'` 设置 token。

示例只做本地算术，不调用模型。把其中逻辑替换成你的工具。钩子可以通过 `node scripts/emit.mjs` 提交标准 JSON 事件，支持文件或 stdin。特定客户端的钩子负载需要映射到上面的 schema。

## 界面与数据

- **Demo** 提供工厂、逆向工程、编码与研究四类模拟。时长含 15、24.8、30、60 秒；格式含方形、横版、竖版与 fit。
- 模拟在本地运行，不调用模型或工具。退出后恢复实时任务。录制模式保留 DEMO 与 SIMULATED 标记。
- 浮动播放条支持暂停、倍速、进度、重播、循环、全屏与视频下载。**Hide** 收起；**Playback controls** 或按 H 唤回。
- 选择某个调用可查看摘要、provenance、覆盖率、折叠的结构化详情、原始结果与输入参数。支持复制代码/JSON 与阅读位置保持。
- 响应式实时流水线为 SOURCE → CONTEXT → TOOLS → RESULTS → SESSION。执行时有传输/扫描动画；等待时脉动。终态与断连停止动画。重连刷新快照。
- 实时图块最多呈现 24 条保留的调用。累计计数器与详情保留量相互独立。
- 模型输出支持基础 Markdown、高亮与安全链接。阅读上限为文本/原始结果 120,000 字符、每个代码块 40,000 字符。结构化预览展开三层、每个集合 20 项。省略与上游截断都会明确标注。
- 桌面演示在窗口缩放时填满可用区域，不做等比黑边。导出尺寸单独选择。浏览器方形录制使用 1008×1008 窗口与 300px 侧栏；横版/fit 布局在宽度上分配机器、传送带与矩阵，并为动作与日志预留空间。
- 支持会话切换、事件过滤与脱敏 JSON 导出。
- 检查计数只来自 `check` 事件。模型输出完成不代表测试通过。
- 服务绑定回环地址、禁止跨站访问、外部事件需要 token。
- 最多保留 100 个任务与 5000 条近期事件详情。调用、检查、token 与总事件独立累计。缺失的详情会被标出；导出包含保留元数据。没有持久存储，也没有云服务。
- 仪表盘启动的任务可以在这里停止。外部智能体仍由原客户端控制。

## 推广预览

打开 **Demo**，选择场景/时长/格式，开始播放：

- [方形逆向工程](http://127.0.0.1:4318/?preview=1&scene=reverse&duration=30&format=square)
- [双室工厂](http://127.0.0.1:4318/?preview=1&scene=cleanroom&duration=24.8&format=square)
- [竖版](http://127.0.0.1:4318/?preview=1&scene=reverse&duration=30&format=portrait)
- [横版编码](http://127.0.0.1:4318/?preview=1&scene=coding&duration=30&format=wide)

键盘：Space 暂停/继续，R 重播，F 切换全屏，H 切换控件，Esc 退出。浏览器窗口对准所选长宽比；桌面预览自动贴合应用窗口。无需 API key 或工具连接。

### 在应用内下载视频

启动演示，点击播放条上的 **↓ Video**。选择方形 **1080×1080**、横版 **1920×1080** 或竖版 **1080×1920**，以 **30 fps** 导出。webview/浏览器支持时优先 MP4 + H.264；否则依次尝试 WebM + VP9、VP8。需要 WebCodecs 支持以及所选尺寸的编码器。视频无音频，保留模拟标记。

导出在隔离的本地预览中以虚拟时间戳渲染完整场景，同时捕获界面与 Canvas 图形。不打开事件流，也不发起模型/工具调用。当前实时会话与播放状态被保留。可查看进度、可取消；渲染耗时可能超过视频播放时长。桌面应用弹出原生视频保存对话框，浏览器模式则直接下载。

这条导出路径完全离线，只用应用自带资源。运行时不需要另行安装 Chrome 或 FFmpeg。采集/编码库是开发依赖，打包成约 437 kB 的本地 JavaScript 资源；六份第三方许可证与包清单位于 `public/vendor/licenses/`。

### 命令行视频与封面

单独的命令行录制器需要 Chrome/Chromium 与 FFmpeg。先启动 Agent Bay，再运行：

```sh
npm run video -- --scene reverse --duration 30 --format square --fps 15
npm run video -- --scene cleanroom --duration 24.8 --format square --fps 30
npm run video -- --scene coding --duration 15 --format wide --fps 24
npm run video -- --scene research --duration 30 --format portrait --fps 24
```

输出为 `artifacts/promo-<scene>-<format>-<duration>s.mp4` 及配套封面。H.264 视频无音频。预设尺寸为 1080×1080、1920×1080、1080×1920。已有文件不会被覆盖；请换 `--out` 路径。

自定义路径用 `AGENT_BAY_CHROME_PATH` 与 `AGENT_BAY_FFMPEG_PATH`。其他端口传 `--url http://127.0.0.1:4319`。帧使用虚拟时间；编码耗时与播放时长不同。演示的计数与检查不度量真实模型或任务。

工厂预设使用 744 个时间采样来驱动函数数、天数、拒绝数、旗帜与运行时，包含传送带节拍、源跌落、拒绝弧线、扫描与标注。其中两处验证反转是有意为之。实时任务使用真实事件。

### 前端改动

- 修改 `public/reference-timeline.js` 或 `public/reference-factory.js` 后运行 `npm run build:reference`。
- 修改 `public/result-view.js` 或 `public/pixel-agent.js` 后运行 `npm run build:ui`。
- 工作区样式与实时渲染在 `public/factory-theme.css` 和 `public/factory-view.js`。
- Settings 样式在 `public/settings.css`；可复用深色菜单在 `public/themed-select.js` 和 `public/themed-select.css`。
- 变更浏览器采集依赖后运行 `npm run build:video`，刷新 vendored 导出资源与许可证清单。
- SVG/Canvas 头像共用几何。所有预览图形使用 Canvas/DOM。

重新构建后刷新页面即可。已运行的服务器会直接提供更新后的静态文件，无需重启。

## 验证

```sh
npm test
npm run check:english
node scripts/verify-factory-alignment.mjs
node scripts/verify-reference.mjs
```

测试覆盖鉴权、脱敏、碎片化 Unicode SSE、两种模型协议、取消、截断、长会话记账、送达恢复、结果、生命周期状态与跨平台发现。本地协议 fixture 不代表商业模型的兼容性。

英文文本检查扫描仓库自产文本，排除依赖、生成产物与译文文档。用 `npm run check:english -- --artifacts` 可包含本地文本报告。多语言传输 fixture 使用 Unicode 转义以保持字节级覆盖。

布局验证检查 16 种场景/格式/时间组合，包括宽度、工厂均衡留白、真实拒绝字形、槽位/料仓/卡片间隙、机器对齐与动作/日志空间。时间线验证检查 744 个时间戳、45 个边界、确定性暂停/定位与实时恢复。两者都需要 Chrome/Chromium；自定义路径用 `AGENT_BAY_CHROME_PATH`。

桌面测试会启动真实后端进程，走 HTTP/SSE 与 staged 资源、取消模型请求、关闭 MCP 子进程、验证端口释放，并覆盖 stdin EOF 与父进程消失。浏览器测试还覆盖两种标题栏布局、窗口控制命令、最大化状态、拖动/双击行为、原生偏好优先级与保存路由、对话框取消、脱敏导出与普通下载回退。这些测试使用原生 API 适配器，不能替代原生 GUI 与安装包验收。

主题菜单测试用真实鼠标键盘输入检查选择、输入查找、必填校验、表单序列化、动态选项、程序化赋值、重置、禁用祖先、裁剪与模态交互。视频导出检查覆盖隔离采集、受支持的编码器选择、取消与保留当前工作台；已完成的完整时长导出与原生验收见 [VALIDATION.md](VALIDATION.md)。

Windows 上检查发布版可执行文件前，请先关闭正在运行的桌面应用，然后用真实 WebView2 与受限的原生对话框自动化验证：

```sh
node scripts/verify-desktop.mjs --exe src-tauri/target/release/agent-bay-desktop.exe --package --dialogs
```

加 `--rea` 可连接已安装的 REA 服务器并执行只读的 `binary_session` 查询。原生验证检查包哈希与内置运行时，把截图和报告写到 `artifacts/` 下，然后关闭自己的应用。它不使用已有的浏览器模式服务。

`node scripts/verify-rea-managed.mjs` 单独用真实 REA 检查一个受控的 .NET 10 DLL，共 18 条断言。需要 .NET SDK/REA；安装路径可通过脚本的环境变量配置。

已在 Windows 上做过实际主机测试。macOS/Linux 的启动代码与安装路径经过了测试，但这两个操作系统还没有机器级验收。分析能力取决于已安装的引擎。

更新后的本地服务在 http://127.0.0.1:4319；更早的 4318 服务仍然可用。真实工具证据：`artifacts/reliability-real-rea-ui.json`。手动外部 Codex 接入：`artifacts/codex-external-live-ui.json`。凭据保存在所选服务器的内存中。

API 文档：[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)、[Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)、[Ollama 兼容性](https://docs.ollama.com/api/openai-compatibility)。

## 联系

- 邮箱：[dodoaling@163.com](mailto:dodoaling@163.com)
- X (Twitter)：[@DodoAling](https://x.com/DodoAling)
- 微信：`dodoaling`
- 微信公众号：`DodoAling` —— 扫码关注，或按图中所示搜索：

<img src="docs/media/wechat-mp-qr.png" alt="微信公众号二维码：扫码或在微信内搜索 DodoAling" width="420">
