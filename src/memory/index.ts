/**
 * Long-term Memory — persistent memory for the agent.
 *
 * Uses a JSON file for storage.
 * Inspired by MemSense / ArkMem patterns.
 *
 * File location: `${MINI_AGENT_DATA_DIR}/memories/memories.json`
 * (default `.mini-agent/memories/memories.json` under the package directory).
 * Set `MINI_AGENT_DATA_DIR` to override.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface MemoryEntry {
  id: string;
  type: "fact" | "preference" | "task" | "skill" | "conversation";
  content: string;
  tags: string[];
  timestamp: number;
  accessCount: number;
}

const __pkgdir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = resolve(__pkgdir, "..", "..", ".mini-agent");
const DATA_ROOT = process.env.MINI_AGENT_DATA_DIR
  ? resolve(process.env.MINI_AGENT_DATA_DIR)
  : DEFAULT_DATA_DIR;
const MEMORY_DIR = resolve(DATA_ROOT, "memories");
const MEMORY_FILE = resolve(MEMORY_DIR, "memories.json");

function ensureDir(): void {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
}

function loadAll(): MemoryEntry[] {
  ensureDir();
  if (!existsSync(MEMORY_FILE)) return [];
  try {
    return JSON.parse(readFileSync(MEMORY_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveAll(entries: MemoryEntry[]): void {
  ensureDir();
  // Atomic write: temp file in the same dir, then rename. Prevents
  // half-written JSON when a concurrent process or signal interrupts us.
  const tmp = `${MEMORY_FILE}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(entries, null, 2), "utf8");
  renameSync(tmp, MEMORY_FILE);
}

/** Remember a piece of information */
export function remember(type: MemoryEntry["type"], content: string, tags: string[] = []): void {
  const entries = loadAll();
  entries.push({
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    content,
    tags,
    timestamp: Date.now(),
    accessCount: 0,
  });
  saveAll(entries);
  console.error(`[Memory] Stored: ${type} (${tags.join(", ")})`);
}

/** Recall memories matching tags */
export function recall(tags: string[], limit = 5): MemoryEntry[] {
  const entries = loadAll();
  const matched = entries
    .filter((e) => tags.some((t) => e.tags.includes(t)))
    .sort((a, b) => b.accessCount - a.accessCount)
    .slice(0, limit);

  // Increment access count
  for (const m of matched) m.accessCount++;
  saveAll(
    loadAll().map((e) => {
      const found = matched.find((m) => m.id === e.id);
      return found || e;
    })
  );

  return matched;
}

/** Search memories by content keyword */
export function searchMemories(keyword: string, limit = 5): MemoryEntry[] {
  return loadAll()
    .filter((e) => e.content.toLowerCase().includes(keyword.toLowerCase()))
    .slice(-limit)
    .reverse();
}

/** Get all memories of a specific type */
export function getMemories(type?: MemoryEntry["type"]): MemoryEntry[] {
  const entries = loadAll();
  return type ? entries.filter((e) => e.type === type).reverse() : entries.reverse();
}

/** Get memory stats */
export function getMemoryStats(): { total: number; byType: Record<string, number> } {
  const entries = loadAll();
  const byType: Record<string, number> = {};
  for (const e of entries) byType[e.type] = (byType[e.type] || 0) + 1;
  return { total: entries.length, byType };
}

/** Clear all memories */
export function clearMemories(): void {
  saveAll([]);
  console.error("[Memory] Cleared all memories");
}
