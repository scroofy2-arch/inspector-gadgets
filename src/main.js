/**
 * UI wiring for Seeking Tools.
 * - Tool selection, input handling, run button, progress display.
 * - Renders structured JSON results as cards, with the path badge that always
 *   names which inference path actually ran (on-device vs in-cloud).
 * - Findings log persisted in localStorage only; nothing is uploaded.
 */

import { analyze, initFirebase, isConfigured } from "./analyze.js";
import { LOCAL_MAX_CHARS, TOOLS } from "./tools.js";

const $ = (id) => document.getElementById(id);

const els = {
  statusPill: $("status-pill"),
  setupBanner: $("setup-banner"),
  sourceText: $("source-text"),
  charCount: $("char-count"),
  lengthNote: $("length-note"),
  toolGrid: $("tool-grid"),
  privateOnly: $("private-only"),
  runBtn: $("run-btn"),
  modelProgress: $("model-progress"),
  modelProgressLabel: $("model-progress-label"),
  modelProgressBar: $("model-progress-bar"),
  runError: $("run-error"),
  results: $("results"),
  resultsTitle: $("results-title"),
  pathBadge: $("path-badge"),
  pathNote: $("path-note"),
  resultSummary: $("result-summary"),
  findings: $("findings"),
  questionsBlock: $("questions-block"),
  questionsList: $("questions-list"),
  rawJson: $("raw-json"),
  findingsLog: $("findings-log"),
  clearLog: $("clear-log"),
};

const LOG_KEY = "seeking-tools-findings-log-v1";
let selectedTool = "silence-listener";

function setStatus(text, kind) {
  els.statusPill.textContent = text;
  els.statusPill.className = `status-pill status-${kind}`;
}

function setError(message) {
  if (!message) {
    els.runError.hidden = true;
    els.runError.textContent = "";
    return;
  }
  els.runError.hidden = false;
  els.runError.textContent = message;
}

function showProgress(label, fraction) {
  els.modelProgress.hidden = false;
  els.modelProgressLabel.textContent = label;
  els.modelProgressBar.style.width =
    fraction == null ? "100%" : `${Math.round(fraction * 100)}%`;
}

function hideProgress() {
  els.modelProgress.hidden = true;
  els.modelProgressBar.style.width = "0%";
}

/** Detect on-device availability (Chrome Prompt API) for the status pill. */
async function probeDeviceModel() {
  if (typeof LanguageModel === "undefined") {
    setStatus("On-device unavailable — cloud only", "cloud");
    return;
  }
  try {
    const availability = await LanguageModel.availability();
    if (availability === "available") {
      setStatus("On-device ready (Gemini Nano)", "device");
    } else if (availability === "downloading" || availability === "downloadable") {
      setStatus("On-device model downloading…", "downloading");
    } else {
      setStatus("On-device unavailable — cloud only", "cloud");
    }
  } catch {
    setStatus("On-device check failed — cloud only", "cloud");
  }
}

function pathBadge(inferenceSource, forcedCloud) {
  if (inferenceSource === "on_device") {
    els.pathBadge.textContent = "● ON-DEVICE · Gemini Nano";
    els.pathBadge.className = "path-badge path-device";
    els.pathNote.textContent =
      "Ran entirely on this device. Nothing was sent to the cloud.";
  } else {
    els.pathBadge.textContent = "● IN-CLOUD · Gemini Flash";
    els.pathBadge.className = "path-badge path-cloud";
    els.pathNote.textContent = forcedCloud
      ? "Ran in the cloud because the input is too long for the on-device model's context (~9,216 tokens)."
      : "Ran in the cloud (Gemini Flash). The text left this device.";
  }
}

function renderResults(tool, { data, inferenceSource, forcedCloud }) {
  els.results.hidden = false;
  els.resultsTitle.textContent = `${tool.name} — result`;
  pathBadge(inferenceSource, forcedCloud);
  els.resultSummary.textContent = data.summary || "";

  els.findings.innerHTML = "";
  (data.findings || []).forEach((f) => {
    const card = document.createElement("article");
    card.className = "finding-card";
    const sev = document.createElement("span");
    sev.className = `severity severity-${f.severity || "medium"}`;
    sev.textContent = (f.severity || "medium").toUpperCase();
    const title = document.createElement("h3");
    title.textContent = f.title || "";
    const detail = document.createElement("p");
    detail.textContent = f.detail || "";
    card.append(sev, title, detail);
    els.findings.append(card);
  });

  const questions = data.questions || [];
  els.questionsBlock.hidden = questions.length === 0;
  els.questionsList.innerHTML = "";
  questions.forEach((q) => {
    const li = document.createElement("li");
    li.textContent = q;
    els.questionsList.append(li);
  });

  els.rawJson.textContent = JSON.stringify(data, null, 2);
  els.results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function loadLog() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
  } catch {
    return [];
  }
}

function renderLog() {
  const entries = loadLog();
  els.findingsLog.innerHTML = "";
  if (entries.length === 0) {
    const li = document.createElement("li");
    li.className = "log-empty";
    li.textContent = "No analyses yet.";
    els.findingsLog.append(li);
    return;
  }
  entries
    .slice()
    .reverse()
    .forEach((e) => {
      const li = document.createElement("li");
      li.className = "log-entry";
      const when = new Date(e.at).toLocaleString();
      const badge = e.inferenceSource === "on_device" ? "ON-DEVICE" : "IN-CLOUD";
      li.innerHTML = "";
      const strong = document.createElement("strong");
      strong.textContent = e.toolName;
      const span = document.createElement("span");
      span.textContent = ` — ${badge} · ${when}`;
      const p = document.createElement("p");
      p.textContent = e.summary || "";
      li.append(strong, span, p);
      els.findingsLog.append(li);
    });
}

function addToLog(tool, result) {
  const entries = loadLog();
  entries.push({
    at: new Date().toISOString(),
    toolName: tool.name,
    inferenceSource: result.inferenceSource,
    summary: result.data.summary || "",
  });
  localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(-50)));
  renderLog();
}

async function onRun() {
  const text = els.sourceText.value.trim();
  if (!text) {
    setError("Paste some text to investigate first.");
    return;
  }
  const tool = TOOLS[selectedTool];
  setError("");
  els.runBtn.disabled = true;
  els.runBtn.textContent = "Running…";

  try {
    const result = await analyze(tool, text, {
      privateOnly: els.privateOnly.checked,
      onProgress: (fraction) => {
        if (fraction == null) {
          hideProgress();
        } else {
          showProgress(
            `Preparing on-device model… ${Math.round(fraction * 100)}%`,
            fraction
          );
        }
      },
    });
    hideProgress();
    renderResults(tool, result);
    addToLog(tool, result);
  } catch (err) {
    hideProgress();
    setError(
      err && err.message
        ? err.message
        : "Analysis failed. If you chose Private only, the on-device model may not be available on this browser."
    );
  } finally {
    els.runBtn.disabled = false;
    els.runBtn.textContent = "Run analysis";
  }
}

function onToolSelect(event) {
  const btn = event.target.closest("[data-tool]");
  if (!btn) return;
  selectedTool = btn.dataset.tool;
  els.toolGrid
    .querySelectorAll(".tool-card")
    .forEach((el) => el.classList.toggle("selected", el === btn));
}

function onInput() {
  const len = els.sourceText.value.length;
  els.charCount.textContent = `${len.toLocaleString()} characters`;
  els.lengthNote.hidden = len <= LOCAL_MAX_CHARS;
}

function init() {
  renderLog();
  onInput();

  els.toolGrid.addEventListener("click", onToolSelect);
  els.sourceText.addEventListener("input", onInput);
  els.runBtn.addEventListener("click", onRun);
  els.clearLog.addEventListener("click", () => {
    localStorage.removeItem(LOG_KEY);
    renderLog();
  });

  if (!isConfigured()) {
    els.setupBanner.hidden = false;
    setStatus("Not configured", "unknown");
    els.runBtn.disabled = true;
    return;
  }

  if (!initFirebase()) {
    setStatus("Firebase init failed", "unknown");
    return;
  }

  probeDeviceModel();
}

init();
