/**
 * Tool definitions for Seeking Tools.
 *
 * Each tool is one functional analysis run on pasted text. Every tool returns
 * the SAME JSON shape (see ANALYSIS_SCHEMA) so the on-device and in-cloud
 * paths are interchangeable — the hybrid structured-output pattern from the
 * Firebase docs:
 *   cloud:     inCloudParams.generationConfig { responseMimeType, responseSchema }
 *   on-device: onDeviceParams.promptOptions { responseConstraint }
 *
 * Routing (the hybrid idea):
 *   - "local" tools are quick checks -> PREFER_ON_DEVICE (private, nothing
 *     leaves the device when Nano runs).
 *   - "cloud" tools are deeper synthesis -> PREFER_IN_CLOUD (heavier
 *     reasoning, larger context).
 * The app always shows which path actually ran (result.response.inferenceSource).
 */

import { Schema } from "firebase/ai";

export const SEVERITIES = ["low", "medium", "high"];

const findingSchema = Schema.object({
  properties: {
    title: Schema.string(),
    detail: Schema.string(),
    severity: Schema.enumString({ enum: SEVERITIES }),
  },
});

export const ANALYSIS_SCHEMA = Schema.object({
  properties: {
    summary: Schema.string(),
    findings: Schema.array({ items: findingSchema }),
    questions: Schema.array({ items: Schema.string() }),
  },
  optionalProperties: ["questions"],
});

const SYSTEM_PROMPT = `You are the Silence Listener inside Seeking Tools, an investigation workbench.
Your job is to question every narrative, even official ones, and to look at what is NOT confirmed.
Rules:
- Never accept a claim just because it is presented as official or authoritative.
- Distinguish what the text actually says from what it implies.
- Report only what the text supports; mark anything you cannot verify as unconfirmed.
- Be specific and concrete. Name the gap, not a vague feeling.
- Answer with JSON only, matching the provided schema. No markdown, no extra text.`;

export const TOOLS = {
  "silence-listener": {
    id: "silence-listener",
    name: "Silence Listener",
    route: "local",
    routeLabel: "Quick check · on-device first",
    instruction: `Read the pasted text and list what is NOT said: the facts, numbers, names, dates, sources, or context that a complete account would need but this text omits. For each missing item, say why its absence matters and what would fill the gap. Put the hard unanswered questions in "questions".`,
  },
  "omission-reading": {
    id: "omission-reading",
    name: "Omission Reading",
    route: "local",
    routeLabel: "Quick check · on-device first",
    instruction: `Read the pasted text and map each significant claim to the evidence the text actually provides for it. For every claim with weak, missing, or only-implied evidence, record it as a finding with severity (high = central claim with no evidence). Put the evidence gaps as questions in "questions".`,
  },
  "damage-control": {
    id: "damage-control",
    name: "Damage-Control Reader",
    route: "cloud",
    routeLabel: "Deep synthesis · cloud first",
    instruction: `Read the pasted text as a piece of damage control and narrative framing. Identify deflection (changing the subject), minimization (making something smaller than it is), selective emphasis, loaded language, and any shift in what the story is about compared to what happened. For each, quote the move briefly and explain what it is doing. Put the questions the framing avoids in "questions".`,
  },
  "question-everything": {
    id: "question-everything",
    name: "Question Everything",
    route: "cloud",
    routeLabel: "Deep synthesis · cloud first",
    instruction: `Read the pasted text and generate the hard questions it does not answer, even if it looks 100% correct on the surface. Include: alternative explanations for the same facts, what evidence would confirm or refute the central claim, who benefits from this framing, what a sceptic would ask, and what the text assumes without saying. Put most of the output in "questions", and use "findings" for the assumptions the text quietly makes.`,
  },
};

export function buildPrompt(tool, text) {
  return `${SYSTEM_PROMPT}\n\n---\nTool: ${tool.name}\nInstruction: ${tool.instruction}\n\n---\nText to investigate:\n${text}`;
}

/** On-device (Gemini Nano) context is about 9,216 tokens. Past that, force cloud. */
export const LOCAL_MAX_CHARS = 5000;
