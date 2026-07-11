'use strict';

/**
 * M7 動作確認スクリプト
 * 人間確認フロー（draft確認/質問回答/曖昧返信再確認/Discord投稿）を検証する。
 */

process.env.DB_PATH = './data/check_human_flow_test.db';
process.env.DISCORD_CHANNEL_ID = 'ch-m7';
process.env.DISCORD_ADMIN_USER_ID = 'admin-m7';
process.env.MAX_ROUNDS = '10';
process.env.SHOW_AI_DISCUSSION = 'false';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  initDb,
  closeDb,
  createSession,
  createMessage,
  createDraft,
  updateDraftReview,
  updateSessionStatus,
  getMessagesBySession,
  getSessionById,
} = require('../src/db/db');
const { handleMessageCreate } = require('../src/discord/eventHandlers');

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

function createInProgressSession(initialRequest) {
  return createSession({
    discordChannelId: process.env.DISCORD_CHANNEL_ID,
    discordUserId: process.env.DISCORD_ADMIN_USER_ID,
    initialRequest,
    maxRounds: 10,
  }).id;
}

async function scenarioAmbiguousDraftReply() {
  console.log('\n[Scenario 1] ドラフト確認への曖昧返信');

  const sessionId = createInProgressSession('在庫管理アプリを作りたい');
  const { id: draftId } = createDraft({
    sessionId,
    roundNumber: 1,
    contentMarkdown: '# Draft\n本文',
    writerQuestion: null,
  });
  updateDraftReview(draftId, {
    reviewerVerdict: 'needs_revision',
    reviewerComment: 'コメント',
  });

  createMessage({
    sessionId,
    role: 'reviewer',
    messageType: 'normal',
    content: 'VERDICT: NEEDS_REVISION',
    roundNumber: 1,
  });

  const beforeCount = getMessagesBySession(sessionId).length;
  const channel = createMockChannel();

  await handleMessageCreate(buildMessage({ channel, content: 'よろしく' }), {
    runRound: async () => {
      throw new Error('曖昧返信時はrunRoundが呼ばれない想定');
    },
  });

  const afterCount = getMessagesBySession(sessionId).length;
  assert(afterCount === beforeCount, '曖昧返信時は人間メッセージを保存しない');
  assert(channel.sends.some((s) => `${s.content || ''}`.includes('再確認')), '再確認メッセージを投稿する');

  updateSessionStatus(sessionId, 'confirmed');
}

async function scenarioQuestionAnswerAndQuestionPost() {
  console.log('\n[Scenario 2] 質問回答として処理し次の質問を投稿');

  const sessionId = createInProgressSession('要件を整理したい');
  createMessage({
    sessionId,
    role: 'reviewer',
    messageType: 'question',
    content: '運用時間帯を教えてください',
    roundNumber: 1,
  });

  const channel = createMockChannel();

  await handleMessageCreate(buildMessage({ channel, content: '平日9-18時です' }), {
    runRound: async () => ({
      sessionId,
      roundNumber: 2,
      nextAction: 'ask_human',
      questionSource: 'reviewer',
      questionText: '- SLAをどこまで保証しますか？',
      isFollowUpQuestion: true,
      draftId: 1,
    }),
    runDirectorQuestionFormatter: async ({ rawQuestion }) => ({
      content: rawQuestion.replace('- ', ''),
      modelName: 'mock',
    }),
  });

  const messages = getMessagesBySession(sessionId);
  assert(messages.some((m) => m.role === 'human' && m.message_type === 'question_answer'), '質問回答をquestion_answerで保存する');
  assert(channel.sends.some((s) => `${s.content || ''}`.includes('❓ 質問')), '質問投稿が行われる');
  assert(channel.sends.some((s) => `${s.content || ''}`.includes('内部協議でも解決しなかった')), 'フォローアップ文言が付与される');

  updateSessionStatus(sessionId, 'confirmed');
}

async function scenarioReviewResultPostAndOkReply() {
  console.log('\n[Scenario 3] ドラフト確認投稿とOK解釈');

  const sessionId = createInProgressSession('顧客管理システム');
  createMessage({
    sessionId,
    role: 'human',
    messageType: 'normal',
    content: '初回要望',
    roundNumber: 0,
  });

  const { id: draftId } = createDraft({
    sessionId,
    roundNumber: 1,
    contentMarkdown: '# 顧客管理システム 要件定義書\n## 1. 背景・目的\n本文',
    writerQuestion: null,
  });
  updateDraftReview(draftId, {
    reviewerVerdict: 'ok',
    reviewerComment: '不足なし',
  });

  const channel1 = createMockChannel();

  await handleMessageCreate(buildMessage({ channel: channel1, content: '次へ' }), {
    runRound: async () => ({
      sessionId,
      roundNumber: 1,
      nextAction: 'review_result',
      reviewerVerdict: 'ok',
      reviewerComment: '不足なし',
      draftId,
    }),
  });

  assert(channel1.sends.some((s) => `${s.content || ''}`.includes('📝 ドラフト確認')), 'ドラフト確認メッセージを投稿する');
  assert(channel1.sends.some((s) => Array.isArray(s.files) && s.files.length > 0), 'ドラフト全文を添付する');

  // reviewer通常メッセージを追加して draft_confirmation コンテキストを作る
  createMessage({
    sessionId,
    role: 'reviewer',
    messageType: 'normal',
    content: 'VERDICT: OK',
    roundNumber: 1,
  });

  const channel2 = createMockChannel();
  await handleMessageCreate(buildMessage({ channel: channel2, content: 'OK' }), {
    runRound: async () => {
      throw new Error('OK返信時はrunRoundが呼ばれない想定');
    },
  });

  const session = getSessionById(sessionId);
  assert(session.status === 'confirmed', 'OK返信時にセッションをconfirmedへ更新する');
  assert(channel2.sends.some((s) => `${s.content || ''}`.includes('✅ 受付完了')), 'OK受付メッセージを投稿する');
}

async function main() {
  initDb();

  await scenarioAmbiguousDraftReply();
  await scenarioQuestionAnswerAndQuestionPost();
  await scenarioReviewResultPostAndOkReply();

  closeDb();

  const dbPath = path.resolve(__dirname, '../data/check_human_flow_test.db');
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${dbPath}${suffix}`;
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }

  console.log('\n✅ M7 人間確認フローのチェックが完了しました。\n');
}

main().catch((error) => {
  console.error('\n❌ checkHumanFlow 失敗:', error.message);
  closeDb();
  process.exit(1);
});
