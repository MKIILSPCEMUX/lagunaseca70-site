/**
 * Laguna Seca — high score board API (Cloudflare Pages Function)
 * Route: /api/scores
 *
 * Storage: a single Cloudflare KV namespace, bound to this project as `SCORES`.
 *   Each entry is one KV key so writes never collide:
 *     key   = entry:<game>:<invScore>:<ts>:<rand>   (sorted best-first)
 *     meta  = { i: initials, s: score, t: ts }        (public, returned on GET)
 *     value = { initials, score, email, joinList, ts } (private; email never shown)
 *
 * Bindings / variables (set in the Cloudflare dashboard — see SETUP guide):
 *   SCORES              (KV namespace)  — required
 *   COMPETITION_CLOSE   (text)          — optional ISO datetime; when the Dark Star
 *                                          prize run closes. Defaults below.
 *   ADMIN_KEY           (secret)        — optional; GET ...&key=ADMIN_KEY dumps emails
 *   BUTTONDOWN_API_KEY  (secret)        — optional; subscribes opt-ins to the list
 */

const GAMES = ['darkstar', 'sneca'];
const CAP = { darkstar: 200000, sneca: 800 };   // reject scores above a plausible ceiling
const PAD = 7;                                    // width for the sortable inverse-score key
const DEFAULT_CLOSE = '2026-08-14T19:00:00Z';     // 8pm UK time (BST) on Fri 14 Aug 2026; override with COMPETITION_CLOSE

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function invScore(game, score) {
  return String(CAP[game] - score).padStart(PAD, '0');
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const game = (url.searchParams.get('game') || 'darkstar').toLowerCase();

  if (!GAMES.includes(game)) return json({ error: 'unknown game' }, 400);

  // Only Dark Star carries the timed prize. Sneca's board stays open indefinitely.
  const isPrize = game === 'darkstar';
  const closesAt = isPrize ? (env.COMPETITION_CLOSE || DEFAULT_CLOSE) : null;
  const closed = isPrize && Date.now() > Date.parse(closesAt);

  if (!env.SCORES) {
    // KV not bound yet — behave gracefully so the site still works pre-setup.
    return json({ game, closesAt, closed, scores: [], count: 0, setup: false });
  }

  if (request.method === 'GET') {
    const prefix = `entry:${game}:`;
    const listed = await env.SCORES.list({ prefix, limit: 200 });
    const rows = listed.keys
      .map((k) => k.metadata)
      .filter((m) => m && typeof m.s === 'number')
      .slice(0, 10)
      .map((m) => ({ initials: m.i, score: m.s, ts: m.t }));

    // Admin dump (includes emails) when the secret matches.
    const key = url.searchParams.get('key');
    if (key && env.ADMIN_KEY && key === env.ADMIN_KEY) {
      const full = [];
      for (const k of listed.keys.slice(0, 100)) {
        const v = await env.SCORES.get(k.name);
        if (v) { try { full.push(JSON.parse(v)); } catch (e) {} }
      }
      return json({ game, closesAt, closed, count: listed.keys.length, scores: rows, entries: full });
    }

    return json({ game, closesAt, closed, count: listed.keys.length, scores: rows, setup: true });
  }

  if (request.method === 'POST') {
    if (closed) return json({ error: 'closed', closed: true }, 403);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }

    // initials: exactly three letters
    const initials = String(body.initials || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    if (initials.length !== 3) return json({ error: 'initials must be three letters' }, 400);

    // score: integer within the plausible range
    const score = Math.floor(Number(body.score));
    if (!Number.isFinite(score) || score < 0 || score > CAP[game]) {
      return json({ error: 'score out of range' }, 400);
    }

    // email: optional, lightly validated
    let email = String(body.email || '').trim().toLowerCase();
    if (email) {
      if (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return json({ error: 'invalid email' }, 400);
      }
    }
    const joinList = !!body.joinList;
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const keyName = `entry:${game}:${invScore(game, score)}:${ts}:${rand}`;

    await env.SCORES.put(
      keyName,
      JSON.stringify({ initials, score, email, joinList, ts }),
      { metadata: { i: initials, s: score, t: ts } }
    );

    // Optional: subscribe opt-ins to Buttondown (non-fatal if it fails).
    if (joinList && email && env.BUTTONDOWN_API_KEY) {
      try {
        await fetch('https://api.buttondown.com/v1/subscribers', {
          method: 'POST',
          headers: {
            'Authorization': 'Token ' + env.BUTTONDOWN_API_KEY,
            'content-type': 'application/json',
          },
          // Double opt-in by default: the subscriber gets a confirm email and
          // shows as "unactivated" in Buttondown until they click it.
          body: JSON.stringify({ email_address: email, tags: ['arcade', game] }),
        });
      } catch (e) { /* ignore — the score still counts */ }
    }

    return json({ ok: true, initials, score, ts });
  }

  return json({ error: 'method not allowed' }, 405);
}
