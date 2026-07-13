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
 * Run a deep research workflow on a question.
 * Uses the agent's search tools + LLM to produce a comprehensive report.
 */
export async function deepResearch(question: string): Promise<ResearchResult> {
  const start = Date.now();
  const subQuestions: string[] = [];
  const findings: Array<{ question: string; findings: string }> = [];
  let totalSteps = 0;

  // Step 1: Decompose — ask LLM to break down the question
  const decomposition = await runAgent(
    `You are a research planner. Break down this question into 3-5 specific sub-questions that when answered together will provide a comprehensive answer. 
Question: "${question}"
    
Output each sub-question on a new line starting with "- ". Be specific and actionable.`
  );
  totalSteps++;

  // Parse sub-questions
  for (const line of decomposition.answer.split("\n")) {
    const trimmed = line.replace(/^-\s*/, "").trim();
    if (trimmed && trimmed.length > 10) {
      subQuestions.push(trimmed);
    }
  }
  if (subQuestions.length === 0) {
    // Fallback: use the original question as one sub-question
    subQuestions.push(question);
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