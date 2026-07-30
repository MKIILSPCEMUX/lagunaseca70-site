/* Laguna Seca — shared high score board client.
   Both games load this and call:
     Leaderboard.init('darkstar', { panel: '#hiscore-panel', accent: '#48d86b', prize: true });
     Leaderboard.onGameOver(score);            // when a run ends
   The entry form (initials + optional email + mailing-list opt-in) is built here,
   so the game files only need a panel container and two calls. */
(function () {
  var API = '/api/scores';
  var cfg = { game: 'darkstar', accent: '#48d86b', prize: false, panel: null };
  var state = { closesAt: null, closed: false, scores: [] };
  var modal = null;

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
      '.lb{--lb-accent:#48d86b;font-family:"Arial Narrow","Helvetica Neue",Arial,sans-serif;color:#f2efe8;}' +
      '.lb-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:7px;}' +
      '.lb-title{font-size:11px;font-weight:800;letter-spacing:0.22em;text-transform:uppercase;color:var(--lb-accent);}' +
      '.lb-sub{font-size:9px;letter-spacing:0.06em;text-transform:uppercase;opacity:0.72;text-align:right;}' +
      '.lb-list{list-style:none;margin:0;padding:0;}' +
      '.lb-row{display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 2px;border-bottom:1px solid rgba(255,255,255,0.08);}' +
      '.lb-row:last-child{border-bottom:none;}' +
      '.lb-rank{width:16px;opacity:0.5;font-size:10px;text-align:right;}' +
      '.lb-ini{font-weight:800;letter-spacing:0.14em;width:44px;}' +
      '.lb-sc{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:700;}' +
      '.lb-row.me .lb-ini,.lb-row.me .lb-sc{color:var(--lb-accent);}' +
      '.lb-empty{font-size:10.5px;opacity:0.6;padding:6px 2px;letter-spacing:0.04em;}' +
      /* modal */
      '.lb-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:18px;' +
      'background:rgba(3,5,10,0.72);backdrop-filter:blur(2px);}' +
      '.lb-modal[hidden]{display:none;}' +
      '.lb-card{--lb-accent:#48d86b;width:100%;max-width:320px;background:linear-gradient(180deg,#14131a,#0c0b10);' +
      'border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:20px 18px;color:#f2efe8;' +
      'font-family:"Arial Narrow","Helvetica Neue",Arial,sans-serif;box-shadow:0 24px 60px rgba(0,0,0,0.6);}' +
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
      '.lb-msg.err{color:#ff6b6b;}.lb-msg.ok{color:var(--lb-accent);}';
    var s = el('style'); s.id = 'lb-style'; s.textContent = css;
    document.head.appendChild(s);
  }

  function fmtCountdown(closesAt) {
    var ms = Date.parse(closesAt) - Date.now();
    if (ms <= 0) return 'Closed';
    var d = Math.floor(ms / 86400000);
    var h = Math.floor((ms % 86400000) / 3600000);
    if (d > 0) return 'Prize closes in ' + d + 'd ' + h + 'h';
    var m = Math.floor((ms % 3600000) / 60000);
    return 'Prize closes in ' + h + 'h ' + m + 'm';
  }

  function renderPanel() {
    var host = typeof cfg.panel === 'string' ? document.querySelector(cfg.panel) : cfg.panel;
    if (!host) return;
    host.innerHTML = '';
    var box = el('div', 'lb');
    box.style.setProperty('--lb-accent', cfg.accent);

    var head = el('div', 'lb-head');
    head.appendChild(el('span', 'lb-title', 'High Scores'));
    var sub = 'Top scores';
    if (cfg.prize) sub = state.closed ? 'Competition closed' : fmtCountdown(state.closesAt);
    head.appendChild(el('span', 'lb-sub', esc(sub)));
    box.appendChild(head);

    if (!state.scores.length) {
      box.appendChild(el('div', 'lb-empty', 'Be the first name on the board.'));
    } else {
      var list = el('ol', 'lb-list');
      state.scores.forEach(function (r, i) {
        var row = el('div', 'lb-row' + (r._me ? ' me' : ''));
        row.appendChild(el('span', 'lb-rank', String(i + 1)));
        row.appendChild(el('span', 'lb-ini', esc(r.initials)));
        row.appendChild(el('span', 'lb-sc', String(r.score)));
        list.appendChild(row);
      });
      box.appendChild(list);
    }
    if (cfg.prize && state.closed && state.scores.length) {
      box.appendChild(el('div', 'lb-empty', 'Winner: ' + esc(state.scores[0].initials) + '. We will be in touch.'));
    }
    host.appendChild(box);
  }

  function load() {
    return fetch(API + '?game=' + encodeURIComponent(cfg.game), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.closesAt = d.closesAt; state.closed = !!d.closed; state.scores = d.scores || [];
        renderPanel();
      })
      .catch(function () { renderPanel(); });
  }

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
      '<input maxlength="1" inputmode="latin" aria-label="Initial 1">' +
      '<input maxlength="1" inputmode="latin" aria-label="Initial 2">' +
      '<input maxlength="1" inputmode="latin" aria-label="Initial 3"></div>' +
      '<input class="lb-field lb-email" type="email" placeholder="Email (optional)" aria-label="Email">' +
      '<label class="lb-opt"><input type="checkbox" class="lb-join"><span>Add me to the Laguna Seca mailing list</span></label>' +
      '<div class="lb-tip">Screenshot your score to share it.</div>' +
      '<div class="lb-actions"><button class="lb-btn lb-go">Submit</button><button class="lb-btn lb-skip">Skip</button></div>' +
      '<div class="lb-msg"></div></div>';
    document.body.appendChild(modal);

    var card = modal.querySelector('.lb-card');
    card.style.setProperty('--lb-accent', cfg.accent);
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
    modal.querySelector('.lb-skip').addEventListener('click', hideModal);
    modal.querySelector('.lb-go').addEventListener('click', submit);
    // keep game keyboard controls from firing while typing
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
    if ((joinList || (cfg.prize)) && email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
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
        msg.className = 'lb-msg ok'; msg.textContent = 'On the board.';
        // optimistic insert, then reload from server
        state.scores.push({ initials: initials, score: pendingScore, _me: true });
        state.scores.sort(function (a, b) { return b.score - a.score; });
        state.scores = state.scores.slice(0, 10);
        renderPanel();
        setTimeout(function () { hideModal(); load(); }, 700);
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
      cfg.panel = opts.panel || null;
      injectStyle();
      load();
    },
    onGameOver: function (score) {
      if (state.closed) { load(); return; }        // frozen board, just refresh
      if (!(score > 0)) return;
      showModal(score);
    },
    refresh: function () { return load(); },
  };
})();
