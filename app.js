/* Português 1000: PT→EN quiz with Leitner spaced repetition. All state lives in localStorage on the device. */
(() => {
  'use strict';
  const WORDS = window.WORDS || [];
  const CATS = window.CATS || {};
  const BY_ID = new Map(WORDS.map(w => [w.i, w]));
  const KEY = 'pt1000.v1';
  const DAY = 86400000;
  const INTERVAL = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 21 }; // days until next review after reaching box
  const MASTER_BOX = 5;
  const REVIEW_CAP = 40;
  const REQUEUE_GAP = 3;
  const POS_PL = { v: 'czasownik', n: 'rzeczownik', adj: 'przymiotnik', adv: 'przysłówek', pron: 'zaimek', det: 'określnik', conj: 'spójnik', prep: 'przyimek', num: 'liczebnik', phr: 'zwrot', int: 'wykrzyknik' };

  const $ = id => document.getElementById(id);

  /* ---------- storage ---------- */
  const fresh = () => ({ v: 1, cards: {}, settings: { dir: 'pt', batch: 10, auto: true }, streak: { last: '', n: 0 }, today: { d: '', a: 0, ok: 0 } });
  let S;
  try {
    S = JSON.parse(localStorage.getItem(KEY)) || fresh();
  } catch (e) { S = fresh(); }
  const def = fresh();
  S.settings = Object.assign(def.settings, S.settings || {});
  S.cards = S.cards || {};
  S.streak = S.streak || def.streak;
  S.today = S.today || def.today;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked: keep going in memory */ } };
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  /* ---------- dates ---------- */
  const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const yesterdayKey = () => dayKey(startOfDay() - DAY / 2);

  /* ---------- stats ---------- */
  function stats() {
    const now = Date.now();
    let mastered = 0, learning = 0, due = 0;
    for (const w of WORDS) {
      const c = S.cards[w.i];
      if (!c) continue;
      if (c.b >= MASTER_BOX) mastered++; else learning++;
      if (c.due <= now) due++;
    }
    return { mastered, learning, due, unseen: WORDS.length - mastered - learning };
  }
  function currentStreak() {
    if (S.streak.last === dayKey() || S.streak.last === yesterdayKey()) return S.streak.n;
    return 0;
  }
  function bumpToday(correct) {
    const today = dayKey();
    if (S.today.d !== today) S.today = { d: today, a: 0, ok: 0 };
    S.today.a++;
    if (correct) S.today.ok++;
    if (S.streak.last !== today) {
      S.streak.n = S.streak.last === yesterdayKey() ? S.streak.n + 1 : 1;
      S.streak.last = today;
    }
  }

  /* ---------- text helpers ---------- */
  const keysOf = en => new Set(
    en.toLowerCase().replace(/\(.*?\)/g, '').split('/').map(s => s.replace(/[!?.…"]/g, '').trim()).filter(Boolean)
  );
  const overlaps = (a, b) => { const ka = keysOf(a.e); for (const k of keysOf(b.e)) if (ka.has(k)) return true; return false; };
  const speechText = pt => pt.replace(/\(.*?\)/g, '').replace(/\s\/\s/g, ', ').replace(/…/g, '').trim();
  const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

  /* ---------- distractors ---------- */
  function distractors(w, dir) {
    const shown = x => (dir === 'pt' ? x.e : x.p).toLowerCase();
    const tiers = [
      x => x.s === w.s && x.c === w.c,
      x => x.s === w.s,
      x => x.c === w.c,
      () => true,
    ];
    const picked = [];
    const used = new Set([shown(w)]);
    for (const t of tiers) {
      const pool = shuffle(WORDS.filter(x => x.i !== w.i && t(x)));
      for (const x of pool) {
        if (picked.length === 3) break;
        if (picked.includes(x) || used.has(shown(x)) || overlaps(w, x) || picked.some(p => overlaps(p, x))) continue;
        picked.push(x); used.add(shown(x));
      }
      if (picked.length === 3) break;
    }
    return picked;
  }

  /* ---------- speech ---------- */
  let voice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    const vs = speechSynthesis.getVoices();
    const norm = v => (v.lang || '').replace('_', '-').toLowerCase();
    voice = vs.find(v => norm(v) === 'pt-pt') || vs.find(v => /joana|catarina|cristiano/i.test(v.name)) || vs.find(v => norm(v).startsWith('pt')) || null;
    renderVoiceInfo();
    return voice;
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', pickVoice);
  }
  function speak(pt) {
    if (!('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(speechText(pt));
      u.lang = 'pt-PT';
      if (voice) u.voice = voice;
      u.rate = 0.9;
      speechSynthesis.speak(u);
    } catch (e) { /* speech unavailable */ }
  }
  function renderVoiceInfo() {
    const el = $('voice-info');
    if (!el) return;
    if (!('speechSynthesis' in window)) { el.textContent = 'Ta przeglądarka nie ma syntezy mowy.'; return; }
    if (!voice) { el.textContent = 'Brak głosu portugalskiego. Na iPhonie: Ustawienia > Dostępność > Treść mówiona > Głosy > Portugalski (Portugalia).'; return; }
    const isPT = (voice.lang || '').replace('_', '-').toLowerCase() === 'pt-pt';
    el.textContent = isPT ? `Głos: ${voice.name} (pt-PT)` : `Głos: ${voice.name} (${voice.lang}). Głosu pt-PT brak, dodasz go w Ustawienia > Dostępność > Treść mówiona > Głosy.`;
  }

  /* ---------- screens ---------- */
  function show(id, focus = true) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    window.scrollTo(0, 0);
    const focusTarget = { home: 'btn-start', quiz: 'q-word', summary: 'btn-again', settings: 'btn-close-settings' }[id];
    const el = focusTarget && $(focusTarget);
    if (focus && el && id !== 'quiz') el.focus({ preventScroll: true });
  }

  function plural(n, one, few, many) {
    if (n === 1) return one;
    const d = n % 10, dd = n % 100;
    return d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14) ? few : many;
  }

  function renderHome() {
    const st = stats();
    $('mastered').textContent = st.mastered;
    $('total').textContent = WORDS.length;
    const pct = WORDS.length ? (st.mastered / WORDS.length) * 100 : 0;
    $('mbar-fill').style.width = pct + '%';
    const bar = $('mbar');
    bar.setAttribute('aria-valuemax', WORDS.length);
    bar.setAttribute('aria-valuenow', st.mastered);
    $('learning').textContent = st.learning;
    $('due').textContent = st.due;
    $('unseen').textContent = st.unseen;
    const n = currentStreak();
    $('streak').textContent = n;
    $('streak-unit').textContent = plural(n, 'dzień', 'dni', 'dni');
    const today = S.today.d === dayKey() ? S.today : { a: 0, ok: 0 };
    $('today-line').textContent = today.a
      ? `Dziś: ${today.a} ${plural(today.a, 'odpowiedź', 'odpowiedzi', 'odpowiedzi')}, ${today.ok} dobrze`
      : (n ? 'Zrób dziś sesję, żeby utrzymać serię' : 'Dziś jeszcze bez ćwiczeń');
    for (const b of document.querySelectorAll('#home .seg-btn')) b.setAttribute('aria-checked', String(b.dataset.dir === S.settings.dir));
    const newN = Math.min(S.settings.batch, st.unseen);
    const revN = Math.min(st.due, REVIEW_CAP);
    if (revN + newN > 0) {
      $('start-label').textContent = 'Zacznij naukę';
      const parts = [];
      if (revN) parts.push(`${revN} ${plural(revN, 'powtórka', 'powtórki', 'powtórek')}`);
      if (newN) parts.push(`${newN} ${plural(newN, 'nowe słowo', 'nowe słowa', 'nowych słów')}`);
      $('start-sub').textContent = parts.join(' · ');
    } else {
      $('start-label').textContent = 'Ćwicz dodatkowo';
      $('start-sub').textContent = st.mastered === WORDS.length && WORDS.length
        ? 'Wszystkie słowa opanowane. Możesz utrwalać.'
        : 'Na dziś wszystko zrobione. Kolejne powtórki jutro.';
    }
  }

  function renderSettings() {
    for (const b of document.querySelectorAll('#seg-batch .seg-btn')) b.setAttribute('aria-checked', String(Number(b.dataset.n) === S.settings.batch));
    $('chk-auto').checked = !!S.settings.auto;
    renderVoiceInfo();
  }

  /* ---------- session ---------- */
  let Q = null; // { queue: [{id, isNew, missed}], total, done, ok, wrong, newCount, practice, current, opts, answered }

  function buildSession() {
    const now = Date.now();
    const seen = WORDS.filter(w => S.cards[w.i]);
    const due = seen.filter(w => S.cards[w.i].due <= now)
      .sort((a, b) => S.cards[a.i].due - S.cards[b.i].due || S.cards[a.i].b - S.cards[b.i].b)
      .slice(0, REVIEW_CAP);
    const fresh = WORDS.filter(w => !S.cards[w.i]).slice(0, S.settings.batch);
    let items = [...shuffle(due).map(w => ({ id: w.i, isNew: false })), ...fresh.map(w => ({ id: w.i, isNew: true }))];
    let practice = false;
    if (!items.length) {
      practice = true;
      const pool = shuffle(seen.slice()).sort((a, b) => S.cards[a.i].b - S.cards[b.i].b).slice(0, 10);
      items = shuffle(pool).map(w => ({ id: w.i, isNew: false }));
    }
    return { queue: items, total: items.length, done: 0, ok: 0, wrong: 0, newCount: fresh.length, practice, missed: new Set(), firstTry: new Set() };
  }

  function startSession() {
    if (!WORDS.length) return;
    Q = buildSession();
    if (!Q.queue.length) { renderHome(); return; }
    show('quiz');
    nextCard();
  }

  function nextCard() {
    if (!Q.queue.length) return finishSession();
    const item = Q.queue[0];
    const w = BY_ID.get(item.id);
    const dir = S.settings.dir;
    Q.current = item;
    Q.answered = false;
    const opts = shuffle([w, ...distractors(w, dir)]);
    Q.opts = opts;

    $('q-label').textContent = item.isNew && !Q.missed.has(item.id) ? 'Nowe słowo · co to znaczy?' : (dir === 'pt' ? 'Co to znaczy?' : 'Jak to jest po portugalsku?');
    const wordEl = $('q-word');
    wordEl.textContent = dir === 'pt' ? w.p : w.e;
    wordEl.setAttribute('lang', dir === 'pt' ? 'pt-PT' : 'en');
    wordEl.classList.toggle('long', wordEl.textContent.length > 16);
    $('q-tag').textContent = `${POS_PL[w.s] || ''} · ${CATS[w.c] || ''}`;
    $('btn-speak').hidden = dir !== 'pt';

    const box = $('options');
    box.textContent = '';
    opts.forEach((o, idx) => {
      const b = document.createElement('button');
      b.className = 'opt';
      b.type = 'button';
      b.dataset.id = o.i;
      const label = document.createElement('span');
      label.textContent = dir === 'pt' ? o.e : o.p;
      if (dir !== 'pt') label.lang = 'pt-PT';
      b.append(label);
      b.insertAdjacentHTML('beforeend', '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>');
      b.setAttribute('aria-label', `${idx + 1}. ${label.textContent}`);
      b.addEventListener('click', () => answer(o.i));
      box.append(b);
    });
    const fb = $('feedback');
    fb.textContent = '';
    fb.className = 'feedback';
    $('btn-next').hidden = true;

    const doneUnique = Q.total - new Set(Q.queue.map(x => x.id)).size;
    $('qcount').textContent = `${doneUnique}/${Q.total}`;
    $('qbar-fill').style.width = (Q.total ? (doneUnique / Q.total) * 100 : 0) + '%';

    if (dir === 'pt' && S.settings.auto) speak(w.p);
    wordEl.setAttribute('tabindex', '-1');
    wordEl.focus({ preventScroll: true });
  }

  function answer(chosenId) {
    if (!Q || Q.answered) return;
    Q.answered = true;
    const item = Q.current;
    const w = BY_ID.get(item.id);
    const correct = chosenId === w.i;
    const dir = S.settings.dir;
    const today0 = startOfDay();

    for (const b of document.querySelectorAll('#options .opt')) {
      const id = Number(b.dataset.id);
      b.disabled = true;
      const icon = b.querySelector('use');
      if (id === w.i) { b.classList.add('ok'); icon.setAttribute('href', '#i-check'); }
      else if (id === chosenId) { b.classList.add('bad'); icon.setAttribute('href', '#i-x'); }
      else b.classList.add('dim');
    }

    const c = S.cards[w.i] || { b: 1, due: 0, r: 0, w: 0 };
    if (correct) {
      c.r++;
      if (Q.missed.has(w.i)) { c.b = 1; c.due = today0 + DAY; }
      else if (!Q.practice) { c.b = Math.min(MASTER_BOX, (S.cards[w.i] ? c.b : 1) + 1); c.due = today0 + INTERVAL[c.b] * DAY; }
      Q.queue.shift();
      if (!Q.missed.has(w.i)) Q.ok++;
    } else {
      c.w++;
      c.b = 1;
      c.due = Date.now();
      if (!Q.missed.has(w.i)) Q.wrong++;
      Q.missed.add(w.i);
      const it = Q.queue.shift();
      Q.queue.splice(Math.min(REQUEUE_GAP, Q.queue.length), 0, it);
    }
    S.cards[w.i] = c;
    bumpToday(correct);
    save();

    const fb = $('feedback');
    if (correct) {
      fb.className = 'feedback ok';
      fb.textContent = c.b >= MASTER_BOX && !Q.missed.has(w.i) ? 'Dobrze! Słowo opanowane.' : 'Dobrze!';
    } else {
      fb.className = 'feedback bad';
      fb.textContent = `Źle. Poprawnie: ${dir === 'pt' ? w.e : w.p}`;
    }
    if (dir === 'en' && S.settings.auto) speak(w.p);
    const next = $('btn-next');
    next.hidden = false;
    next.focus({ preventScroll: true });
  }

  function finishSession() {
    const total = Q.ok + Q.wrong;
    $('s-score').textContent = `${Q.ok}/${total}`;
    const st = stats();
    const parts = [`Dobrze za pierwszym razem: ${Q.ok} z ${total}.`];
    if (Q.newCount && !Q.practice) parts.push(`Nowe słowa: ${Q.newCount}.`);
    parts.push(`Opanowane: ${st.mastered} z ${WORDS.length}.`);
    const n = currentStreak();
    parts.push(`Seria: ${n} ${plural(n, 'dzień', 'dni', 'dni')}.`);
    $('s-detail').textContent = parts.join(' ');
    Q = null;
    show('summary');
  }

  /* ---------- events ---------- */
  $('btn-start').addEventListener('click', startSession);
  $('btn-again').addEventListener('click', startSession);
  $('btn-home').addEventListener('click', () => { renderHome(); show('home'); });
  $('btn-quit').addEventListener('click', () => { if (speechSynthesis) speechSynthesis.cancel(); Q = null; renderHome(); show('home'); });
  $('btn-next').addEventListener('click', nextCard);
  $('btn-speak').addEventListener('click', () => { if (Q) speak(BY_ID.get(Q.current.id).p); });
  $('btn-settings').addEventListener('click', () => { renderSettings(); show('settings'); });
  $('btn-close-settings').addEventListener('click', () => { renderHome(); show('home'); });
  for (const b of document.querySelectorAll('#home .seg-btn')) b.addEventListener('click', () => { S.settings.dir = b.dataset.dir; save(); renderHome(); });
  for (const b of document.querySelectorAll('#seg-batch .seg-btn')) b.addEventListener('click', () => { S.settings.batch = Number(b.dataset.n); save(); renderSettings(); });
  $('chk-auto').addEventListener('change', e => { S.settings.auto = e.target.checked; save(); });

  let resetArmed = null;
  $('btn-reset').addEventListener('click', () => {
    const btn = $('btn-reset');
    if (!resetArmed) {
      btn.textContent = 'Na pewno? Stuknij jeszcze raz';
      resetArmed = setTimeout(() => { resetArmed = null; btn.textContent = 'Wyzeruj postęp'; }, 4000);
      return;
    }
    clearTimeout(resetArmed); resetArmed = null;
    const keep = S.settings;
    S = fresh(); S.settings = keep; save();
    btn.textContent = 'Wyzeruj postęp';
    $('reset-info').textContent = 'Postęp wyzerowany.';
  });

  document.addEventListener('keydown', e => {
    if ($('quiz').hidden || !Q) return;
    if (!Q.answered && /^[1-4]$/.test(e.key)) { const o = Q.opts[Number(e.key) - 1]; if (o) answer(o.i); }
    else if (Q.answered && (e.key === 'Enter' || e.key === ' ') && document.activeElement !== $('btn-next')) { e.preventDefault(); nextCard(); }
  });

  // Roll the "today" counter over when the app is reopened on a new day.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('home').hidden) renderHome(); });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  renderHome();
  show('home', false);
})();
