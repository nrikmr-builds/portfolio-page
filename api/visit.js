// Vercel serverless function: emails visitor metadata for each new page visit.
// Requires env vars: RESEND_API_KEY, VISIT_EMAIL_TO (and optionally VISIT_EMAIL_FROM).

const BOT_PATTERN = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora|pinterest|vercel|headless|lighthouse|pagespeed|curl|wget|python|axios|node-fetch/i;

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function describeUA(ua) {
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\//.test(ua) ? 'Opera' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Safari\//.test(ua) ? 'Safari' : 'Unknown browser';
  const os =
    /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
    /Android/.test(ua) ? 'Android' :
    /Mac OS X/.test(ua) ? 'macOS' :
    /Windows/.test(ua) ? 'Windows' :
    /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  const device = /Mobi|iPhone|Android.*Mobile/.test(ua) ? 'Phone' : /iPad|Tablet|Android/.test(ua) ? 'Tablet' : 'Desktop';
  return { browser, os, device };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const h = req.headers;
  const ua = h['user-agent'] || '';
  if (!ua || BOT_PATTERN.test(ua)) return res.status(204).end();

  // Only accept beacons sent from the site itself.
  const origin = h.origin || h.referer || '';
  if (!/^https:\/\/(www\.)?nripeshthebuilder\.com|^https:\/\/[a-z0-9-]+\.vercel\.app/.test(origin)) {
    return res.status(204).end();
  }

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const decode = (v) => { try { return decodeURIComponent(v || ''); } catch { return v || ''; } };
  const city = decode(h['x-vercel-ip-city']);
  const region = h['x-vercel-ip-country-region'] || '';
  const country = h['x-vercel-ip-country'] || '';
  const ip = (h['x-forwarded-for'] || '').split(',')[0].trim();
  const { browser, os, device } = describeUA(ua);
  const when = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });
  const location = [city, region, country].filter(Boolean).join(', ') || 'Unknown';

  const rows = [
    ['Time (Pacific)', when],
    ['Page', body.path || '/'],
    ['Came from', body.referrer || 'Direct / unknown'],
    ['Location (approx.)', location],
    ['Visitor time zone', body.timeZone],
    ['Device', `${device} · ${os} · ${browser}`],
    ['Screen', body.screen],
    ['Language', body.language || h['accept-language']],
    ['IP address', ip],
    ['User agent', ua],
  ];

  const html = `
    <div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;color:#1c1710">
      <h2 style="margin:0 0 12px;font-size:18px">New visit to nripeshthebuilder.com</h2>
      <table cellpadding="6" style="border-collapse:collapse">
        ${rows.map(([k, v]) => `<tr><td style="color:#6c6153;vertical-align:top;white-space:nowrap">${esc(k)}</td><td>${esc(v || '—')}</td></tr>`).join('')}
      </table>
    </div>`;

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.VISIT_EMAIL_TO;
  if (!apiKey || !to) {
    console.error('visit: RESEND_API_KEY or VISIT_EMAIL_TO is not set');
    return res.status(204).end();
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.VISIT_EMAIL_FROM || 'Portfolio Visits <onboarding@resend.dev>',
        to: [to],
        subject: `Portfolio visit · ${location} · ${device}`,
        html,
      }),
    });
    if (!r.ok) console.error('visit: Resend error', r.status, await r.text());
  } catch (err) {
    console.error('visit: send failed', err);
  }
  return res.status(204).end();
};
