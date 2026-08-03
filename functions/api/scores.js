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
 *   PLAY_SECRET         (secret)        — optional; signs play tokens. Falls back
 *                                          to ADMIN_KEY if unset. Never sent to the browser.
 *   BUTTONDOWN_API_KEY  (secret)        — no longer used (opt-in is client-side embed)
 */

const GAMES = ['darkstar', 'sneca', 'liebezeit'];
// Plausible ceilings. A real run stays well under these; anything above is junk.
const CAP = { darkstar: 12000, sneca: 700, liebezeit: 250000 };
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

// ---- signed play tokens (stop direct POSTs to the API) ----
// The signing secret lives only on the server, so the browser can't forge a
// token. To submit, a run must first fetch one from GET ?start=1, and it can
// only be used once.
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hmacHex(secret, msg) {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function playSecret(env) {
  return env.PLAY_SECRET || env.ADMIN_KEY || 'laguna-unset-secret';
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

    // Issue a signed play token for a run that's starting.
    if (url.searchParams.get('start')) {
      const iat = Date.now();
      const nonce = crypto.randomUUID();
      const sig = await hmacHex(playSecret(env), game + '.' + iat + '.' + nonce);
      return json({ token: iat + '.' + nonce + '.' + sig });
    }

    const key = url.searchParams.get('key');
    const isAdmin = key && env.ADMIN_KEY && key === env.ADMIN_KEY;

    // Admin: wipe this game's board  (…/api/scores?game=darkstar&key=ADMIN_KEY&wipe=yes)
    if (isAdmin && url.searchParams.get('wipe') === 'yes') {
      let cursor, removed = 0;
      do {
        const page = await env.SCORES.list({ prefix, limit: 1000, cursor });
        for (const k of page.keys) { await env.SCORES.delete(k.name); removed++; }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      return json({ wiped: removed, game });
    }

    const listed = await env.SCORES.list({ prefix, limit: 200 });
    const rows = listed.keys
      .map((k) => k.metadata)
      .filter((m) => m && typeof m.s === 'number')
      .slice(0, 10)
      .map((m) => ({ initials: m.i, score: m.s, ts: m.t }));

    // Admin dump (includes emails) when the secret matches.
    if (isAdmin) {
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

    // play token: must be one we signed, unexpired, not reused, and old enough
    // that a real run of this length could have produced the score.
    const token = String(body.token || '');
    const tp = token.split('.');
    if (tp.length !== 3) return json({ error: 'no play token' }, 403);
    const iat = Number(tp[0]);
    const expectSig = await hmacHex(playSecret(env), game + '.' + tp[0] + '.' + tp[1]);
    if (!safeEq(tp[2], expectSig)) return json({ error: 'bad play token' }, 403);
    const age = Date.now() - iat;
    if (!(age >= 0 && age < 6 * 3600 * 1000)) return json({ error: 'token expired' }, 403);
    if (age < 2000 + score * 12) return json({ error: 'too fast' }, 403);
    const usedKey = 'used:' + tp[1];
    if (await env.SCORES.get(usedKey)) return json({ error: 'token already used' }, 409);
    await env.SCORES.put(usedKey, '1', { expirationTtl: 21600 });

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

    // Mailing-list opt-in is handled client-side via Buttondown's free embed
    // endpoint (the API route needs a paid plan and returns 403). We still store
    // joinList + email here so the admin dump is a complete backup of opt-ins.
    await env.SCORES.put(
      keyName,
      JSON.stringify({ initials, score, email, joinList, ts }),
      { metadata: { i: initials, s: score, t: ts } }
    );

    return json({ ok: true, initials, score, ts });
  }

  return json({ error: 'method not allowed' }, 405);
}
