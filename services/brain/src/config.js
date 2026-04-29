const path = require('node:path');

function loadConfig(env = process.env) {
  required(env, 'SLACK_BOT_TOKEN');
  required(env, 'SLACK_APP_TOKEN');
  required(env, 'SLACK_SIGNING_SECRET');
  required(env, 'VAULT_PATH');
  required(env, 'ANTHROPIC_API_KEY');

  const allowed = (env.ALLOWED_SLACK_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const tz = (env.TIMEZONE || '').trim() || hostTimezone();

  const calIds = (env.DEFAULT_CALENDAR_IDS || 'primary')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const google =
    env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET
      ? { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET }
      : null;

  return {
    slack: {
      botToken: env.SLACK_BOT_TOKEN,
      appToken: env.SLACK_APP_TOKEN,
      signingSecret: env.SLACK_SIGNING_SECRET,
    },
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY,
      tagModel: env.ANTHROPIC_TAG_MODEL || 'claude-haiku-4-5-20251001',
      chatModel: env.ANTHROPIC_CHAT_MODEL || 'claude-sonnet-4-6',
      classifyModel: env.ANTHROPIC_CLASSIFY_MODEL || 'claude-haiku-4-5-20251001',
    },
    google,
    defaultCalendarIds: calIds,
    vaultPath: path.resolve(env.VAULT_PATH),
    allowedUserIds: allowed,
    timezone: tz,
    logLevel: env.LOG_LEVEL || 'info',
  };
}

function required(env, key) {
  if (!env[key] || env[key].trim() === '') {
    throw new Error(`config: ${key} is required`);
  }
}

function hostTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

module.exports = { loadConfig };
