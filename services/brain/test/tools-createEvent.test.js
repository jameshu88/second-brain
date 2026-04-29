const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { proposeEvent, confirmEvent } = require('../src/tools/createEvent');
const { _setPathOverride, getPending } = require('../src/state/threads');

async function tmpStateDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'brain-cev-'));
}

test('proposeEvent stores pending action and returns proposal text', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  const out = await proposeEvent({
    threadTs: 't1',
    calendar: { events: { insert: async () => ({ data: { id: 'should-not-be-called', htmlLink: '' } }) } },
    args: {
      title: 'FormLab pitch prep',
      start: '2026-05-01T14:00:00-07:00',
      end: '2026-05-01T16:00:00-07:00',
    },
  });
  assert.match(out.text, /Propose: 'FormLab pitch prep'/);
  assert.match(out.text, /Reply `y`/);
  const pend = await getPending('t1');
  assert.ok(pend);
  assert.equal(pend.kind, 'create_event');
  await fs.rm(dir, { recursive: true, force: true });
});

test('proposeEvent returns "not configured" when calendar is null', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  const out = await proposeEvent({
    threadTs: 't1',
    calendar: null,
    args: { title: 't', start: 'a', end: 'b' },
  });
  assert.equal(out.error, 'google_not_configured');
  const pend = await getPending('t1');
  assert.equal(pend, null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('confirmEvent fires events.insert when pending action exists', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  let inserted = null;
  const cal = {
    events: {
      insert: async ({ resource, calendarId }) => {
        inserted = { resource, calendarId };
        return { data: { id: 'ev123', htmlLink: 'https://cal/ev123' } };
      },
    },
  };
  await proposeEvent({
    threadTs: 't1',
    calendar: cal,
    args: { title: 'X', start: 's', end: 'e', calendarId: 'primary' },
  });
  const out = await confirmEvent({ threadTs: 't1', calendar: cal });
  assert.equal(out.id, 'ev123');
  assert.equal(out.htmlLink, 'https://cal/ev123');
  assert.equal(inserted.calendarId, 'primary');
  assert.equal(inserted.resource.summary, 'X');
  const after = await getPending('t1');
  assert.equal(after, null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('confirmEvent returns "no pending" when nothing to confirm', async () => {
  const dir = await tmpStateDir();
  _setPathOverride(path.join(dir, 'threads.json'));
  const out = await confirmEvent({ threadTs: 'no-such', calendar: { events: { insert: async () => {} } } });
  assert.equal(out.error, 'no_pending');
  await fs.rm(dir, { recursive: true, force: true });
});
