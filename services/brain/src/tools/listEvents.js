async function listEvents({ calendar, calendarIds, from, to, q }) {
  if (!calendar) {
    return { error: 'google_not_configured' };
  }
  const all = [];
  for (const calId of calendarIds) {
    const resp = await calendar.events.list({
      calendarId: calId,
      timeMin: from,
      timeMax: to,
      q,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    });
    for (const ev of resp.data.items || []) {
      all.push({
        id: ev.id,
        title: ev.summary || '(no title)',
        start: ev.start?.dateTime || ev.start?.date,
        end: ev.end?.dateTime || ev.end?.date,
        attendees: (ev.attendees || []).map((a) => a.email).filter(Boolean),
        location: ev.location || '',
        description: ev.description || '',
        calendar: calId,
      });
    }
  }
  return all;
}

module.exports = { listEvents };
