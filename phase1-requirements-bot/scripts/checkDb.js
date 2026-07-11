/**
 * scripts/checkDb.js
 * DB層の動作確認スクリプト。
 * セッション作成 → メッセージ追加 → ドラフト追加 → 取得 の一連の流れを確認する。
 *
 * 実行: node scripts/checkDb.js
 */

process.env.DB_PATH = './data/check_db_test.db';

require('dotenv').config();
const {
  initDb,
  closeDb,
  createSession,
  getSessionById,
  getActiveSession,
  updateSessionStatus,
  incrementRoundCount,
  incrementQuestionCount,
  incrementDeliberationCount,
  resetDeliberationCount,
  createMessage,
  getMessagesBySession,
  getLastMessageType,
  createDraft,
  updateDraftReview,
  getLatestDraft,
} = require('../src/db/db');

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

initDb();
console.log('\n[1] セッション作成');
const { id: sessionId } = createSession({
  discordChannelId: 'ch-001',
  discordUserId: 'user-001',
  initialRequest: 'テスト用の要望です。',
  maxRounds: 10,
});
assert(typeof sessionId === 'number' && sessionId > 0, `セッション作成 id=${sessionId}`);

console.log('\n[2] セッション取得');
const session = getSessionById(sessionId);
assert(session.id === sessionId, 'getSessionById');
assert(session.status === 'in_progress', 'status=in_progress');
assert(session.round_count === 0, 'round_count=0');

console.log('\n[3] 進行中セッション取得');
const active = getActiveSession();
assert(active !== undefined, 'getActiveSession が結果を返す');
assert(active.id === sessionId, 'getActiveSession のIDが一致');

console.log('\n[4] カウント操作');
incrementRoundCount(sessionId);
incrementRoundCount(sessionId);
assert(getSessionById(sessionId).round_count === 2, 'round_count=2');

incrementQuestionCount(sessionId);
const s2 = getSessionById(sessionId);
assert(s2.question_count === 1, 'question_count=1');
assert(s2.deliberation_count === 0, 'question後にdeliberation_count=0');

incrementDeliberationCount(sessionId);
incrementDeliberationCount(sessionId);
assert(getSessionById(sessionId).deliberation_count === 2, 'deliberation_count=2');

resetDeliberationCount(sessionId);
assert(getSessionById(sessionId).deliberation_count === 0, 'deliberation_count reset=0');

console.log('\n[5] メッセージ追加');
const { id: msgId1 } = createMessage({
  sessionId,
  role: 'human',
  messageType: 'normal',
  content: '要件定義書を作ってください。',
  roundNumber: 1,
});
assert(typeof msgId1 === 'number', `メッセージ作成 id=${msgId1}`);

createMessage({ sessionId, role: 'director', messageType: 'normal', content: '了解しました。', roundNumber: 1 });
createMessage({ sessionId, role: 'requirements_writer', messageType: 'question', content: '詳細を教えてください。', roundNumber: 1 });

const messages = getMessagesBySession(sessionId);
assert(messages.length === 3, 'メッセージ3件取得');

const lastType = getLastMessageType(sessionId);
assert(lastType === 'question', `getLastMessageType=${lastType}`);

console.log('\n[6] ドラフト追加・レビュー更新');
const { id: draftId } = createDraft({
  sessionId,
  roundNumber: 1,
  contentMarkdown: '# 要件定義書\n## 1. 目的\nテスト。',
  writerQuestion: null,
});
assert(typeof draftId === 'number', `ドラフト作成 id=${draftId}`);

updateDraftReview(draftId, { reviewerVerdict: 'needs_revision', reviewerComment: '目的が不明瞭です。' });
const draft = getLatestDraft(sessionId);
assert(draft.reviewer_verdict === 'needs_revision', 'reviewer_verdict=needs_revision');
assert(draft.reviewer_comment === '目的が不明瞭です。', 'reviewer_comment が正しい');

console.log('\n[7] ステータス更新');
updateSessionStatus(sessionId, 'confirmed');
assert(getSessionById(sessionId).status === 'confirmed', 'status=confirmed');

closeDb();

// テスト用DBを削除
const fs = require('fs');
const path = require('path');
const dbPath = path.resolve(__dirname, '../data/check_db_test.db');
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
const walPath = dbPath + '-wal';
const shmPath = dbPath + '-shm';
if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

console.log('\n✅ すべてのチェックが通過しました。\n');
