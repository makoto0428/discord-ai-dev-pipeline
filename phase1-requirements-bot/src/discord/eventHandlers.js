const logger = require('../utils/logger');
const {
  createMessage,
  createSession,
  getActiveSession,
  getLastMessageType,
} = require('../db/db');
const { runRound } = require('../orchestrator/roundRunner');

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

async function handleMessageCreate(message) {
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

    const result = await runRound({
      sessionId,
      humanInput: message.content,
      logger,
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

  const lastMessageType = getLastMessageType(activeSession.id);
  const humanMessageType = lastMessageType === 'question' ? 'question_answer' : 'normal';

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

  const result = await runRound({
    sessionId: activeSession.id,
    humanInput: message.content,
    logger,
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