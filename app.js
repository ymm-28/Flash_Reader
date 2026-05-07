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
  const unitBtns     = document.querySelectorAll('#unitBtns .unit-btn');
  const goReadBtn    = $('goReadBtn');
  const statusEl     = $('settingsStatus');
  const sourceTabs   = document.querySelectorAll('.source-tab');
  const sourcePanes  = document.querySelectorAll('.source-pane');

  // リーダー画面要素
  const backBtn      = $('backBtn');
  const menuBtn      = $('menuBtn');
  const readerTitle  = $('readerTitle');
  const readerInfo   = $('readerInfo');
  const wordEl       = $('word');
  const progressBar  = $('progressBar');
  const playBtn      = $('playBtn');
  const back3Btn     = $('back3Btn');
  const finishMsg    = $('finishMsg');

  // クイックパネル
  const quickPanel    = $('quickPanel');
  const qpBackdrop    = $('quickPanelBackdrop');
  const qpClose       = $('qpClose');
  const qpSpeed       = $('qpSpeed');
  const qpSpeedVal    = $('qpSpeedVal');
  const qpFontSize    = $('qpFontSize');
  const qpFontSizeVal = $('qpFontSizeVal');
  const qpUnitBtns    = document.querySelectorAll('#qpUnitBtns .unit-btn');

  // 状態
  let tokens = [], idx = 0, timer = null, playing = false;
  let currentUnit = 'word';
  let currentText = '';
  let currentTitle = '';
  const CACHE_PREFIX = 'aozora_cache_v1:';

  // ── プリセットoptions生成 ──
  if (typeof AOZORA_PRESETS === 'undefined' || !AOZORA_PRESETS.length) {
    setStatus('プリセットの読み込み失敗');
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
      return text.split(/(?<=[。、！？!?])/g)
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

  // 現在のtokens内idxに対応する元テキストの文字位置を返す
  function tokenIdxToCharPos(targetIdx) {
    let pos = 0;
    for (let i = 0; i < targetIdx && i < tokens.length; i++) {
      pos += tokens[i].length;
    }
    return pos;
  }

  // 文字位置を新しいtokensのidxに変換
  function charPosToTokenIdx(charPos, newTokens) {
    let pos = 0;
    for (let i = 0; i < newTokens.length; i++) {
      pos += newTokens[i].length;
      if (pos >= charPos) return i;
    }
    return Math.max(0, newTokens.length - 1);
  }

  // ── テキスト読み込み（位置リセット） ──
  function loadText(text, title) {
    currentText = text;
    currentTitle = title || '';
    tokens = tokenize(text, currentUnit);
    idx = 0;
    readerTitle.textContent = currentTitle;
    setStatus(`「${currentTitle}」読み込み完了（${tokens.length} ${currentUnit === 'phrase' ? '文' : '語'}）`);
    updateGoBtn();
  }

  // ── 単位変更（位置を保持） ──
  function changeUnit(newUnit) {
    if (newUnit === currentUnit || !currentText) {
      currentUnit = newUnit;
      syncUnitButtons();
      return;
    }
    const charPos = tokenIdxToCharPos(idx);
    currentUnit = newUnit;
    tokens = tokenize(currentText, currentUnit);
    idx = charPosToTokenIdx(charPos, tokens);
    syncUnitButtons();
    if (readerScreen.classList.contains('active')) {
      updateView();
    }
  }

  function syncUnitButtons() {
    [...unitBtns, ...qpUnitBtns].forEach(b => {
      b.classList.toggle('active', b.dataset.unit === currentUnit);
    });
  }

  // ── 読むボタン状態 ──
  function updateGoBtn() {
    if (idx > 0 && idx < tokens.length) {
      goReadBtn.textContent = `続きから読む（${idx + 1}/${tokens.length}）▶`;
      goReadBtn.classList.add('resume');
    } else {
      goReadBtn.textContent = '読む ▶';
      goReadBtn.classList.remove('resume');
    }
  }

  // ── 画面切替 ──
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

  // ── 表示更新 ──
  function updateView() {
    const done = idx >= tokens.length;
    wordEl.style.display    = done ? 'none' : '';
    finishMsg.style.display = done ? 'block' : 'none';
    if (done) {
      progressBar.style.width = '100%';
      readerInfo.textContent = `${tokens.length}/${tokens.length}`;
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
  function stop() { pause(); updateView(); }

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

  async function fetchAozora(url) {
    const cacheKey = CACHE_PREFIX + url;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) {}
    }
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
    let parsed;
    try {
      parsed = parseAozoraHtml(await tryFetch(url));
    } catch (e1) {
      const proxied = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
      parsed = parseAozoraHtml(await tryFetch(proxied));
    }
    try { localStorage.setItem(cacheKey, JSON.stringify(parsed)); } catch (e) {}
    return parsed;
  }

  // ══ クイックパネル ══
  function openQuickPanel() {
    qpSpeed.value = speedRange.value;
    qpSpeedVal.textContent = speedRange.value + 'ms';
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
  sourceTabs.forEach(t => {
    t.addEventListener('click', () => {
      sourceTabs.forEach(x => x.classList.remove('active'));
      sourcePanes.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      document.querySelector(`.source-pane[data-pane="${t.dataset.source}"]`).classList.add('active');
    });
  });

  // プリセット選択（URLフェッチ）
  presetSel.addEventListener('change', async () => {
    const i = parseInt(presetSel.value, 10);
    if (isNaN(i)) return;
    const p = AOZORA_PRESETS[i];
    setStatus(`「${p.title}」を取得中...`);
    presetSel.disabled = true;
    try {
      const { title, text } = await fetchAozora(p.url);
      loadText(text, title || p.title);
    } catch (e) {
      setStatus(`取得失敗: ${e.message}`);
    } finally {
      presetSel.disabled = false;
    }
  });

  // URL取得
  loadUrlBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) { setStatus('URLを入力してください'); return; }
    loadUrlBtn.disabled = true;
    setStatus('取得中...');
    try {
      const { title, text } = await fetchAozora(url);
      loadText(text, title);
    } catch (e) {
      setStatus(`取得失敗: ${e.message}`);
    } finally {
      loadUrlBtn.disabled = false;
    }
  });

  // 直接入力テキストの読み込み
  loadTextBtn.addEventListener('click', () => {
    const t = textInput.value.trim();
    if (!t) { setStatus('文章を入力してください'); return; }
    loadText(t, '入力テキスト');
  });

  // スライダー（設定画面）
  speedRange.addEventListener('input', () => {
    speedVal.textContent = speedRange.value + 'ms';
    qpSpeed.value = speedRange.value;
    qpSpeedVal.textContent = speedRange.value + 'ms';
  });
  fontSizeRange.addEventListener('input', () => {
    fontSizeVal.textContent = fontSizeRange.value + 'px';
    qpFontSize.value = fontSizeRange.value;
    qpFontSizeVal.textContent = fontSizeRange.value + 'px';
    document.documentElement.style.setProperty('--word-size', fontSizeRange.value + 'px');
  });

  // ユニットボタン（設定画面）
  unitBtns.forEach(btn => {
    btn.addEventListener('click', () => changeUnit(btn.dataset.unit));
  });

  // ── リーダー操作 ──
  goReadBtn.addEventListener('click', () => {
    if (!tokens.length) { setStatus('テキストを選択してください'); return; }
    showReader();
  });
  backBtn.addEventListener('click', showSettings);
  playBtn.addEventListener('click', () => { playing ? pause() : play(); });
  back3Btn.addEventListener('click', () => {
    const wp = playing; pause();
    idx = Math.max(0, idx - 4);
    updateView();
    if (wp) play();
  });

  // ── クイック設定 ──
  menuBtn.addEventListener('click', openQuickPanel);
  qpClose.addEventListener('click', closeQuickPanel);
  qpBackdrop.addEventListener('click', closeQuickPanel);

  qpSpeed.addEventListener('input', () => {
    speedRange.value = qpSpeed.value;
    speedVal.textContent = qpSpeed.value + 'ms';
    qpSpeedVal.textContent = qpSpeed.value + 'ms';
    // 再生中なら次のtickから新速度が適用される
  });
  qpFontSize.addEventListener('input', () => {
    fontSizeRange.value = qpFontSize.value;
    fontSizeVal.textContent = qpFontSize.value + 'px';
    qpFontSizeVal.textContent = qpFontSize.value + 'px';
    document.documentElement.style.setProperty('--word-size', qpFontSize.value + 'px');
  });
  qpUnitBtns.forEach(btn => {
    btn.addEventListener('click', () => changeUnit(btn.dataset.unit));
  });

  // キーボード
  document.addEventListener('keydown', e => {
    if (!readerScreen.classList.contains('active')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
    else if (e.code === 'ArrowLeft') {
      const wp = playing; pause();
      idx = Math.max(0, idx - 4); updateView();
      if (wp) play();
    } else if (e.code === 'Escape') {
      closeQuickPanel();
    }
  });

  // ── 初期化 ──
  presetSel.value = '0';
  presetSel.dispatchEvent(new Event('change'));

  if (!('Segmenter' in (window.Intl || {}))) {
    setStatus('※ ブラウザがIntl.Segmenter非対応のため文字単位のみ動作');
  }
});
