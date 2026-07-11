'use strict';

const path = require('path');
const fs = require('fs');
const { chatWithRole } = require('../../../../shared/ollama/ollamaClient');

const PROMPT_PATH = path.resolve(__dirname, '../../../prompts/requirementsWriter.md');

let _systemPrompt = null;

function getSystemPrompt() {
  if (!_systemPrompt) {
    _systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf-8');
  }
  return _systemPrompt;
}

/**
 * 要確認事項セクションをパースして本文と質問リストに分割する。
 * @param {string} content - 要件定義役の応答全文
 * @returns {{ draftBody: string, questions: string[] }}
 */
function parseRequirementsWriterOutput(content) {
  const marker = '## 要確認事項';
  const idx = content.indexOf(marker);

  if (idx === -1) {
    return { draftBody: content.trim(), questions: [] };
  }

  const draftBody = content.slice(0, idx).trim();
  const questionSection = content.slice(idx + marker.length).trim();

  if (!questionSection || questionSection === 'なし') {
    return { draftBody, questions: [] };
  }

  // 箇条書き行を抽出（「- 」または「・」始まり）
  const lines = questionSection.split('\n');
  const questions = lines
    .map((line) => line.replace(/^[-・]\s*/, '').trim())
    .filter((line) => line.length > 0 && line !== 'なし');

  return { draftBody, questions };
}

/**
 * 要件定義役AIを呼び出す。
 * @param {object} params
 * @param {string} params.directorInstruction - 指示役からの指示
 * @param {string} [params.currentDraft] - 現在のドラフト（ある場合）
 * @param {boolean} [params.internalDeliberationMode] - 内部協議モードフラグ
 * @param {string} [params.deliberationContext] - 内部協議モード時の追加コンテキスト
 * @returns {Promise<{draftBody: string, questions: string[], rawContent: string, modelName: string}>}
 */
async function runRequirementsWriter({
  directorInstruction,
  currentDraft = '',
  internalDeliberationMode = false,
  deliberationContext = '',
}) {
  let systemPrompt = getSystemPrompt();

  if (internalDeliberationMode) {
    const deliberationAddition = fs.readFileSync(
      path.resolve(__dirname, '../../../prompts/internalDeliberation.md'),
      'utf-8',
    );
    systemPrompt = `${systemPrompt}\n\n${deliberationAddition}`;
  }

  const parts = [];
  if (currentDraft) {
    parts.push(`## 現在のドラフト\n${currentDraft}`);
  }
  parts.push(`## 指示役AIからの指示\n${directorInstruction}`);
  if (internalDeliberationMode && deliberationContext) {
    parts.push(`## 内部協議コンテキスト\n${deliberationContext}`);
  }

  const userPrompt = parts.join('\n\n');

  const result = await chatWithRole({
    role: 'requirementsWriter',
    systemPrompt,
    userPrompt,
  });

  const { draftBody, questions } = parseRequirementsWriterOutput(result.content);

  return {
    draftBody,
    questions,
    rawContent: result.content,
    modelName: result.modelName,
  };
}

module.exports = { runRequirementsWriter, parseRequirementsWriterOutput };
