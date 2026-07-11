'use strict';

/**
 * M8 動作確認スクリプト
 * checkCompletion と finalizeSession を検証する。
 */

process.env.DB_PATH = './data/check_finalization_test.db';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  initDb,
  closeDb,
  createSession,
  createDraft,
  updateDraftReview,
  getSessionById,
  incrementRoundCount,
} = require('../src/db/db');
const { checkCompletion, finalizeSession } = require('../src/orchestrator/sessionManager');

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

function createTestSession({ maxRounds, initialRequest }) {
  return createSession({
    discordChannelId: 'ch-m8',
    discordUserId: 'user-m8',
    initialRequest,
    maxRounds,
  }).id;
}

function cleanupFileIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

async function scenarioReviewOkCompletion() {
  console.log('\n[Scenario 1] レビューOKで完了判定');

  const sessionId = createTestSession({
    maxRounds: 5,
    initialRequest: 'レビューOK完了のテスト',
  });

  const { id: draftId } = createDraft({
    sessionId,
    roundNumber: 1,
    contentMarkdown: '# テスト要件定義\n## 1. 背景・目的\n本文',
  });
  updateDraftReview(draftId, {
    reviewerVerdict: 'ok',
    reviewerComment: '問題なし',
  });
  incrementRoundCount(sessionId);

  const completion = checkCompletion({
    sessionId,
    roundResult: {
      nextAction: 'review_result',
      reviewerVerdict: 'ok',
      draftId,
    },
  });

  assert(completion.isComplete === true, 'review_ok で完了判定になる');
  assert(completion.reason === 'review_ok', '完了理由が review_ok');

  const finalized = finalizeSession({
    sessionId,
    reason: completion.reason,
  });

  assert(fs.existsSync(finalized.outputPath), '最終Markdownファイルが生成される');
  assert(getSessionById(sessionId).status === 'confirmed', 'セッションが confirmed になる');

  cleanupFileIfExists(finalized.outputPath);
}

async function scenarioMaxRoundsCompletion() {
  console.log('\n[Scenario 2] 最大ラウンド到達で完了判定');

  const sessionId = createTestSession({
    maxRounds: 1,
    initialRequest: '最大ラウンド完了のテスト',
  });

  const { id: draftId } = createDraft({
    sessionId,
    roundNumber: 1,
    contentMarkdown: '# テスト要件定義\n## 1. 背景・目的\n本文',
  });
  updateDraftReview(draftId, {
    reviewerVerdict: 'needs_revision',
    reviewerComment: '追加修正が必要',
  });
  incrementRoundCount(sessionId);

  const completion = checkCompletion({
    sessionId,
    roundResult: {
      nextAction: 'review_result',
      reviewerVerdict: 'needs_revision',
      draftId,
    },
  });

  assert(completion.isComplete === true, 'max_rounds で完了判定になる');
  assert(completion.reason === 'max_rounds', '完了理由が max_rounds');

  const finalized = finalizeSession({
    sessionId,
    reason: completion.reason,
  });

  assert(fs.existsSync(finalized.outputPath), '最大ラウンド時も最終Markdownが生成される');

  const exportedBody = fs.readFileSync(finalized.outputPath, 'utf-8');
  assert(exportedBody.includes('## 最終ドラフト'), 'テンプレート形式で保存される');

  cleanupFileIfExists(finalized.outputPath);
}

async function main() {
  initDb();

  await scenarioReviewOkCompletion();
  await scenarioMaxRoundsCompletion();

  closeDb();

  const dbPath = path.resolve(__dirname, '../data/check_finalization_test.db');
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${dbPath}${suffix}`;
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }

  console.log('\n✅ M8 終了条件・確定処理のチェックが完了しました。\n');
}

main().catch((error) => {
  console.error('\n❌ checkFinalization 失敗:', error.message);
  closeDb();
  process.exit(1);
});
