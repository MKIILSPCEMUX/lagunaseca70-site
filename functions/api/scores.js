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
// Plausible ceilings. Dark Star's track loops, so a marathon run can pile up;
// the real anti-cheat is the time-gate below (which scales with the score), so
// this just blocks absurd values. Sneca is grid-capped so it stays small.
// Liebezeit: a plain autopilot that only steers for the freest lane clears
// 420,000 over the 96 bars, so the ceiling has to sit well clear of that.
const CAP = { darkstar: 100000, sneca: 700, liebezeit: 2000000 };

/* The 'too fast' gate: a run that produced this score cannot have been shorter
   than min + score/rate. rate is the fastest points per second any honest run
   could manage, set generously, because a false rejection costs a real player
   their score while a determined faker can simply wait anyway.

   This was one hardcoded rule, age >= 2000 + score*12, which is 83 points per
   second. Right for Dark Star, absurd for Liebezeit, where a 400k run would
   have had to last eighty minutes. */
const GATE = {
  darkstar:  { min: 2000, rate: 83.34 },
  sneca:     { min: 2000, rate: 83.34 },
  liebezeit: { min: 8000, rate: 6000  },
};
const PAD = 7;                                    // width for the sortable inverse-score key
const DEFAULT_CLOSE = '2026-08-14T19:00:00Z';     // 8pm UK time (BST) on Fri 14 Aug 2026; override with COMPETITION_CLOSE

/* Competition windows, per game. A game with no entry here just has a board
   that never closes. opens matters as much as closes: a score set before the
   competition starts belongs on the board but is not in the running for the
   prize. Times are UTC, and Britain is on BST through August, so 22:00 local
   is 21:00 here. */
const PRIZE = {
  darkstar:  { opens: null,                   closes: DEFAULT_CLOSE },
  liebezeit: { opens: '2026-08-17T21:00:00Z', closes: '2026-08-31T21:00:00Z' },
};

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
  /* GET carries the game in the query string; POST carries it in the body.
     Reading the query only meant EVERY submission was validated as darkstar
     whatever game sent it: Liebezeit scores were bounced against Dark Star's
     cap, Sneca's play token failed its signature because tokens are signed per
     game, and entries landed under entry:darkstar:. The client now sends it
     both ways, and so does this. */
  let body = null;
  if (request.method === 'POST') {
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  }
  const game = String((body && body.game) || url.searchParams.get('game') || 'darkstar').toLowerCase();

  if (!GAMES.includes(game)) return json({ error: 'unknown game' }, 400);

  // Dark Star and Liebezeit each carry a timed prize; Sneca's board never closes.
  const prize    = PRIZE[game] || null;
  const isPrize  = !!prize;
  const closesAt = !prize ? null
                 : (game === 'darkstar' ? (env.COMPETITION_CLOSE || prize.closes) : prize.closes);
  const opensAt  = prize ? prize.opens : null;
  const closed   = isPrize && Date.now() > Date.parse(closesAt);
  const open     = isPrize && !closed && (!opensAt || Date.now() >= Date.parse(opensAt));

  if (!env.SCORES) {
    // KV not bound yet — behave gracefully so the site still works pre-setup.
    return json({ game, opensAt, closesAt, closed, open, scores: [], count: 0, setup: false });
  }

  if (request.method === 'GET') {
    const prefix = `entry:${game}:`;

    // Issue a signed play token for a run that's starting.
    if (url.searchParams.get('start')) {
      /* Tokens are the thing worth hoarding, so cap how many one address can
         collect. A player restarting hard might get through twenty an hour;
         a script wanting a stack of them cannot. */
      const tip = request.headers.get('cf-connecting-ip') || 'x';
      const tKey = `tk:${game}:${tip}:${Math.floor(Date.now() / 3600000)}`;
      const tN = Number((await env.SCORES.get(tKey)) || 0);
      if (tN >= 40) return json({ error: 'slow down' }, 429);
      await env.SCORES.put(tKey, String(tN + 1), { expirationTtl: 7200 });

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

    // Admin: add a verified score by hand (for a legit run the game wrongly blocked)
    //   …?game=darkstar&key=ADMIN_KEY&add=1&initials=IAU&score=19800&email=a@b.com
    if (isAdmin && url.searchParams.get('add') === '1') {
      const aInitials = String(url.searchParams.get('initials') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
      const aScore = Math.floor(Number(url.searchParams.get('score')));
      if (aInitials.length !== 3 || !Number.isFinite(aScore) || aScore < 0 || aScore > CAP[game]) {
        return json({ error: 'bad add params' }, 400);
      }
      const aEmail = String(url.searchParams.get('email') || '').trim().toLowerCase();
      const aJoin = url.searchParams.get('joinList') === 'true';
      const aTs = Date.now();
      const aRand = Math.random().toString(36).slice(2, 8);
      const aKey = `entry:${game}:${invScore(game, aScore)}:${aTs}:${aRand}`;
      await env.SCORES.put(
        aKey,
        JSON.stringify({ initials: aInitials, score: aScore, email: aEmail, joinList: aJoin, ts: aTs, admin: true }),
        { metadata: { i: aInitials, s: aScore, t: aTs } }
      );
      return json({ added: { initials: aInitials, score: aScore }, game });
    }

    const listed = await env.SCORES.list({ prefix, limit: 1000 });
    // Sort by the actual score in metadata, NOT by key order. The key encodes
    // cap-minus-score, so a change in the cap would otherwise mis-sort entries.
    const keysByScore = listed.keys
      .filter((k) => k.metadata && typeof k.metadata.s === 'number')
      .sort((a, b) => b.metadata.s - a.metadata.s);
    const rows = keysByScore.slice(0, 10).map((k) => ({ initials: k.metadata.i, score: k.metadata.s, ts: k.metadata.t }));

    // Admin dump (includes emails) when the secret matches.
    if (isAdmin) {
      const full = [];
      for (const k of keysByScore.slice(0, 100)) {
        const v = await env.SCORES.get(k.name);
        if (v) { try { full.push(JSON.parse(v)); } catch (e) {} }
      }
      return json({ game, opensAt, closesAt, closed, open, count: keysByScore.length, scores: rows, entries: full });
    }

    // The prize winner: the highest score submitted before the close. The board
    // stays open afterwards, so newer (post-close) scores can sit above this on
    // the live list, but the prize is locked to whoever led at the close.
    let winner = null;
    if (isPrize && closed) {
      const closeMs = Date.parse(closesAt);
      const openMs  = opensAt ? Date.parse(opensAt) : 0;
      for (const k of keysByScore) {
        const t = k.metadata.t;
        if (t <= closeMs && t >= openMs) { winner = { initials: k.metadata.i, score: k.metadata.s }; break; }
      }
    }

    return json({ game, opensAt, closesAt, closed, open, winner, count: keysByScore.length, scores: rows, setup: true });
  }

  if (request.method === 'POST') {
    // Board stays open to new scores even after the prize closes.
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
    /* A run is under five minutes. Six hours of token life was six hours in
       which a harvested token could be sat on; 45 minutes is still generous
       for someone who paused. */
    if (!(age >= 0 && age < 45 * 60 * 1000)) return json({ error: 'token expired' }, 403);
    const gate = GATE[game] || { min: 2000, rate: 83.34 };
    if (age < gate.min + (score / gate.rate) * 1000) return json({ error: 'too fast' }, 403);
    /* Per-IP ceiling. The play token is the real gate, but tokens are free to
       fetch, so this caps how fast one machine can spend them. A genuine run
       is about four minutes, so nobody honest gets near this. */
    const ip = request.headers.get('cf-connecting-ip') || 'x';
    const rlKey = `rl:${game}:${ip}:${Math.floor(Date.now() / 3600000)}`;
    const rlN = Number((await env.SCORES.get(rlKey)) || 0);
    if (rlN >= 15) return json({ error: 'too many submissions, try again later' }, 429);
    await env.SCORES.put(rlKey, String(rlN + 1), { expirationTtl: 7200 });

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
