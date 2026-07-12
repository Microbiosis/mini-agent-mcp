# Mini Agent MCP

[![npm version](https://img.shields.io/npm/v/mini-agent-mcp.svg?style=flat-square)](https://www.npmjs.com/package/mini-agent-mcp)
[![npm downloads](https://img.shields.io/npm/dm/mini-agent-mcp.svg?style=flat-square)](https://www.npmjs.com/package/mini-agent-mcp)
[![GitHub license](https://img.shields.io/github/license/Microbiosis/mini-agent-mcp?style=flat-square)](https://github.com/Microbiosis/mini-agent-mcp/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Microbiosis/mini-agent-mcp?style=flat-square)](https://github.com/Microbiosis/mini-agent-mcp)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyTDJsMTAgOGgxMEwxMiAyem0wIDIwTDEyIDEyaDEwbDEwLThMMTIgMjJ6Ii8+PC9zdmc+)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square&logo=nodedotjs)](https://nodejs.org)

> **中文名称**: Mini Agent MCP 智能代理服务器  
> **英文名称**: Mini Agent MCP  
> **服务分类**: 搜索工具 / AI Agent / 开发者工具  
> **来源地址**: https://github.com/Microbiosis/mini-agent-mcp  
> **托管部署**: 可托管部署（无本地环境依赖，支持云端一键部署）

## 服务介绍

Mini Agent MCP 是一个集成了 ReAct 小型 Agent 的 MCP (Model Context Protocol) 智能代理服务。Agent 可以自主调用多个工具完成复杂的多步任务，支持 LLM 驱动和规则引擎两种模式。

内置 AnySearch 搜索能力 — 网页搜索、域名搜索、批量搜索、URL 内容提取。Agent 支持多模型 LLM 通信，优先使用 MCP Sampling（客户端模型），也支持 Direct HTTP 回退。

## 服务描述

基于 MCP 协议的智能代理服务器，集成了 7 个内置工具（计算器、文本分析、文本转换、单位转换、日期时间、随机生成、ReAct Agent）和 4 个 AnySearch 搜索工具。支持多步推理（最多 8 步），可自主组合调用工具完成任务。支持 MCP Sampling 多模型通信，无需服务器端 API Key 即可调用 LLM。

## ✨ 核心功能

- **🧮 内置工具** — 计算器、文本分析、文本转换、单位转换、日期时间、随机生成，共 6 个无需 API Key 的本地工具
- **🤖 ReAct Agent** — 支持 Thought → Action → Observation 多步推理循环，最多可组合调用 8 个工具步骤
- **🔍 AnySearch 搜索** — 通过 MCP Streamable HTTP 集成 AnySearch，支持通用搜索、批量搜索（1-5 并行）、URL 内容提取、垂直领域搜索
- **🔗 多模型通信** — 支持 MCP Sampling（客户端模型）和 Direct HTTP（自有 API）两种 LLM 通信方式，兼容 OpenAI / Anthropic 两种 API 格式
- **☁️ 可托管部署** — 无本地环境依赖，可一键部署到 ModelScope MCP 广场，自动生成 SSE 访问地址
- **🔁 自动重试** — 工具调用失败自动重试 3 次，指数退避（1s → 2s → 4s）

## 🚀 快速上手

### 方式 1: MCP 客户端配置（推荐）

#### ZCode

```json
{
  "mcpServers": {
    "mini-agent-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["mini-agent-mcp"],
      "env": {
        "ANYSEARCH_API_KEY": "",
        "LLM_API_FORMAT": "openai",
        "LLM_API_KEY": "",
        "LLM_BASE_URL": "",
        "LLM_MODEL": ""
      }
    }
  }
}
```

> 在 ZCode 中使用时，Agent 优先使用 MCP Sampling（ZCode 的 LLM）。配置 `LLM_*` 后可作为回退：Sampling 失败时自动切换到 Direct HTTP。

### 方式 2: .env 文件（fallback）

当 MCP 客户端不传递环境变量时，在服务器工作目录创建 `.env` 文件：

```bash
# 复制模板
cp .env.example .env

# 编辑 .env 填入值
ANYSEARCH_API_KEY=xs_xxxxx
LLM_API_KEY=lc_xxxxx
LLM_BASE_URL=https://api.longcat.chat/openai
LLM_MODEL=LongCat-2.0-Preview
```

> 服务器启动时自动读取 `.env` 文件，无需客户端传递变量。

### 方式 3: 本地开发

```bash
git clone https://github.com/Microbiosis/mini-agent-mcp.git
cd mini-agent-mcp
npm install
npm run build
node dist/index.js           # 运行 MCP 服务器
node dist/index.js --test    # 运行测试
```

## 🛠️ 工具列表

### 内置工具

| 工具名称 | 说明 | 参数 |
|----------|------|------|
| `calculator` | 安全数学表达式求值（支持 sqrt, sin, cos, pi 等） | `expression` (string, 必需) |
| `text_stats` | 文本统计分析（字数、词频、句子数等） | `text` (string, 必需) |
| `text_transform` | 文本转换（大小写、反转、排序、去重等） | `text` (string, 必需), `operation` (string, 必需) |
| `unit_convert` | 单位转换（长度、重量、温度、数据） | `value` (number, 必需), `from` (string, 必需), `to` (string, 必需) |
| `datetime_info` | 日期时间查询、格式化、差值计算 | `operation` (string, 必需) |
| `random_gen` | 随机数、UUID、密码、列表抽取 | `operation` (string, 必需) |
| `run_agent` | ReAct Agent — 自主调用上述工具完成多步任务 | `task` (string, 必需) |

### AnySearch 工具（自动发现）

启动时自动连接 `https://api.anysearch.com/mcp` 动态发现：

| 工具名称 | 说明 | 参数 |
|----------|------|------|
| `anysearch_search` | 通用搜索（支持金融、学术、法律等垂直领域） | `query` (string, 必需), `max_results` (number, 可选) |
| `anysearch_batch_search` | 1-5 个独立查询并行搜索 | `queries` (array, 必需) |
| `anysearch_extract` | URL 网页内容提取（Markdown，最多 50,000 字符） | `url` (string, 必需) |
| `anysearch_get_sub_domains` | 查询垂直领域目录（领域搜索前必须先调用） | `domain` (string, 可选) |

## 🤖 Agent 工作流程

```
用户任务 → [Thought: 分析任务]
           → [Action: 选择工具] → [执行工具] → [Observation: 观察结果]
           → [Thought: 继续推理]
           → ... (最多 8 步)
           → [Final Answer: 最终答案]
```

## 📡 LLM 通信模式

Agent 支持三种 LLM 通信方式，**按优先级自动选择**：

### 方式 1: MCP Sampling（推荐）

服务器通过 MCP 协议的 `sampling/createMessage` 请求，让**客户端（如 ZCode / Claude Desktop / Cursor）**代为调用 LLM。

- **零配置** — 服务器不需要 API Key，不需要知道模型名称
- **客户端决定模型** — 客户端使用用户选择的模型
- **支持多模型通信** — 客户端可以灵活选择不同的模型进行推理

> 这是 MCP 的原生多模型通信方式。只要客户端支持 sampling，Agent 就能使用客户端的 LLM。

### 方式 2: Direct HTTP（回退）

服务器直接调用 LLM API。需要设置环境变量：

| 变量 | 必需 | 说明 | 示例 |
|------|------|------|------|
| `LLM_API_KEY` | 是 | API 密钥 | `sk-xxxxx` |
| `LLM_BASE_URL` | 是 | API 端点（需包含 `/v1`） | `https://api.longcat.chat/openai/v1` |
| `LLM_MODEL` | 是 | 模型名称 | `LongCat-2.0` |
| `LLM_API_FORMAT` | 否 | `openai` 或 `anthropic`（不填则自动识别） | `openai` |

### 方式 3: 规则引擎（兜底）

无 LLM 时自动启用，通过模式匹配处理常见任务（数学计算、单位转换、时间查询、密码/UUID 生成、文本分析、多步复合任务）。

### 总结

| 场景 | LLM 模式 |
|------|----------|
| 在 ZCode / Claude / Cursor 中作为 MCP 服务器运行 | MCP Sampling（客户端模型）✅ |
| 独立运行 + 设置了 `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` | Direct HTTP |
| 独立运行 + 未设置环境变量 | 规则引擎模式（无 LLM）|

## 🌐 支持的 LLM 供应商

### OpenAI Chat Completions 格式

`LLM_API_FORMAT=openai` 或不设置（自动识别）

| 供应商 | `LLM_BASE_URL` | `LLM_MODEL` 示例 |
|--------|----------------|------------------|
| **LongCat** | `https://api.longcat.chat/openai/v1` | `LongCat-2.0` |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o-mini` |
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat` |
| **SenseNova** | `https://token.sensenova.cn/v1` | `sensenova-6.7-flash-lite` |
| **kimi** | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| **Ollama** | `http://localhost:11434/v1` | `llama3.2` |

### Anthropic Messages 格式

`LLM_API_FORMAT=anthropic` 或不设置（URL 含 `/anthropic` 自动识别）

| 供应商 | `LLM_BASE_URL` | `LLM_MODEL` 示例 | 认证头 |
|--------|----------------|------------------|--------|
| **LongCat (Anthropic)** | `https://api.longcat.chat/anthropic` | `LongCat-2.0-Preview` | `x-api-key` |
| **SenseNova (Anthropic)** | `https://token.sensenova.cn` | `sensenova-6.7-flash-lite` | `Bearer` |
| **Anthropic** | `https://api.anthropic.com` | `claude-sonnet-4-20250514` | `Bearer` |

> **格式自动识别**：代码从 `LLM_BASE_URL` 自动判断用哪种格式发请求：
> - URL 含 `/anthropic` → Anthropic 格式
> - 其他 → OpenAI 格式

## 🔧 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `ANYSEARCH_API_KEY` | 否 | AnySearch API Key | 匿名访问（更低限额） |
| `LLM_API_KEY` | 否 | LLM API 密钥 | 无（回退到 Sampling） |
| `LLM_BASE_URL` | 否 | LLM 端点 URL | 无 |
| `LLM_MODEL` | 否 | LLM 模型名称 | 无 |
| `LLM_API_FORMAT` | 否 | `openai` 或 `anthropic` | 自动识别 |

**传递方式**：
1. MCP 客户端 `env` 字段（标准方式）
2. `.env` 文件（服务器启动时读取，fallback）

## 📋 使用示例

### 内置工具调用示例

```
Task: "Calculate 25 * 4 + sqrt(81) and then convert 500 grams to pounds"
```

Agent 会自动：
1. 调用 `calculator` 计算 `25 * 4 + sqrt(81) = 109`
2. 调用 `unit_convert` 转换 `500 grams = 1.10 pounds`
3. 返回完整的推理过程和最终答案

### 搜索任务示例

```
Task: "Search for the latest AI agent frameworks and summarize the top 3"
```

Agent 会调用 `anysearch_search` 获取搜索结果，然后推理总结。

### 批量搜索示例

```
Task: "Search for 'React vs Vue' and 'TypeScript trends 2025' in parallel"
```

Agent 会调用 `anysearch_batch_search` 同时发起多个查询。

## 🏗️ 项目结构

```
mini-agent-mcp/
├── LICENSE                     # Apache-2.0 许可证
├── README.md                   # 项目文档
├── .env.example                # 环境变量模板
├── package.json                # NPM 包配置
├── tsconfig.json               # TypeScript 配置
├── assets/
│   └── icon.png                # 项目图标 (512x512)
├── src/
│   ├── index.ts                # MCP 服务器入口（含 .env 加载 + 重试）
│   ├── tools/
│   │   ├── types.ts            # 工具类型定义
│   │   ├── registry.ts         # 工具注册表
│   │   ├── calculator.ts       # 数学计算器
│   │   ├── text.ts             # 文本工具
│   │   ├── converter.ts        # 单位转换
│   │   ├── datetime.ts         # 日期时间
│   │   ├── random.ts           # 随机生成
│   │   ├── anysearch-client.ts # AnySearch MCP 客户端封装
│   │   └── anysearch.ts        # AnySearch 工具动态包装
│   └── agent/
│       ├── llm.ts              # LLM 通信层 (采样 + HTTP + 多供应商)
│       ├── react.ts            # ReAct 推理循环
│       └── index.ts            # Agent 工具定义
└── dist/                       # 编译输出
```

## 🔐 安全说明

- 无本地数据存储
- API Key 通过环境变量传递，不写入代码或日志
- 使用 MCP 标准协议通信
- 托管部署在阿里云函数计算 MicroVM 沙箱隔离环境中运行
- SSE 访问地址为专属敏感信息，请勿泄露

## ⚠️ 使用限制

- 免费托管服务有调用配额限制（超限返回 HTTP 429）
- 匿名 AnySearch 访问有速率限制（建议配置 API Key）
- Agent 单次任务最多 8 个工具调用步骤
- 工具调用超时 60 秒，LLM 推理超时 120 秒
- 工具失败后自动重试 3 次（指数退避）

## 📄 许可证

[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) © 2026 Microbiosis

本项目集成了 AnySearch（Apache-2.0 许可证）。

## 🤝 贡献

欢迎提交 Issue 和 PR：https://github.com/Microbiosis/mini-agent-mcp/issues

Fork → 修改 → 提交请求即可。

## 🔗 相关链接

- [ModelScope MCP 广场](https://modelscope.cn/mcp)
- [AnySearch 文档](https://anysearch.com/docs)
- [MCP 协议规范](https://modelcontextprotocol.io)
- [GitHub 仓库](https://github.com/Microbiosis/mini-agent-mcp)
