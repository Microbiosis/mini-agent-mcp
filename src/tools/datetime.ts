/**
 * Date/time tool — get current time, format dates, calculate date differences.
 */

import type { ToolDefinition } from "./types.js";
import { textResult } from "./types.js";

export const datetimeTool: ToolDefinition = {
  name: "datetime_info",
  description:
    "Get current date/time, format a date, or calculate the difference between two dates. " +
    "Operations: 'now' (current date/time, optional timezone), 'format' (format a date string, requires 'date' and 'format' params), " +
    "'diff' (difference between two dates, requires 'date' and 'date2' params). " +
    "Date format: ISO 8601 (e.g. '2024-01-15') or natural language. " +
    "Format string uses: YYYY, MM, DD, HH, mm, ss, dddd (day name).",
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["now", "format", "diff"],
        description: "The datetime operation to perform",
      },
      timezone: {
        type: "string",
        description:
          "Timezone for 'now' operation, e.g. 'Asia/Shanghai', 'America/New_York'. Defaults to UTC.",
      },
      date: {
        type: "string",
        description: "Date string for format/diff operations (ISO 8601 or parseable date)",
      },
      date2: {
        type: "string",
        description: "Second date for diff operation",
      },
      format: {
        type: "string",
        description: "Format string for format operation, e.g. 'YYYY-MM-DD HH:mm:ss'",
      },
    },
    required: ["operation"],
  },
  handler: async (args) => {
    const op = args.operation as string;

    switch (op) {
      case "now": {
        const tz = (args.timezone as string) || "UTC";
        try {
          const now = new Date();
          const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZoneName: "short",
          });
          const parts = formatter.formatToParts(now);
          const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
          const tzName = parts.find((p) => p.type === "timeZoneName")?.value || tz;

          return textResult(
            `Current date/time (${tzName}):\n` +
              `  ${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}\n` +
              `  ISO: ${now.toISOString()}\n` +
              `  Unix timestamp: ${Math.floor(now.getTime() / 1000)}`
          );
        } catch {
          return textResult(`Current date/time (UTC):\n  ${new Date().toISOString()}`, false);
        }
      }

      case "format": {
        const dateStr = args.date as string;
        const fmt = (args.format as string) || "YYYY-MM-DD HH:mm:ss";
        if (!dateStr) {
          return textResult("Error: 'date' is required for format operation", true);
        }
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
          return textResult(`Error: invalid date '${dateStr}'`, true);
        }
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const monthNames = [
          "January",
          "February",
          "March",
          "April",
          "May",
          "June",
          "July",
          "August",
          "September",
          "October",
          "November",
          "December",
        ];

        const pad = (n: number) => String(n).padStart(2, "0");
        const result = fmt
          .replace(/YYYY/g, String(date.getFullYear()))
          .replace(/YY/g, String(date.getFullYear()).slice(-2))
          .replace(/MMMM/g, monthNames[date.getMonth()])
          .replace(/MM/g, pad(date.getMonth() + 1))
          .replace(/DD/g, pad(date.getDate()))
          .replace(/dddd/g, dayNames[date.getDay()])
          .replace(/HH/g, pad(date.getHours()))
          .replace(/mm/g, pad(date.getMinutes()))
          .replace(/ss/g, pad(date.getSeconds()));

        return textResult(`Formatted: ${result}\n(Input: ${dateStr})`);
      }

      case "diff": {
        const d1 = args.date as string;
        const d2 = args.date2 as string;
        if (!d1 || !d2) {
          return textResult("Error: 'date' and 'date2' are required for diff operation", true);
        }
        const date1 = new Date(d1);
        const date2 = new Date(d2);
        if (isNaN(date1.getTime())) {
          return textResult(`Error: invalid date '${d1}'`, true);
        }
        if (isNaN(date2.getTime())) {
          return textResult(`Error: invalid date '${d2}'`, true);
        }
        const diffMs = date2.getTime() - date1.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const absDays = Math.abs(diffDays);

        return textResult(
          `Date difference:\n` +
            `  Date 1: ${date1.toISOString()}\n` +
            `  Date 2: ${date2.toISOString()}\n` +
            `  Difference: ${diffDays} days (${diffHours} hours, ${diffMinutes} minutes)\n` +
            `  Absolute: ${absDays} days\n` +
            `  Direction: ${diffMs >= 0 ? "Date 2 is after Date 1" : "Date 2 is before Date 1"}`
        );
      }

      default:
        return textResult(`Error: unknown operation '${op}'`, true);
    }
  },
};
