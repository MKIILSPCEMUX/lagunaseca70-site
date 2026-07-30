/* Laguna Seca — shared high score board client.
   Both games load this and call:
     Leaderboard.init('darkstar', { screen: '.scanner', accent: '#48d86b',
                                    prize: true, onReplay: resetGame });
     Leaderboard.onGameOver(score);   // when a run ends
     Leaderboard.hideScreen();        // call inside the game's own restart

   Flow: run ends -> if you scored, an entry form pops (three initials + optional
   email + mailing-list opt-in). After you submit or skip, the top-ten board is
   drawn ON the game screen and stays until you play again. No permanent panel in
   the cabinet, so nothing grows and shoves the layout around. */
(function () {
  var API = '/api/scores';
  var cfg = { game: 'darkstar', accent: '#48d86b', prize: false, screen: null, onReplay: null };
  var state = { closesAt: null, closed: false, scores: [], myTs: null, myEntry: null };
  var modal = null, overlay = null, keyCatcher = null;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function injectStyle() {
    if (document.getElementById('lb-style')) return;
    var css =
      /* entry modal */
      '.lb-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:18px;' +
      'background:rgba(3,5,10,0.72);backdrop-filter:blur(2px);font-family:"Arial Narrow","Helvetica Neue",Arial,sans-serif;}' +
      '.lb-modal[hidden]{display:none;}' +
      '.lb-card{--lb-accent:#48d86b;width:100%;max-width:320px;background:linear-gradient(180deg,#14131a,#0c0b10);' +
      'border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:20px 18px;color:#f2efe8;' +
      'box-shadow:0 24px 60px rgba(0,0,0,0.6);}' +
      '.lb-ct{font-size:13px;font-weight:800;letter-spacing:0.28em;text-transform:uppercase;text-align:center;color:var(--lb-accent);}' +
      '.lb-cs{text-align:center;font-size:12px;letter-spacing:0.08em;margin:6px 0 2px;opacity:0.9;}' +
      '.lb-cs b{font-size:18px;}' +
      '.lb-cp{text-align:center;font-size:10.5px;line-height:1.5;opacity:0.72;margin:8px 0 14px;}' +
      '.lb-inis{display:flex;gap:10px;justify-content:center;margin-bottom:14px;}' +
      '.lb-inis input{width:46px;height:56px;text-align:center;font-size:26px;font-weight:800;text-transform:uppercase;' +
      'border-radius:10px;border:1px solid rgba(255,255,255,0.22);background:#f7f6f2;color:#111;caret-color:var(--lb-accent);}' +
      '.lb-inis input:focus{outline:2px solid var(--lb-accent);outline-offset:1px;}' +
      '.lb-field{width:100%;height:38px;padding:6px 12px;border-radius:19px;border:1px solid rgba(255,255,255,0.2);' +
      'background:#f7f6f2;color:#111;font-size:13px;margin-bottom:10px;}' +
      '.lb-opt{display:flex;align-items:flex-start;gap:8px;font-size:10.5px;line-height:1.4;opacity:0.85;margin-bottom:10px;cursor:pointer;}' +
      '.lb-opt input{margin-top:1px;}' +
      '.lb-tip{font-size:10px;text-align:center;opacity:0.6;letter-spacing:0.04em;margin-bottom:14px;}' +
      '.lb-actions{display:flex;gap:10px;}' +
      '.lb-btn{flex:1;height:40px;border:none;border-radius:20px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;' +
      'font-size:12px;cursor:pointer;}' +
      '.lb-go{background:var(--lb-accent);color:#06120a;}' +
      '.lb-skip{background:rgba(255,255,255,0.1);color:#f2efe8;}' +
      '.lb-btn:disabled{opacity:0.55;cursor:default;}' +
      '.lb-msg{text-align:center;font-size:10.5px;min-height:14px;margin-top:9px;letter-spacing:0.04em;}' +
      '.lb-msg.err{color:#ff6b6b;}.lb-msg.ok{color:var(--lb-accent);}' +
      /* on-screen board overlay */
      '.lb-screen{position:absolute;inset:0;z-index:14;display:flex;flex-direction:column;padding:16px 16px 14px;' +
      'background:rgba(4,6,10,0.92);color:#f2efe8;font-family:"Arial Narrow","Helvetica Neue",Arial,sans-serif;cursor:pointer;' +
      'touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}' +
      '.lb-screen[hidden]{display:none;}' +
      '.lb-s-title{font-size:13px;font-weight:800;letter-spacing:0.26em;text-transform:uppercase;color:var(--lb-accent);text-align:center;}' +
      '.lb-s-sub{font-size:9px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.7;text-align:center;margin:3px 0 12px;}' +
      '.lb-s-list{list-style:none;margin:0;padding:0;flex:1 1 auto;overflow-y:auto;}' +
      '.lb-s-row{display:flex;align-items:center;gap:8px;font-size:14px;padding:5px 3px;border-bottom:1px solid rgba(255,255,255,0.09);}' +
      '.lb-s-row:last-child{border-bottom:none;}' +
      '.lb-s-rank{width:20px;text-align:right;opacity:0.5;font-size:11px;}' +
      '.lb-s-ini{font-weight:800;letter-spacing:0.16em;width:52px;}' +
      '.lb-s-sc{margin-left:auto;font-weight:700;font-variant-numeric:tabular-nums;}' +
      '.lb-s-row.me .lb-s-ini,.lb-s-row.me .lb-s-sc{color:var(--lb-accent);}' +
      '.lb-s-empty{opacity:0.7;text-align:center;font-size:12px;padding:18px 0;flex:1;}' +
      '.lb-s-foot{text-align:center;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;margin-top:12px;color:var(--lb-accent);}';
    var s = el('style'); s.id = 'lb-style'; s.textContent = css;
    document.head.appendChild(s);
  }

  function fmtCountdown(closesAt) {
    var ms = Date.parse(closesAt) - Date.now();
    if (ms <= 0) return 'Closed';
    var d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
    if (d > 0) return 'Prize closes in ' + d + 'd ' + h + 'h';
    var m = Math.floor((ms % 3600000) / 60000);
    return 'Prize closes in ' + h + 'h ' + m + 'm';
  }

  // Keep the player's own just-submitted entry visible even if KV's list read
  // hasn't caught up yet (KV list is eventually consistent, so a fresh entry can
  // be missing from the next read for a moment).
  function mergeMine() {
    if (!state.myEntry) return;
    var has = state.scores.some(function (r) { return r.ts === state.myEntry.ts; });
    if (!has) {
      state.scores.push({ initials: state.myEntry.initials, score: state.myEntry.score, ts: state.myEntry.ts });
      state.scores.sort(function (a, b) { return b.score - a.score; });
      state.scores = state.scores.slice(0, 10);
    }
  }

  function load() {
    return fetch(API + '?game=' + encodeURIComponent(cfg.game), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.closesAt = d.closesAt; state.closed = !!d.closed; state.scores = d.scores || [];
        mergeMine();
      })
      .catch(function () { /* offline: leave state as-is */ });
  }

  /* ---------- on-screen board ---------- */
  function ensureOverlay() {
    if (overlay) return overlay;
    var host = document.querySelector(cfg.screen);
    if (!host) return null;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    overlay = el('div', 'lb-screen'); overlay.hidden = true;
    overlay.style.setProperty('--lb-accent', cfg.accent);
    overlay.addEventListener('click', replay);
    host.appendChild(overlay);
    return overlay;
  }

  function renderBoard() {
    if (!overlay) return;
    var sub = cfg.prize ? (state.closed ? 'Competition closed' : fmtCountdown(state.closesAt)) : 'Top scores';
    var html = '<div class="lb-s-title">High Scores</div><div class="lb-s-sub">' + esc(sub) + '</div>';
    if (!state.scores.length) {
      html += '<div class="lb-s-empty">Be the first name on the board.</div>';
    } else {
      html += '<ol class="lb-s-list">';
      state.scores.forEach(function (r, i) {
        var me = (state.myTs && r.ts === state.myTs) ? ' me' : '';
        html += '<div class="lb-s-row' + me + '"><span class="lb-s-rank">' + (i + 1) + '</span>' +
          '<span class="lb-s-ini">' + esc(r.initials) + '</span>' +
          '<span class="lb-s-sc">' + r.score + '</span></div>';
      });
      html += '</ol>';
    }
    html += '<div class="lb-s-foot">Tap or press space to play again</div>';
    overlay.innerHTML = html;
  }

  function showBoard() {
    ensureOverlay();
    if (!overlay) return;
    renderBoard();
    overlay.hidden = false;
    addKeyCatcher();
  }
  function hideScreen() {
    if (overlay) overlay.hidden = true;
    removeKeyCatcher();
  }
  function addKeyCatcher() {
    if (keyCatcher) return;
    keyCatcher = function (e) {
      if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation(); replay();
      }
    };
    document.addEventListener('keydown', keyCatcher, true);
  }
  function removeKeyCatcher() {
    if (keyCatcher) { document.removeEventListener('keydown', keyCatcher, true); keyCatcher = null; }
  }
  function replay() {
    hideScreen();
    if (typeof cfg.onReplay === 'function') { try { cfg.onReplay(); } catch (e) {} }
  }

  /* ---------- entry modal ---------- */
  function buildModal() {
    if (modal) return;
    injectStyle();
    modal = el('div', 'lb-modal'); modal.hidden = true;
    modal.innerHTML =
      '<div class="lb-card">' +
      '<div class="lb-ct">Game Over</div>' +
      '<div class="lb-cs">You scored <b class="lb-scoreval">0</b></div>' +
      '<div class="lb-cp"></div>' +
      '<div class="lb-inis">' +
      '<input maxlength="1" autocomplete="off" aria-label="Initial 1">' +
      '<input maxlength="1" autocomplete="off" aria-label="Initial 2">' +
      '<input maxlength="1" autocomplete="off" aria-label="Initial 3"></div>' +
      '<input class="lb-field lb-email" type="email" autocomplete="email" placeholder="Email (optional)" aria-label="Email">' +
      '<label class="lb-opt"><input type="checkbox" class="lb-join"><span>Add me to the Laguna Seca mailing list</span></label>' +
      '<div class="lb-tip">Screenshot your score to share it.</div>' +
      '<div class="lb-actions"><button class="lb-btn lb-go">Submit</button><button class="lb-btn lb-skip">Skip</button></div>' +
      '<div class="lb-msg"></div></div>';
    document.body.appendChild(modal);

    modal.querySelector('.lb-card').style.setProperty('--lb-accent', cfg.accent);
    var inputs = Array.prototype.slice.call(modal.querySelectorAll('.lb-inis input'));
    inputs.forEach(function (inp, i) {
      inp.addEventListener('input', function () {
        inp.value = inp.value.toUpperCase().replace(/[^A-Z]/g, '');
        if (inp.value && i < 2) inputs[i + 1].focus();
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !inp.value && i > 0) inputs[i - 1].focus();
      });
    });
    modal.querySelector('.lb-skip').addEventListener('click', function () { hideModal(); showBoard(); });
    modal.querySelector('.lb-go').addEventListener('click', submit);
    // stop the game's own key handlers (on window) from firing while typing,
    // but keep the inputs' own handlers working (bubble phase, not capture)
    modal.addEventListener('keydown', function (e) { e.stopPropagation(); });
  }

  var pendingScore = 0, busy = false;

  function showModal(score) {
    buildModal();
    pendingScore = score; busy = false;
    modal.querySelector('.lb-scoreval').textContent = String(score);
    modal.querySelector('.lb-cp').textContent = cfg.prize
      ? 'Highest score when the clock runs out wins the EP and album. Add your email to claim a prize if you win.'
      : 'Post your initials to the board. Email only needed to join the list.';
    modal.querySelectorAll('.lb-inis input').forEach(function (i) { i.value = ''; });
    modal.querySelector('.lb-email').value = '';
    modal.querySelector('.lb-join').checked = false;
    var msg = modal.querySelector('.lb-msg'); msg.textContent = ''; msg.className = 'lb-msg';
    modal.querySelector('.lb-go').disabled = false;
    modal.hidden = false;
    setTimeout(function () { modal.querySelector('.lb-inis input').focus(); }, 30);
  }
  function hideModal() { if (modal) modal.hidden = true; }

  function submit() {
    if (busy) return;
    var msg = modal.querySelector('.lb-msg');
    var initials = Array.prototype.map.call(modal.querySelectorAll('.lb-inis input'), function (i) { return i.value; }).join('');
    if (initials.length !== 3) { msg.className = 'lb-msg err'; msg.textContent = 'Enter three initials.'; return; }
    var email = modal.querySelector('.lb-email').value.trim();
    var joinList = modal.querySelector('.lb-join').checked;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      msg.className = 'lb-msg err'; msg.textContent = 'That email looks off.'; return;
    }
    if (joinList && !email) { msg.className = 'lb-msg err'; msg.textContent = 'Add an email to join the list.'; return; }
    busy = true;
    modal.querySelector('.lb-go').disabled = true;
    msg.className = 'lb-msg'; msg.textContent = 'Saving...';

    fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ game: cfg.game, initials: initials, score: pendingScore, email: email, joinList: joinList }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) {
          busy = false; modal.querySelector('.lb-go').disabled = false;
          msg.className = 'lb-msg err';
          msg.textContent = res.d && res.d.closed ? 'The competition has closed.' : (res.d && res.d.error) || 'Could not save.';
          return;
        }
        state.myTs = res.d.ts;
        state.myEntry = { initials: initials, score: pendingScore, ts: res.d.ts };
        state.scores.push({ initials: initials, score: pendingScore, ts: res.d.ts });
        state.scores.sort(function (a, b) { return b.score - a.score; });
        state.scores = state.scores.slice(0, 10);
        msg.className = 'lb-msg ok'; msg.textContent = 'On the board.';
        setTimeout(function () {
          hideModal(); showBoard();
          load().then(function () { renderBoard(); });   // reconcile with the server
        }, 500);
      })
      .catch(function () {
        busy = false; modal.querySelector('.lb-go').disabled = false;
        msg.className = 'lb-msg err'; msg.textContent = 'Network error. Try again.';
      });
  }

  window.Leaderboard = {
    init: function (game, opts) {
      opts = opts || {};
      cfg.game = game;
      cfg.accent = opts.accent || cfg.accent;
      cfg.prize = !!opts.prize;
      cfg.screen = opts.screen || null;
      cfg.onReplay = opts.onReplay || null;
      injectStyle();
      load();
    },
    onGameOver: function (score) {
      load().then(function () {
        if (!state.closed && score > 0) showModal(score);
        else showBoard();          // scored zero, or the prize has closed
      });
    },
    hideScreen: hideScreen,
    refresh: load,
  };
})();
