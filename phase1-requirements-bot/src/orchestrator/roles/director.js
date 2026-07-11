'use strict';

const path = require('path');
const fs = require('fs');
const { chatWithRole } = require('../../../../shared/ollama/ollamaClient');

const PROMPT_PATH = path.resolve(__dirname, '../../../prompts/director.md');
const QUESTION_FORMATTER_PROMPT_PATH = path.resolve(__dirname, '../../../prompts/directorQuestionFormatter.md');

let _systemPrompt = null;
let _questionFormatterPrompt = null;

function loadPrompt(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function getSystemPrompt() {
  if (!_systemPrompt) {
    _systemPrompt = loadPrompt(PROMPT_PATH);
  }
  return _systemPrompt;
}

function getQuestionFormatterPrompt() {
  if (!_questionFormatterPrompt) {
    _questionFormatterPrompt = loadPrompt(QUESTION_FORMATTER_PROMPT_PATH);
  }
  return _questionFormatterPrompt;
}

/**
 * 指示役AIを呼び出す。人間の入力を解釈し、要件定義役AIへの指示を生成する。
 * @param {object} params
 * @param {string} params.humanInput - 人間の入力（要望や修正指示）
 * @param {string} [params.currentDraft] - 現在のドラフト（ある場合）
 * @param {string} [params.humanSummary] - セッション開始からの人間の発言の要約
 * @returns {Promise<{content: string, modelName: string}>}
 */
async function runDirector({ humanInput, currentDraft = '', humanSummary = '' }) {
  const systemPrompt = getSystemPrompt();

  const parts = [];
  if (humanSummary) {
    parts.push(`## これまでの人間の発言の要約\n${humanSummary}`);
  }
  if (currentDraft) {
    parts.push(`## 現在のドラフト\n${currentDraft}`);
  }
  parts.push(`## 人間からの入力\n${humanInput}`);

  const userPrompt = parts.join('\n\n');

  const result = await chatWithRole({
    role: 'director',
    systemPrompt,
    userPrompt,
  });

  return { content: result.content, modelName: result.modelName };
}

/**
 * 指示役AIを質問整形モードで呼び出す。
 * AIチームから出た質問を人間向けに整形する。
 * @param {object} params
 * @param {string} params.rawQuestion - 要件定義役またはレビュー役の質問原文
 * @returns {Promise<{content: string, modelName: string}>}
 */
async function runDirectorQuestionFormatter({ rawQuestion }) {
  const systemPrompt = getQuestionFormatterPrompt();

  const result = await chatWithRole({
    role: 'director',
    systemPrompt,
    userPrompt: rawQuestion,
  });

  return { content: result.content, modelName: result.modelName };
}

module.exports = { runDirector, runDirectorQuestionFormatter };
