# Mini Agent MCP

[![npm version](https://img.shields.io/npm/v/mini-agent-mcp.svg?style=flat-square)](https://www.npmjs.com/package/mini-agent-mcp)
[![npm downloads](https://img.shields.io/npm/dm/mini-agent-mcp.svg?style=flat-square)](https://www.npmjs.com/package/mini-agent-mcp)
[![GitHub license](https://img.shields.io/github/license/Microbiosis/mini-agent-mcp?style=flat-square)](https://github.com/Microbiosis/mini-agent-mcp/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Microbiosis/mini-agent-mcp?style=flat-square)](https://github.com/Microbiosis/mini-agent-mcp)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue?style=flat-square)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square&logo=nodedotjs)](https://nodejs.org)

> **中文名称**: Mini Agent MCP 智能代理服务器  
> **英文名称**: Mini Agent MCP  
> **服务分类**: 搜索工具 / AI Agent / 开发者工具  
> **来源地址**: https://github.com/Microbiosis/mini-agent-mcp  
> **托管部署**: 可托管部署（无本地环境依赖，支持云端一键部署）

## 服务介绍

基于 **FastMCP** 框架构建的 MCP 智能代理服务器，集成了 ReAct 小型 Agent、AnySearch 搜索能力和 7 个内置工具。Agent 支持多步推理、函数调用（Function Calling）和 LLM 多模型通信。

## ✨ 核心功能

- **🧮 7 个内置工具** — 计算器、文本分析、文本转换、单位转换、日期时间、随机生成、ReAct Agent
- **🤖 ReAct Agent** — 原生 Function Calling 循环，LLM 直接返回结构化 tool_calls，最多 8 步
- **🔍 AnySearch 搜索** — 自动发现并注册搜索工具（search / batch_search / extract / get_sub_domains）
- **🔗 多模型通信** — MCP Sampling（客户端模型）优先，Direct HTTP（OpenAI SDK）回退
- **🛡️ 工具门禁** — 执行前参数校验（input-length / calculator-expression）
- **☁️ 可托管部署** — 无本地环境依赖，可部署到 ModelScope MCP 广场

## 🚀 快速上手

### MCP 客户端配置

```json
{
  "mcpServers": {
    "mini-agent-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["mini-agent-mcp"],
      "env": {
        "ANYSEARCH_API_KEY": "",
        "LLM_API_KEY": "",
        "LLM_BASE_URL": "",
        "LLM_MODEL": "",
        "LLM_MAX_TOKENS": "4096"
      }
    }
  }
}
```

### .env 文件（fallback）

```bash
cp .env.example .env
# 编辑 .env 填入值
ANYSEARCH_API_KEY=sk-xxxxx
LLM_API_KEY=sk-xxxxx
LLM_BASE_URL=https://api.longcat.chat/openai/v1
LLM_MODEL=LongCat-2.0
```

### 本地开发

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
| `calculator` | 安全数学表达式求值 | `expression` (string, 必需) |
| `text_stats` | 文本统计分析 | `text` (string, 必需) |
| `text_transform` | 文本转换（大小写、反转、排序等） | `text` (string, 必需), `operation` (string, 必需) |
| `unit_convert` | 单位转换（长度、重量、温度、数据） | `value` (number, 必需), `from` (string, 必需), `to` (string, 必需) |
| `datetime_info` | 日期时间查询、格式化、差值计算 | `operation` (string, 必需) |
| `random_gen` | 随机数、UUID、密码、列表抽取 | `operation` (string, 必需) |
| `run_agent` | ReAct Agent — 自主调用工具完成多步任务 | `task` (string, 必需) |

### AnySearch 工具（自动发现）

| 工具名称 | 说明 |
|----------|------|
| `anysearch_search` | 通用搜索（支持金融、学术、法律等垂直领域） |
| `anysearch_batch_search` | 1-5 个独立查询并行搜索 |
| `anysearch_extract` | URL 网页内容提取（Markdown，最多 50,000 字符） |
| `anysearch_get_sub_domains` | 查询垂直领域目录 |

## 🤖 Agent 工作流程

```
用户任务 → [LLM 推理] → [Function Calling: tool_calls]
         → [执行工具] → [tool role 传回结果]
         → [LLM 继续推理] → ... (最多 8 步)
         → [Final Answer]
```

## 📡 LLM 通信模式

| 模式 | 说明 | 配置 |
|------|------|------|
| **MCP Sampling** | 客户端提供 LLM，零配置 | 无需环境变量 |
| **Direct HTTP** | 服务器通过 OpenAI SDK 调用 API | 设置 `LLM_*` 三项 |
| **规则引擎** | 兜底，处理简单任务 | 无 LLM 时自动启用 |

## 🔧 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `ANYSEARCH_API_KEY` | 否 | AnySearch API Key | 匿名访问 |
| `LLM_API_KEY` | 否 | LLM API 密钥（裸 Key，不带 `Bearer `） | 无 |
| `LLM_BASE_URL` | 否 | LLM 端点（需包含 `/v1`） | 无 |
| `LLM_MODEL` | 否 | 模型名称 | 无 |
| `LLM_MAX_TOKENS` | 否 | 最大生成 token 数 | `4096` |

## 🌐 支持的 LLM 供应商

| 供应商 | `LLM_BASE_URL` | `LLM_MODEL` 示例 |
|--------|----------------|------------------|
| **LongCat** | `https://api.longcat.chat/openai/v1` | `LongCat-2.0` |
| **SenseNova** | `https://token.sensenova.cn/v1` | `sensenova-6.7-flash-lite` |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o-mini` |
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat` |
| **kimi** | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| **Ollama** | `http://localhost:11434/v1` | `llama3.2` |

## 🏗️ 项目结构

```
mini-agent-mcp/
├── LICENSE                          # Apache-2.0
├── README.md
├── .env.example
├── package.json
├── tsconfig.json
├── server.json                      # MCP Registry
├── assets/icon.png
├── src/
│   ├── index.ts                     # FastMCP 服务器入口
│   ├── tools/
│   │   ├── index.ts                 # 工具注册（Zod schema + handler）
│   │   ├── calculator.ts / text.ts / converter.ts / datetime.ts / random.ts
│   │   ├── anysearch-client.ts      # AnySearch MCP 客户端
│   │   └── anysearch.ts             # AnySearch 工具自动发现
│   └── agent/
│       ├── llm.ts                   # LLM 通信（OpenAI SDK）
│       ├── react.ts                 # ReAct 推理循环（Function Calling）
│       └── index.ts                 # Agent 工具定义
└── dist/
```

## 🔐 安全

- 工具门禁：执行前校验参数长度和合法性
- API Key 通过环境变量传递，不写入代码
- 标准 MCP 协议通信

## 📄 许可证

[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) © 2026 Microbiosis

## 🔗 相关链接

- [ModelScope MCP 广场](https://modelscope.cn/mcp)
- [AnySearch 文档](https://anysearch.com/docs)
- [FastMCP 框架](https://github.com/punkpeye/fastmcp)
- [MCP 协议规范](https://modelcontextprotocol.io)
- [GitHub 仓库](https://github.com/Microbiosis/mini-agent-mcp)