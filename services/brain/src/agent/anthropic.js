const Anthropic = require('@anthropic-ai/sdk');

function buildClient({ apiKey }) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new Error('buildClient: apiKey is required');
  }
  return new Anthropic({ apiKey });
}

module.exports = { buildClient };
