// Vercel serverless function: records visitor metadata for the daily digest email.
// Requires Upstash Redis env vars (KV_REST_API_URL, KV_REST_API_TOKEN).

const { PENDING_KEY, MAX_PENDING, redis } = require('./_lib');

const BOT_PATTERN = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora|pinterest|vercel|headless|lighthouse|pagespeed|curl|wget|python|axios|node-fetch/i;

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
  const clip = (v, n = 300) => String(v ?? '').slice(0, n);
  const decode = (v) => { try { return decodeURIComponent(v || ''); } catch { return v || ''; } };

  const { browser, os, device } = describeUA(ua);
  const visit = {
    ts: Date.now(),
    path: clip(body.path || '/', 200),
    referrer: clip(body.referrer, 300),
    city: decode(h['x-vercel-ip-city']),
    region: h['x-vercel-ip-country-region'] || '',
    country: h['x-vercel-ip-country'] || '',
    timeZone: clip(body.timeZone, 60),
    device, os, browser,
    screen: clip(body.screen, 20),
    language: clip(body.language || h['accept-language'], 60),
    ip: (h['x-forwarded-for'] || '').split(',')[0].trim(),
    ua: clip(ua, 400),
  };

  try {
    await redis([
      ['RPUSH', PENDING_KEY, JSON.stringify(visit)],
      ['LTRIM', PENDING_KEY, -MAX_PENDING, -1],
    ]);
  } catch (err) {
    console.error('visit: failed to record', err);
  }
  return res.status(204).end();
};
