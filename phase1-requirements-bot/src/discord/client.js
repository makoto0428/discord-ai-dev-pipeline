const { Client, GatewayIntentBits } = require('discord.js');
const logger = require('../utils/logger');
const { registerEventHandlers } = require('./eventHandlers');

function createDiscordClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  registerEventHandlers(client);

  client.once('clientReady', () => {
    logger.info(`Bot が起動しました: ${client.user.tag}`);
  });

  client.on('error', (error) => {
    logger.error('Discord クライアントエラー', error);
  });

  return client;
}

async function loginDiscordClient(client, token) {
  await client.login(token);
}

module.exports = {
  createDiscordClient,
  loginDiscordClient,
};