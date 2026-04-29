const fs = require('node:fs');
const path = require('node:path');

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts/classify.md'), 'utf8');
const VALID = new Set(['capture', 'question', 'both']);

const TOOL = {
  name: 'classify',
  description: 'Save the classification of the user message.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['capture', 'question', 'both'] },
    },
    required: ['verdict'],
  },
};

async function classifyMessage({ client, model, text }) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('classifyMessage: text is required');
  }
  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 64,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'classify' },
      messages: [{ role: 'user', content: text }],
    });
    const block = (resp.content || []).find((b) => b.type === 'tool_use' && b.name === 'classify');
    const v = block?.input?.verdict;
    if (VALID.has(v)) return v;
    return 'capture';
  } catch {
    return 'capture';
  }
}

module.exports = { classifyMessage, TOOL, SYSTEM_PROMPT };
