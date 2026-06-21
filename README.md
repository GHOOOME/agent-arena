# Agent Arena

Agent Arena 是一个本机/可信局域网使用的多模型 Agent 工作台。它可以把同一个任务并发发送给多个窗口，每个窗口有独立记忆、独立模型、独立项目工作区和预览，用来对比不同模型或不同分支的实现结果。

模型调用使用阿里云 Token Plan。Token Plan 官方定位是交互式 AI 编程/Agent 工具使用，不适合公网多人服务、应用后端或自动化批量评测。请只在可信本机或局域网运行。API Key 只保存在服务端环境变量或本机私有配置文件中，不会进入浏览器 bundle。

## Features

- Work / Window / Race 工作流：一个 Work 内可创建多个独立窗口，同一任务可广播给多个窗口。
- Token Plan allowlist 模型目录和能力提示。
- 文本、推理、视觉理解模型并发流式对比。
- 每个窗口独立会话记忆，避免上下文互相污染。
- 本地项目 Agent：读取项目、创建窗口工作区、应用安全补丁、运行白名单命令、启动预览。
- Codex CLI Runtime 可选接入：使用隔离 `.codex-runtime`，模型请求仍走 Token Plan。
- 图片生成模型面板，生成图会保存到本地 `public/generated`。
- 429 限流退避重试，默认至少 4 路并发。

## Requirements

- Node.js 20 或更高版本。
- npm。
- PostgreSQL，本机或远程均可。
- 一个阿里云 Token Plan API Key。
- macOS 推荐使用，系统文件夹选择器目前只在 macOS 上启用。
- 桌面模式使用 Electron，安装依赖时会下载 Electron 二进制。
- 可选：安装 `codex` CLI 后才能使用 `Codex CLI Runtime` 窗口。

## Quick Start

安装依赖：

```bash
npm install
```

复制环境变量示例：

```bash
cp .env.example .env.local
```

编辑 `.env.local`，至少配置 `DATABASE_URL`。Token Plan API Key 可以先不写，稍后在页面里填写。

```bash
ALIYUN_TOKEN_PLAN_API_KEY=
ALIYUN_TOKEN_PLAN_BASE_URL=https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/llm_arena?schema=public
MAX_PARALLEL_REQUESTS=4
MAX_SELECTED_MODELS=6
ASSET_DIR=public/generated
```

创建 PostgreSQL 数据库。下面是一个本机示例，请按自己的用户名和密码调整：

```bash
createdb llm_arena
```

如果你没有 `createdb` 命令，也可以用 pgAdmin4 新建一个名为 `llm_arena` 的数据库，然后把 `.env.local` 里的 `DATABASE_URL` 改成对应连接字符串。

初始化 Prisma：

```bash
npm run prisma:generate
npm run prisma:migrate
```

启动本地网页服务：

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

首次进入页面后，在左侧 `本机配置` 中粘贴 Token Plan API Key，然后保存配置。页面保存的 Key 会写入 `.arena-local/config.json`，该目录已被 `.gitignore` 忽略，不应提交到仓库。

## Desktop App

开发模式下可以直接打开桌面窗口：

```bash
npm run desktop:dev
```

它会优先复用已经运行在 `127.0.0.1:3000` 的 Arena 服务；如果没有可复用服务，会自动启动一个只监听 `127.0.0.1` 的 Next 服务，并用 Electron 打开独立窗口。桌面模式复用同一套数据库、Token Plan 配置、本地 Agent 和项目工作区。

如果已经执行过 `npm run build`，也可以用生产模式启动桌面窗口：

```bash
npm run desktop:start
```

第一版桌面壳仍然需要本机 PostgreSQL 和 `.env.local` 里的 `DATABASE_URL`。后续如果要做成下载即用，可以再增加 SQLite 或内置数据库方案。

当前仓库已支持本地桌面窗口运行；生成可分发的 macOS `.app` 安装包属于下一阶段，需要再接入打包配置和签名策略。

## LAN Access

如果只在可信局域网内访问，可以这样启动：

```bash
npm run dev -- --hostname 0.0.0.0
```

然后用本机内网 IP 访问，例如 `http://192.168.x.x:3000`。

不要把这个项目直接暴露到公网。当前版本默认不带登录系统，且具备本地文件读写和命令执行能力。

## Configuration

`.env.local` 用于本机运行配置。不要把真实 `.env.local` 提交到 GitHub。

字段说明：

- `ALIYUN_TOKEN_PLAN_API_KEY`：阿里云 Token Plan API Key。可以留空，启动后在页面左侧 `本机配置` 里粘贴保存。真实 Key 不要提交到仓库。
- `ALIYUN_TOKEN_PLAN_BASE_URL`：Token Plan 的 OpenAI-compatible 接口地址。默认使用北京区域：`https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。
- `DATABASE_URL`：PostgreSQL 连接字符串，必填。项目用它保存 Work、窗口、对话记忆、工具日志、Race 记录等数据。
- `MAX_PARALLEL_REQUESTS`：同一轮 Race 最多同时运行多少个窗口请求。默认 `4`，适合同时让多个模型并发处理任务。
- `MAX_SELECTED_MODELS`：旧版多模型对比模式的单次最大模型选择数。Work/Window/Race 新流程主要受窗口数量和 `MAX_PARALLEL_REQUESTS` 影响。
- `ASSET_DIR`：生成图片、预览资产等本地文件保存目录。默认 `public/generated`，数据库只保存路径和 metadata，不保存大文件本体。

Token Plan API Key 有两种配置方式：

- 推荐：页面左侧 `本机配置` 粘贴保存。保存位置是 `.arena-local/config.json`。
- 高级：在 `.env.local` 设置 `ALIYUN_TOKEN_PLAN_API_KEY`。

页面保存的 Key 优先级高于 `.env.local`。接口只返回是否已配置和来源，不返回明文 Key。

## Project Modes

创建 Work 时可以选择：

- `新建项目`：在 `/Users/mac/Documents/arena-projects` 下创建一个 starter Next 项目。
- `打开文件夹`：用系统弹窗选择本机项目文件夹。
- `从链接导入`：从 `https://...` Git 链接克隆项目。
- `只聊天`：不绑定项目，只进行模型对话和对比。

对没有 Git 的项目，Arena 会自动创建本地版本记录和初始安全快照；窗口开发时优先使用 `git worktree`，不可用时使用过滤复制 fallback。

## Useful Commands

```bash
npm run security:check
npm run lint
npx tsc --noEmit
npm run desktop:smoke
npm run smoke:ui
npm run build
```

`npm run smoke:ui` 需要本地服务已经运行在 [http://localhost:3000](http://localhost:3000)。
`npm run desktop:smoke` 会自动启动 Electron 和本地服务，窗口加载成功后自动退出。

## Security Notes

- 不要提交 `.env`、`.env.local`、`.arena-local/`、`.codex-runtime/`、本地 Agent/编辑器目录或生成图片。
- 不要把真实 API Key 写进 README、issue、截图或示例文件。
- 开源或 push 前建议运行 `npm run security:check`。
- 本项目默认适合个人本机或可信局域网，不适合公网多人使用。
- 本地 Agent 可能读写所选项目文件，请只绑定你信任的项目。
