'use strict';

const path = require('path');
const fs = require('fs');
const { chatWithRole } = require('../../../../shared/ollama/ollamaClient');

const PROMPT_PATH = path.resolve(__dirname, '../../../prompts/reviewer.md');

let _systemPrompt = null;

function getSystemPrompt() {
  if (!_systemPrompt) {
    _systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf-8');
  }
  return _systemPrompt;
}

/**
 * レビュー役の応答をパースして verdict / comment / questions を取り出す。
 * @param {string} content
 * @returns {{ verdict: 'OK'|'NEEDS_REVISION'|'QUESTION'|'UNKNOWN', comment: string, questions: string[] }}
 */
function parseReviewerOutput(content) {
  const firstLine = content.split('\n')[0].trim();

  let verdict = 'UNKNOWN';
  if (firstLine === 'VERDICT: OK') {
    verdict = 'OK';
  } else if (firstLine === 'VERDICT: NEEDS_REVISION') {
    verdict = 'NEEDS_REVISION';
  } else if (firstLine === 'VERDICT: QUESTION') {
    verdict = 'QUESTION';
  }

  // ### 指摘事項 セクションを抽出
  const commentMatch = content.match(/###\s*指摘事項\s*\n([\s\S]*?)(?=###|$)/);
  const rawComment = commentMatch ? commentMatch[1].trim() : '';
  const comment = rawComment === 'なし' ? '' : rawComment;

  // ### 質問 セクションを抽出
  const questionMatch = content.match(/###\s*質問\s*\n([\s\S]*?)(?=###|$)/);
  const rawQuestions = questionMatch ? questionMatch[1].trim() : '';
  const questions =
    rawQuestions && rawQuestions !== 'なし'
      ? rawQuestions
          .split('\n')
          .map((line) => line.replace(/^[-・]\s*/, '').trim())
          .filter((line) => line.length > 0)
      : [];

  return { verdict, comment, questions };
}

/**
 * レビュー役AIを呼び出す。
 * @param {object} params
 * @param {string} params.draft - 要件定義役が作成したドラフト
 * @param {string} [params.humanInput] - 人間の最新の入力（コンテキスト）
 * @param {boolean} [params.internalDeliberationMode] - 内部協議モードフラグ
 * @param {string} [params.deliberationContext] - 内部協議モード時の追加コンテキスト
 * @returns {Promise<{verdict: string, comment: string, questions: string[], rawContent: string, modelName: string}>}
 */
async function runReviewer({
  draft,
  humanInput = '',
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
  if (humanInput) {
    parts.push(`## 人間からの最新の入力（コンテキスト）\n${humanInput}`);
  }
  parts.push(`## レビュー対象ドラフト\n${draft}`);
  if (internalDeliberationMode && deliberationContext) {
    parts.push(`## 内部協議コンテキスト\n${deliberationContext}`);
  }

  const userPrompt = parts.join('\n\n');

  const result = await chatWithRole({
    role: 'reviewer',
    systemPrompt,
    userPrompt,
  });

  const { verdict, comment, questions } = parseReviewerOutput(result.content);

  return {
    verdict,
    comment,
    questions,
    rawContent: result.content,
    modelName: result.modelName,
  };
}

module.exports = { runReviewer, parseReviewerOutput };
