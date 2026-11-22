/* Português 1000: PT→EN quiz with Leitner spaced repetition. All state lives in localStorage on the device. */
(() => {
  'use strict';
  const WORDS = (Array.isArray(window.WORDS) ? window.WORDS : []).map(w => (w.g != null && !Array.isArray(w.g) ? Object.assign({}, w, { g: [w.g] }) : w));
  const CATS = window.CATS || {};
  const BY_ID = new Map(WORDS.map(w => [w.i, w]));
  const KEY = 'pt1000.v1';
  const INTERVAL = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 21 }; // calendar days until next review after reaching a box
  const MASTER_BOX = 5;
  const REVIEW_CAP = 40;
  const REQUEUE_GAP = 3;
  const POS_PL = { v: 'czasownik', n: 'rzeczownik', adj: 'przymiotnik', adv: 'przysłówek', pron: 'zaimek', det: 'określnik', conj: 'spójnik', prep: 'przyimek', num: 'liczebnik', phr: 'zwrot', int: 'wykrzyknik' };
  const POS_FAMILY = { v: 'v', n: 'n', adj: 'adj', num: 'det', det: 'det', pron: 'det', adv: 'adv', prep: 'adv', conj: 'adv', phr: 'phr', int: 'phr' };

  const $ = id => document.getElementById(id);
  const hasSpeech = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  /* ---------- dates: calendar day keys, immune to DST ---------- */
  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayKey = () => keyOf(new Date());
  const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return keyOf(new Date(y, m - 1, d + n)); };
  const yesterdayKey = () => addDays(dayKey(), -1);
  const fmtDay = key => {
    if (key === addDays(dayKey(), 1)) return 'jutro';
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  /* ---------- storage ---------- */
  const fresh = () => ({ v: 2, cards: {}, settings: { dir: 'pt', batch: 10, auto: true }, streak: { last: '', n: 0 }, today: { d: '', a: 0, ok: 0 } });
  function load() {
    let s;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { s = null; }
    return normalize(s) || fresh();
  }
  // Returns a clean state object, or null when the input is not a usable save.
  function normalize(s, strict = false) {
    const def = fresh();
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    if (strict && (typeof s.cards !== 'object' || (s.settings != null && typeof s.settings !== 'object'))) return null;
    if (s.cards && (typeof s.cards !== 'object' || Array.isArray(s.cards))) return null;
    s.settings = Object.assign(def.settings, s.settings || {});
    s.cards = s.cards || {};
    s.streak = s.streak || def.streak;
    s.today = s.today || def.today;
    for (const [id, c] of Object.entries(s.cards)) {
      const badDay = c && c.d != null && !(typeof c.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.d));
      if (!c || typeof c !== 'object' || !(c.b >= 1 && c.b <= MASTER_BOX) || badDay) { if (strict) return null; delete s.cards[id]; continue; }
      // v1 stored timestamps; v2 stores day keys
      if (!c.d) c.d = typeof c.due === 'number' ? keyOf(new Date(c.due + 12 * 3600000)) : dayKey(); // +12h absorbs DST drift
      delete c.due;
    }
    s.v = 2;
    return s;
  }
  let S = load();
  let unsaved = false;
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(S));
      unsaved = false;
      $('save-error').hidden = true;
      applyPendingUpdate();
      return true;
    } catch (e) {
      unsaved = true;
      $('save-error').hidden = false;
      return false;
    }
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  // Another tab changed progress: adopt it instead of overwriting it later.
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    S = load(); // session queue only holds ids, so adopting the newer state mid-quiz is safe
    if (!$('home').hidden) renderHome();
    if (!$('settings').hidden) renderSettings();
  });

  /* ---------- stats ---------- */
  function stats() {
    const today = dayKey();
    let mastered = 0, learning = 0, due = 0, next = '';
    for (const w of WORDS) {
      const c = S.cards[w.i];
      if (!c) continue;
      if (c.b >= MASTER_BOX) mastered++; else learning++;
      if (c.d <= today) due++;
      else if (!next || c.d < next) next = c.d;
    }
    return { mastered, learning, due, next, unseen: WORDS.length - mastered - learning };
  }
  function currentStreak() {
    return S.streak.last >= yesterdayKey() ? S.streak.n : 0; // >= also covers a clock moved back
  }
  function bumpToday(correct) {
    const today = dayKey();
    if (S.today.d !== today) S.today = { d: today, a: 0, ok: 0 };
    S.today.a++;
    if (correct) S.today.ok++;
    if (S.streak.last < today) {
      S.streak.n = S.streak.last === yesterdayKey() ? S.streak.n + 1 : 1;
      S.streak.last = today;
    }
  }

  /* ---------- text helpers ---------- */
  const keysOf = en => new Set(
    en.toLowerCase().replace(/\(.*?\)/g, '').split('/').map(s => s.replace(/[!?.…"]/g, '').trim()).filter(Boolean)
  );
  const sameMeaning = (a, b) => {
    if (a.g && b.g && a.g.some(g => b.g.includes(g))) return true; // curated synonym groups
    const ka = keysOf(a.e);
    for (const k of keysOf(b.e)) if (ka.has(k)) return true;
    return false;
  };
  const speechText = pt => pt.replace(/\(.*?\)/g, '').replace(/\s\/\s/g, ', ').replace(/…/g, '').trim();
  const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

  /* ---------- distractors ---------- */
  function distractors(w, dir) {
    const shown = x => (dir === 'pt' ? x.e : x.p).toLowerCase();
    const fam = x => POS_FAMILY[x.s] || x.s;
    const tiers = [
      x => x.s === w.s && x.c === w.c,
      x => x.s === w.s,
      x => fam(x) === fam(w),
      () => true,
    ];
    const picked = [];
    const used = new Set([shown(w)]);
    for (const t of tiers) {
      for (const x of shuffle(WORDS.filter(x => x.i !== w.i && t(x)))) {
        if (picked.length === 3) break;
        if (picked.includes(x) || used.has(shown(x)) || sameMeaning(w, x) || picked.some(p => sameMeaning(p, x))) continue;
        picked.push(x); used.add(shown(x));
      }
      if (picked.length === 3) break;
    }
    return picked;
  }

  /* ---------- speech ---------- */
  let voice = null, speakToken = 0;
  function pickVoice() {
    if (!hasSpeech) return null;
    const vs = speechSynthesis.getVoices();
    const norm = v => (v.lang || '').replace('_', '-').toLowerCase();
    const ptpt = vs.filter(v => norm(v) === 'pt-pt');
    voice = ptpt.find(v => v.localService) || ptpt[0]
      || vs.find(v => /joana|catarina|cristiano/i.test(v.name))
      || vs.find(v => norm(v).startsWith('pt')) || null;
    renderVoiceInfo();
    return voice;
  }
  if (hasSpeech) {
    pickVoice();
    if (speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', pickVoice);
  }
  function speak(pt) {
    if (!hasSpeech) return;
    try {
      if (!voice) pickVoice();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(speechText(pt));
      u.lang = 'pt-PT';
      if (voice) u.voice = voice;
      u.rate = 0.9;
      $('speak-error').hidden = true;
      const token = ++speakToken;
      u.onerror = ev => { if (token === speakToken && ev.error !== 'interrupted' && ev.error !== 'canceled') $('speak-error').hidden = false; };
      speechSynthesis.speak(u);
    } catch (e) { /* speech unavailable */ }
  }
  const stopSpeech = () => { if (hasSpeech) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } } };
  function renderVoiceInfo() {
    const el = $('voice-info');
    if (!el) return;
    if (!hasSpeech) { el.textContent = 'Ta przeglądarka nie ma syntezy mowy.'; return; }
    if (!voice) { el.textContent = 'Brak głosu portugalskiego. Na iPhonie: Ustawienia > Dostępność > Treść mówiona > Głosy > Portugalski (Portugalia).'; return; }
    const isPT = (voice.lang || '').replace('_', '-').toLowerCase() === 'pt-pt';
    el.textContent = isPT
      ? `Głos: ${voice.name} (pt-PT)`
      : `Głos: ${voice.name} (${voice.lang}), to nie jest wymowa z Portugalii. Głos pt-PT dodasz w Ustawienia > Dostępność > Treść mówiona > Głosy > Portugalski (Portugalia).`;
  }

  /* ---------- screens ---------- */
  function show(id, focus = true) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    window.scrollTo(0, 0);
    const focusTarget = { home: 'btn-start', summary: 'btn-again', settings: 'btn-close-settings' }[id];
    const el = focusTarget && $(focusTarget);
    if (focus && el) el.focus({ preventScroll: true });
    if (id === 'home') applyPendingUpdate();
  }

  function plural(n, one, few, many) {
    if (n === 1) return one;
    const d = n % 10, dd = n % 100;
    return d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14) ? few : many;
  }

  const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

  let renderedDay = dayKey();
  function renderHome() {
    renderedDay = dayKey();
    if (!WORDS.length) {
      $('load-error').hidden = false;
      $('btn-start').disabled = true;
      return;
    }
    const st = stats();
    $('mastered').textContent = st.mastered;
    $('total').textContent = WORDS.length;
    $('mbar-fill').style.width = (st.mastered / WORDS.length) * 100 + '%';
    const bar = $('mbar');
    bar.setAttribute('aria-valuemax', WORDS.length);
    bar.setAttribute('aria-valuenow', st.mastered);
    bar.setAttribute('aria-valuetext', `${st.mastered} z ${WORDS.length}`);
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
    setRadio('seg-dir', S.settings.dir);
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
      $('start-sub').textContent = st.mastered === WORDS.length
        ? 'Wszystkie słowa opanowane. Możesz utrwalać.'
        : `Na dziś wszystko zrobione. Kolejne powtórki: ${st.next ? fmtDay(st.next) : 'jutro'}.`;
    }
    $('install-hint').hidden = isStandalone() || !/iPhone|iPad|iPod/.test(navigator.userAgent);
  }

  function setRadio(groupId, value) {
    for (const b of document.querySelectorAll(`#${groupId} [role="radio"]`)) {
      const on = b.dataset.v === String(value);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }
  function bindRadio(groupId, onPick) {
    const btns = [...document.querySelectorAll(`#${groupId} [role="radio"]`)];
    btns.forEach((b, i) => {
      b.addEventListener('click', () => onPick(b.dataset.v));
      b.addEventListener('keydown', e => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const nb = btns[(i + step + btns.length) % btns.length];
        onPick(nb.dataset.v);
        nb.focus();
      });
    });
  }

  function renderSettings() {
    setRadio('seg-batch', S.settings.batch);
    $('chk-auto').checked = !!S.settings.auto;
    renderVoiceInfo();
  }

  /* ---------- session ---------- */
  let Q = null;

  function buildSession() {
    const today = dayKey();
    const seen = WORDS.filter(w => S.cards[w.i]);
    const due = seen.filter(w => S.cards[w.i].d <= today)
      .sort((a, b) => (S.cards[a.i].d < S.cards[b.i].d ? -1 : S.cards[a.i].d > S.cards[b.i].d ? 1 : S.cards[a.i].b - S.cards[b.i].b))
      .slice(0, REVIEW_CAP);
    const fresh = WORDS.filter(w => !S.cards[w.i]).slice(0, S.settings.batch);
    let items = [...shuffle(due).map(w => ({ id: w.i, isNew: false })), ...fresh.map(w => ({ id: w.i, isNew: true }))];
    let practice = false;
    if (!items.length) {
      practice = true;
      const pool = shuffle(seen.slice()).sort((a, b) => S.cards[a.i].b - S.cards[b.i].b).slice(0, 10);
      items = shuffle(pool).map(w => ({ id: w.i, isNew: false }));
    }
    return { queue: items, total: items.length, ok: 0, wrong: 0, newCount: fresh.length, practice, missed: new Set() };
  }

  function startSession() {
    if (!WORDS.length) return;
    Q = buildSession();
    if (!Q.queue.length) { Q = null; renderHome(); return; }
    show('quiz', false);
    nextCard();
  }

  function renderProgress() {
    const left = new Set(Q.queue.map(x => x.id)).size;
    const done = Q.total - left;
    $('qcount').textContent = `${done}/${Q.total}`;
    $('qbar-fill').style.width = (Q.total ? (done / Q.total) * 100 : 0) + '%';
  }

  function nextCard() {
    if (!Q) return;
    if (!Q.queue.length) return finishSession();
    const item = Q.queue[0];
    const w = BY_ID.get(item.id);
    const dir = S.settings.dir;
    Q.dir = dir; // fixed for this question even if settings change meanwhile
    $('speak-error').hidden = true;
    Q.current = item;
    Q.answered = false;
    Q.opts = shuffle([w, ...distractors(w, dir)]);

    const prompt = dir === 'pt' ? 'Co to znaczy?' : 'Jak to jest po portugalsku?';
    $('q-label').textContent = item.isNew && !Q.missed.has(item.id) ? `Nowe słowo · ${prompt}` : prompt;
    const wordEl = $('q-word');
    wordEl.textContent = dir === 'pt' ? w.p : w.e;
    wordEl.lang = dir === 'pt' ? 'pt-PT' : 'en';
    wordEl.classList.toggle('long', wordEl.textContent.length > 16);
    $('q-tag').textContent = `${POS_PL[w.s] || ''} · ${CATS[w.c] || ''}`;
    $('btn-speak').hidden = dir !== 'pt';

    const box = $('options');
    box.textContent = '';
    for (const o of Q.opts) {
      const b = document.createElement('button');
      b.className = 'opt';
      b.type = 'button';
      b.dataset.id = o.i;
      b.lang = dir === 'pt' ? 'en' : 'pt-PT';
      const label = document.createElement('span');
      label.textContent = dir === 'pt' ? o.e : o.p;
      b.append(label);
      b.insertAdjacentHTML('beforeend', '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>');
      b.addEventListener('click', () => answer(o.i));
      box.append(b);
    }
    const fb = $('feedback');
    fb.textContent = '';
    fb.className = 'feedback';
    $('btn-next').hidden = true;
    renderProgress();

    if (dir === 'pt' && S.settings.auto) speak(w.p);
    wordEl.tabIndex = -1;
    wordEl.focus({ preventScroll: true });
  }

  function answer(chosenId) {
    if (!Q || Q.answered) return;
    Q.answered = true;
    const item = Q.current;
    const w = BY_ID.get(item.id);
    const correct = chosenId === w.i;
    const dir = Q.dir;
    const today = dayKey();

    for (const b of document.querySelectorAll('#options .opt')) {
      const id = Number(b.dataset.id);
      b.disabled = true;
      const icon = b.querySelector('use');
      if (id === w.i) { b.classList.add('ok'); icon.setAttribute('href', '#i-check'); }
      else if (id === chosenId) { b.classList.add('bad'); icon.setAttribute('href', '#i-x'); }
      else b.classList.add('dim');
    }

    const known = !!S.cards[w.i];
    const c = S.cards[w.i] || { b: 1, d: today, r: 0, w: 0 };
    const lapsedToday = c.lapse === today || Q.missed.has(w.i); // survives a restart today and a retry after midnight
    if (correct) {
      c.r++;
      if (lapsedToday) { c.b = 1; c.d = addDays(today, INTERVAL[1]); }
      else if (!Q.practice) { c.b = Math.min(MASTER_BOX, (known ? c.b : 1) + 1); c.d = addDays(today, INTERVAL[c.b]); }
      Q.queue.shift();
      if (!Q.missed.has(w.i)) Q.ok++;
    } else {
      c.w++;
      c.b = 1;
      c.d = today;
      c.lapse = today;
      if (!Q.missed.has(w.i)) Q.wrong++;
      Q.missed.add(w.i);
      const it = Q.queue.shift();
      Q.queue.splice(Math.min(REQUEUE_GAP, Q.queue.length), 0, it);
    }
    S.cards[w.i] = c;
    bumpToday(correct);
    save();
    renderProgress();

    const fb = $('feedback');
    fb.textContent = '';
    if (correct) {
      fb.className = 'feedback ok';
      fb.textContent = c.b >= MASTER_BOX && !lapsedToday && !Q.practice ? 'Dobrze! Słowo opanowane.' : 'Dobrze!';
    } else {
      fb.className = 'feedback bad';
      const ans = document.createElement('span');
      ans.lang = dir === 'pt' ? 'en' : 'pt-PT';
      ans.textContent = dir === 'pt' ? w.e : w.p;
      fb.append('Źle. Poprawnie: ', ans);
    }
    if (dir === 'en') {
      $('btn-speak').hidden = false;
      if (S.settings.auto) speak(w.p);
    }
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

  function goHome() { stopSpeech(); Q = null; renderHome(); show('home'); }

  /* ---------- backup ---------- */
  $('btn-export').addEventListener('click', async () => {
    const data = JSON.stringify(S);
    $('backup-text').value = data;
    try { await navigator.clipboard.writeText(data); $('backup-info').textContent = 'Skopiowano do schowka. Wklej to w apce na ekranie głównym.'; }
    catch (e) { $('backup-info').textContent = 'Zaznacz tekst w polu i skopiuj go ręcznie.'; }
  });
  $('btn-import').addEventListener('click', () => {
    try {
      const s = normalize(JSON.parse($('backup-text').value), true);
      if (!s) throw new Error('bad');
      const prev = S;
      S = s;
      if (!save()) { S = prev; $('save-error').hidden = true; unsaved = false; $('backup-info').textContent = 'Kopia jest poprawna, ale telefon nie pozwolił jej zapisać. Spróbuj ponownie.'; return; }
      renderSettings();
      $('backup-info').textContent = `Wczytano postęp: ${Object.keys(S.cards).length} słów.`;
    } catch (e) { $('backup-info').textContent = 'To nie wygląda na kopię postępu z tej apki.'; }
  });

  /* ---------- events ---------- */
  $('btn-start').addEventListener('click', startSession);
  $('btn-again').addEventListener('click', startSession);
  $('btn-home').addEventListener('click', goHome);
  $('btn-quit').addEventListener('click', goHome);
  $('btn-next').addEventListener('click', nextCard);
  $('btn-speak').addEventListener('click', () => { if (Q && Q.current) speak(BY_ID.get(Q.current.id).p); });
  $('btn-settings').addEventListener('click', () => { renderSettings(); show('settings'); });
  $('btn-close-settings').addEventListener('click', goHome);
  $('btn-retry-save').addEventListener('click', save);
  bindRadio('seg-dir', v => { S.settings.dir = v; save(); renderHome(); });
  bindRadio('seg-batch', v => { S.settings.batch = Number(v); save(); renderSettings(); });
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

  // Shortcuts only while the quiz is open; focused buttons keep their own Enter/Space.
  document.addEventListener('keydown', e => {
    if (!Q || $('quiz').hidden) return;
    const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
    const onOther = onButton && !document.activeElement.classList.contains('opt');
    if (!Q.answered && !onOther && /^[1-4]$/.test(e.key)) { const o = Q.opts[Number(e.key) - 1]; if (o) answer(o.i); }
    else if (Q.answered && !onButton && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); nextCard(); }
  });

  // New day while the app stays open: refresh counters and due reviews.
  const refreshIfNewDay = () => { if (dayKey() !== renderedDay && !$('home').hidden) renderHome(); };
  setInterval(refreshIfNewDay, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refreshIfNewDay();
    if (swReg) swReg.update().catch(() => {});
  });

  /* ---------- service worker + updates ---------- */
  let swReg = null, pendingReload = false;
  // Reload into a new version only on Home, outside a quiz, with everything saved.
  function applyPendingUpdate() {
    if (pendingReload && !Q && !unsaved && $('home') && !$('home').hidden) { pendingReload = false; location.reload(); }
  }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    let controlled = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!controlled) { controlled = true; return; } // first install: this page already runs the current files
      pendingReload = true;
      applyPendingUpdate();
    });
    const offlineFail = () => { $('offline-status').textContent = 'Tryb offline się nie zainstalował. Otwórz apkę ponownie z internetem.'; };
    window.addEventListener('load', () => {
      const timer = setTimeout(offlineFail, 20000); // serviceWorker.ready never rejects
      navigator.serviceWorker.register('sw.js').then(reg => {
        swReg = reg;
        return navigator.serviceWorker.ready;
      }).then(() => { clearTimeout(timer); $('offline-status').textContent = 'Działa offline.'; })
        .catch(() => { clearTimeout(timer); offlineFail(); });
    });
  } else {
    $('offline-status').textContent = 'Tryb offline działa tylko z adresu https.';
  }

  renderHome();
  show('home', false);
})();
