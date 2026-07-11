/**
 * Random generation tool — random numbers, UUIDs, passwords, pick from list.
 */

import type { ToolDefinition } from "./types.js";
import { textResult } from "./types.js";
import { randomUUID, randomBytes } from "node:crypto";

export const randomGenTool: ToolDefinition = {
  name: "random_gen",
  description:
    "Generate random values. Operations: 'number' (random int in range, requires 'min' and 'max'), " +
    "'uuid' (UUID v4), 'password' (random password, optional 'length' and 'uppercase'/'symbols' flags), " +
    "'pick' (pick N items from a list, requires 'items' array and optional 'count'), " +
    "'shuffle' (shuffle a list, requires 'items' array).",
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["number", "uuid", "password", "pick", "shuffle"],
        description: "The random generation operation",
      },
      min: {
        type: "number",
        description: "Minimum value for 'number' operation (inclusive)",
      },
      max: {
        type: "number",
        description: "Maximum value for 'number' operation (inclusive)",
      },
      length: {
        type: "number",
        description: "Length for password (default 16)",
      },
      uppercase: {
        type: "boolean",
        description: "Include uppercase in password (default true)",
      },
      symbols: {
        type: "boolean",
        description: "Include symbols in password (default true)",
      },
      items: {
        type: "array",
        items: { type: "string" },
        description: "Array of items for pick/shuffle operations",
      },
      count: {
        type: "number",
        description: "Number of items to pick for 'pick' operation (default 1)",
      },
    },
    required: ["operation"],
  },
  handler: async (args) => {
    const op = args.operation as string;

    switch (op) {
      case "number": {
        const min = Math.ceil(args.min as number);
        const max = Math.floor(args.max as number);
        if (isNaN(min) || isNaN(max)) {
          return textResult("Error: 'min' and 'max' are required for number operation", true);
        }
        if (min > max) {
          return textResult(`Error: min (${min}) cannot be greater than max (${max})`, true);
        }
        const result = Math.floor(Math.random() * (max - min + 1)) + min;
        return textResult(`Random number (${min}-${max}): ${result}`);
      }

      case "uuid": {
        const uuid = randomUUID();
        return textResult(`UUID v4: ${uuid}`);
      }

      case "password": {
        const len = (args.length as number) || 16;
        const useUpper = args.uppercase !== false;
        const useSymbols = args.symbols !== false;
        const lowercase = "abcdefghijklmnopqrstuvwxyz";
        const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const digits = "0123456789";
        const symbols = "!@#$%^&*()-_=+[]{}|;:,.<>?";
        let charset = lowercase + digits;
        if (useUpper) charset += uppercase;
        if (useSymbols) charset += symbols;

        const bytes = randomBytes(len);
        let password = "";
        for (let i = 0; i < len; i++) {
          password += charset[bytes[i] % charset.length];
        }
        const strength = len >= 16 && useUpper && useSymbols ? "strong" : len >= 8 ? "medium" : "weak";
        return textResult(`Password (${len} chars, strength: ${strength}):\n${password}`);
      }

      case "pick": {
        const items = args.items as string[];
        if (!Array.isArray(items) || items.length === 0) {
          return textResult("Error: 'items' array is required for pick operation", true);
        }
        const count = Math.min((args.count as number) || 1, items.length);
        const shuffled = [...items];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const picked = shuffled.slice(0, count);
        return textResult(`Picked ${count} from ${items.length} items:\n${picked.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}`);
      }

      case "shuffle": {
        const items = args.items as string[];
        if (!Array.isArray(items) || items.length === 0) {
          return textResult("Error: 'items' array is required for shuffle operation", true);
        }
        const shuffled = [...items];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return textResult(`Shuffled:\n${shuffled.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}`);
      }

      default:
        return textResult(`Error: unknown operation '${op}'`, true);
    }
  },
};
