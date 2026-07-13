/**
 * Deep Research — multi-step research workflow (MS-Agent pattern)
 *
 * Flow:
 *   1. Decompose question into sub-questions
 *   2. Search for each sub-question
 *   3. Summarize findings
 *   4. Generate final report
 */

import { runAgent } from "../agent/react.js";

export interface ResearchResult {
  question: string;
  subQuestions: Array<{ question: string; findings: string }>;
  report: string;
  totalSteps: number;
  durationMs: number;
}

/**
 * Parse sub-questions from an LLM decomposition answer.
 *
 * Strict contract (fixes the over-permissive original):
 *   1. Prefer content inside a fenced code block (```...``` or ```lang...```)
 *   2. Each kept line MUST start with "- " followed by ≥12 non-trivial chars
 *   3. Cap results to `max` items (default 5)
 *   4. Returns [] if nothing valid — caller should fall back to the original question
 *
 * This is exported so tests can verify it without involving an LLM.
 */
export function parseSubQuestions(answer: string, max = 5): string[] {
  if (!answer || typeof answer !== "string") return [];

  // Step 1 — try to extract fenced code block first; this is the
  // most reliable signal because the prompt asks for ```...```
  let body = answer;
  const fenceMatch = answer.match(/```(?:[a-zA-Z0-9_-]+)?\n?([\s\S]*?)\n?```/);
  if (fenceMatch && fenceMatch[1]) {
    body = fenceMatch[1];
  }

  // Step 2 — strict line match: "- " plus at least 12 chars of content
  const out: string[] = [];
  const lineRe = /^-\s+(.{12,})$/;
  for (const raw of body.split(/\r?\n/)) {
    const m = raw.match(lineRe);
    if (!m) continue;
    const text = m[1].trim().replace(/\s+/g, " ");
    if (text.length < 12) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Run a deep research workflow on a question.
 * Uses the agent's search tools + LLM to produce a comprehensive report.
 */
export async function deepResearch(question: string): Promise<ResearchResult> {
  const start = Date.now();
  const subQuestions: string[] = [];
  const findings: Array<{ question: string; findings: string }> = [];
  let totalSteps = 0;

  // Step 1: Decompose — ask LLM to break down the question
  // Hardened prompt: require fenced code block to constrain LLM output
  const decomposition = await runAgent(
    `You are a research planner. Break down this question into 3-5 specific sub-questions that when answered together will provide a comprehensive answer.

Question: "${question}"

Output ONLY a fenced code block containing the list. Each item must be on its own line starting with "- ". Do not add any prose before or after the block. Example:

\`\`\`
- What is X?
- How does Y work?
- Why does Z matter?
\`\`\``
  );
  totalSteps++;

  // Parse sub-questions using the strict helper
  const parsed = parseSubQuestions(decomposition.answer, 5);
  if (parsed.length === 0) {
    // Fallback: use the original question as one sub-question
    subQuestions.push(question);
  } else {
    subQuestions.push(...parsed);
  }

  // Step 2: Research each sub-question
  for (const sq of subQuestions) {
    const searchResult = await runAgent(
      `Search for information about: "${sq}". 
Then summarize what you found in 3-5 bullet points. Be factual and cite specific details.`
    );
    totalSteps++;
    findings.push({ question: sq, findings: searchResult.answer });
  }

  // Step 3: Synthesize — generate final report
  const findingsText = findings
    .map((f) => `## ${f.question}\n${f.findings}`)
    .join("\n\n");

  const reportResult = await runAgent(
    `You are a research report writer. Synthesize the following research findings into a comprehensive, well-structured report.

Original Question: "${question}"

Research Findings:
${findingsText}

Write a complete report with:
1. Executive Summary (2-3 sentences)
2. Key Findings (organized by sub-topic)
3. Conclusions

Format in Markdown. Be thorough and informative.`
  );
  totalSteps++;

  return {
    question,
    subQuestions: findings,
    report: reportResult.answer,
    totalSteps,
    durationMs: Date.now() - start,
  };
}