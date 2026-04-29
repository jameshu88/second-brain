async function hydrateThread({ client, channel, threadTs, botUserId, limit = 20 }) {
  try {
    const resp = await client.conversations.replies({
      channel,
      ts: threadTs,
      limit,
      inclusive: true,
    });
    const messages = (resp.messages || []).slice(-limit);
    return messages
      .filter((m) => typeof m.text === 'string' && m.text.trim() !== '')
      .map((m) => {
        const fromBot = m.bot_id || m.user === botUserId;
        return { role: fromBot ? 'assistant' : 'user', content: m.text };
      });
  } catch {
    return [];
  }
}

module.exports = { hydrateThread };
