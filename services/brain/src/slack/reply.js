async function ack(client, { channel, threadTs, text }) {
  try {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text,
    });
    return true;
  } catch (err) {
    console.error('[slack/reply] ack failed:', err.message);
    return false;
  }
}

module.exports = { ack };
