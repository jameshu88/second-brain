const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, merge, serialize, splitDocument } = require('../src/util/frontmatter');

test('parse returns empty frontmatter and full body when no fence', () => {
  const { frontmatter, body } = parse('hello world\n');
  assert.deepEqual(frontmatter, {});
  assert.equal(body, 'hello world\n');
});

test('parse extracts simple frontmatter and body', () => {
  const input = `---\ncreated: 2026-04-29T00:00:00.000Z\nstatus: inbox\n---\nbody text\n`;
  const { frontmatter, body } = parse(input);
  assert.equal(frontmatter.created, '2026-04-29T00:00:00.000Z');
  assert.equal(frontmatter.status, 'inbox');
  assert.equal(body, 'body text\n');
});

test('parse preserves unknown fields', () => {
  const input = `---\ncreated: 2026-04-29T00:00:00.000Z\ncustom_field: 42\n---\n\n`;
  const { frontmatter } = parse(input);
  assert.equal(frontmatter.custom_field, 42);
});

test('merge preserves existing keys not overridden', () => {
  const out = merge({ created: 'a', custom: 'keep' }, { status: 'inbox' });
  assert.deepEqual(out, { created: 'a', custom: 'keep', status: 'inbox' });
});

test('merge override replaces matching keys', () => {
  const out = merge({ status: 'inbox' }, { status: 'active' });
  assert.equal(out.status, 'active');
});

test('serialize produces fenced YAML + body with trailing newline', () => {
  const out = serialize({ created: '2026-04-29T00:00:00.000Z', status: 'inbox' }, 'body\n');
  assert.match(out, /^---\n/);
  assert.match(out, /\ncreated: '?2026-04-29T00:00:00\.000Z'?\n/);
  assert.match(out, /\nstatus: inbox\n/);
  assert.match(out, /\n---\n/);
  assert.ok(out.endsWith('body\n'));
});

test('roundtrip preserves all fields including unknown', () => {
  const fm = { created: '2026-04-29T00:00:00.000Z', source: 'slack', mystery: ['a', 'b'] };
  const round = parse(serialize(fm, 'body\n'));
  assert.deepEqual(round.frontmatter, fm);
  assert.equal(round.body, 'body\n');
});

test('splitDocument returns frontmatter and body strings unchanged when no fence', () => {
  const out = splitDocument('plain text\n');
  assert.equal(out.frontmatterText, '');
  assert.equal(out.body, 'plain text\n');
});
