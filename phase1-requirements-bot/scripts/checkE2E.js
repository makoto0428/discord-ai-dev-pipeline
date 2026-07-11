'use strict';

/**
 * M9 エンドツーエンド動作確認スクリプト
 *
 * 確認項目:
 * 1) 正常系: セッション開始〜確定までの流れ
 * 2) エラー系: Ollama接続エラー時の挙動
 * 3) 再起動系: DB永続化によりセッション継続できること
 */

process.env.DB_PATH = './data/check_e2e_test.db';
process.env.DISCORD_CHANNEL_ID = 'ch-m9';
process.env.DISCORD_ADMIN_USER_ID = 'admin-m9';
process.env.MAX_ROUNDS = '3';
process.env.SHOW_AI_DISCUSSION = 'false';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  initDb,
  closeDb,
  createMessage,
  getSessionById,
  getActiveSession,
  getMessagesBySession,
  getLatestDraft,
  updateSessionStatus,
} = require('../src/db/db');
const { handleMessageCreate } = require('../src/discord/eventHandlers');
const { chatWithRole } = require('../../shared/ollama/ollamaClient');
const { OUTPUT_DIR } = require('../src/output/markdownExporter');

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

function createMockChannel() {
  const sends = [];
  return {
    sends,
    async send(payload) {
      sends.push(payload);
      return payload;
    },
  };
}

function buildMessage({ channel, content }) {
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    channelId: process.env.DISCORD_CHANNEL_ID,
    channel,
    author: {
      id: process.env.DISCORD_ADMIN_USER_ID,
      bot: false,
    },
    content,
  };
}

async function scenarioNormalFlow() {
  console.log('\n[Scenario 1] 正常系: セッション開始〜確定');

  const channel = createMockChannel();

  // 1通目: 新規セッション開始、review_resultで確認投稿へ
  await handleMessageCreate(buildMessage({ channel, content: '社内FAQ検索システムを作りたい' }), {
    runRound: async ({ sessionId }) => {
      createMessage({
        sessionId,
        role: 'reviewer',
        messageType: 'normal',
        content: 'VERDICT: NEEDS_REVISION',
        roundNumber: 1,
      });
      const { createDraft, updateDraftReview } = require('../src/db/db');
      const { id: draftId } = createDraft({
        sessionId,
        roundNumber: 1,
        contentMarkdown: '# FAQ検索システム 要件定義書\n## 1. 背景・目的\n社内問い合わせ削減',
      });
      updateDraftReview(draftId, {
        reviewerVerdict: 'needs_revision',
        reviewerComment: '軽微な修正提案',
      });
      return {
        sessionId,
        roundNumber: 1,
        nextAction: 'review_result',
        reviewerVerdict: 'needs_revision',
        reviewerComment: '軽微な修正提案',
        draftId,
      };
    },
  });

  const active = getActiveSession();
  assert(active && active.status === 'in_progress', 'セッションが開始され進行中である');
  assert(channel.sends.some((s) => `${s.content || ''}`.includes('📝 ドラフト確認')), 'ドラフト確認投稿が行われる');

  // 2通目: 人間OKで確定
  await handleMessageCreate(buildMessage({ channel, content: 'OK' }));

  const session = getSessionById(active.id);
  assert(session.status === 'confirmed', 'OK後にセッションがconfirmedになる');
  assert(channel.sends.some((s) => `${s.content || ''}`.includes('✅ 完了報告')), '完了報告が投稿される');

  const latestDraft = getLatestDraft(active.id);
  assert(!!latestDraft, '最終ドラフトがDBに残っている');
}

async function scenarioOllamaErrorFlow() {
  console.log('\n[Scenario 2] エラー系: Ollama接続エラー');

  const originalHost = process.env.OLLAMA_HOST;
  const originalRetry = process.env.OLLAMA_RETRY_COUNT;
  const originalTimeout = process.env.OLLAMA_TIMEOUT_MS;

  try {
    process.env.OLLAMA_HOST = 'http://127.0.0.1:1';
    process.env.OLLAMA_RETRY_COUNT = '0';
    process.env.OLLAMA_TIMEOUT_MS = '300';

    await chatWithRole({
      role: 'director',
      systemPrompt: 'you are tester',
      userPrompt: 'ping',
      model: 'dummy-model',
      logger: console,
    });

    assert(false, '到達しない想定（接続エラーが発生すべき）');
  } catch (error) {
    assert(
      /Ollama|ECONNREFUSED|ENOTFOUND|AbortError|connect|fetch/i.test(`${error.message}`),
      '接続エラーを検出できる',
    );
    console.log(`  参考エラー: ${error.message}`);
  } finally {
    process.env.OLLAMA_HOST = originalHost;
    process.env.OLLAMA_RETRY_COUNT = originalRetry;
    process.env.OLLAMA_TIMEOUT_MS = originalTimeout;
  }
}

async function scenarioRestartFlow() {
  console.log('\n[Scenario 3] 再起動系: セッション継続');

  const sessionId = getSessionById(1)?.id || null;
  assert(sessionId !== null, '事前に作成済みセッションが存在する');

  // 再起動を模擬
  closeDb();
  initDb();

  const activeAfterRestart = getActiveSession();
  assert(activeAfterRestart === undefined, '既存セッションは確定済みのため進行中セッションなし');

  // 新しい進行中セッションを作って再起動継続確認
  const { createSession } = require('../src/db/db');
  const newSessionId = createSession({
    discordChannelId: process.env.DISCORD_CHANNEL_ID,
    discordUserId: process.env.DISCORD_ADMIN_USER_ID,
    initialRequest: '再起動継続確認',
    maxRounds: 3,
  }).id;

  createMessage({
    sessionId: newSessionId,
    role: 'human',
    messageType: 'normal',
    content: '初回入力',
    roundNumber: 0,
  });

  closeDb();
  initDb();

  const resumed = getActiveSession();
  assert(resumed && resumed.id === newSessionId, '再起動後も進行中セッションを再取得できる');

  const channel = createMockChannel();
  await handleMessageCreate(buildMessage({ channel, content: '継続入力です' }), {
    runRound: async ({ sessionId: sid }) => ({
      sessionId: sid,
      roundNumber: 1,
      nextAction: 'ask_human',
      questionSource: 'reviewer',
      questionText: '- 追加確認です',
      isFollowUpQuestion: false,
      draftId: 1,
    }),
    runDirectorQuestionFormatter: async ({ rawQuestion }) => ({
      content: rawQuestion,
      modelName: 'mock',
    }),
  });

  const messages = getMessagesBySession(newSessionId);
  assert(messages.some((m) => m.role === 'human' && m.content.includes('継続入力です')), '再起動後の入力が同一セッションに保存される');

  updateSessionStatus(newSessionId, 'confirmed');
}

function cleanupOutputs() {
  if (fs.existsSync(OUTPUT_DIR)) {
    const files = fs.readdirSync(OUTPUT_DIR);
    for (const file of files) {
      const filePath = path.join(OUTPUT_DIR, file);
      if (fs.statSync(filePath).isFile() && file.startsWith('session-')) {
        fs.unlinkSync(filePath);
      }
    }
  }
}

function cleanupDbFile() {
  const dbPath = path.resolve(__dirname, '../data/check_e2e_test.db');
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${dbPath}${suffix}`;
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }
}

async function main() {
  initDb();

  await scenarioNormalFlow();
  await scenarioOllamaErrorFlow();
  await scenarioRestartFlow();

  closeDb();
  cleanupOutputs();
  cleanupDbFile();

  console.log('\n✅ M9 エンドツーエンド動作確認が完了しました。\n');
}

main().catch((error) => {
  console.error('\n❌ checkE2E 失敗:', error.message);
  closeDb();
  process.exit(1);
});
