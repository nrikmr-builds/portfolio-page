// Shared helpers for the visit log and the daily digest. Files starting with "_" are not routes.

const PENDING_KEY = 'visits:pending';
const MAX_PENDING = 2000; // safety cap on stored visits between digests

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis is not configured (KV_REST_API_URL / KV_REST_API_TOKEN missing)');
  return { url, token };
}

// Run several Redis commands in one request via the Upstash REST pipeline.
async function redis(commands) {
  const { url, token } = redisConfig();
  const r = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`Redis error ${r.status}: ${await r.text()}`);
  const results = await r.json();
  for (const res of results) if (res.error) throw new Error(`Redis error: ${res.error}`);
  return results.map((res) => res.result);
}

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendEmail({ subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.VISIT_EMAIL_TO;
  if (!apiKey || !to) throw new Error('RESEND_API_KEY or VISIT_EMAIL_TO is not set');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.VISIT_EMAIL_FROM || 'Portfolio Visits <onboarding@resend.dev>',
      to: [to],
      subject,
      html,
    }),
  });
  if (!r.ok) throw new Error(`Resend error ${r.status}: ${await r.text()}`);
}

module.exports = { PENDING_KEY, MAX_PENDING, redis, esc, sendEmail };
