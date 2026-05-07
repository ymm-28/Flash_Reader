(() => {
  const $ = id => document.getElementById(id);
  const presetSel = $('preset'), urlInput = $('urlInput'), loadUrlBtn = $('loadUrlBtn');
  const speedRange = $('speed'), speedVal = $('speedVal'), unitSel = $('unit');
  const startBtn = $('startBtn'), pauseBtn = $('pauseBtn'), resetBtn = $('resetBtn');
  const wordEl = $('word'), titleEl = $('title'), infoEl = $('info');
  const progressBar = $('progressBar'), statusEl = $('status');

  let tokens = [], idx = 0, timer = null, playing = false, currentTitle = '';

  // プリセット読み込み
  AOZORA_PRESETS.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = p.title;
    presetSel.appendChild(opt);
  });

  // 単語分割（Intl.Segmenterは現代ブラウザで日本語対応）
  function tokenize(text, mode) {
    text = text.replace(/\s+/g, ' ').trim();
    if (mode === 'char') {
      return Array.from(text).filter(c => c !== ' ');
    }
    if (mode === 'phrase') {
      // 句読点・記号で区切る
      return text.split(/(?<=[。、！？!?「」『』,.])/g)
        .map(s => s.trim()).filter(Boolean);
    }
    // word mode
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const seg = new Intl.Segmenter('ja', { granularity: 'word' });
      const out = [];
      for (const s of seg.segment(text)) {
        const w = s.segment.trim();
        if (w) out.push(w);
      }
      return out;
    }
    // フォールバック: 文字単位
    return Array.from(text);
  }

  function setStatus(msg) { statusEl.textContent = msg; }

  function loadText(text, title) {
    currentTitle = title || '';
    titleEl.textContent = currentTitle;
    tokens = tokenize(text, unitSel.value);
    idx = 0;
    updateView();
    setStatus(`読み込み完了: ${tokens.length} トークン`);
    wordEl.textContent = '▶ 開始ボタンを押してください';
  }

  function updateView() {
    if (!tokens.length) return;
    if (idx >= tokens.length) {
      wordEl.textContent = '── 終了 ──';
      progressBar.style.width = '100%';
      infoEl.textContent = `${tokens.length}/${tokens.length}`;
      return;
    }
    wordEl.textContent = tokens[idx];
    infoEl.textContent = `${idx + 1}/${tokens.length}`;
    progressBar.style.width = ((idx + 1) / tokens.length * 100) + '%';
  }

  function tick() {
    if (idx >= tokens.length) {
      stop();
      return;
    }
    updateView();
    idx++;
    timer = setTimeout(tick, parseInt(speedRange.value, 10));
  }

  function play() {
    if (!tokens.length) { setStatus('まずテキストを読み込んでください'); return; }
    if (idx >= tokens.length) idx = 0;
    playing = true;
    startBtn.textContent = '▶ 再生中';
    tick();
  }

  function pause() {
    playing = false;
    if (timer) { clearTimeout(timer); timer = null; }
    startBtn.textContent = '▶ 開始';
  }

  function stop() {
    pause();
    startBtn.textContent = '▶ 開始';
  }

  function reset() {
    pause();
    idx = 0;
    updateView();
    if (tokens.length) wordEl.textContent = '▶ 開始ボタンを押してください';
  }

  // 青空文庫HTMLのパース（XHTML本文を抽出）
  function parseAozoraHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // タイトル
    const titleNode = doc.querySelector('h1.title') || doc.querySelector('title');
    const title = titleNode ? titleNode.textContent.trim() : '青空文庫';
    // ルビ除去
    doc.querySelectorAll('rt, rp').forEach(n => n.remove());
    // 本文: div.main_text が標準
    const main = doc.querySelector('div.main_text') || doc.body;
    // 注釈などの特殊タグを処理
    main.querySelectorAll('.notes, .bibliographical_information, .after_text').forEach(n => n.remove());
    let text = main.textContent || '';
    // ［＃〜］形式の注記を除去
    text = text.replace(/［＃[^］]*］/g, '');
    text = text.replace(/　/g, ' ').replace(/[ \t]+/g, ' ');
    return { title, text: text.trim() };
  }

  async function fetchAozora(url) {
    setStatus('取得中...');
    // 直接fetch（CORSが通れば）→ ダメならプロキシ
    const tryFetch = async (u) => {
      const res = await fetch(u);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      // 青空文庫はShift_JISが多い
      let text;
      try {
        text = new TextDecoder('shift_jis').decode(buf);
        if (!text.includes('<') && !text.includes('青空')) {
          text = new TextDecoder('utf-8').decode(buf);
        }
      } catch (e) {
        text = new TextDecoder('utf-8').decode(buf);
      }
      return text;
    };

    try {
      const html = await tryFetch(url);
      return parseAozoraHtml(html);
    } catch (e1) {
      setStatus('直接取得失敗、プロキシ経由で再試行...');
      try {
        const proxied = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
        const html = await tryFetch(proxied);
        return parseAozoraHtml(html);
      } catch (e2) {
        throw new Error('取得失敗: ' + e2.message + '（CORSの制限の可能性。プリセットをご利用ください）');
      }
    }
  }

  // イベント
  presetSel.addEventListener('change', () => {
    const i = presetSel.value;
    if (i === '') return;
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

  unitSel.addEventListener('change', () => {
    // 同じテキストで再分割
    const sel = presetSel.value;
    if (sel !== '') {
      const p = AOZORA_PRESETS[sel];
      loadText(p.text, p.title);
    }
  });

  startBtn.addEventListener('click', () => {
    if (playing) pause(); else play();
  });
  pauseBtn.addEventListener('click', pause);
  resetBtn.addEventListener('click', reset);

  // キーボードショートカット
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); if (playing) pause(); else play(); }
    else if (e.code === 'ArrowLeft') {
      pause(); idx = Math.max(0, idx - 2); updateView(); idx++;
    }
    else if (e.code === 'ArrowRight') {
      pause(); updateView(); idx = Math.min(tokens.length, idx + 1);
    }
    else if (e.code === 'ArrowUp') {
      speedRange.value = Math.max(40, parseInt(speedRange.value) - 20);
      speedVal.textContent = speedRange.value + 'ms';
    }
    else if (e.code === 'ArrowDown') {
      speedRange.value = Math.min(1000, parseInt(speedRange.value) + 20);
      speedVal.textContent = speedRange.value + 'ms';
    }
  });

  // 初期メッセージ
  if (!('Segmenter' in (window.Intl || {}))) {
    setStatus('※ このブラウザはIntl.Segmenterに非対応のため、文字単位での表示になります');
  } else {
    setStatus('プリセットを選ぶか、青空文庫のXHTMLページのURLを入力してください');
  }
})();
