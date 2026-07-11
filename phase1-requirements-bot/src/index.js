require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const logger = require('./utils/logger');

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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  logger.info(`Bot が起動しました: ${client.user.tag}`);
});

client.on('error', (err) => {
  logger.error('Discord クライアントエラー', err);
});

process.on('unhandledRejection', (err) => {
  logger.error('未処理の Promise 拒否', err);
});

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  logger.error('Discord へのログインに失敗しました', err);
  process.exit(1);
});
