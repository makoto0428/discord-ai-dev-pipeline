'use strict';

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../output/requirements');

function sanitizeFileName(input) {
  return `${input || ''}`
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function reasonLabel(reason) {
  if (reason === 'review_ok') return 'レビューOK';
  if (reason === 'max_rounds') return '最大ラウンド到達';
  if (reason === 'human_ok') return '人間OK';
  return '不明';
}

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function buildFrontMatter({ session, draft, reason }) {
  return [
    `- セッションID: ${session.id}`,
    `- ステータス: confirmed`,
    `- 確定理由: ${reasonLabel(reason)}`,
    `- 最終ラウンド: ${draft.round_number}`,
    `- 作成日時: ${new Date().toISOString()}`,
  ].join('\n');
}

function wrapDocument({ session, draft, reason }) {
  const front = buildFrontMatter({ session, draft, reason });
  const initialRequest = (session.initial_request || '').trim();
  const draftBody = (draft.content_markdown || '').trim();

  return [
    '# 要件定義書（確定版）',
    '',
    '## メタ情報',
    front,
    '',
    '## 初回要望',
    initialRequest || '（未記録）',
    '',
    '## 最終ドラフト',
    draftBody,
    '',
  ].join('\n');
}

/**
 * 最終ドラフトをテンプレート形式に整形して output/requirements 配下へ保存する。
 * @param {{ session: object, draft: object, reason: string }} params
 * @returns {string} 保存したファイルの絶対パス
 */
function exportRequirementsMarkdown({ session, draft, reason }) {
  ensureOutputDir();

  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  const baseName = sanitizeFileName(`session-${session.id}-${timestamp}`);
  const fileName = `${baseName || `session-${session.id}`}.md`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  const body = wrapDocument({ session, draft, reason });
  fs.writeFileSync(filePath, body, 'utf-8');

  return filePath;
}

module.exports = {
  OUTPUT_DIR,
  exportRequirementsMarkdown,
};
