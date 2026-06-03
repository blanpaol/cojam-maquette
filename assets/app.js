/* =============================================================
   CoJam — Prototype · Routeur SPA + interactions
   Tout est piloté par attributs data-* dans le HTML :
     data-go="idEcran"     → navigue vers l'écran
     data-back             → écran précédent
     data-sheet="idSheet"  → ouvre une bottom-sheet
     data-close-sheet      → ferme la sheet
   + composants auto : message audio, enregistrement, push-to-talk,
     toggles, chips sélectionnables.
   ============================================================= */
(function () {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const viewport = $('.viewport');
  const history = [];

  /* ---------- Routeur ---------- */
  function go(id, opts = {}) {
    const next = document.getElementById(id);
    if (!next || next.classList.contains('is-active')) return;
    const current = $('.screen.is-active');

    if (current) {
      if (!opts.back) history.push(current.id);
      current.classList.add('is-leaving');
      current.classList.remove('is-active');
      setTimeout(() => current.classList.remove('is-leaving'), 340);
    }
    next.classList.add('is-active');
    setTheme(next.dataset.theme || 'light');
    syncTabs(id);
    const sc = next.querySelector('.scroll');
    if (sc) sc.scrollTop = 0;
  }

  function back() {
    const prev = history.pop();
    if (prev) go(prev, { back: true });
  }

  function setTheme(theme) {
    viewport.classList.toggle('bar-light', theme === 'dark');
    viewport.classList.toggle('bar-dark', theme !== 'dark');
  }

  function syncTabs(id) {
    $$('.tabbar .tab').forEach(t => t.classList.toggle('active', t.dataset.go === id));
  }

  /* ---------- Bottom sheets ---------- */
  function openSheet(id) { const s = document.getElementById(id); if (s) s.classList.add('open'); }
  function closeSheet() { $$('.sheet-mask.open').forEach(s => s.classList.remove('open')); }

  /* ---------- Délégation des clics ---------- */
  document.addEventListener('click', (e) => {
    const goEl = e.target.closest('[data-go]');
    if (goEl) { e.preventDefault(); go(goEl.dataset.go); return; }

    if (e.target.closest('[data-back]')) { back(); return; }

    const sheetEl = e.target.closest('[data-sheet]');
    if (sheetEl) { openSheet(sheetEl.dataset.sheet); return; }

    if (e.target.closest('[data-close-sheet]') || e.target.classList.contains('sheet-mask')) { closeSheet(); return; }

    // toggles
    const tog = e.target.closest('.toggle');
    if (tog) { tog.classList.toggle('on'); return; }

    // chips sélectionnables
    const chip = e.target.closest('.chip.selectable');
    if (chip) { chip.classList.toggle('on'); return; }

    // message audio : play/pause
    const play = e.target.closest('.vm-play');
    if (play) { toggleVoice(play.closest('.voice-msg')); return; }

    // enregistrement
    if (e.target.closest('.c-ic.mic')) { startRec(e.target.closest('.composer')); return; }
    if (e.target.closest('.rec-cancel')) { stopRec(e.target.closest('.rec-bar'), false); return; }
    if (e.target.closest('.rec-send')) { stopRec(e.target.closest('.rec-bar'), true); return; }
  });

  /* ============================================================
     MESSAGE AUDIO — waveform + lecture simulée
     ============================================================ */
  // motif déterministe d'amplitudes (rend "naturel" sans random)
  const PATTERN = [.35,.6,.85,.5,.7,1,.45,.65,.9,.4,.55,.8,.6,.35,.7,.95,.5,.75,.4,.6,.85,.55,.3,.7,.9,.45,.65,.5,.8,.35];

  function buildWave(el, bars = 30) {
    el.innerHTML = '';
    for (let i = 0; i < bars; i++) {
      const s = document.createElement('span');
      s.style.height = (22 + PATTERN[i % PATTERN.length] * 70) + '%';
      el.appendChild(s);
    }
  }

  const voiceState = new WeakMap();

  function toggleVoice(vm) {
    if (!vm) return;
    const st = voiceState.get(vm);
    if (st && st.playing) { pauseVoice(vm); return; }

    // stoppe les autres
    $$('.voice-msg.playing').forEach(pauseVoice);

    const bars = $$('.vm-wave span', vm);
    const durEl = $('.vm-dur', vm);
    const total = parseDur(durEl ? durEl.textContent : '0:12');
    setPlayIcon(vm, true);
    vm.classList.add('playing');

    let i = 0;
    const step = Math.max(40, (total * 1000) / bars.length);
    const timer = setInterval(() => {
      if (i < bars.length) { bars[i].classList.add('played'); i++; }
      if (durEl) durEl.textContent = fmt(Math.min(total, (i / bars.length) * total));
      if (i >= bars.length) finishVoice(vm);
    }, step);

    voiceState.set(vm, { playing: true, timer, total });
  }

  function pauseVoice(vm) {
    const st = voiceState.get(vm);
    if (st) clearInterval(st.timer);
    vm.classList.remove('playing');
    setPlayIcon(vm, false);
    voiceState.set(vm, { playing: false });
  }

  function finishVoice(vm) {
    const st = voiceState.get(vm);
    if (st) clearInterval(st.timer);
    vm.classList.remove('playing');
    setPlayIcon(vm, false);
    setTimeout(() => {
      $$('.vm-wave span', vm).forEach(b => b.classList.remove('played'));
      const d = $('.vm-dur', vm);
      if (d && d.dataset.full) d.textContent = d.dataset.full;
    }, 500);
    voiceState.set(vm, { playing: false });
  }

  const ICON_PLAY  = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  function setPlayIcon(vm, playing) {
    const b = $('.vm-play', vm);
    if (b) b.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  }
  function parseDur(t) { const [m, s] = t.split(':').map(Number); return m * 60 + s; }
  function fmt(sec) { const m = Math.floor(sec / 60), s = Math.round(sec % 60); return m + ':' + String(s).padStart(2, '0'); }

  /* ============================================================
     ENREGISTREMENT — barre live + envoi d'un message audio
     ============================================================ */
  let recTimer = null;
  function startRec(composer) {
    if (!composer) return;
    const bar = composer.parentElement.querySelector('.rec-bar');
    if (!bar) return;
    composer.style.display = 'none';
    bar.classList.add('on');
    const t = $('.rec-time', bar);
    let s = 0;
    if (t) t.textContent = '0:00';
    recTimer = setInterval(() => { s++; if (t) t.textContent = fmt(s); }, 1000);
    bar.dataset.elapsed = '0';
    bar._tick = setInterval(() => { bar.dataset.elapsed = String(+bar.dataset.elapsed + 1); }, 1000);
  }

  function stopRec(bar, send) {
    if (!bar) return;
    clearInterval(recTimer); clearInterval(bar._tick);
    const composer = bar.parentElement.querySelector('.composer');
    bar.classList.remove('on');
    if (composer) composer.style.display = '';
    if (send) {
      const dur = Math.max(1, +(bar.dataset.elapsed || 3));
      appendVoiceMessage(dur);
    }
  }

  function appendVoiceMessage(seconds) {
    const thread = $('.screen.is-active .thread');
    if (!thread) return;
    const dur = fmt(seconds);
    const row = document.createElement('div');
    row.className = 'row me';
    row.innerHTML =
      '<div class="voice-msg">' +
        '<button class="vm-play">' + ICON_PLAY + '</button>' +
        '<div class="vm-wave"></div>' +
        '<div class="vm-meta"><span class="vm-dur" data-full="' + dur + '">' + dur + '</span></div>' +
      '</div>';
    thread.appendChild(row);
    buildWave($('.vm-wave', row), 26);
    const sc = thread.closest('.scroll') || thread.parentElement;
    sc.scrollTop = sc.scrollHeight;
  }

  /* ============================================================
     PUSH-TO-TALK (salon vocal + mode conduite)
     ============================================================ */
  function wirePTT(el) {
    const down = () => { el.classList.add('held'); const l = el.querySelector('.ptt-lbl, span'); if (l) { el.dataset.lbl = l.textContent; l.textContent = 'Parle…'; } };
    const up   = () => { el.classList.remove('held'); const l = el.querySelector('.ptt-lbl, span'); if (l && el.dataset.lbl) l.textContent = el.dataset.lbl; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('pointercancel', up);
  }

  /* ---------- Init ---------- */
  function init() {
    $$('.vm-wave').forEach(w => { if (!w.children.length) buildWave(w, w.dataset.bars ? +w.dataset.bars : 30); });
    $$('.rec-wave').forEach(w => { w.innerHTML = ''; for (let i = 0; i < 26; i++) { const s = document.createElement('span'); s.style.animationDelay = (i * 0.05) + 's'; w.appendChild(s); } });
    $$('.vm-play').forEach(b => { if (!b.innerHTML.trim()) b.innerHTML = ICON_PLAY; });
    $$('.ptt, .big-ptt').forEach(wirePTT);

    // écran de départ
    const start = document.querySelector('.screen[data-start]') || document.querySelector('.screen');
    if (start) { start.classList.add('is-active'); setTheme(start.dataset.theme || 'light'); syncTabs(start.id); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // expose pour debug
  window.CoJam = { go, back };
})();
