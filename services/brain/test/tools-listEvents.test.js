const test = require('node:test');
const assert = require('node:assert/strict');
const { listEvents } = require('../src/tools/listEvents');

function fakeCalendar(items) {
  return {
    events: {
      list: async () => ({ data: { items } }),
    },
  };
}

test('listEvents returns normalized event records', async () => {
  const cal = fakeCalendar([
    {
      id: 'ev1',
      summary: 'Standup',
      start: { dateTime: '2026-04-29T09:00:00-07:00' },
      end: { dateTime: '2026-04-29T09:30:00-07:00' },
      attendees: [{ email: 'a@x.com' }],
      location: 'Zoom',
      description: 'daily',
    },
  ]);
  const out = await listEvents({
    calendar: cal,
    calendarIds: ['primary'],
    from: '2026-04-29T00:00:00-07:00',
    to: '2026-04-30T00:00:00-07:00',
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Standup');
  assert.equal(out[0].calendar, 'primary');
});

test('listEvents fans out across multiple calendars and merges', async () => {
  let nthCall = 0;
  const cal = {
    events: {
      list: async ({ calendarId }) => {
        nthCall += 1;
        return { data: { items: [{ id: `ev-${calendarId}`, summary: `Event ${calendarId}` }] } };
      },
    },
  };
  const out = await listEvents({
    calendar: cal,
    calendarIds: ['primary', 'work@example.com'],
    from: 'now',
    to: 'now+1d',
  });
  assert.equal(nthCall, 2);
  assert.equal(out.length, 2);
});

test('listEvents returns "not configured" sentinel when calendar is null', async () => {
  const out = await listEvents({ calendar: null, calendarIds: ['primary'], from: 'a', to: 'b' });
  assert.deepEqual(out, { error: 'google_not_configured' });
});

test('listEvents returns empty array when no events', async () => {
  const cal = fakeCalendar([]);
  const out = await listEvents({ calendar: cal, calendarIds: ['primary'], from: 'a', to: 'b' });
  assert.deepEqual(out, []);
});
