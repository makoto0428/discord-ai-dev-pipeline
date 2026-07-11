'use strict';

/**
 * M6 動作確認スクリプト
 * 新規セッションを作成して roundRunner.runRound() を1回実行し、
 * 3AIの応答がDBへ記録されることと質問分岐が機能することを確認する。
 */

process.env.DB_PATH = './data/check_round_runner_test.db';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  initDb,
  closeDb,
  createSession,
  createMessage,
  getSessionById,
  getMessagesBySession,
  getDraftsBySession,
} = require('../src/db/db');
const { runRound } = require('../src/orchestrator/roundRunner');

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

async function main() {
  console.log('\n=== M6 roundRunner 動作確認 ===');

  initDb();

  const initialRequest = '在庫管理システムを作りたい。入出庫記録と在庫アラートがほしい。';
  const { id: sessionId } = createSession({
    discordChannelId: 'ch-check-round',
    discordUserId: 'user-check-round',
    initialRequest,
    maxRounds: 10,
  });

  createMessage({
    sessionId,
    role: 'human',
    messageType: 'normal',
    content: initialRequest,
    roundNumber: 0,
  });

  const result = await runRound({
    sessionId,
    humanInput: initialRequest,
    logger: console,
  });

  console.log('\n[結果]');
  console.log(result);

  const messages = getMessagesBySession(sessionId);
  const drafts = getDraftsBySession(sessionId);
  const session = getSessionById(sessionId);

  console.log('\n[検証]');
  assert(drafts.length >= 1, 'ドラフトが1件以上保存されている');
  assert(messages.some((m) => m.role === 'director'), '指示役メッセージが保存されている');
  assert(messages.some((m) => m.role === 'requirements_writer'), '要件定義役メッセージが保存されている');

  if (result.nextAction === 'ask_human') {
    assert(session.round_count === 0, '質問分岐時はround_countを増やさない');
    assert(session.question_count >= 1, '質問分岐時はquestion_countを増やす');
    assert(messages.some((m) => m.message_type === 'question'), '質問メッセージが保存されている');
    console.log('  ✓ 質問分岐を確認');
  } else {
    assert(messages.some((m) => m.role === 'reviewer'), 'レビュー役メッセージが保存されている');
    assert(session.round_count === 1, '通常分岐時はround_countが1増える');
    console.log('  ✓ 通常分岐を確認');
  }

  closeDb();

  // テスト用DB削除
  const dbPath = path.resolve(__dirname, '../data/check_round_runner_test.db');
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${dbPath}${suffix}`;
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }

  console.log('\n✅ M6 roundRunner のチェックが完了しました。\n');
}

main().catch((error) => {
  console.error('\n❌ checkRoundRunner 失敗:', error.message);
  closeDb();
  process.exit(1);
});
