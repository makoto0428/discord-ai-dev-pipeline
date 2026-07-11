const logger = require('../utils/logger');
const {
  createMessage,
  createSession,
  getActiveSession,
  getLatestDraft,
  getLastMessage,
  getLastMessageType,
  getDraftById,
  getMessagesBySessionAndRound,
  updateSessionStatus,
} = require('../db/db');
const { runRound } = require('../orchestrator/roundRunner');
const { runDirectorQuestionFormatter } = require('../orchestrator/roles/director');
const {
  postDraftReviewConfirmation,
  postQuestionForHuman,
  postAiDiscussion,
  postAmbiguousDraftReplyNotice,
  postAmbiguousQuestionAnswerNotice,
  postAcknowledgedOk,
} = require('./messageBuilder');

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません。`);
  }

  return value;
}

function getMaxRounds() {
  const rawValue = process.env.MAX_ROUNDS || '10';
  const maxRounds = Number.parseInt(rawValue, 10);

  if (Number.isNaN(maxRounds) || maxRounds <= 0) {
    throw new Error(`MAX_ROUNDS の値が不正です: ${rawValue}`);
  }

  return maxRounds;
}

function shouldShowAiDiscussion() {
  return (process.env.SHOW_AI_DISCUSSION || 'false').toLowerCase() === 'true';
}

function detectHumanContext(sessionId) {
  const lastMessageType = getLastMessageType(sessionId);
  if (lastMessageType === 'question') {
    return 'question_answer';
  }

  const lastMessage = getLastMessage(sessionId);
  const latestDraft = getLatestDraft(sessionId);

  if (
    lastMessage?.role === 'reviewer'
    && lastMessage?.message_type === 'normal'
    && (latestDraft?.reviewer_verdict === 'ok' || latestDraft?.reviewer_verdict === 'needs_revision')
  ) {
    return 'draft_confirmation';
  }

  return 'normal';
}

function classifyDraftConfirmationReply(content) {
  const normalized = content.trim().toLowerCase();

  if (/^(ok|okay|承認|問題ありません|この内容でok|確定)$/.test(normalized)) {
    return 'ok';
  }

  if (normalized.includes('修正') || normalized.includes('変更') || normalized.includes('追記')) {
    return 'revision';
  }

  return 'ambiguous';
}

function isAmbiguousQuestionAnswer(content) {
  const normalized = content.trim();
  if (normalized.length < 2) {
    return true;
  }
  return /^(わからない|不明|どっちでも|任せる)$/.test(normalized);
}

async function postRoundResultToDiscord({ channel, result, runDirectorQuestionFormatterFn }) {
  if (result.nextAction === 'ask_human') {
    const formatted = await runDirectorQuestionFormatterFn({
      rawQuestion: result.questionText,
    });

    await postQuestionForHuman({
      channel,
      questionText: formatted.content,
      sourceRole: result.questionSource,
      isFollowUp: Boolean(result.isFollowUpQuestion),
    });
    return;
  }

  if (result.nextAction === 'review_result') {
    const draft = getDraftById(result.draftId);
    if (!draft) {
      throw new Error(`ドラフトが見つかりません: ${result.draftId}`);
    }

    await postDraftReviewConfirmation({
      channel,
      roundNumber: result.roundNumber,
      draftMarkdown: draft.content_markdown,
      reviewerVerdict: result.reviewerVerdict,
      reviewerComment: result.reviewerComment,
    });
  }
}

async function postAiDiscussionIfEnabled({ channel, sessionId, roundNumber }) {
  if (!shouldShowAiDiscussion()) {
    return;
  }

  const roundMessages = getMessagesBySessionAndRound(sessionId, roundNumber)
    .filter((m) => m.role === 'director' || m.role === 'requirements_writer' || m.role === 'reviewer');

  for (const m of roundMessages) {
    await postAiDiscussion({
      channel,
      role: m.role,
      messageType: m.message_type,
      content: m.content,
    });
  }
}

async function handleMessageCreate(message, deps = {}) {
  const runRoundFn = deps.runRound || runRound;
  const runDirectorQuestionFormatterFn = deps.runDirectorQuestionFormatter || runDirectorQuestionFormatter;

  if (message.author?.bot) {
    return;
  }

  const targetChannelId = getRequiredEnv('DISCORD_CHANNEL_ID');
  const adminUserId = getRequiredEnv('DISCORD_ADMIN_USER_ID');

  if (message.channelId !== targetChannelId) {
    logger.debug('対象外チャンネルのため無視しました', {
      channelId: message.channelId,
      messageId: message.id,
    });
    return;
  }

  if (message.author.id !== adminUserId) {
    logger.warn('管理者以外の投稿のため無視しました', {
      channelId: message.channelId,
      userId: message.author.id,
      messageId: message.id,
    });
    return;
  }

  const activeSession = getActiveSession();

  if (!activeSession) {
    const { id: sessionId } = createSession({
      discordChannelId: message.channelId,
      discordUserId: message.author.id,
      initialRequest: message.content,
      maxRounds: getMaxRounds(),
    });

    createMessage({
      sessionId,
      role: 'human',
      messageType: 'normal',
      content: message.content,
      roundNumber: 0,
    });

    logger.info('新規セッションを開始しました', {
      sessionId,
      channelId: message.channelId,
      userId: message.author.id,
    });

    const result = await runRoundFn({
      sessionId,
      humanInput: message.content,
      logger,
    });

    await postAiDiscussionIfEnabled({
      channel: message.channel,
      sessionId,
      roundNumber: result.roundNumber,
    });

    await postRoundResultToDiscord({
      channel: message.channel,
      result,
      runDirectorQuestionFormatterFn,
    });

    logger.info('M6ラウンド実行結果', {
      sessionId,
      roundNumber: result.roundNumber,
      nextAction: result.nextAction,
      reviewerVerdict: result.reviewerVerdict,
      questionSource: result.questionSource,
    });
    return;
  }

  const humanContext = detectHumanContext(activeSession.id);

  if (humanContext === 'draft_confirmation') {
    const replyType = classifyDraftConfirmationReply(message.content);

    if (replyType === 'ambiguous') {
      await postAmbiguousDraftReplyNotice(message.channel);
      return;
    }

    createMessage({
      sessionId: activeSession.id,
      role: 'human',
      messageType: 'normal',
      content: message.content,
      roundNumber: activeSession.round_count,
    });

    if (replyType === 'ok') {
      updateSessionStatus(activeSession.id, 'confirmed');
      await postAcknowledgedOk(message.channel);
      return;
    }
  }

  if (humanContext === 'question_answer' && isAmbiguousQuestionAnswer(message.content)) {
    await postAmbiguousQuestionAnswerNotice(message.channel);
    return;
  }

  const humanMessageType = humanContext === 'question_answer' ? 'question_answer' : 'normal';

  createMessage({
    sessionId: activeSession.id,
    role: 'human',
    messageType: humanMessageType,
    content: message.content,
    roundNumber: activeSession.round_count,
  });

  logger.info('継続セッションへの返信を受信しました', {
    sessionId: activeSession.id,
    roundCount: activeSession.round_count,
    channelId: message.channelId,
    userId: message.author.id,
    humanMessageType,
  });

  const result = await runRoundFn({
    sessionId: activeSession.id,
    humanInput: message.content,
    logger,
  });

  await postAiDiscussionIfEnabled({
    channel: message.channel,
    sessionId: activeSession.id,
    roundNumber: result.roundNumber,
  });

  await postRoundResultToDiscord({
    channel: message.channel,
    result,
    runDirectorQuestionFormatterFn,
  });

  logger.info('M6ラウンド実行結果', {
    sessionId: activeSession.id,
    roundNumber: result.roundNumber,
    nextAction: result.nextAction,
    reviewerVerdict: result.reviewerVerdict,
    questionSource: result.questionSource,
  });
}

function registerEventHandlers(client) {
  client.on('messageCreate', async (message) => {
    try {
      await handleMessageCreate(message);
    } catch (error) {
      logger.error('messageCreate の処理中にエラーが発生しました', error);
    }
  });
}

module.exports = {
  getMaxRounds,
  handleMessageCreate,
  registerEventHandlers,
};