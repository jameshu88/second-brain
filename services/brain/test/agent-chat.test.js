const test = require('node:test');
const assert = require('node:assert/strict');
const { runChat } = require('../src/agent/chat');

function makeClient(turns) {
  let i = 0;
  return {
    messages: {
      create: async () => {
        const next = turns[i];
        i += 1;
        if (!next) throw new Error('client called more times than scripted');
        return next;
      },
    },
  };
}

const stubTools = {
  search_vault: async () => [{ path: '00_Inbox/x.md', line: 1, snippet: 'hit', frontmatter: {}, mtime: new Date() }],
  read_note: async () => ({ frontmatter: {}, body: 'note body' }),
  list_events: async () => [],
  propose_event: async () => ({ text: 'Propose: ... Reply `y` to create.', pending: true }),
};

test('runChat returns text response after a single end_turn turn', async () => {
  const client = makeClient([
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'no matches in your vault' }] },
  ]);
  const out = await runChat({
    client,
    model: 'm',
    systemPrompt: 'sys',
    history: [{ role: 'user', content: 'find X' }],
    tools: stubTools,
    timezone: 'America/Los_Angeles',
  });
  assert.match(out.replyText, /no matches/);
  assert.equal(out.turns, 1);
});

test('runChat invokes a tool then returns text on next turn', async () => {
  const client = makeClient([
    {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'u1', name: 'search_vault', input: { query: 'safe' } }],
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'found 1 hit' }] },
  ]);
  const out = await runChat({
    client,
    model: 'm',
    systemPrompt: 'sys',
    history: [{ role: 'user', content: 'find safe notes' }],
    tools: stubTools,
    timezone: 'UTC',
  });
  assert.match(out.replyText, /found 1 hit/);
  assert.equal(out.turns, 2);
});

test('runChat aborts after 10 tool-use turns to prevent runaway', async () => {
  const turns = [];
  for (let i = 0; i < 11; i++) {
    turns.push({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: `u${i}`, name: 'search_vault', input: { query: 'x' } }],
    });
  }
  const client = makeClient(turns);
  const out = await runChat({
    client,
    model: 'm',
    systemPrompt: 'sys',
    history: [{ role: 'user', content: 'go' }],
    tools: stubTools,
    timezone: 'UTC',
  });
  assert.match(out.replyText, /tool turn limit/i);
  assert.equal(out.turns, 10);
});

test('runChat surfaces tool errors to the model as tool_result content', async () => {
  const client = makeClient([
    {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'u1', name: 'list_events', input: {} }],
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'cal not configured' }] },
  ]);
  const tools = {
    ...stubTools,
    list_events: async () => ({ error: 'google_not_configured' }),
  };
  const out = await runChat({
    client,
    model: 'm',
    systemPrompt: 'sys',
    history: [{ role: 'user', content: 'whats on calendar' }],
    tools,
    timezone: 'UTC',
  });
  assert.match(out.replyText, /not configured/i);
  assert.equal(out.turns, 2);
});
