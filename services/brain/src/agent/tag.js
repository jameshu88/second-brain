const fs = require('node:fs');
const path = require('node:path');

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts/tag.md'), 'utf8');

const VALID_TYPES = new Set(['idea', 'task', 'note', 'decision', 'question']);
const VALID_PARA_ROOTS = ['01_Projects/', '02_Areas/', '03_Resources/', '04_Archive/', '00_Inbox'];

const TOOL = {
  name: 'save_tags',
  description: 'Save the structured tags for a captured note.',
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['idea', 'task', 'note', 'decision', 'question'],
      },
      tags: { type: 'array', items: { type: 'string' } },
      mentions: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
      suggested_para: { type: 'string' },
    },
    required: ['type', 'tags', 'mentions', 'summary', 'suggested_para'],
  },
};

async function tagCapture({ client, model, text, entities }) {
  const knownEntities = entities.flat || [];
  const userMessage =
    `Known entities (use these as-is for any [[wikilink]] in mentions; do not invent others):\n` +
    knownEntities.map((e) => `- ${e}`).join('\n') +
    `\n\nNote text:\n${text}\n`;

  const resp = await client.messages.create({
    model,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'save_tags' },
    messages: [{ role: 'user', content: userMessage }],
  });

  const block = (resp.content || []).find((b) => b.type === 'tool_use' && b.name === 'save_tags');
  if (!block) {
    throw new Error('tag pass: model did not call save_tags');
  }
  const raw = block.input || {};

  if (!VALID_TYPES.has(raw.type)) {
    throw new Error(`tag pass: invalid type "${raw.type}"`);
  }
  const sp = String(raw.suggested_para || '').trim();
  if (!VALID_PARA_ROOTS.some((r) => sp === r || sp.startsWith(r))) {
    throw new Error(`tag pass: suggested_para "${sp}" outside known PARA roots`);
  }

  const allowedMentionSet = new Set(knownEntities.map((e) => `[[${e}]]`));
  const mentions = (raw.mentions || []).filter((m) => allowedMentionSet.has(m));

  return {
    type: raw.type,
    tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 8) : [],
    mentions,
    summary: String(raw.summary || '').trim(),
    suggested_para: sp,
  };
}

module.exports = { tagCapture, TOOL, SYSTEM_PROMPT };
