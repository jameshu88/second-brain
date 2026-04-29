const path = require('node:path');
const { App } = require('@slack/bolt');
const { writeCapture } = require('../capture/writeInbox');
const { writeNote } = require('../tools/writeNote');
const { ack } = require('./reply');
const { classifyMessage } = require('../agent/classify');
const { tagCapture } = require('../agent/tag');
const { runChat } = require('../agent/chat');
const { scanEntities: realScanEntities } = require('../util/entities');
const { hydrateThread: realHydrateThread } = require('./hydrate');
const { buildClient } = require('../agent/anthropic');
const { searchVault } = require('../tools/searchVault');
const { readNote } = require('../tools/readNote');
const { listEvents } = require('../tools/listEvents');
const { proposeEvent, confirmEvent } = require('../tools/createEvent');
const { getPending } = require('../state/threads');
const { loadGoogleAuth } = require('../google/auth');
const { google } = require('googleapis');

const CONFIRM_TOKENS = new Set(['y', 'yes', 'Y', 'YES']);

function buildHandlers(deps) {
  const {
    vaultPath,
    allowedUserIds,
    anthropic,
    scanEntities,
    googleCalendar,
    botUserId,
    timezone,
    defaultCalendarIds,
    hydrateThread,
  } = deps;

  const isAllowed = (userId) => {
    if (!userId) return false;
    if (allowedUserIds.length === 0) return true;
    return allowedUserIds.includes(userId);
  };

  async function tryConfirmFlow({ text, threadTs, channelId, slackClient }) {
    if (!CONFIRM_TOKENS.has(text.trim())) return false;
    const pending = await getPending(threadTs);
    if (!pending) return false;
    if (pending.kind === 'create_event') {
      const out = await confirmEvent({ threadTs, calendar: googleCalendar });
      const replyText = out.error
        ? `Could not create event: ${out.error}`
        : `Created. ${out.htmlLink}`;
      await ack(slackClient, { channel: channelId, threadTs, text: replyText });
      return true;
    }
    return false;
  }

  async function capturePath({ text, userId, ts, channelType, channelId, threadTs, slackClient, logger }) {
    const filePath = await writeCapture({
      vaultPath, text, userId, ts, channelType, channelId,
    });
    logger.info?.(`capture written: ${filePath}`);
    let tags = null;
    try {
      const entities = await scanEntities(vaultPath);
      tags = await tagCapture({
        client: anthropic.tagClient,
        model: anthropic.tagModel,
        text,
        entities,
      });
    } catch (err) {
      logger.warn?.(`tag pass failed: ${err.message}`);
    }
    if (tags) {
      const relPath = path.relative(vaultPath, filePath);
      await writeNote({
        vaultPath, relPath,
        frontmatter: {
          type: tags.type, tags: tags.tags, mentions: tags.mentions,
          summary: tags.summary, suggested_para: tags.suggested_para,
        },
        body: `${text.trim()}\n`,
        overwrite: true,
      });
      await ack(slackClient, { channel: channelId, threadTs, text: formatTagAck(tags) });
    } else {
      await ack(slackClient, { channel: channelId, threadTs, text: '✓ Saved (tagging unavailable)' });
    }
  }

  async function chatPath({ text, threadTs, channelId, slackClient, logger }) {
    const history = await hydrateThread({
      client: slackClient, channel: channelId, threadTs, botUserId,
    });
    if (history.length === 0 || history[history.length - 1].role !== 'user') {
      history.push({ role: 'user', content: text });
    }
    const tools = {
      search_vault: async ({ query }) => {
        return searchVault({ vaultPath, query });
      },
      read_note: async ({ path: relPath }) => {
        return readNote({ vaultPath, relPath });
      },
      list_events: async ({ from, to, q }) => {
        return listEvents({ calendar: googleCalendar, calendarIds: defaultCalendarIds, from, to, q });
      },
      propose_event: async (args) => {
        return proposeEvent({ threadTs, calendar: googleCalendar, args });
      },
    };
    const out = await runChat({
      client: anthropic.chatClient,
      model: anthropic.chatModel,
      history,
      tools,
      timezone,
    });
    await ack(slackClient, { channel: channelId, threadTs, text: out.replyText });
  }

  async function dispatch({ text, userId, ts, channelType, channelId, threadTs, slackClient, logger }) {
    const handled = await tryConfirmFlow({ text, threadTs, channelId, slackClient });
    if (handled) return;
    const verdict = await classifyMessage({
      client: anthropic.classifyClient,
      model: anthropic.classifyModel,
      text,
    });
    if (verdict === 'capture' || verdict === 'both') {
      await capturePath({ text, userId, ts, channelType, channelId, threadTs, slackClient, logger });
    }
    if (verdict === 'question' || verdict === 'both') {
      await chatPath({ text, threadTs, channelId, slackClient, logger });
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
      await dispatch({
        text,
        userId: message.user,
        ts: message.ts,
        channelType: 'dm',
        channelId: message.channel,
        threadTs: message.thread_ts || message.ts,
        slackClient: client,
        logger,
      });
    } catch (err) {
      logger.error?.(err);
    }
  }

  async function onAppMention({ event, client, logger }) {
    try {
      if (!isAllowed(event.user)) return;
      const text = stripLeadingMentions(event.text);
      if (!text) return;
      await dispatch({
        text,
        userId: event.user,
        ts: event.ts,
        channelType: 'channel',
        channelId: event.channel,
        threadTs: event.thread_ts || event.ts,
        slackClient: client,
        logger,
      });
    } catch (err) {
      logger.error?.(err);
    }
  }

  return { onMessage, onAppMention };
}

function formatTagAck(tags) {
  const parts = [`✓ Saved as ${tags.type}`];
  if (tags.tags && tags.tags.length) parts.push(`tags: ${tags.tags.join(', ')}`);
  if (tags.mentions && tags.mentions.length) parts.push(`linked: ${tags.mentions.join(' ')}`);
  return parts.join(' · ');
}

function stripLeadingMentions(text) {
  return (text || '').replace(/<@[^>]+>\s*/g, '').trim();
}

async function buildApp({ config }) {
  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    signingSecret: config.slack.signingSecret,
    socketMode: true,
  });

  const anthropicClient = buildClient({ apiKey: config.anthropic.apiKey });

  // Resolve the bot's user ID once at startup so hydrateThread can identify assistant messages.
  let botUserId = null;
  try {
    const auth = await app.client.auth.test();
    botUserId = auth.user_id;
  } catch (err) {
    console.warn('[adapter] could not resolve bot user_id:', err.message);
  }

  const oauthClient = await loadGoogleAuth({ google: config.google });
  const googleCalendar = oauthClient
    ? google.calendar({ version: 'v3', auth: oauthClient })
    : null;

  const handlers = buildHandlers({
    vaultPath: config.vaultPath,
    allowedUserIds: config.allowedUserIds,
    anthropic: {
      classifyClient: anthropicClient,
      classifyModel: config.anthropic.classifyModel,
      tagClient: anthropicClient,
      tagModel: config.anthropic.tagModel,
      chatClient: anthropicClient,
      chatModel: config.anthropic.chatModel,
    },
    scanEntities: realScanEntities,
    googleCalendar,
    botUserId,
    timezone: config.timezone,
    defaultCalendarIds: config.defaultCalendarIds,
    hydrateThread: realHydrateThread,
  });

  app.message(async (args) => handlers.onMessage(args));
  app.event('app_mention', async (args) => handlers.onAppMention(args));

  return app;
}

module.exports = { buildApp, buildHandlers, stripLeadingMentions, formatTagAck };
