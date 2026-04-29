const { setPending, getPending, clearPending } = require('../state/threads');

async function proposeEvent({ threadTs, calendar, args }) {
  if (!calendar) {
    return { error: 'google_not_configured' };
  }
  await setPending(threadTs, { kind: 'create_event', args });
  const text = formatProposal(args);
  return { text, pending: true };
}

async function confirmEvent({ threadTs, calendar }) {
  const pending = await getPending(threadTs);
  if (!pending || pending.kind !== 'create_event') {
    return { error: 'no_pending' };
  }
  const a = pending.args;
  const resp = await calendar.events.insert({
    calendarId: a.calendarId || 'primary',
    resource: {
      summary: a.title,
      description: a.description,
      location: a.location,
      start: { dateTime: a.start },
      end: { dateTime: a.end },
      attendees: (a.attendees || []).map((email) => ({ email })),
    },
  });
  await clearPending(threadTs);
  return { id: resp.data.id, htmlLink: resp.data.htmlLink };
}

function formatProposal(a) {
  const parts = [`Propose: '${a.title}'`];
  parts.push(`${a.start} → ${a.end}`);
  if (a.location) parts.push(`@${a.location}`);
  if (a.attendees && a.attendees.length) parts.push(`with ${a.attendees.join(', ')}`);
  parts.push("Reply `y` to create.");
  return parts.join(' · ');
}

module.exports = { proposeEvent, confirmEvent, formatProposal };
