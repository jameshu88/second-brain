const { App } = require('@slack/bolt');
const { writeCapture } = require('../capture/writeInbox');
const { ack } = require('./reply');

function buildHandlers({ vaultPath, allowedUserIds }) {
  const isAllowed = (userId) => {
    if (!userId) return false;
    if (allowedUserIds.length === 0) return true;
    return allowedUserIds.includes(userId);
  };

  async function onMessage({ message, client, logger }) {
    try {
      if (message.subtype || message.bot_id) return;
      if (!message.user) return;
      if (!isAllowed(message.user)) {
        logger.warn(`ignoring message from ${message.user}`);
        return;
      }
      // Slice 1: only DM (im); ignore other channel types here.
      if (message.channel_type !== 'im' && !(message.channel || '').startsWith('D')) {
        return;
      }
      const text = (message.text || '').trim();
      if (!text) return;

      const filePath = await writeCapture({
        vaultPath,
        text,
        userId: message.user,
        ts: message.ts,
        channelType: 'dm',
        channelId: message.channel,
      });
      logger.info?.(`capture written: ${filePath}`);
      void ack; void client;
    } catch (err) {
      logger.error(err);
    }
  }

  async function onAppMention({ event, client, logger }) {
    try {
      if (!isAllowed(event.user)) return;
      const text = stripLeadingMentions(event.text);
      if (!text) return;
      const filePath = await writeCapture({
        vaultPath,
        text,
        userId: event.user,
        ts: event.ts,
        channelType: 'channel',
        channelId: event.channel,
      });
      logger.info?.(`capture written (mention): ${filePath}`);
      void ack; void client;
    } catch (err) {
      logger.error(err);
    }
  }

  return { onMessage, onAppMention };
}

function stripLeadingMentions(text) {
  return (text || '').replace(/<@[^>]+>\s*/g, '').trim();
}

function buildApp({ config }) {
  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    signingSecret: config.slack.signingSecret,
    socketMode: true,
  });

  const { onMessage, onAppMention } = buildHandlers({
    vaultPath: config.vaultPath,
    allowedUserIds: config.allowedUserIds,
  });

  app.message(async (args) => onMessage(args));
  app.event('app_mention', async (args) => onAppMention(args));

  return app;
}

module.exports = { buildApp, buildHandlers, stripLeadingMentions };
