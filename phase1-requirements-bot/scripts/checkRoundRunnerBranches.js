'use strict';

/**
 * M6 分岐検証スクリプト（モック）
 * writer質問 / reviewer質問 / 内部協議解決 の3シナリオを決定的に確認する。
 */

process.env.DB_PATH = './data/check_round_runner_branches_test.db';
process.env.MAX_INTERNAL_DELIBERATION = '1';

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
} = require('../src/db/db');
const { runRound } = require('../src/orchestrator/roundRunner');

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

function createTestSession(initialRequest) {
  const { id: sessionId } = createSession({
    discordChannelId: 'ch-m6-mock',
    discordUserId: 'user-m6-mock',
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

  return sessionId;
}

async function scenarioWriterQuestion() {
  console.log('\n[Scenario 1] writer質問（新規質問）');

  const sessionId = createTestSession('writer質問を確認する');

  const result = await runRound({
    sessionId,
    humanInput: 'writer質問を確認する',
    deps: {
      runDirector: async () => ({ content: 'director instruction', modelName: 'mock' }),
      runRequirementsWriter: async () => ({
        draftBody: '# Draft',
        questions: ['writer question 1'],
        rawContent: '# Draft\n\n## 要確認事項\n- writer question 1',
        modelName: 'mock',
      }),
      runReviewer: async () => {
        throw new Error('writer質問時にreviewerは呼ばれない想定');
      },
    },
  });

  assert(result.nextAction === 'ask_human', '質問分岐に入る');
  assert(result.questionSource === 'requirements_writer', '質問元がrequirements_writer');

  const session = getSessionById(sessionId);
  assert(session.round_count === 0, '質問分岐時はround_countを増やさない');
  assert(session.question_count === 1, '質問分岐時はquestion_countを増やす');
}

async function scenarioReviewerQuestion() {
  console.log('\n[Scenario 2] reviewer質問（新規質問）');

  const sessionId = createTestSession('reviewer質問を確認する');

  const result = await runRound({
    sessionId,
    humanInput: 'reviewer質問を確認する',
    deps: {
      runDirector: async () => ({ content: 'director instruction', modelName: 'mock' }),
      runRequirementsWriter: async () => ({
        draftBody: '# Draft',
        questions: [],
        rawContent: '# Draft\n\n## 要確認事項\nなし',
        modelName: 'mock',
      }),
      runReviewer: async () => ({
        verdict: 'QUESTION',
        comment: '',
        questions: ['reviewer question 1'],
        rawContent: 'VERDICT: QUESTION\n\n### 指摘事項\nなし\n\n### 質問\n- reviewer question 1',
        modelName: 'mock',
      }),
    },
  });

  assert(result.nextAction === 'ask_human', '質問分岐に入る');
  assert(result.questionSource === 'reviewer', '質問元がreviewer');

  const session = getSessionById(sessionId);
  assert(session.round_count === 0, '質問分岐時はround_countを増やさない');
  assert(session.question_count === 1, '質問分岐時はquestion_countを増やす');
}

async function scenarioInternalDeliberationResolved() {
  console.log('\n[Scenario 3] question_answer直後の内部協議解決');

  const sessionId = createTestSession('内部協議を確認する');

  // 直前が question_answer になるように質問→回答履歴を投入
  createMessage({
    sessionId,
    role: 'requirements_writer',
    messageType: 'question',
    content: '既存質問',
    roundNumber: 0,
  });
  createMessage({
    sessionId,
    role: 'human',
    messageType: 'question_answer',
    content: '既存質問への回答',
    roundNumber: 0,
  });

  let writerCalls = 0;

  const result = await runRound({
    sessionId,
    humanInput: '追加の回答',
    deps: {
      runDirector: async () => ({ content: 'director instruction', modelName: 'mock' }),
      runRequirementsWriter: async ({ internalDeliberationMode }) => {
        writerCalls += 1;

        if (!internalDeliberationMode) {
          return {
            draftBody: '# Draft before delib',
            questions: ['再質問'],
            rawContent: '# Draft before delib\n\n## 要確認事項\n- 再質問',
            modelName: 'mock',
          };
        }

        return {
          draftBody: '# Draft resolved',
          questions: [],
          rawContent: '# Draft resolved\n\n## 要確認事項\nなし',
          modelName: 'mock',
        };
      },
      runReviewer: async () => ({
        verdict: 'OK',
        comment: '',
        questions: [],
        rawContent: 'VERDICT: OK\n\n### 指摘事項\nなし\n\n### 質問\nなし',
        modelName: 'mock',
      }),
    },
  });

  assert(writerCalls >= 2, '内部協議で発端ロールが再実行される');
  assert(result.nextAction === 'review_result', '内部協議解決後は通常のレビュー結果に進む');
  assert(result.reviewerVerdict === 'ok', 'レビュー結果が保存される');

  const session = getSessionById(sessionId);
  assert(session.round_count === 1, '解決時はround_countを増やす');
  assert(session.question_count === 0, '内部協議解決時はquestion_countを増やさない');

  const messages = getMessagesBySession(sessionId);
  assert(
    messages.some((m) => m.message_type === 'internal_deliberation'),
    '内部協議メッセージが保存される',
  );
}

async function main() {
  initDb();

  await scenarioWriterQuestion();
  await scenarioReviewerQuestion();
  await scenarioInternalDeliberationResolved();

  closeDb();

  const dbPath = path.resolve(__dirname, '../data/check_round_runner_branches_test.db');
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${dbPath}${suffix}`;
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }

  console.log('\n✅ M6 分岐検証（モック）が完了しました。\n');
}

main().catch((error) => {
  console.error('\n❌ checkRoundRunnerBranches 失敗:', error.message);
  closeDb();
  process.exit(1);
});
