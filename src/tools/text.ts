/**
 * Text processing tools — statistics and transformations.
 */

import type { ToolDefinition } from "./types.js";
import { textResult } from "./types.js";

export const textStatsTool: ToolDefinition = {
  name: "text_stats",
  description:
    "Analyze text and return statistics: character count, word count, sentence count, " +
    "paragraph count, average word length, and most frequent words.",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The text to analyze",
      },
    },
    required: ["text"],
  },
  handler: async (args) => {
    const text = args.text as string;
    if (!text) {
      return textResult("Error: text is required", true);
    }

    const chars = text.length;
    const charsNoSpaces = text.replace(/\s/g, "").length;
    const words = text.trim().split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const sentences = text.split(/[.!?。！？]+/).filter((s) => s.trim().length > 0);
    const sentenceCount = sentences.length;
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    const paragraphCount = paragraphs.length || 1;
    const avgWordLength =
      wordCount > 0 ? (words.reduce((sum, w) => sum + w.length, 0) / wordCount).toFixed(2) : "0";
    const avgWordsPerSentence = sentenceCount > 0 ? (wordCount / sentenceCount).toFixed(1) : "0";

    // Word frequency
    const freq: Record<string, number> = {};
    for (const w of words) {
      const lower = w.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, "");
      if (lower) {
        freq[lower] = (freq[lower] || 0) + 1;
      }
    }
    const topWords = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word, count]) => `  ${word}: ${count}`)
      .join("\n");

    const result = [
      `Text Statistics:`,
      `  Characters: ${chars}`,
      `  Characters (no spaces): ${charsNoSpaces}`,
      `  Words: ${wordCount}`,
      `  Sentences: ${sentenceCount}`,
      `  Paragraphs: ${paragraphCount}`,
      `  Avg word length: ${avgWordLength}`,
      `  Avg words/sentence: ${avgWordsPerSentence}`,
      `  Top words:`,
      topWords || "  (none)",
    ].join("\n");

    return textResult(result);
  },
};

export const textTransformTool: ToolDefinition = {
  name: "text_transform",
  description:
    "Transform text in various ways. Operations: uppercase, lowercase, titlecase, " +
    "reverse, trim, remove_duplicates (remove duplicate lines), sort_lines, " +
    "count_substring (requires 'pattern' param), replace (requires 'pattern' and 'replacement' params).",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The text to transform",
      },
      operation: {
        type: "string",
        enum: [
          "uppercase",
          "lowercase",
          "titlecase",
          "reverse",
          "trim",
          "remove_duplicates",
          "sort_lines",
          "count_substring",
          "replace",
        ],
        description: "The transformation to apply",
      },
      pattern: {
        type: "string",
        description: "Pattern for count_substring or replace operations",
      },
      replacement: {
        type: "string",
        description: "Replacement text for replace operation",
      },
    },
    required: ["text", "operation"],
  },
  handler: async (args) => {
    const text = args.text as string;
    const op = args.operation as string;
    const pattern = args.pattern as string | undefined;
    const replacement = args.replacement as string | undefined;

    let result: string;

    switch (op) {
      case "uppercase":
        result = text.toUpperCase();
        break;
      case "lowercase":
        result = text.toLowerCase();
        break;
      case "titlecase":
        result = text.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
        break;
      case "reverse":
        result = text.split("").reverse().join("");
        break;
      case "trim":
        result = text
          .split("\n")
          .map((l) => l.trim())
          .join("\n")
          .trim();
        break;
      case "remove_duplicates": {
        const lines = text.split("\n");
        const seen = new Set<string>();
        result = lines
          .filter((l) => {
            if (seen.has(l)) return false;
            seen.add(l);
            return true;
          })
          .join("\n");
        break;
      }
      case "sort_lines":
        result = text
          .split("\n")
          .sort((a, b) => a.localeCompare(b))
          .join("\n");
        break;
      case "count_substring":
        if (!pattern) {
          return textResult("Error: 'pattern' is required for count_substring", true);
        }
        {
          const count = text.split(pattern).length - 1;
          result = `Pattern "${pattern}" found ${count} time(s) in the text.`;
        }
        break;
      case "replace":
        if (!pattern) {
          return textResult("Error: 'pattern' is required for replace", true);
        }
        result = text.split(pattern).join(replacement ?? "");
        break;
      default:
        return textResult(`Error: unknown operation '${op}'`, true);
    }

    return textResult(`Transform: ${op}\nResult:\n${result}`);
  },
};
