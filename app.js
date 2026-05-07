document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);

  // 画面
  const settingsScreen = $('settingsScreen');
  const readerScreen   = $('readerScreen');

  // 設定画面要素
  const presetSel    = $('preset');
  const urlInput     = $('urlInput');
  const loadUrlBtn   = $('loadUrlBtn');
  const textInput    = $('textInput');
  const loadTextBtn  = $('loadTextBtn');
  const speedRange   = $('speed');
  const speedVal     = $('speedVal');
  const fontSizeRange = $('fontSize');
  const fontSizeVal  = $('fontSizeVal');
  const goReadBtn    = $('goReadBtn');
  const statusEl     = $('settingsStatus');
  const loadProgress = $('loadProgress');
  const loadProgressFill = $('loadProgressFill');

  // リーダー画面要素
  const backBtn      = $('backBtn');
  const menuBtn      = $('menuBtn');
  const readerTitle  = $('readerTitle');
  const readerInfo   = $('readerInfo');
  const wordEl       = $('word');
  const seekBar      = $('seekBar');
  const playBtn      = $('playBtn');
  const back3Btn     = $('back3Btn');
  const prevBtn      = $('prevBtn');
  const nextBtn      = $('nextBtn');
  const finishMsg    = $('finishMsg');

  // クイックパネル
  const quickPanel    = $('quickPanel');
  const qpBackdrop    = $('quickPanelBackdrop');
  const qpClose       = $('qpClose');
  const qpSpeed       = $('qpSpeed');
  const qpSpeedVal    = $('qpSpeedVal');
  const qpFontSize    = $('qpFontSize');
  const qpFontSizeVal = $('qpFontSizeVal');

  // 状態
  let tokens = [], idx = 0, timer = null, playing = false;
  let currentUnit = 'word';
  let currentText = '';
  let currentTitle = '';
  let wasPlayingBeforeSeek = false;
  const CACHE_PREFIX = 'aozora_cache_v1:';

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

  // ── 速度変換: wps（word per sec）⇔ ms ──
  function wpsToMs(wps) { return Math.round(1000 / Math.max(1, wps)); }

  // ── テーマ ──
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (e) {}
    document.querySelectorAll('[data-theme]').forEach(b => {
      if (b.tagName === 'BUTTON') b.classList.toggle('active', b.dataset.theme === theme);
    });
  }
  // 初期テーマ復元
  let initialTheme = 'dark';
  try {
    const saved = localStorage.getItem('theme');
    if (saved && ['light', 'sepia', 'dark'].includes(saved)) initialTheme = saved;
  } catch (e) {}
  applyTheme(initialTheme);

  // ── プリセット生成 ──
  if (typeof AOZORA_PRESETS === 'undefined' || !AOZORA_PRESETS.length) {
    setStatus('プリセットの読み込みに失敗しました');
  } else {
    AOZORA_PRESETS.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = p.title;
      presetSel.appendChild(opt);
    });
  }

  // ── 単語分割 ──
  function tokenize(text, mode) {
    text = text.replace(/\s+/g, ' ').trim();
    if (mode === 'char') {
      return Array.from(text).filter(c => c.trim() !== '');
    }
    if (mode === 'phrase') {
      const out = [];
      let buf = '';
      for (const ch of text) {
        buf += ch;
        if ('。、！？!?'.includes(ch)) {
          const t = buf.trim();
          if (t) out.push(t);
          buf = '';
        }
      }
      const t = buf.trim();
      if (t) out.push(t);
      return out;
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

  function tokenIdxToCharPos(i) {
    let pos = 0;
    for (let k = 0; k < i && k < tokens.length; k++) pos += tokens[k].length;
    return pos;
  }
  function charPosToTokenIdx(charPos, newTokens) {
    let pos = 0;
    for (let i = 0; i < newTokens.length; i++) {
      pos += newTokens[i].length;
      if (pos >= charPos) return i;
    }
    return Math.max(0, newTokens.length - 1);
  }

  function loadText(text, title) {
    currentText = text;
    currentTitle = title || '';
    tokens = tokenize(text, currentUnit);
    idx = 0;
    readerTitle.textContent = currentTitle;
    seekBar.max = Math.max(0, tokens.length - 1);
    seekBar.value = 0;
    setStatus(`「${currentTitle}」を読み込みました（${tokens.length} ${currentUnit === 'phrase' ? '文' : '語'}）`);
    updateGoBtn();
  }

  function changeUnit(newUnit) {
    if (!newUnit || newUnit === currentUnit) return;
    if (currentText) {
      const charPos = tokenIdxToCharPos(idx);
      currentUnit = newUnit;
      tokens = tokenize(currentText, currentUnit);
      idx = charPosToTokenIdx(charPos, tokens);
      seekBar.max = Math.max(0, tokens.length - 1);
      seekBar.value = idx;
    } else {
      currentUnit = newUnit;
    }
    syncUnitButtons();
    if (readerScreen.classList.contains('active')) updateView();
    updateGoBtn();
  }

  function syncUnitButtons() {
    document.querySelectorAll('[data-unit]').forEach(b => {
      b.classList.toggle('active', b.dataset.unit === currentUnit);
    });
  }

  function updateGoBtn() {
    if (idx > 0 && idx < tokens.length) {
      goReadBtn.textContent = `続きから読む（${idx + 1}/${tokens.length}）▶`;
      goReadBtn.classList.add('resume');
    } else {
      goReadBtn.textContent = '読む ▶';
      goReadBtn.classList.remove('resume');
    }
  }

  function showReader() {
    if (!tokens.length) { setStatus('テキストが未読み込み'); return; }
    settingsScreen.classList.remove('active');
    readerScreen.classList.add('active');
    document.documentElement.style.setProperty('--word-size', fontSizeRange.value + 'px');
    finishMsg.style.display = 'none';
    wordEl.style.display = '';
    updateView();
  }
  function showSettings() {
    pause();
    closeQuickPanel();
    readerScreen.classList.remove('active');
    settingsScreen.classList.add('active');
    updateGoBtn();
  }

  function updateView() {
    const done = idx >= tokens.length;
    wordEl.style.display    = done ? 'none' : '';
    finishMsg.style.display = done ? 'block' : 'none';
    seekBar.value = Math.min(idx, tokens.length - 1);
    if (done) {
      readerInfo.textContent = `${tokens.length}/${tokens.length}`;
      return;
    }
    wordEl.textContent = tokens[idx];
    readerInfo.textContent = `${idx + 1}/${tokens.length}`;
  }

  // idx = 現在表示している語のインデックス
  function tick() {
    if (idx >= tokens.length) { stop(); return; }
    updateView();
    timer = setTimeout(() => {
      idx++;
      tick();
    }, wpsToMs(parseInt(speedRange.value, 10)));
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
  function stop() { pause(); updateView(); }

  // 移動ヘルパ（再生中なら一時停止→移動→再開）
  function moveTo(newIdx) {
    const wp = playing; pause();
    idx = Math.max(0, Math.min(tokens.length, newIdx));
    updateView();
    if (wp && idx < tokens.length) play();
  }

  // ── 青空文庫パース・取得 ──
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

  function showProgress(determinate, percent) {
    loadProgress.classList.add('active');
    if (determinate) {
      loadProgress.classList.remove('indeterminate');
      loadProgressFill.style.width = percent + '%';
    } else {
      loadProgress.classList.add('indeterminate');
      loadProgressFill.style.width = '30%';
    }
  }
  function hideProgress() {
    loadProgress.classList.remove('active', 'indeterminate');
    loadProgressFill.style.width = '0%';
  }

  // 進捗付きfetch
  async function fetchWithProgress(url, label) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = +res.headers.get('Content-Length') || 0;
    if (!res.body || !res.body.getReader) {
      // ストリーム未対応: 一括取得
      showProgress(false, 0);
      setStatus(`${label} 取得中...`);
      return await res.arrayBuffer();
    }
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    showProgress(!!total, 0);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) {
        const pct = Math.min(100, Math.round(received / total * 100));
        showProgress(true, pct);
        setStatus(`${label} 取得中... ${pct}%`);
      } else {
        showProgress(false, 0);
        setStatus(`${label} 取得中... ${(received/1024).toFixed(1)} KB`);
      }
    }
    const buf = new Uint8Array(received);
    let p = 0;
    for (const c of chunks) { buf.set(c, p); p += c.length; }
    return buf.buffer;
  }

  async function fetchAozora(url, label = '') {
    const cacheKey = CACHE_PREFIX + url;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) {}
    }
    const decode = (buf) => {
      let text;
      try {
        text = new TextDecoder('shift_jis').decode(buf);
        if (!text.includes('<')) text = new TextDecoder('utf-8').decode(buf);
      } catch (e) {
        text = new TextDecoder('utf-8').decode(buf);
      }
      return text;
    };

    // aozora.gr.jpはCORSを許可しないので、直接fetchはスキップしてプロキシ経由のみ使う
    // 複数プロキシをフォールバックで順に試す
    const proxies = [
      { name: 'corsproxy.io',  build: u => 'https://corsproxy.io/?url=' + encodeURIComponent(u) },
      { name: 'codetabs',      build: u => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u) },
      { name: 'allorigins',    build: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
    ];

    let lastErr = null;
    for (let i = 0; i < proxies.length; i++) {
      const p = proxies[i];
      try {
        if (i > 0) setStatus(`${label} 別経路で再試行 (${p.name})...`);
        const buf = await fetchWithProgress(p.build(url), label);
        const parsed = parseAozoraHtml(decode(buf));
        try { localStorage.setItem(cacheKey, JSON.stringify(parsed)); } catch (e) {}
        return parsed;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('取得経路が全て失敗しました');
  }

  // ══ クイックパネル ══
  function openQuickPanel() {
    qpSpeed.value = speedRange.value;
    qpSpeedVal.textContent = `${speedRange.value} word/s`;
    qpFontSize.value = fontSizeRange.value;
    qpFontSizeVal.textContent = fontSizeRange.value + 'px';
    syncUnitButtons();
    quickPanel.classList.add('open');
    qpBackdrop.classList.add('open');
  }
  function closeQuickPanel() {
    quickPanel.classList.remove('open');
    qpBackdrop.classList.remove('open');
  }

  // ══ イベント ══

  // ソースタブ
  document.querySelector('.source-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.source-tab');
    if (!t) return;
    document.querySelectorAll('.source-tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.source-pane').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    const pane = document.querySelector(`.source-pane[data-pane="${t.dataset.source}"]`);
    if (pane) pane.classList.add('active');
  });

  // 表示単位ボタン（委譲）
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-unit]');
    if (!b) return;
    if (!b.closest('#unitBtns') && !b.closest('#qpUnitBtns')) return;
    changeUnit(b.dataset.unit);
  });

  // テーマボタン（委譲）
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme]');
    if (!b || b.tagName !== 'BUTTON') return;
    if (!b.closest('#themeBtns') && !b.closest('#qpThemeBtns')) return;
    applyTheme(b.dataset.theme);
  });

  // プリセット選択
  presetSel.addEventListener('change', async () => {
    const i = parseInt(presetSel.value, 10);
    if (isNaN(i) || !AOZORA_PRESETS[i]) return;
    const p = AOZORA_PRESETS[i];
    presetSel.disabled = true;
    setStatus(`「${p.title}」を取得中...`);
    try {
      const { title, text } = await fetchAozora(p.url, `「${p.title}」`);
      loadText(text, title || p.title);
    } catch (e) {
      setStatus(`取得失敗: ${e.message}`);
    } finally {
      presetSel.disabled = false;
      hideProgress();
    }
  });

  // URL取得
  loadUrlBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) { setStatus('URLを入力してください'); return; }
    loadUrlBtn.disabled = true;
    try {
      const { title, text } = await fetchAozora(url, '');
      loadText(text, title);
    } catch (e) {
      setStatus(`取得失敗: ${e.message}`);
    } finally {
      loadUrlBtn.disabled = false;
      hideProgress();
    }
  });

  // 直接入力
  loadTextBtn.addEventListener('click', () => {
    const t = textInput.value.trim();
    if (!t) { setStatus('文章を入力してください'); return; }
    loadText(t, '入力テキスト');
  });

  // スライダー（設定画面）
  speedRange.addEventListener('input', () => {
    speedVal.textContent = `${speedRange.value} word/s`;
  });
  fontSizeRange.addEventListener('input', () => {
    fontSizeVal.textContent = fontSizeRange.value + 'px';
    document.documentElement.style.setProperty('--word-size', fontSizeRange.value + 'px');
  });

  // リーダー操作
  goReadBtn.addEventListener('click', () => {
    if (!tokens.length) { setStatus('テキストを選択してください'); return; }
    showReader();
  });
  backBtn.addEventListener('click', showSettings);
  playBtn.addEventListener('click', () => { playing ? pause() : play(); });
  back3Btn.addEventListener('click', () => moveTo(idx - 3));
  prevBtn.addEventListener('click', () => moveTo(idx - 1));
  nextBtn.addEventListener('click', () => moveTo(idx + 1));

  // シークバー
  seekBar.addEventListener('mousedown', () => { wasPlayingBeforeSeek = playing; pause(); });
  seekBar.addEventListener('touchstart', () => { wasPlayingBeforeSeek = playing; pause(); }, { passive: true });
  seekBar.addEventListener('input', () => {
    idx = parseInt(seekBar.value, 10);
    if (idx >= tokens.length) idx = tokens.length;
    finishMsg.style.display = idx >= tokens.length ? 'block' : 'none';
    wordEl.style.display    = idx >= tokens.length ? 'none' : '';
    if (idx < tokens.length) {
      wordEl.textContent = tokens[idx];
      readerInfo.textContent = `${idx + 1}/${tokens.length}`;
    } else {
      readerInfo.textContent = `${tokens.length}/${tokens.length}`;
    }
  });
  seekBar.addEventListener('change', () => {
    if (wasPlayingBeforeSeek && idx < tokens.length) play();
    wasPlayingBeforeSeek = false;
  });

  // クイック設定
  menuBtn.addEventListener('click', openQuickPanel);
  qpClose.addEventListener('click', closeQuickPanel);
  qpBackdrop.addEventListener('click', closeQuickPanel);

  qpSpeed.addEventListener('input', () => {
    speedRange.value = qpSpeed.value;
    speedVal.textContent = `${qpSpeed.value} word/s`;
    qpSpeedVal.textContent = `${qpSpeed.value} word/s`;
  });
  qpFontSize.addEventListener('input', () => {
    fontSizeRange.value = qpFontSize.value;
    fontSizeVal.textContent = qpFontSize.value + 'px';
    qpFontSizeVal.textContent = qpFontSize.value + 'px';
    document.documentElement.style.setProperty('--word-size', qpFontSize.value + 'px');
  });

  // キーボード
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (!readerScreen.classList.contains('active')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      playing ? pause() : play();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      moveTo(idx - 1);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      moveTo(idx + 1);
    } else if (e.code === 'Escape') {
      closeQuickPanel();
    }
  });

  // ── 初期化 ──
  speedVal.textContent = `${speedRange.value} word/s`;
  fontSizeVal.textContent = fontSizeRange.value + 'px';
  if (AOZORA_PRESETS && AOZORA_PRESETS.length) {
    presetSel.value = '0';
    presetSel.dispatchEvent(new Event('change'));
  }
  if (!('Segmenter' in (window.Intl || {}))) {
    setStatus('※ ブラウザがIntl.Segmenter非対応のため文字単位で動作します');
  }
});
