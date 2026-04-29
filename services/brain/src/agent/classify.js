async function classifyMessage({ text }) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('classifyMessage: text is required');
  }
  return 'capture';
}

module.exports = { classifyMessage };
