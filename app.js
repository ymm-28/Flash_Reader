document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);

  // 画面
  const settingsScreen = $('settingsScreen');
  const readerScreen   = $('readerScreen');

  // 設定画面
  const presetSel    = $('preset');
  const urlInput     = $('urlInput');
  const loadUrlBtn   = $('loadUrlBtn');
  const speedRange   = $('speed');
  const speedVal     = $('speedVal');
  const fontSizeRange = $('fontSize');
  const fontSizeVal  = $('fontSizeVal');
  const unitBtns     = document.querySelectorAll('.unit-btn');
  const goReadBtn    = $('goReadBtn');
  const statusEl     = $('settingsStatus');

  // 表示画面
  const backBtn      = $('backBtn');
  const readerTitle  = $('readerTitle');
  const readerInfo   = $('readerInfo');
  const wordEl       = $('word');
  const progressBar  = $('progressBar');
  const playBtn      = $('playBtn');
  const back3Btn     = $('back3Btn');
  const finishMsg    = $('finishMsg');

  // 状態
  let tokens = [], idx = 0, timer = null, playing = false;
  let currentUnit = 'word';
  let currentText = '';
  let currentTitle = '';

  // ── プリセット読み込み ──
  if (typeof AOZORA_PRESETS === 'undefined' || !AOZORA_PRESETS.length) {
    setStatus('プリセットの読み込みに失敗しました');
    return;
  }
  AOZORA_PRESETS.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = p.title;
    presetSel.appendChild(opt);
  });

  // ── 単語分割 ──
  function tokenize(text, mode) {
    text = text.replace(/\s+/g, ' ').trim();
    if (mode === 'char') {
      return Array.from(text).filter(c => c.trim() !== '');
    }
    if (mode === 'phrase') {
      return text.split(/(?<=[。、！？!?「」『』])/g)
        .map(s => s.trim()).filter(Boolean);
    }
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const seg = new Intl.Segmenter('ja', { granularity: 'word' });
      const out = [];
      for (const s of seg.segment(text)) {
        const w = s.segment.trim();
        if (w) out.push(w);
      }
      return out;
    }
    return Array.from(text);
  }

  function setStatus(msg) { statusEl.textContent = msg; }

  // ── テキスト設定 ──
  function loadText(text, title) {
    currentText = text;
    currentTitle = title || '';
    tokens = tokenize(text, currentUnit);
    idx = 0;
    readerTitle.textContent = currentTitle;
    setStatus(`「${currentTitle}」を読み込みました（${tokens.length} 語）`);
  }

  // ── 画面切り替え ──
  function showReader() {
    if (!tokens.length) {
      setStatus('テキストが読み込まれていません');
      return;
    }
    settingsScreen.classList.remove('active');
    readerScreen.classList.add('active');
    document.documentElement.style.setProperty('--word-size', fontSizeRange.value + 'px');
    finishMsg.style.display = 'none';
    wordEl.style.display = '';
    idx = 0;
    updateView();
  }

  function showSettings() {
    pause();
    readerScreen.classList.remove('active');
    settingsScreen.classList.add('active');
  }

  // ── 表示更新 ──
  function updateView() {
    const done = idx >= tokens.length;
    wordEl.style.display    = done ? 'none' : '';
    finishMsg.style.display = done ? 'block' : 'none';
    if (done) {
      progressBar.style.width = '100%';
      readerInfo.textContent = '';
      return;
    }
    wordEl.textContent = tokens[idx];
    readerInfo.textContent = `${idx + 1}/${tokens.length}`;
    progressBar.style.width = ((idx + 1) / tokens.length * 100) + '%';
  }

  // ── 再生 ──
  function tick() {
    if (idx >= tokens.length) { stop(); return; }
    updateView();
    idx++;
    timer = setTimeout(tick, parseInt(speedRange.value, 10));
  }

  function play() {
    if (!tokens.length) return;
    if (idx >= tokens.length) idx = 0;
    playing = true;
    playBtn.textContent = '⏸';
    finishMsg.style.display = 'none';
    wordEl.style.display = '';
    tick();
  }

  function pause() {
    playing = false;
    if (timer) { clearTimeout(timer); timer = null; }
    playBtn.textContent = '▶';
  }

  function stop() {
    pause();
    updateView();
  }

  // ── 青空文庫パース ──
  function parseAozoraHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const titleNode = doc.querySelector('h1.title') || doc.querySelector('title');
    const title = titleNode ? titleNode.textContent.trim() : '青空文庫';
    doc.querySelectorAll('rt, rp').forEach(n => n.remove());
    const main = doc.querySelector('div.main_text') || doc.body;
    main.querySelectorAll('.notes, .bibliographical_information, .after_text').forEach(n => n.remove());
    let text = main.textContent || '';
    text = text.replace(/［＃[^］]*］/g, '');
    text = text.replace(/　/g, ' ').replace(/[ \t]+/g, ' ');
    return { title, text: text.trim() };
  }

  async function fetchAozora(url) {
    setStatus('取得中...');
    const tryFetch = async (u) => {
      const res = await fetch(u);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      let text;
      try {
        text = new TextDecoder('shift_jis').decode(buf);
        if (!text.includes('<')) text = new TextDecoder('utf-8').decode(buf);
      } catch (e) {
        text = new TextDecoder('utf-8').decode(buf);
      }
      return text;
    };
    try {
      return parseAozoraHtml(await tryFetch(url));
    } catch (e1) {
      setStatus('プロキシ経由で再試行...');
      try {
        const proxied = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
        return parseAozoraHtml(await tryFetch(proxied));
      } catch (e2) {
        throw new Error('取得失敗。プリセットをお試しください');
      }
    }
  }

  // ══ イベント ══

  presetSel.addEventListener('change', () => {
    const i = parseInt(presetSel.value, 10);
    if (isNaN(i)) return;
    const p = AOZORA_PRESETS[i];
    loadText(p.text, p.title);
  });

  loadUrlBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) { setStatus('URLを入力してください'); return; }
    loadUrlBtn.disabled = true;
    try {
      const { title, text } = await fetchAozora(url);
      loadText(text, title);
    } catch (e) {
      setStatus(e.message);
    } finally {
      loadUrlBtn.disabled = false;
    }
  });

  speedRange.addEventListener('input', () => {
    speedVal.textContent = speedRange.value + 'ms';
  });

  fontSizeRange.addEventListener('input', () => {
    fontSizeVal.textContent = fontSizeRange.value + 'px';
    document.documentElement.style.setProperty('--word-size', fontSizeRange.value + 'px');
  });

  // 表示単位ボタン
  unitBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      unitBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentUnit = btn.dataset.unit;
      // 現在のテキストを再分割
      if (currentText) {
        tokens = tokenize(currentText, currentUnit);
        idx = 0;
        setStatus(`「${currentTitle}」を再分割（${tokens.length} 語）`);
      }
    });
  });

  goReadBtn.addEventListener('click', () => {
    if (!tokens.length) {
      setStatus('テキストを選択してください');
      return;
    }
    showReader();
  });

  backBtn.addEventListener('click', showSettings);

  playBtn.addEventListener('click', () => {
    if (playing) pause(); else play();
  });

  back3Btn.addEventListener('click', () => {
    const wasPlaying = playing;
    pause();
    idx = Math.max(0, idx - 4);
    updateView();
    if (wasPlaying) play();
  });

  document.addEventListener('keydown', e => {
    if (!readerScreen.classList.contains('active')) return;
    if (e.code === 'Space') { e.preventDefault(); if (playing) pause(); else play(); }
    else if (e.code === 'ArrowLeft') {
      const wp = playing; pause();
      idx = Math.max(0, idx - 4); updateView();
      if (wp) play();
    }
  });

  // ── 初期化: 最初のプリセットを自動選択 ──
  presetSel.value = '0';
  loadText(AOZORA_PRESETS[0].text, AOZORA_PRESETS[0].title);

  if (!('Segmenter' in (window.Intl || {}))) {
    setStatus('※ ブラウザがIntl.Segmenter非対応のため文字単位で動作します');
  }
});
