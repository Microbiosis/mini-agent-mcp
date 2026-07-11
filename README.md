# Mini Agent MCP

一个集成了 ReAct 小型 Agent 的 MCP (Model Context Protocol) 服务。

Agent 可以自主调用多个工具完成复杂的多步任务，支持 LLM 驱动和规则引擎两种模式。
内置 **AnySearch** 搜索能力 — 网页搜索、域名搜索、批量搜索、URL 内容提取。

## 架构

```
┌────────────────────────────────────────────────────────────┐
│                    MCP Server (stdio)                       │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌─────────────────┐    ┌──────────────────────────────┐  │
│  │   MCP Tools      │    │   ReAct Agent                 │  │
│  │                  │    │                               │  │
│  │ • calculator     │◄───│  Thought → Action             │  │
│  │ • text_stats     │    │     → Observation             │  │
│  │ • text_xform     │    │     → Thought → ...           │  │
│  │ • unit_conv      │    │     → Final Answer            │  │
│  │ • datetime       │    │                               │  │
│  │ • random_gen     │    │  LLM 通信 (二选一):           │  │
│  │                  │    │  ① MCP Sampling (客户端模型)  │  │
│  │ • run_agent ◄────┤───►│  ② Direct HTTP (自有 API)    │  │
│  └────────────┬─────┘    └──────────────────────────────┘  │
│               │  AnySearch MCP (Remote)                     │
│               │  ┌──────────────────────────────────────┐  │
│               └─►│ • anysearch_search                    │  │
│                  │ • anysearch_batch_search               │  │
│                  │ • anysearch_extract                    │  │
│                  │ • anysearch_get_sub_domains            │  │
│                  └──────────────────────────────────────┘  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## 工具列表

### 内置工具

| 工具 | 说明 |
|------|------|
| `calculator` | 安全的数学表达式求值（支持 sqrt, sin, cos, pi 等） |
| `text_stats` | 文本统计分析（字数、词频、句子数等） |
| `text_transform` | 文本转换（大小写、反转、排序、去重等） |
| `unit_convert` | 单位转换（长度、重量、温度、数据） |
| `datetime_info` | 日期时间查询、格式化、差值计算 |
| `random_gen` | 随机数、UUID、密码、列表抽取 |
| `run_agent` | **核心工具** — ReAct Agent，自主调用上述工具完成任务 |

### AnySearch 工具（自动发现）

启动时自动连接 `https://api.anysearch.com/mcp`，动态发现可用工具：

| 工具 | 说明 |
|------|------|
| `anysearch_search` | 通用搜索，支持垂直领域（金融、学术、法律、安全、代码等） |
| `anysearch_batch_search` | 1-5 个独立查询并行搜索，单个失败不影响其他 |
| `anysearch_extract` | 提取 URL 网页内容（返回 Markdown，最多 50,000 字符） |
| `anysearch_get_sub_domains` | 查询垂直领域目录（必须在领域搜索前调用） |

> AnySearch 工具命名以 `anysearch_` 前缀，避免与内置工具冲突。
> 若 AnySearch 服务不可达，服务器自动降级，搜索工具不可用但不影响其他功能。

## Agent 工作流程

```
用户任务 → [Thought: 分析任务]
           → [Action: 选择工具] → [执行工具] → [Observation: 观察结果]
           → [Thought: 继续推理]
           → ... (最多 8 步)
           → [Final Answer: 最终答案]
```

## LLM 通信模式（多模型）

Agent 支持两种 LLM 通信方式，**优先使用 MCP Sampling**：

### 方式 1: MCP Sampling（推荐）

服务器通过 MCP 协议的 `sampling/createMessage` 请求，让**客户端（ZCode）**代为调用 LLM。这意味着：

- **零配置** — 服务器不需要 API Key，不需要知道模型名称
- **客户端决定模型** — ZCode 使用用户选择的模型
- **支持多模型通信** — 客户端可以灵活选择不同的模型进行推理

> 这是 MCP 的原生多模型通信方式。只要客户端支持 sampling（ZCode 支持），Agent 就能使用客户端的 LLM。

### 方式 2: Direct HTTP（回退）

服务器直接调用 OpenAI 兼容 API。需要设置**全部三个**环境变量：

| 变量 | 说明 | 示例 |
|------|------|------|
| `LLM_API_KEY` | API 密钥 | `your-api-key` |
| `LLM_BASE_URL` | API 端点 | `https://api.longcat.chat/openai` |
| `LLM_MODEL` | 模型名称 | `LongCat-2.0-Preview` |

> 没有默认值。三项全设才启用 HTTP 模式。

### 总结

| 场景 | LLM 模式 |
|------|----------|
| 在 ZCode 中作为 MCP 服务器运行 | MCP Sampling（客户端模型）✅ |
| 独立运行 + 设置了 `LLM_*` 三项 | Direct HTTP |
| 独立运行 + 未设置环境变量 | 规则引擎模式（无 LLM）|

## 安装与构建

```bash
npm install
npm run build
```

## 作为 ZCode MCP 服务器配置

在 `~/.zcode/cli/config.json` 中添加：

```json
{
  "mcp": {
    "servers": {
      "mini-agent-mcp": {
        "type": "stdio",
        "command": "node",
        "args": ["D:/Github/mini-agent-mcp/dist/index.js"],
        "env": {
          "ANYSEARCH_API_KEY": "your-anysearch-key"
        }
      }
    }
  }
}
```

> 在 ZCode 中使用 MCP Sampling 模式 — **无需设置 `LLM_*` 环境变量**，Agent 自动使用 ZCode 的 LLM。

### 带 Direct HTTP 回退的配置

如果想让服务器在非 ZCode 环境下也能推理，同时保留 HTTP 回退：

```json
{
  "mcp": {
    "servers": {
      "mini-agent-mcp": {
        "type": "stdio",
        "command": "node",
        "args": ["D:/Github/mini-agent-mcp/dist/index.js"],
        "env": {
          "LLM_API_KEY": "your-llm-key",
          "LLM_BASE_URL": "https://api.longcat.chat/openai",
          "LLM_MODEL": "LongCat-2.0-Preview",
          "ANYSEARCH_API_KEY": "your-anysearch-key"
        }
      }
    }
  }
}
```

> 同时设置两者时：**MCP Sampling 优先，HTTP 回退**。

## AnySearch 集成说明

**传输方式**: Streamable HTTP（MCP SDK 1.29+ 原生支持）

**端点**: `https://api.anysearch.com/mcp`

**认证**（可选）:
- `ANYSEARCH_API_KEY` — 环境变量，设置后享受更高请求限额
- 无 API key 时匿名访问可用，但有速率限制
- 免费申请: https://anysearch.com/console/api-keys

**容错设计**:
- AnySearch 服务不可达时，自动跳过搜索工具，不影响其他功能
- 每次工具调用自动发现并缓存可用工具列表
- 30 秒超时保护

## 测试

```bash
node dist/index.js --test
```

## 使用示例

调用 `run_agent` 工具，传入任务描述：

```
Task: "Calculate 25 * 4 + sqrt(81) and then convert 500 grams to pounds"
```

Agent 会自动：
1. 调用 `calculator` 计算 `25 * 4 + sqrt(81) = 109`
2. 调用 `unit_convert` 转换 `500 grams = 1.10 pounds`
3. 返回完整的推理过程和最终答案

**包含搜索的任务**：

```
Task: "Search for the latest AI agent frameworks and summarize the top 3"
```

Agent 会调用 `anysearch_search` 获取搜索结果，然后推理总结。

## 项目结构

```
mini-agent-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # MCP 服务器入口
│   ├── tools/
│   │   ├── types.ts                # 类型定义
│   │   ├── calculator.ts           # 数学计算器
│   │   ├── text.ts                 # 文本工具
│   │   ├── converter.ts            # 单位转换
│   │   ├── datetime.ts             # 日期时间
│   │   ├── random.ts               # 随机生成
│   │   ├── anysearch-client.ts     # AnySearch MCP 客户端封装
│   │   ├── anysearch.ts            # AnySearch 工具动态包装
│   │   └── registry.ts             # 工具注册表
│   └── agent/
│       ├── llm.ts                  # LLM 通信 (Sampling + HTTP)
│       ├── react.ts                # ReAct 推理循环
│       └── index.ts                # Agent 工具定义
└── dist/                           # 编译输出
```
