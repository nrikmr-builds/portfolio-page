// Vercel cron function: emails one digest of the day's visits at 9pm Pacific.
// Cron runs at 04:00 and 05:00 UTC (see vercel.json); only the run that lands in the
// 9pm Los Angeles hour sends, so the time stays 9pm across daylight saving changes.

const { PENDING_KEY, redis, esc, sendEmail } = require('./_lib');

const TZ = 'America/Los_Angeles';
const laHour = (d = new Date()) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(d));
const laTime = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const laDate = (d = new Date()) => d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });

function topCounts(items, n = 5) {
  const m = new Map();
  for (const it of items) if (it) m.set(it, (m.get(it) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function sourceOf(ref) {
  if (!ref) return 'Direct / unknown';
  try { return new URL(ref).hostname.replace(/^www\./, ''); } catch { return ref; }
}

function renderDigest(visits) {
  const place = (v) => [v.city, v.region, v.country].filter(Boolean).join(', ') || 'Unknown';
  const list = (pairs) => pairs.map(([k, c]) => `${esc(k)} <span style="color:#6c6153">(${c})</span>`).join(' · ') || '—';

  const rows = visits.map((v) => `
    <tr style="border-top:1px solid #e7dfcd">
      <td style="white-space:nowrap;vertical-align:top">${esc(laTime(v.ts))}</td>
      <td style="vertical-align:top">${esc(place(v))}</td>
      <td style="vertical-align:top">${esc(`${v.device} · ${v.os} · ${v.browser}`)}<br><span style="color:#6c6153;font-size:12px">${esc(v.screen || '')} ${esc(v.language || '')}</span></td>
      <td style="vertical-align:top">${esc(sourceOf(v.referrer))}<br><span style="color:#6c6153;font-size:12px">${esc(v.path)}</span></td>
      <td style="vertical-align:top;color:#6c6153;font-size:12px">${esc(v.ip)}</td>
    </tr>`).join('');

  return `
    <div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;color:#1c1710;max-width:860px">
      <h2 style="margin:0 0 4px;font-size:18px">nripeshthebuilder.com · daily visits</h2>
      <p style="margin:0 0 16px;color:#6c6153">${esc(laDate())} · visits since the last digest (9pm–9pm Pacific)</p>
      <p style="margin:0 0 6px"><strong>${visits.length}</strong> visit${visits.length === 1 ? '' : 's'}</p>
      <p style="margin:0 0 6px"><strong>Top locations:</strong> ${list(topCounts(visits.map((v) => [v.city, v.country].filter(Boolean).join(', '))))}</p>
      <p style="margin:0 0 6px"><strong>Top sources:</strong> ${list(topCounts(visits.map((v) => sourceOf(v.referrer))))}</p>
      <p style="margin:0 0 16px"><strong>Devices:</strong> ${list(topCounts(visits.map((v) => v.device)))}</p>
      <table cellpadding="6" style="border-collapse:collapse;width:100%;font-size:13px">
        <tr style="text-align:left;color:#6c6153"><th>Time (PT)</th><th>Location</th><th>Device</th><th>Source · Page</th><th>IP</th></tr>
        ${rows}
      </table>
    </div>`;
}

module.exports = async (req, res) => {
  // Vercel cron sends "Authorization: Bearer <CRON_SECRET>".
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }
  const force = req.query && req.query.force === '1';
  if (!force && laHour() !== 21) return res.status(200).json({ skipped: `LA hour is ${laHour()}, not 21` });

  // Atomically move pending visits aside so visits arriving during the send are kept for tomorrow.
  const batchKey = `visits:batch:${Date.now()}`;
  let visits = [];
  let raw = [];
  try {
    const [exists] = await redis([['EXISTS', PENDING_KEY]]);
    if (exists) {
      await redis([['RENAME', PENDING_KEY, batchKey]]);
      [raw] = await redis([['LRANGE', batchKey, 0, -1]]);
      visits = raw.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
      visits.sort((a, b) => a.ts - b.ts);
    }
  } catch (err) {
    console.error('digest: failed to read visits', err);
    return res.status(500).json({ error: 'read failed' });
  }

  try {
    if (visits.length) {
      await sendEmail({
        subject: `Portfolio: ${visits.length} visit${visits.length === 1 ? '' : 's'} today`,
        html: renderDigest(visits),
      });
    } else {
      await sendEmail({
        subject: 'Portfolio: no visits today',
        html: `<p style="font-family:-apple-system,Segoe UI,sans-serif">No visits to nripeshthebuilder.com since the last digest (${esc(laDate())}).</p>`,
      });
    }
    await redis([['DEL', batchKey]]);
  } catch (err) {
    // Put the visits back so they go out with the next digest.
    console.error('digest: send failed, restoring visits', err);
    try {
      if (raw.length) await redis([['RPUSH', PENDING_KEY, ...raw], ['DEL', batchKey]]);
    } catch (e) { console.error('digest: restore failed; visits remain in', batchKey, e); }
    return res.status(500).json({ error: 'send failed' });
  }
  return res.status(200).json({ sent: visits.length });
};
