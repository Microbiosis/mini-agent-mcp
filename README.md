# Mini Agent MCP

[![npm version](https://img.shields.io/npm/v/mini-agent-mcp.svg?style=flat-square)](https://www.npmjs.com/package/mini-agent-mcp)
[![npm downloads](https://img.shields.io/npm/dm/mini-agent-mcp.svg?style=flat-square)](https://www.npmjs.com/package/mini-agent-mcp)
[![GitHub license](https://img.shields.io/github/license/Microbiosis/mini-agent-mcp?style=flat-square)](https://github.com/Microbiosis/mini-agent-mcp/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Microbiosis/mini-agent-mcp?style=flat-square)](https://github.com/Microbiosis/mini-agent-mcp)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue?style=flat-square)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square&logo=nodedotjs)](https://nodejs.org)

> 一个基于 **FastMCP + OpenAI SDK** 的 MCP 智能代理服务器  
> 集成 **ReAct Agent**、**DAG 工作流**、**深度研究**、**持久化记忆**、**技能学习**、**AnySearch 检索**等能力  
> 单二进制即可托管 / 本地部署 / 嵌入任意 MCP 客户端

---

## 一、这是什么

`mini-agent-mcp` 是一个遵循 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) 的 **stdio / SSE 服务器**：

- **对外**只暴露 **1 个 MCP 工具：`run_agent`**——用于没有子 Agent 的应用注入一个"子智能体"
- **对内**托管一个 **ReAct 推理代理**，自主调用 14 个内部工具（6 个基础工具 + 4 个 AnySearch 工具 + 高级 pipeline 等）完成任务
- 内置 **DAG 工作流**与**多阶段深度研究**管线
- 通过 **ToolManager** 统一管理超时、并发、重试、门禁
- 通过 **`.memory/` 与 `.skills/`** 实现本地持久化记忆和技能学习

支持三种 LLM 通信模式（自动级联 fallback）：
1. **MCP Sampling** — 客户端模型，零配置
2. **Direct HTTP** — 通过 OpenAI SDK 直连任意兼容端点
3. **Rule-based** — 基于正则的模式匹配兜底

---

## 二、核心特性

| 模块 | 能力 |
|------|------|
| 🧮 **基础工具** | 安全数学计算、文本统计、文本转换、单位换算、日期时间、随机生成 |
| 🤖 **ReAct Agent** | 原生 Function Calling 多步推理，自动匹配历史技能，Hook 注入 |
| 🔗 **DAG 工作流** | 有向无环图编排，并行执行无依赖节点，自动注入上游结果 |
| 🔍 **深度研究** | 拆解子问题 → 并行检索 → 综合报告，三阶段管线 |
| 💾 **记忆系统** | 4 类标签化持久记忆，按访问频次 LRU 检索 |
| 🎯 **技能系统** | 完成任务后提取可复用技能，新任务自动匹配 |
| 🌐 **AnySearch 集成** | 自动发现并接入检索工具，仅供 Agent 内部调用 |
| 🛡️ **工具门禁** | 输入长度上限、错误分类、智能重试、超时控制 |
| 🔌 **三模式 LLM** | Sampling → HTTP → Rule-based 透明级联 fallback |
| 🪝 **Hooks 扩展** | 在 LLM 调用前后注入自定义逻辑（Yao 模式） |

---

## 三、架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                       MCP 客户端 (Claude / ZCode)                   │
│              tools/list 只见 1 个工具: run_agent                    │
│              tools/call 仅可调 run_agent                            │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ run_agent(task)
┌─────────────────────────────▼───────────────────────────────────────┐
│                         FastMCP Server                              │
│              run_agent — 唯一对外的 MCP 工具                          │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────────┐
│                       ToolManager (singleton)                       │
│   超时 / 并发上限 / 智能重试 / 输入门禁 / 调用历史                  │
│   14 个内部工具（外面看不见）                                       │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
        ┌─────────────────────┼──────────────────────┐
        │                     │                      │
        ▼                     ▼                      ▼
   6 个本地工具       run_agent（唯一对外工具）     .memory / .skills
   (calculator, ...   + 内部高级 pipeline              (持久化)
                     仅 Agent 内部使用)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    ReAct Agent (src/agent/react.ts)                 │
│                                                                     │
│   LLM ←── CreateHook ── messages ──→ LLM ──→ NextHook → 响应校验    │
│    │                                                              │
│    │ tool_calls                                                    │
│    ▼                                                              │
│  buildToolList() = 6 本地工具 + AnySearch 4 个内部工具              │
│  (AnySearch 懒加载：首次 run_agent 调用时发现并缓存)                │
│                                                                     │
│   ┌─────────────────────────┐    ┌─────────────────────────┐       │
│   │   LLM 模式 (优先级)      │    │     Fallback 链          │       │
│   │   1. MCP Sampling        │ →  │   失败 → 降级到下一模式  │       │
│   │   2. Direct HTTP         │    │                         │       │
│   │   3. Rule-based          │    │                         │       │
│   └─────────────────────────┘    └─────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    持久化层 (本地 JSON)                             │
│   .memory/memories.json   ── 4 类记忆 (fact/preference/task/conv)   │
│   .skills/skills.json     ── 标签评分技能库                         │
└─────────────────────────────────────────────────────────────────────┘

**AnySearch 懒加载时序**：
1. 服务器启动 → 仅注册 `run_agent` 到 FastMCP + 6 个本地工具到内部 ToolManager
2. 客户端调用 `run_agent` → Agent 触发 `ensureAnySearchTools()`
3. 首次：HTTP 连接到 `api.anysearch.com/mcp` 发现工具，缓存 1 小时
4. 后续：命中缓存（除非 TTL 过期或调用 `resetAnySearchCache()`）
```

---

## 四、快速上手

### 4.1 MCP 客户端配置

**stdio 模式**（最常用）— 复制到客户端的 MCP 配置文件中：

```json
{
  "mcpServers": {
    "mini-agent-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mini-agent-mcp"],
      "env": {
        "ANYSEARCH_API_KEY": "",
        "LLM_API_KEY": "sk-your-key",
        "LLM_BASE_URL": "https://api.longcat.chat/openai/v1",
        "LLM_MODEL": "LongCat-2.0",
        "LLM_MAX_TOKENS": "4096"
      }
    }
  }
}
```

> 也可直接使用 `node dist/index.js` 启动本地编译产物（见 §4.3）。

**SSE 模式**（可选）— 通过 `node dist/index.js --sse` 启用 `httpStream` 传输。

### 4.2 `.env` 配置（fallback）

服务器启动时按以下顺序查找 `.env`（**第一个存在即生效**）：

1. `process.cwd()/.env` — 启动时的工作目录
2. `<dist 上一级>/.env` — 即 `npm install` 后的项目根目录（`dist/index.js` 启动场景）
3. `<dist 上两级>/.env` — 项目根目录的父目录

> ⚠️ 通过 `npx -y mini-agent-mcp` 全局拉起时，`process.cwd()` 取决于 MCP 客户端的工作目录，**不一定等于项目根**。推荐同时在 MCP 配置文件的 `env` 块中显式注入变量（见 §4.1），以避免查找路径不一致带来的配置漂移。

```bash
cp .env.example .env
```

```ini
# AnySearch API Key（可选 — 不填则匿名访问，有较低速率限制）
ANYSEARCH_API_KEY=

# LLM 直接调用配置（仅 Direct HTTP 模式需要）
LLM_API_KEY=
LLM_BASE_URL=https://api.longcat.chat/openai/v1
LLM_MODEL=LongCat-2.0
LLM_MAX_TOKENS=4096

# 可选：多供应商切换（见 §9.2）
# LLM_PROVIDER=openai
# LLM_PROVIDERS_PATH=/abs/path/to/providers.json

# Agent 行为调优
AGENT_MAX_TURNS=5          # ReAct 推理步数上限（1-50）
AGENT_TOOL_RETRY=1         # 工具失败重试次数（0-3）

# ToolManager 调优
TOOL_MAX_CONCURRENT=10     # 并发执行上限
TOOL_RETRY_COUNT=2         # 瞬时错误重试（0-5）
```

### 4.3 本地开发

```bash
git clone https://github.com/Microbiosis/mini-agent-mcp.git
cd mini-agent-mcp
npm install
npm run build          # tsc 编译到 dist/
node dist/index.js           # 启动 MCP 服务器（stdio）
node dist/index.js --test    # 自检模式：调用全部 14 个工具
node dist/index.js --sse     # 启用 HTTP Stream 传输
```

> `--test` 模式运行完成后会 `process.exit(0)`，适合做 CI 自检。

### 4.4 验证安装

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  | npx mini-agent-mcp
```

正常情况下会返回 14 个工具的 schema。

---

## 五、MCP 工具参考

### 5.1 唯一对外工具（外部 Agent 唯一可调）

| 工具 | 参数 | 用途 | 超时 |
|------|------|------|------|
| `run_agent` | `task: string`<br>`mode?: 'auto'\|'rule'` | 把任务委派给内置 ReAct Agent；Agent 自动选择并调用 14 个内部工具完成。`rule` 强制正则模式（无需 LLM） | 120s |

**`run_agent` 返回结构**：

```
Task: 计算 sqrt(15) + 8
Mode: LLM-powered (HTTP)
Steps: 2

--- Reasoning Trace ---
[Step 1]
  Thought: ...
  Action: calculator
  Observation: Expression: sqrt(15) + 8
Result: 11.872983346207417
[Step 2]
  Thought: ...
  Final Answer: 11.87

--- Final Answer ---
11.87
```

### 5.2 内部工具（仅 Agent 可见，外部 tools/list 不可见）

下面 14 个工具**不**通过 MCP `tools/list` 暴露——只能由 `run_agent` 内的 ReAct 循环自动调用。客户端 Agent 通过 `run_agent(task)` 委派任务，Agent 在内部根据需要挑选并执行这些工具。

#### 基础工具（6 个 — 同步、确定性）

| 内部工具 | 参数 | 用途 |
|---------|------|------|
| `calculator` | `expression: string` | 安全数学求值（递归下降解析器，无 `eval()`）。支持 `+ - * / % ^`、括号、函数 `sqrt abs sin cos tan asin acos atan log ln exp floor ceil round`、常量 `pi e` |
| `text_stats` | `text: string` | 字符数、词数、句数、段数、平均词长、Top 5 高频词 |
| `text_transform` | `text: string`<br>`operation` (9 种)<br>`pattern?: string`<br>`replacement?: string` | uppercase/lowercase/titlecase/reverse/trim/remove_duplicates/sort_lines/count_substring/replace |
| `unit_convert` | `value: number`<br>`from: string`<br>`to: string` | 长度/重量/温度/数据单位换算 |
| `datetime_info` | `operation: 'now'\|'format'\|'diff'` + 配套参数 | 当前时间、格式转换、日期差 |
| `random_gen` | `operation: 'number'\|'uuid'\|'password'\|'pick'\|'shuffle'` + 配套参数 | 随机整数/UUID/密码/采样/洗牌 |

#### 高级 pipeline（3 个）

| 内部工具 | 用途 |
|---------|------|
| `run_workflow` | DAG 工作流编排（多个 Agent 任务按依赖执行） |
| `deep_research` | 三阶段深度研究：拆解 → 检索 → 综合 |
| (复合) | 多阶段研究任务的串联入口 |

#### 记忆工具（3 个 — 持久化到 `.memory/memories.json`）

| 内部工具 | 用途 |
|---------|------|
| `remember` | 存储一条记忆（fact/preference/task/conversation） |
| `recall` | 按标签检索 Top 5 记忆 |
| `memory_stats` | 返回记忆统计 |

#### 技能工具（2 个 — 持久化到 `.skills/skills.json`）

| 内部工具 | 用途 |
|---------|------|
| `extract_skill` | 提取一个可复用技能 |
| `list_skills` | 列出所有技能 |

#### AnySearch 工具（4 个 — 懒加载）

`anysearch_search` / `anysearch_batch_search` / `anysearch_extract` / `anysearch_get_sub_domains`（详见 §6）

> 💡 **设计意图**：本服务的核心定位是为没有子智能体的 Agent 应用注入"子智能体"能力。外部工具集保持极简（仅 `run_agent`），全部内部工具由 Agent 自治调度，避免暴露过多工具面干扰主 Agent 的选择。

---

## 六、AnySearch 内部工具

**懒加载**：AnySearch 工具**不在启动时连接**，而是等到首次调用 `run_agent`（或 `deep_research`）时，由 Agent 通过 `ensureAnySearchTools()` 触发发现 + 注册。这样：

- 服务器冷启动不受 AnySearch 网络影响
- 不使用 Agent 功能的客户端完全跳过 AnySearch
- 工具列表缓存 1 小时（可用 `ANYSEARCH_CACHE_TTL_MS` 覆盖）

发现后会注册到内部 ToolManager 的工具：

| 内部名称 | 功能 |
|---------|------|
| `anysearch_search` | 通用搜索（支持金融、学术、法律等垂直领域） |
| `anysearch_batch_search` | 1-5 个独立查询的并行搜索 |
| `anysearch_extract` | URL 网页内容提取（最多 50,000 字符 Markdown） |
| `anysearch_get_sub_domains` | 查询垂直领域目录 |

> ⚠️ **这些工具仅注册到内部 ToolManager，供 ReAct Agent 在推理循环中自主调用，*不* 通过 MCP `tools/list` 暴露给外部客户端**——MCP `tools/list` 始终只返回 1 个工具：`run_agent`。

**匿名可用**：不设 `ANYSEARCH_API_KEY` 也能连接，只是有较低的速率限制；高级使用场景可填 Key 提升配额。

**缓存策略**：
- 默认 TTL：1 小时（环境变量 `ANYSEARCH_CACHE_TTL_MS`，设为 `0` 每次过期都重发现）
- 瞬时失败时：保留旧缓存（serving stale cache）—— 可用工具优先于无工具
- 手动刷新：调用 `resetAnySearchCache()`（来自 `mini-agent-mcp/agent` 或内部 API）

**容错**：MCPRuntime 状态机（`idle → connecting → connected → degraded/error/disabled`）自动处理瞬时错误（重试）和硬错误（401/403/DNS → 禁用），AnySearch 不可达不会阻塞 Agent 启动。

---

## 七、LLM 三模式 + Fallback

`run_agent` 启动时按优先级选择 LLM 调用方式，失败时自动降级：

```
┌─────────────────────────────────────────────────────────┐
│  runAgent(task)                                         │
│    ↓                                                    │
│  getLLMMode()                                           │
│    ├─► "sampling" (MCP 客户端支持时)                      │
│    │     ├─ 成功 → 返回                                  │
│    │     └─ 失败 → 检查 Direct HTTP 配置                 │
│    ├─► "http" (设置了 LLM_API_KEY + BASE_URL + MODEL)    │
│    │     ├─ 成功 → 返回                                  │
│    │     └─ 失败 → Fallback                              │
│    └─► "none" (Rule-based 兜底)                          │
│          └─ 永远可执行                                   │
└─────────────────────────────────────────────────────────┘
```

| 模式 | 触发条件 | 优点 | 限制 |
|------|---------|------|------|
| **MCP Sampling** | MCP 客户端注册了 `sampling` capability | 零配置、客户端 LLM | 依赖客户端支持 |
| **Direct HTTP** | 设置了 `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` | 与客户端解耦、可托管 | 需要 API Key |
| **Rule-based** | 上述都失败 / 显式 `mode='rule'` | 无 LLM 也能跑 | 仅限 §5.1 基础工具能直接覆盖的任务（数学、单位换、时间、密码、UUID、文本统计、日期差） |

**关键 API**：
- `getLLMMode(): 'sampling' | 'http' | 'none'` — 检查当前可用模式
- `getLLMConfig()` — 返回 Direct HTTP 配置（如有）

---

## 八、Hooks 系统（Yao 模式）

`src/agent/react.ts` 暴露两个 Hook 点，可在不修改 Agent 内核的前提下注入自定义行为：

```ts
import { addCreateHook, addNextHook, clearHooks } from "mini-agent-mcp";

addCreateHook(async (ctx, messages) => {
  // LLM 调用前，可注入 / 修改 / 取消消息
  // ctx: { task, step, maxSteps }
  // 返回 null → 取消本次 LLM 调用
  // 返回 messages 数组 → 替换为新消息
  if (ctx.step === 0) {
    messages.push({ role: "user", content: "[System] 请使用中文回答。" });
  }
  return messages;
});

addNextHook(async (ctx, response) => {
  // LLM 响应后，可校验 / 拦截
  // 返回 "stop" → 立即终止 Agent
  // 返回 "continue" 或 null → 正常继续
  if (response.content?.includes("ERROR")) return "stop";
  return null;
});

// 清空所有 Hook
clearHooks();
```

典型用途：
- 注入系统级提示词 / 安全约束
- 添加审计日志、调用统计
- 限制工具调用范围（前置门禁）
- 在响应出现危险模式时紧急停止

---

## 九、持久化层

### 9.1 Memory（`.memory/memories.json`）

```ts
interface Memory {
  id: string;               // mem_<timestamp>_<rand>
  type: "fact" | "preference" | "task" | "conversation";
  content: string;
  tags: string[];           // 用于检索
  timestamp: number;        // 创建时间（epoch ms）
  accessCount: number;      // recall 时递增，影响排序
}
```

**检索算法**：
1. 标签完全匹配 → 直接召回
2. 按 `accessCount + recency` 排序
3. 默认返回 Top 5（`recall(tags, limit=5)`）

### 9.2 Skill（`.skills/skills.json`）

```ts
interface Skill {
  id: string;                  // skill_<timestamp>
  name: string;
  description: string;
  exampleTask: string;
  steps: string[];             // 步骤描述（注入到消息历史）
  tags: string[];              // 匹配关键词
  useCount: number;            // 累计被自动应用次数
  createdAt: number;           // 首次创建时间（永不更新）
  lastUsedAt?: number;         // 最近一次被 matchSkill 匹配并 useSkill() 的时间
  lastUpdatedAt?: number;      // 最近一次 extractSkill() 覆盖内容的时间
}
```

**匹配评分**（`matchSkill(task)`）：
- 每个匹配 tag：`+10`
- 每个 step 前 20 字符出现在 task 中：`+5`
- 仅返回 `score > 0` 的最佳匹配

**自动应用**：每次 `runAgent` 启动前都会调用 `matchSkill()`，若命中则把步骤作为 `hint` 注入 LLM 消息，并 `useSkill()` 增加计数 — 这就是"自我学习"的机制。

---

## 十、DAG 工作流

`run_workflow` 接受一个 JSON 数组，按有向无环图执行：

```json
[
  {"id": "fetch", "label": "抓取",  "task": "用 search 工具查询 MCP 协议", "timeout": 60},
  {"id": "sum1",  "label": "摘要1", "task": "把上面的内容翻译成中文", "dependsOn": ["fetch"], "timeout": 30},
  {"id": "sum2",  "label": "摘要2", "task": "提取 3 个关键点",          "dependsOn": ["fetch"], "timeout": 30},
  {"id": "final", "label": "汇总",  "task": "合并两个摘要为最终报告",    "dependsOn": ["sum1", "sum2"]}
]
```

**执行特性**：
- **并行执行**：无依赖关系（或依赖已完成的）的步骤会同时启动（`Promise.all`）
- **依赖注入**：`buildStepTask()` 把上游步骤的 `result.answer` 拼到下游任务末尾
- **环检测**：DFS 检测循环依赖，抛出明确错误
- **死锁处理**：若没有 ready 步骤但未全部完成，剩余的标记为 blocked
- **超时**：每步独立超时（秒），默认 60

**返回结构**：
```ts
{
  success: boolean,
  totalDurationMs: number,
  steps: [{ id, label, result, error?, durationMs }]
}
```

---

## 十一、深度研究（deep_research）

三阶段管线，5 分钟超时：

```
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│   1. 拆解      │ ──►  │   2. 检索      │ ──►  │   3. 综合      │
│               │      │               │      │               │
│ LLM 把问题    │      │ 每个子问题    │      │ LLM 收到所有  │
│ 拆成 3-5 个   │      │ 触发 run_agent│      │ findings +    │
│ 子问题        │      │ 自动调 search │      │ 原问题，生成  │
│ (fenced code) │      │ 收集 findings │      │ Markdown 报告 │
└───────────────┘      └───────────────┘      └───────────────┘
```

**`parseSubQuestions()` 容错**：
- 优先解析 fenced code block（` ``` ... ``` `）
- 降级到行扫描，只接受 `"- "` 开头且 ≥12 字符的行
- 默认最多 5 个子问题
- 解析失败 → fallback 为单问题 `[原问题]`

返回结构包含 `subQuestions`、`totalSteps`、`durationMs` 和完整的 Markdown 报告（执行摘要 + 关键发现 + 结论）。

---

## 十二、配置参考

### 12.1 全部环境变量

| 变量 | 必需 | 默认 | 用途 |
|------|:----:|------|------|
| `LLM_API_KEY` | 视模式 | — | Direct HTTP 模式的 API Key（裸 Key，不带 `Bearer`） |
| `LLM_BASE_URL` | 视模式 | — | OpenAI 兼容端点（需含 `/v1`） |
| `LLM_MODEL` | 视模式 | — | 模型名 |
| `LLM_MAX_TOKENS` | 否 | `4096` | 单次生成上限 |
| `LLM_PROVIDER` | 否 | `default` | 从 `providers.json` 选命名供应商 |
| `LLM_PROVIDERS_PATH` | 否 | — | 命名供应商配置文件路径 |
| `AGENT_MAX_TURNS` | 否 | `5` | ReAct 推理步数上限（1-50） |
| `AGENT_TOOL_RETRY` | 否 | `1` | 工具失败重试（0-3） |
| `TOOL_MAX_CONCURRENT` | 否 | `10` | ToolManager 并发上限 |
| `TOOL_RETRY_COUNT` | 否 | `2` | 瞬时错误重试（0-5） |
| `ANYSEARCH_API_KEY` | 否 | 匿名 | AnySearch 提升配额 |
| `ANYSEARCH_CACHE_TTL_MS` | 否 | `3600000` | AnySearch 工具发现缓存 TTL（毫秒；`0` = 每次过期都重发现） |

### 12.2 多供应商配置（`providers.json`）

```json
{
  "openai": {
    "apiKey": "sk-...",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o-mini"
  },
  "deepseek": {
    "apiKey": "sk-...",
    "baseUrl": "https://api.deepseek.com/v1",
    "model": "deepseek-chat"
  }
}
```

启动时设置 `LLM_PROVIDERS_PATH=/path/to/providers.json` + `LLM_PROVIDER=openai`。

> ⚠️ **安全提示**：`providers.json` 含明文 API Key，请务必：
> - 加入 `.gitignore`，**不要提交到仓库**
> - 文件权限设为 `chmod 600`（Linux/macOS）
> - 在 CI/CD 中通过密钥管理服务注入，避免硬编码
> - 推荐优先使用 `.env` + 环境变量方式（§4.2），多供应商配置仅在需要**运行时切换模型**时使用

### 12.3 内置供应商参考

| 供应商 | `LLM_BASE_URL` | `LLM_MODEL` 示例 |
|--------|----------------|------------------|
| LongCat | `https://api.longcat.chat/openai/v1` | `LongCat-2.0` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Moonshot (Kimi) | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| SenseNova | `https://token.sensenova.cn/v1` | `sensenova-6.7-flash-lite` |
| Ollama (本地) | `http://localhost:11434/v1` | `llama3.2` |

---

## 十三、项目结构

```
mini-agent-mcp/
├── LICENSE                           # Apache-2.0
├── README.md                         # 本文件
├── .env.example                      # 环境变量模板
├── package.json
├── tsconfig.json
├── server.json                       # MCP Registry 元数据
├── assets/icon.png                   # 商店图标
├── scripts/                          # 14 个独立测试脚本
│   ├── test-tools-list.mjs           # 通过 JSON-RPC 探测 tools/list
│   ├── test-agent.mjs                # ReAct (rule + LLM) 双模式
│   ├── test-workflow.mjs             # DAG + deep_research
│   ├── test-deep-research*.mjs       # 深度研究变体
│   ├── test-memory-skill.mjs         # 持久化层 CRUD
│   ├── test-anysearch*.mjs           # AnySearch 集成
│   ├── test-dag-buildStepTask.mjs    # 纯函数单元测试
│   ├── test-research-parser.mjs      # 解析器单元测试
│   └── ...                           # 集成 / 回归脚本
├── src/
│   ├── index.ts                      # FastMCP 入口 + 工具注册
│   ├── agent/
│   │   ├── react.ts                  # ReAct 推理循环 + Hooks
│   │   ├── llm.ts                    # OpenAI SDK + Sampling
│   │   └── index.ts                  # run_agent / getLLMMode 等公共 API 重导出
│   ├── tools/
│   │   ├── manager.ts                # ToolManager (超时/并发/重试)
│   │   ├── registry.ts               # 工具注册中心 (本地 + AnySearch 统一入口)
│   │   ├── index.ts                  # 6 个内置工具的导出桶
│   │   ├── types.ts                  # ToolDefinition / ToolResult
│   │   ├── calculator.ts             # 安全数学解析器
│   │   ├── text.ts                   # text_stats + text_transform
│   │   ├── converter.ts              # 单位换算
│   │   ├── datetime.ts               # 日期时间
│   │   ├── random.ts                 # 随机生成
│   │   ├── anysearch.ts              # AnySearch 工具包装
│   │   └── anysearch-client.ts       # MCPRuntime 状态机
│   ├── workflow/
│   │   ├── dag.ts                    # DAG 工作流编排
│   │   └── research.ts               # 深度研究三阶段管线
│   ├── memory/index.ts               # 持久化记忆
│   └── skill/index.ts                # 技能提取与匹配
└── dist/                             # 编译产物
```

---

## 十四、安全与设计理念

**安全约束**：
- 所有 API Key 仅通过环境变量传递，永不入代码
- ToolManager 内置输入长度门禁（默认 10,000 字符；`calculator` 500 字符）
- 错误分类：`hard` (401/403/DNS/refused) 直接失败；`transient` (timeout/429/5xx) 自动重试 + 指数退避（最多 8s）
- 计算器使用自研递归下降解析器，**不使用 `eval()`**

**设计原则**：
- **协议优先**：严格遵守 MCP JSON-RPC over stdio/SSE
- **分层解耦**：`ToolManager` 统一抽象，工具实现可插拔
- **级联容错**：LLM / 网络 / 工具层均有多级 fallback
- **本地优先**：记忆 / 技能持久化到本地 JSON，无需外部数据库
- **零配置可启动**：最小可用配置为 0（默认走 Sampling 或 Rule-based）
- **可观测性**：Hooks（§八）提供 LLM 调用前后拦截点，可注入审计日志 / 调用统计 / 安全告警；ToolManager 内置调用历史，便于回放与调试

---

## 十五、许可证

[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) © 2026 Microbiosis

---

## 十六、相关链接

- [GitHub 仓库](https://github.com/Microbiosis/mini-agent-mcp)
- [npm 包](https://www.npmjs.com/package/mini-agent-mcp)
- [MCP 协议规范](https://modelcontextprotocol.io)
- [FastMCP 框架](https://github.com/punkpeye/fastmcp)
- [AnySearch 文档](https://anysearch.com/docs)
- [OpenAI API](https://platform.openai.com/docs)
