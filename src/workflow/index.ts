/**
 * Workflow module barrel — exports DAG + deep research.
 */

export { runWorkflow, buildStepTask, type WorkflowStep, type WorkflowResult } from "./dag.js";
export { deepResearch, parseSubQuestions, type ResearchResult } from "./research.js";
