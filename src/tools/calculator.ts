/**
 * Calculator tool — safely evaluates mathematical expressions.
 * Supports +, -, *, /, ^, parentheses, sqrt(), abs(), sin(), cos(), tan(), log(), ln(), pi, e.
 */

import type { ToolDefinition, ToolResult } from "./types.js";
import { textResult } from "./types.js";

/** Safe math expression evaluator — no eval() used */
function evaluateMath(expr: string): number {
  // Tokenize
  const tokens = tokenize(expr);
  const parser = new Parser(tokens);
  const ast = parser.parseExpression();
  if (parser.pos < tokens.length) {
    throw new Error(`Unexpected token: ${tokens[parser.pos]}`);
  }
  return ast();
}

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let num = "";
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        num += expr[i];
        i++;
      }
      tokens.push(num);
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let name = "";
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) {
        name += expr[i];
        i++;
      }
      tokens.push(name);
      continue;
    }
    // Multi-char operators
    if (c === "*" && expr[i + 1] === "*") {
      tokens.push("^");
      i += 2;
      continue;
    }
    tokens.push(c);
    i++;
  }
  return tokens;
}

class Parser {
  pos = 0;
  constructor(private tokens: string[]) {}

  parseExpression(): () => number {
    let left = this.parseTerm();
    while (this.pos < this.tokens.length) {
      const op = this.tokens[this.pos];
      if (op === "+" || op === "-") {
        this.pos++;
        const right = this.parseTerm();
        const l = left;
        const r = right;
        if (op === "+") {
          left = () => l() + r();
        } else {
          left = () => l() - r();
        }
      } else {
        break;
      }
    }
    return left;
  }

  parseTerm(): () => number {
    let left = this.parseFactor();
    while (this.pos < this.tokens.length) {
      const op = this.tokens[this.pos];
      if (op === "*" || op === "/" || op === "%") {
        this.pos++;
        const right = this.parseFactor();
        const l = left;
        const r = right;
        if (op === "*") {
          left = () => l() * r();
        } else if (op === "/") {
          left = () => l() / r();
        } else {
          left = () => l() % r();
        }
      } else {
        break;
      }
    }
    return left;
  }

  parseFactor(): () => number {
    let base = this.parseUnary();
    while (this.pos < this.tokens.length && this.tokens[this.pos] === "^") {
      this.pos++;
      const exp = this.parseUnary();
      const b = base;
      const e = exp;
      base = () => Math.pow(b(), e());
    }
    return base;
  }

  parseUnary(): () => number {
    if (this.pos < this.tokens.length && this.tokens[this.pos] === "-") {
      this.pos++;
      const operand = this.parseUnary();
      return () => -operand();
    }
    if (this.pos < this.tokens.length && this.tokens[this.pos] === "+") {
      this.pos++;
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  parsePrimary(): () => number {
    const token = this.tokens[this.pos];
    if (token === undefined) {
      throw new Error("Unexpected end of expression");
    }
    if (token === "(") {
      this.pos++;
      const expr = this.parseExpression();
      if (this.tokens[this.pos] !== ")") {
        throw new Error("Expected closing parenthesis");
      }
      this.pos++;
      return expr;
    }
    if (/^[0-9.]/.test(token)) {
      const num = parseFloat(token);
      if (isNaN(num)) {
        throw new Error(`Invalid number: ${token}`);
      }
      this.pos++;
      return () => num;
    }
    // Named constants and functions
    const constants: Record<string, number> = {
      pi: Math.PI,
      e: Math.E,
    };
    const functions: Record<string, (x: number) => number> = {
      sqrt: Math.sqrt,
      abs: Math.abs,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      asin: Math.asin,
      acos: Math.acos,
      atan: Math.atan,
      log: (x) => Math.log10(x),
      ln: (x) => Math.log(x),
      exp: Math.exp,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
    };
    if (token in constants) {
      this.pos++;
      return () => constants[token];
    }
    if (token in functions) {
      this.pos++;
      if (this.tokens[this.pos] !== "(") {
        throw new Error(`Expected ( after function ${token}`);
      }
      this.pos++;
      const arg = this.parseExpression();
      if (this.tokens[this.pos] !== ")") {
        throw new Error(`Expected ) after function argument for ${token}`);
      }
      this.pos++;
      return () => functions[token](arg());
    }
    throw new Error(`Unexpected token: ${token}`);
  }
}

export const calculatorTool: ToolDefinition = {
  name: "calculator",
  description:
    "Evaluate a mathematical expression safely. Supports +, -, *, /, %, ^ (power), " +
    "parentheses, and functions: sqrt, abs, sin, cos, tan, asin, acos, atan, log (base 10), " +
    "ln (natural), exp, floor, ceil, round. Constants: pi, e. Example: 'sqrt(16) + 2^3' = 12",
  inputSchema: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "The mathematical expression to evaluate, e.g. '2 + 3 * 4' or 'sqrt(144) + pi'",
      },
    },
    required: ["expression"],
  },
  handler: async (args) => {
    const expr = args.expression as string;
    if (!expr || typeof expr !== "string") {
      return textResult("Error: expression is required and must be a string", true);
    }
    try {
      const result = evaluateMath(expr);
      if (!isFinite(result)) {
        return textResult(`Expression: ${expr}\nResult: Infinity or NaN (undefined)`, true);
      }
      // Round to avoid floating point noise
      const rounded = Math.round(result * 1e10) / 1e10;
      return textResult(`Expression: ${expr}\nResult: ${rounded}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return textResult(`Error evaluating expression '${expr}': ${msg}`, true);
    }
  },
};
