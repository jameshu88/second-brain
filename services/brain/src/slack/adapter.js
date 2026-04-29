const path = require('node:path');
const { App } = require('@slack/bolt');
const { writeCapture } = require('../capture/writeInbox');
const { writeNote } = require('../tools/writeNote');
const { ack } = require('./reply');
const { classifyMessage } = require('../agent/classify');
const { tagCapture } = require('../agent/tag');
const { scanEntities: realScanEntities } = require('../util/entities');
const { buildClient } = require('../agent/anthropic');

function buildHandlers(deps) {
  const { vaultPath, allowedUserIds, anthropic, scanEntities } = deps;

  const isAllowed = (userId) => {
    if (!userId) return false;
    if (allowedUserIds.length === 0) return true;
    return allowedUserIds.includes(userId);
  };

  async function processCapture({ text, userId, ts, channelType, channelId, threadTs, slackClient, logger }) {
    const filePath = await writeCapture({
      vaultPath,
      text,
      userId,
      ts,
      channelType,
      channelId,
    });
    logger.info?.(`capture written: ${filePath}`);

    let tags = null;
    try {
      const entities = await scanEntities(vaultPath);
      tags = await tagCapture({
        client: anthropic.client,
        model: anthropic.model,
        text,
        entities,
      });
    } catch (err) {
      logger.warn?.(`tag pass failed: ${err.message}`);
    }

    if (tags) {
      const relPath = path.relative(vaultPath, filePath);
      await writeNote({
        vaultPath,
        relPath,
        frontmatter: {
          type: tags.type,
          tags: tags.tags,
          mentions: tags.mentions,
          summary: tags.summary,
          suggested_para: tags.suggested_para,
        },
        body: `${text.trim()}\n`,
        overwrite: true,
      });
      await ack(slackClient, {
        channel: channelId,
        threadTs,
        text: formatTagAck(tags),
      });
    } else {
      await ack(slackClient, {
        channel: channelId,
        threadTs,
        text: '✓ Saved (tagging unavailable)',
      });
    }
  }

  async function onMessage({ message, client, logger }) {
    try {
      if (message.subtype || message.bot_id) return;
      if (!message.user) return;
      if (!isAllowed(message.user)) {
        logger.warn?.(`ignoring message from ${message.user}`);
        return;
      }
      if (message.channel_type !== 'im' && !(message.channel || '').startsWith('D')) {
        return;
      }
      const text = (message.text || '').trim();
      if (!text) return;
      const verdict = await classifyMessage({ text });
      if (verdict === 'capture' || verdict === 'both') {
        await processCapture({
          text,
          userId: message.user,
          ts: message.ts,
          channelType: 'dm',
          channelId: message.channel,
          threadTs: message.thread_ts || message.ts,
          slackClient: client,
          logger,
        });
      }
    } catch (err) {
      logger.error?.(err);
    }
  }

  async function onAppMention({ event, client, logger }) {
    try {
      if (!isAllowed(event.user)) return;
      const text = stripLeadingMentions(event.text);
      if (!text) return;
      const verdict = await classifyMessage({ text });
      if (verdict === 'capture' || verdict === 'both') {
        await processCapture({
          text,
          userId: event.user,
          ts: event.ts,
          channelType: 'channel',
          channelId: event.channel,
          threadTs: event.thread_ts || event.ts,
          slackClient: client,
          logger,
        });
      }
    } catch (err) {
      logger.error?.(err);
    }
  }

  return { onMessage, onAppMention };
}

function formatTagAck(tags) {
  const parts = [`✓ Saved as ${tags.type}`];
  if (tags.tags && tags.tags.length) {
    parts.push(`tags: ${tags.tags.join(', ')}`);
  }
  if (tags.mentions && tags.mentions.length) {
    parts.push(`linked: ${tags.mentions.join(' ')}`);
  }
  return parts.join(' · ');
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

  const anthropicClient = buildClient({ apiKey: config.anthropic.apiKey });

  const { onMessage, onAppMention } = buildHandlers({
    vaultPath: config.vaultPath,
    allowedUserIds: config.allowedUserIds,
    anthropic: { client: anthropicClient, model: config.anthropic.tagModel },
    scanEntities: realScanEntities,
  });

  app.message(async (args) => onMessage(args));
  app.event('app_mention', async (args) => onAppMention(args));

  return app;
}

module.exports = { buildApp, buildHandlers, stripLeadingMentions, formatTagAck };
