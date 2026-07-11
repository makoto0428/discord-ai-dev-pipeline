require('dotenv').config();
const logger = require('./utils/logger');
const { initDb, closeDb } = require('./db/db');
const { createDiscordClient, loginDiscordClient } = require('./discord/client');

// .env 必須項目の確認
const requiredEnvVars = [
  'DISCORD_TOKEN',
  'DISCORD_CHANNEL_ID',
  'DISCORD_ADMIN_USER_ID',
];

for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    logger.error(`.env に ${key} が設定されていません。Bot を起動できません。`);
    process.exit(1);
  }
}

initDb();

const client = createDiscordClient();

process.on('unhandledRejection', (err) => {
  logger.error('未処理の Promise 拒否', err);
});

process.on('SIGINT', () => {
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});

loginDiscordClient(client, process.env.DISCORD_TOKEN).catch((err) => {
  logger.error('Discord へのログインに失敗しました', err);
  closeDb();
  process.exit(1);
});
