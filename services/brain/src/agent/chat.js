const fs = require('node:fs');
const path = require('node:path');

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts/chat.md'), 'utf8');
const MAX_TURNS = 10;

const TOOL_DEFINITIONS = [
  {
    name: 'search_vault',
    description: 'Search the markdown vault for a substring. Returns hits with path, line, snippet, and parsed frontmatter.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'read_note',
    description: 'Read a full note by vault-relative path. Returns frontmatter + body.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'list_events',
    description: 'List Google Calendar events between two ISO timestamps.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'ISO 8601 inclusive start' },
        to: { type: 'string', description: 'ISO 8601 exclusive end' },
        q: { type: 'string' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'propose_event',
    description: 'Propose a Google Calendar event. The user must reply `y` for it to fire. Always quote the title, start, end, and timezone in your final reply.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'ISO 8601 with timezone' },
        end: { type: 'string', description: 'ISO 8601 with timezone' },
        description: { type: 'string' },
        location: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string' } },
        calendarId: { type: 'string' },
      },
      required: ['title', 'start', 'end'],
    },
  },
];

async function runChat({ client, model, systemPrompt, history, tools, timezone }) {
  const sys = `${systemPrompt || SYSTEM_PROMPT}\n\nCurrent local timezone: ${timezone}`;
  const messages = [...history];
  let turns = 0;
  let replyText = '';

  while (turns < MAX_TURNS) {
    turns += 1;
    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      system: sys,
      tools: TOOL_DEFINITIONS,
      messages,
    });

    if (resp.stop_reason === 'tool_use') {
      const toolBlocks = resp.content.filter((b) => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: resp.content });
      const toolResults = [];
      for (const tb of toolBlocks) {
        const fn = tools[tb.name];
        let result;
        if (typeof fn !== 'function') {
          result = { error: `unknown tool: ${tb.name}` };
        } else {
          try {
            result = await fn(tb.input || {});
          } catch (err) {
            result = { error: err.message };
          }
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tb.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    const textBlock = (resp.content || []).find((b) => b.type === 'text');
    replyText = textBlock?.text || '';
    return { replyText, stopReason: resp.stop_reason, turns };
  }

  return {
    replyText: 'Reached tool turn limit (10). Try a more specific question.',
    stopReason: 'max_turns',
    turns,
  };
}

module.exports = { runChat, TOOL_DEFINITIONS };
