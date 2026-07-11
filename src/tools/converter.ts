/**
 * Unit conversion tool — length, weight, temperature, and more.
 */

import type { ToolDefinition } from "./types.js";
import { textResult } from "./types.js";

// Conversion factors to base unit
const lengthFactors: Record<string, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
  inch: 0.0254,
  in: 0.0254,
  inches: 0.0254,
  ft: 0.3048,
  feet: 0.3048,
  yard: 0.9144,
  yd: 0.9144,
  yards: 0.9144,
  mile: 1609.344,
  mi: 1609.344,
  miles: 1609.344,
};

const weightFactors: Record<string, number> = {
  mg: 0.001,
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilo: 1000,
  kilos: 1000,
  kilogram: 1000,
  kilograms: 1000,
  ton: 1000000,
  t: 1000000,
  oz: 28.3495,
  ounce: 28.3495,
  ounces: 28.3495,
  lb: 453.592,
  lbs: 453.592,
  pound: 453.592,
  pounds: 453.592,
};

const dataFactors: Record<string, number> = {
  bit: 1,
  byte: 8,
  B: 8,
  KB: 8 * 1024,
  MB: 8 * 1024 * 1024,
  GB: 8 * 1024 * 1024 * 1024,
  TB: 8 * 1024 * 1024 * 1024 * 1024,
};

function convertTemperature(value: number, from: string, to: string): number {
  // Convert to Celsius first
  let celsius: number;
  switch (from.toLowerCase()) {
    case "c":
    case "celsius":
      celsius = value;
      break;
    case "f":
    case "fahrenheit":
      celsius = (value - 32) * (5 / 9);
      break;
    case "k":
    case "kelvin":
      celsius = value - 273.15;
      break;
    default:
      throw new Error(`Unknown temperature unit: ${from}`);
  }
  // Convert from Celsius to target
  switch (to.toLowerCase()) {
    case "c":
    case "celsius":
      return celsius;
    case "f":
    case "fahrenheit":
      return celsius * (9 / 5) + 32;
    case "k":
    case "kelvin":
      return celsius + 273.15;
    default:
      throw new Error(`Unknown temperature unit: ${to}`);
  }
}

function convertGeneric(
  value: number,
  from: string,
  to: string,
  factors: Record<string, number>
): number {
  if (!(from in factors)) {
    throw new Error(`Unknown unit: ${from}. Available: ${Object.keys(factors).join(", ")}`);
  }
  if (!(to in factors)) {
    throw new Error(`Unknown unit: ${to}. Available: ${Object.keys(factors).join(", ")}`);
  }
  // Convert to base then to target
  return (value * factors[from]) / factors[to];
}

export const unitConvertTool: ToolDefinition = {
  name: "unit_convert",
  description:
    "Convert between units of the same category. Categories: length (mm, cm, m, km, inch, in, ft, yard, yd, mile, mi), " +
    "weight (mg, g, kg, ton, t, oz, lb, pound), temperature (C, F, K), data (bit, byte, KB, MB, GB, TB). " +
    "Example: convert 100 from 'cm' to 'inch'.",
  inputSchema: {
    type: "object",
    properties: {
      value: {
        type: "number",
        description: "The value to convert",
      },
      from: {
        type: "string",
        description: "Source unit, e.g. 'cm', 'kg', 'C', 'KB'",
      },
      to: {
        type: "string",
        description: "Target unit, e.g. 'inch', 'lb', 'F', 'MB'",
      },
    },
    required: ["value", "from", "to"],
  },
  handler: async (args) => {
    const value = args.value as number;
    const from = args.from as string;
    const to = args.to as string;

    if (typeof value !== "number" || isNaN(value)) {
      return textResult("Error: value must be a number", true);
    }
    if (!from || !to) {
      return textResult("Error: 'from' and 'to' units are required", true);
    }

    // Detect category
    const fromLower = from.toLowerCase();
    const tempUnits = ["c", "f", "k", "celsius", "fahrenheit", "kelvin"];
    const isTemp =
      tempUnits.includes(fromLower) && tempUnits.includes(to.toLowerCase());

    try {
      let result: number;
      let category: string;

      if (isTemp) {
        result = convertTemperature(value, from, to);
        category = "temperature";
      } else if (from in lengthFactors && to in lengthFactors) {
        result = convertGeneric(value, from, to, lengthFactors);
        category = "length";
      } else if (from in weightFactors && to in weightFactors) {
        result = convertGeneric(value, from, to, weightFactors);
        category = "weight";
      } else if (from in dataFactors && to in dataFactors) {
        result = convertGeneric(value, from, to, dataFactors);
        category = "data";
      } else {
        return textResult(
          `Error: cannot convert from '${from}' to '${to}'. ` +
            `Make sure both units belong to the same category.\n` +
            `Available units:\n` +
            `  Length: ${Object.keys(lengthFactors).join(", ")}\n` +
            `  Weight: ${Object.keys(weightFactors).join(", ")}\n` +
            `  Temperature: C, F, K\n` +
            `  Data: ${Object.keys(dataFactors).join(", ")}`,
          true
        );
      }

      const rounded = Math.round(result * 1e6) / 1e6;
      return textResult(
        `${value} ${from} = ${rounded} ${to}\n(category: ${category})`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return textResult(`Conversion error: ${msg}`, true);
    }
  },
};
