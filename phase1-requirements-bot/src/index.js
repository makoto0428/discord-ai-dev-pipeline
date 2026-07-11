require('dotenv').config();
const logger = require('./utils/logger');
const { initDb, closeDb } = require('./db/db');
const { createDiscordClient, loginDiscordClient } = require('./discord/client');

const requiredEnvVars = [
  'DISCORD_TOKEN',
  'DISCORD_CHANNEL_ID',
  'DISCORD_ADMIN_USER_ID',
];

function getMissingRequiredEnvVars() {
  return requiredEnvVars.filter((key) => !process.env[key]);
}

function validateEnvOrExit() {
  const missing = getMissingRequiredEnvVars();

  if (missing.length > 0) {
    logger.error('必須の環境変数が不足しているため起動できません。', {
      missing,
      hint: 'phase1-requirements-bot/.env.example をコピーして .env を作成し、値を設定してください。',
    });
    process.exit(1);
  }

  const suspicious = requiredEnvVars.filter((key) => {
    const value = `${process.env[key] || ''}`.toLowerCase();
    return value.includes('your_') || value.includes('here');
  });

  if (suspicious.length > 0) {
    logger.warn('環境変数にプレースホルダー値の可能性があります。', {
      keys: suspicious,
    });
  }
}

function shutdown(code = 0) {
  closeDb();
  process.exit(code);
}

validateEnvOrExit();

initDb();

const client = createDiscordClient();

logger.info('Bot起動設定を読み込みました', {
  targetChannel: process.env.DISCORD_CHANNEL_ID,
  adminUser: process.env.DISCORD_ADMIN_USER_ID,
  logLevel: process.env.LOG_LEVEL || 'INFO',
});

process.on('unhandledRejection', (err) => {
  logger.error('未処理の Promise 拒否', err);
});

process.on('uncaughtException', (err) => {
  logger.error('未処理の例外', err);
  shutdown(1);
});

process.on('SIGINT', () => {
  logger.info('SIGINT を受信したためシャットダウンします');
  shutdown(0);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM を受信したためシャットダウンします');
  shutdown(0);
});

loginDiscordClient(client, process.env.DISCORD_TOKEN).catch((err) => {
  logger.error('Discord へのログインに失敗しました', err);
  shutdown(1);
});
