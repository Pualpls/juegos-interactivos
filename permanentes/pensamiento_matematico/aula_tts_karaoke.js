/* ============================================================================
   AULA TTS KARAOKE ENGINE v2 (3° "A" · Escuela Primaria Federal "José Clemente Orozco")
   - Lectura en voz alta con Voz IA de Google (es-MX) + respaldo offline (speechSynthesis)
   - Sincronización exacta inmune a Transfer-Encoding: chunked:
     * Pre-carga canplaythrough + escucha activa de durationchange/progress
     * Micro-fragmentación por oraciones/cláusulas con pre-carga en segundo plano
     * Modelo fonético español calibrado (hiatos, cifras, unidades, alargamiento prepausal y espacios ___)
     * Compensación de latencia de salida de audio (50 ms) para cero adelanto visual
   - Subrayado suave palabra por palabra y pausas en signos (, ; : . ? !)
   - 100% Vanilla JS, cero dependencias externas, cero contaminación de textContent
   ============================================================================ */
(function (global) {
  'use strict';

  if (global.AulaTTS) return;

  const STYLE_ID = 'aula-tts-karaoke-styles';
  const TTS_BASE = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=es-MX&q=';
  // Compensación de latencia física del buffer de audio HDMI/altavoces (evita que el subrayado se adelante al sonido)
  const AUDIO_OUTPUT_LATENCY_SEC = 0.055;

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT', 'TEMPLATE', 'INPUT', 'TEXTAREA', 'SELECT', 'CANVAS']);
  const SKIP_CLASSES = [
    'aula-tts-opt-btn',
    'aula-tts-prompt-btn',
    'aula-tts-prompt-bar',
    'aula-tts-ignore',
    'exam-box',
    'badge-num',
    'card-letter',
    'option-indicator',
    'situation-icon',
    'step-num',
    'slot-label'
  ];

  const FAST_WORDS = new Set([
    'el', 'la', 'lo', 'los', 'las', 'de', 'del', 'y', 'e', 'o', 'u',
    'a', 'al', 'en', 'un', 'es', 'se', 'su', 'le', 'me', 'te', 'si',
    'no', 'por', 'con', 'que', 'mas', 'más', 'sin', 'mi', 'tu'
  ]);

  const ABBR_SYLLABLES = {
    'cm': 4, 'mm': 4, 'km': 4, 'kg': 4, 'ml': 4, 'mg': 4,
    'm': 2, 'g': 2, 'l': 2, 'hrs': 2, 'min': 3, 'seg': 3,
    'pts': 2, 'opm': 3, 'ppm': 3
  };

  const player = {
    activeEl: null,
    activeBtn: null,
    audio: null,
    preloadedAudio: null,
    rafId: null,
    sessionId: 0,
    tokens: [],
    restoreRecords: [],
    activeTokenIdx: -1,
    speaking: false,
    config: null,
    observer: null,
    debounceTimer: null,
    wiredPromptMap: new WeakMap(),
    wiredOptionSet: new WeakSet(),
    promptBindings: []
  };

  function ensureNoReferrerMeta() {
    if (!document.head) return;
    let meta = document.querySelector('meta[name="referrer"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'referrer');
      meta.setAttribute('content', 'no-referrer');
      document.head.insertBefore(meta, document.head.firstChild);
    } else if (meta.getAttribute('content') !== 'no-referrer') {
      meta.setAttribute('content', 'no-referrer');
    }
  }

  /* --------------------------------------------------------------------------
     1. INYECCIÓN DE ESTILOS (CERO CAMBIO DE LAYOUT / COMPATIBLE CLARO Y OSCURO)
     -------------------------------------------------------------------------- */
  function injectStyles() {
    ensureNoReferrerMeta();
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .aula-tts-tok {
        border-radius: 4px;
        transition: background-color 0.08s ease, box-shadow 0.08s ease;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
      }

      .aula-tts-word-active {
        background-color: rgba(250, 204, 21, 0.34) !important;
        text-decoration: underline !important;
        text-decoration-color: #f59e0b !important;
        text-decoration-thickness: 3px !important;
        text-underline-offset: 3px !important;
        box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.18) !important;
      }

      .aula-tts-pause-active {
        background-color: rgba(56, 189, 248, 0.36) !important;
        text-decoration: underline !important;
        text-decoration-color: #0284c7 !important;
        text-decoration-thickness: 3px !important;
        text-underline-offset: 3px !important;
        box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.28) !important;
      }

      .aula-tts-prompt-bar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        margin: 0 0 6px 0;
        width: 100%;
        pointer-events: auto;
      }

      .aula-tts-prompt-bar.align-left {
        justify-content: flex-start;
      }

      .aula-tts-prompt-bar.inline-bar {
        display: inline-flex;
        width: auto;
        margin: 0 0 0 8px;
        vertical-align: middle;
      }

      .aula-tts-prompt-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 5px 12px;
        border-radius: 999px;
        border: 2px solid #38bdf8;
        background: rgba(224, 242, 254, 0.96);
        color: #0369a1;
        font-family: inherit;
        font-size: 0.82rem;
        font-weight: 800;
        line-height: 1.15;
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        box-shadow: 0 2px 6px rgba(2, 132, 199, 0.18);
        transition: transform 0.12s ease, background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .aula-tts-prompt-btn:hover {
        background: #bae6fd;
        transform: translateY(-1px);
      }

      .aula-tts-prompt-btn:active {
        transform: scale(0.96);
      }

      .aula-tts-prompt-btn.speaking {
        background: #fef3c7;
        border-color: #f59e0b;
        color: #92400e;
        box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.25);
      }

      .aula-tts-has-opt-btn {
        position: relative !important;
        padding-right: 48px !important;
      }

      .aula-tts-opt-btn {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        width: 34px;
        height: 34px;
        border-radius: 999px;
        border: 2px solid #38bdf8;
        background: rgba(240, 249, 255, 0.96);
        color: #0369a1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 6;
        user-select: none;
        -webkit-user-select: none;
        box-shadow: 0 2px 5px rgba(15, 23, 42, 0.16);
        transition: transform 0.12s ease, background-color 0.15s ease, border-color 0.15s ease;
        pointer-events: auto;
      }

      .aula-tts-opt-btn::before {
        content: '🔊';
        font-size: 15px;
        line-height: 1;
      }

      .aula-tts-opt-btn:hover {
        background: #bae6fd;
        transform: translateY(-50%) scale(1.08);
      }

      .aula-tts-opt-btn:active {
        transform: translateY(-50%) scale(0.94);
      }

      .aula-tts-opt-btn.speaking {
        background: #fef3c7;
        border-color: #f59e0b;
        box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.30);
      }

      .aula-tts-opt-btn.speaking::before {
        content: '⏹️';
        font-size: 14px;
      }
    `;
    document.head.appendChild(style);
  }

  /* --------------------------------------------------------------------------
     2. MODELO FONÉTICO CALIBRADO DE ESPAÑOL (SÍLABAS, HIATOS, CIFRAS Y PAUSAS)
     -------------------------------------------------------------------------- */
  function countSpanishSyllables(lowerWord) {
    const clean = lowerWord.replace(/[^a-záéíóúüñ]/g, '');
    if (!clean) return 1;
    const groups = clean.match(/[aeiouáéíóúü]+/g);
    let count = groups ? groups.length : 1;
    // Sumar hiatos reales en español (dos vocales fuertes seguidas o débil tónica junto a vocal: Ga-el, ma-es-tro, ha-bí-a, frí-o)
    const hiatusStrong = clean.match(/[aeoáéó][aeoáéó]/g);
    const hiatusAccent = clean.match(/(?:[íú][aeiouáéó]|[aeiouáéó][íú])/g);
    if (hiatusStrong) count += hiatusStrong.length;
    if (hiatusAccent) count += hiatusAccent.length;
    return Math.max(1, count);
  }

  function estimateNumberSyllables(numStr) {
    const clean = numStr.replace(/[^\d]/g, '');
    if (!clean) return 1;
    const n = parseInt(clean, 10);
    if (isNaN(n)) return 2.5;
    if (n <= 15) return (n <= 10 && n !== 0) ? 2.2 : 3.0;
    if (n < 30) return 3.9;
    if (n < 100) return (n % 10 === 0) ? 3.3 : 5.4;
    if (n < 1000) {
      const rem = n % 100;
      return 4.2 + (rem > 0 ? estimateNumberSyllables(String(rem)) : 0);
    }
    return 6.8 + Math.min(4, clean.length);
  }

  function estimateTokenSeconds(tok, isBeforePunct, isLastInChunk) {
    if (tok.isBlank) {
      // Se lee como "espacio en blanco" (~0.92s)
      return 0.92;
    }
    if (tok.isPunct) {
      if (/[.!?…]/.test(tok.text)) return isLastInChunk ? 0.15 : 0.46;
      if (/[,;:—–]/.test(tok.text)) return isLastInChunk ? 0.18 : 0.35;
      return 0.10;
    }

    const t = tok.text.replace(/[¿¡"«»()\[\]{}]/g, '').trim();
    if (!t) return 0.08;

    let sec;
    // Números, moneda, grados y porcentajes (Google TTS articula los números con pausa clara)
    if (/^[\$]?\d+(?:[.,]\d+)*[°%]?$/.test(t)) {
      let extra = 0;
      if (t.includes('$')) extra += 2.2;
      if (t.includes('°')) extra += 2.6;
      if (t.includes('%')) extra += 3.0;
      const syl = estimateNumberSyllables(t) + extra;
      sec = 0.20 + syl * 0.175;
    } else if (/^[A-Da-d]\)$/.test(t)) {
      // Incisos A) B) C) D) tienen breve pausa posterior
      sec = 0.36;
    } else {
      const lower = t.toLowerCase();
      if (ABBR_SYLLABLES[lower]) {
        sec = 0.14 + ABBR_SYLLABLES[lower] * 0.165;
      } else if (FAST_WORDS.has(lower)) {
        sec = 0.175;
      } else {
        const syl = countSpanishSyllables(lower);
        sec = 0.115 + syl * 0.168 + Math.min(t.length, 15) * 0.008;
      }
    }

    // Alargamiento prepausal natural antes de coma o punto en español
    if (isBeforePunct) {
      sec *= 1.22;
    }
    return sec;
  }

  function estimateChunkDurationSec(chunkTokens) {
    let total = 0.12; // lead-in + tail-out promedio medido en MP3 de Google TTS (24ms + 48ms + margen)
    for (let i = 0; i < chunkTokens.length; i++) {
      const tok = chunkTokens[i];
      const isLast = (i === chunkTokens.length - 1);
      const beforePunct = !tok.isPunct && (i + 1 < chunkTokens.length && chunkTokens[i + 1].isPunct);
      total += estimateTokenSeconds(tok, beforePunct, isLast);
    }
    return Math.max(0.45, total);
  }

  /* --------------------------------------------------------------------------
     3. TOKENIZACIÓN SEGURA DEL DOM (PALABRAS + PAUSAS + ESPACIOS EN BLANCO)
     -------------------------------------------------------------------------- */
  function shouldSkipNode(node) {
    let cur = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (cur && cur !== document.body) {
      if (SKIP_TAGS.has(cur.tagName)) return true;
      if (cur.classList) {
        for (let i = 0; i < SKIP_CLASSES.length; i++) {
          if (cur.classList.contains(SKIP_CLASSES[i])) return true;
        }
      }
      if (cur.getAttribute && cur.getAttribute('aria-hidden') === 'true') return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function extractPlainText(el) {
    if (!el) return '';
    const parts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (shouldSkipNode(node)) continue;
      if (node.nodeValue && node.nodeValue.trim()) {
        parts.push(node.nodeValue);
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function tokenizeElement(el) {
    const tokens = [];
    const restoreRecords = [];
    const textNodes = [];

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      if (shouldSkipNode(n)) continue;
      if (n.nodeValue && n.nodeValue.trim().length > 0) {
        textNodes.push(n);
      }
    }

    // Grupos:
    // 1. Espacios
    // 2. Espacios en blanco didácticos: ___ , ¿ ? , [ ? ]
    // 3. Cifras / monedas / grados / porcentajes
    // 4. Incisos A) B) C) D)
    // 5. Signos de pausa: , ; : . ! ? … — –
    // 6. Palabras (incluyendo signos de apertura ¿ ¡ « " ( pegados)
    // 7. Símbolos matemáticos (+, -, ×, =, > , <)
    // 8. Otros caracteres
    const TOKEN_RE = /(\s+)|(_{2,}|\[\s*\?\s*\]|¿\s*\?)|([\$]?\d+(?:[.,]\d+)*[°%]?)|([A-Da-d]\))|([,;:.!?…—–]+)|([¿¡«"'(]*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9'-]+[»"')]*)|([+\-×÷=])|([^\s])/g;
    const MATH_SPOKEN = { '+': 'más', '-': 'menos', '×': 'por', '÷': 'entre', '=': 'igual a' };

    textNodes.forEach((textNode) => {
      const parent = textNode.parentNode;
      if (!parent) return;
      const originalText = textNode.nodeValue;
      const frag = document.createDocumentFragment();
      const insertedNodes = [];

      let match;
      TOKEN_RE.lastIndex = 0;
      while ((match = TOKEN_RE.exec(originalText)) !== null) {
        const piece = match[0];
        if (match[1]) {
          const ws = document.createTextNode(piece);
          frag.appendChild(ws);
          insertedNodes.push(ws);
          continue;
        }

        const isBlank = Boolean(match[2]);
        const isPunct = Boolean(match[5]);
        const isMathOp = Boolean(match[7]);
        const hasSpeakable = isBlank || isPunct || isMathOp || /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/.test(piece);

        if (!hasSpeakable) {
          const raw = document.createTextNode(piece);
          frag.appendChild(raw);
          insertedNodes.push(raw);
          continue;
        }

        const span = document.createElement('span');
        span.className = isPunct ? 'aula-tts-tok aula-tts-punct' : 'aula-tts-tok aula-tts-word';
        span.textContent = piece;
        const tokIdx = tokens.length;
        span.dataset.ttsIdx = String(tokIdx);

        let spokenText = piece;
        if (isBlank) spokenText = 'espacio en blanco';
        else if (isMathOp && MATH_SPOKEN[piece]) spokenText = MATH_SPOKEN[piece];

        tokens.push({
          idx: tokIdx,
          text: piece,
          spokenText: spokenText,
          isPunct: isPunct,
          isBlank: isBlank,
          span: span
        });

        frag.appendChild(span);
        insertedNodes.push(span);
      }

      parent.replaceChild(frag, textNode);
      restoreRecords.push({
        parent: parent,
        insertedNodes: insertedNodes,
        originalText: originalText
      });
    });

    return { tokens, restoreRecords };
  }

  function restoreElementDom() {
    clearActiveHighlight();
    for (let i = player.restoreRecords.length - 1; i >= 0; i--) {
      const rec = player.restoreRecords[i];
      if (!rec.parent || !rec.parent.isConnected) continue;
      const first = rec.insertedNodes.find((nd) => nd.parentNode === rec.parent);
      if (!first) continue;
      const restored = document.createTextNode(rec.originalText);
      rec.parent.insertBefore(restored, first);
      rec.insertedNodes.forEach((nd) => {
        if (nd.parentNode === rec.parent) {
          rec.parent.removeChild(nd);
        }
      });
    }
    player.restoreRecords = [];
    player.tokens = [];
    player.activeTokenIdx = -1;
  }

  function clearActiveHighlight() {
    if (player.activeTokenIdx >= 0 && player.tokens[player.activeTokenIdx]) {
      const prev = player.tokens[player.activeTokenIdx].span;
      if (prev) {
        prev.classList.remove('aula-tts-word-active', 'aula-tts-pause-active');
      }
    }
    player.activeTokenIdx = -1;
  }

  function setActiveToken(idx) {
    if (idx === player.activeTokenIdx) return;
    clearActiveHighlight();
    if (idx < 0 || idx >= player.tokens.length) return;
    const tok = player.tokens[idx];
    if (!tok || !tok.span || !tok.span.isConnected) return;
    tok.span.classList.add(tok.isPunct ? 'aula-tts-pause-active' : 'aula-tts-word-active');
    player.activeTokenIdx = idx;
  }

  /* --------------------------------------------------------------------------
     4. MICRO-FRAGMENTACIÓN POR ORACIONES Y CLÁUSULAS (CERO ACUMULACIÓN DE DESFASE)
     -------------------------------------------------------------------------- */
  function joinTokensSpokenText(list) {
    let out = '';
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const spoken = t.spokenText || t.text;
      out += ((i === 0 || t.isPunct) ? '' : ' ') + spoken;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function buildChunks(tokens) {
    const MAX_CHARS = 95;
    const chunks = [];
    let current = [];
    let currentLen = 0;

    function flush() {
      if (current.length === 0) return;
      const text = joinTokensSpokenText(current);
      if (text) {
        chunks.push({ tokens: current.slice(), text: text });
      }
      current = [];
      currentLen = 0;
    }

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const spoken = tok.spokenText || tok.text;
      const addLen = (current.length === 0 || tok.isPunct ? 0 : 1) + spoken.length;

      if (currentLen + addLen > MAX_CHARS && current.length > 0) {
        let splitAt = -1;
        for (let k = current.length - 1; k >= Math.floor(current.length * 0.4); k--) {
          if (current[k].isPunct) {
            splitAt = k;
            break;
          }
        }
        if (splitAt >= 0 && splitAt < current.length - 1) {
          const head = current.slice(0, splitAt + 1);
          const tail = current.slice(splitAt + 1);
          const headTxt = joinTokensSpokenText(head);
          if (headTxt) chunks.push({ tokens: head, text: headTxt });
          current = tail;
          currentLen = joinTokensSpokenText(tail).length;
        } else {
          flush();
        }
      }

      current.push(tok);
      currentLen += (current.length === 1 || tok.isPunct ? 0 : 1) + spoken.length;

      // Cortar siempre al terminar una oración (. ! ? ; :) para re-anclar el reloj a 0.00s
      if (tok.isPunct && /[.!?;:…]/.test(tok.text) && currentLen >= 14) {
        flush();
      } else if (tok.isPunct && /[,—–]/.test(tok.text) && currentLen >= 46) {
        // En oraciones largas, cortar también en la coma para descargar MP3 pequeños e instantáneos
        flush();
      }
    }
    flush();
    return chunks;
  }

  function buildTimelineForChunk(chunkTokens, totalDurationSec) {
    const leadIn = Math.min(0.045, totalDurationSec * 0.025);
    const tailOut = Math.min(0.065, totalDurationSec * 0.035);
    const usable = Math.max(0.22, totalDurationSec - leadIn - tailOut);

    const weights = chunkTokens.map((tok, i) => {
      const isLast = (i === chunkTokens.length - 1);
      const beforePunct = !tok.isPunct && (i + 1 < chunkTokens.length && chunkTokens[i + 1].isPunct);
      return estimateTokenSeconds(tok, beforePunct, isLast);
    });
    const sumW = weights.reduce((a, b) => a + b, 0) || 1;

    let acc = leadIn;
    return chunkTokens.map((tok, i) => {
      const dur = (weights[i] / sumW) * usable;
      const start = acc;
      acc += dur;
      return {
        tokIdx: tok.idx,
        start: start,
        end: acc
      };
    });
  }

  /* --------------------------------------------------------------------------
     5. REPRODUCCIÓN CON VOZ IA (PRE-CARGA + DURATIONCHANGE VIVO) Y RESPALDO
     -------------------------------------------------------------------------- */
  function cleanupAudioObj(a) {
    if (!a) return;
    try {
      a.onended = null;
      a.onerror = null;
      a.onloadedmetadata = null;
      a.ondurationchange = null;
      a.oncanplaythrough = null;
      a.onplay = null;
      a.pause();
      a.src = '';
    } catch (e) {}
  }

  function stop() {
    player.sessionId++;
    player.speaking = false;

    if (player.rafId) {
      cancelAnimationFrame(player.rafId);
      player.rafId = null;
    }

    cleanupAudioObj(player.audio);
    player.audio = null;
    cleanupAudioObj(player.preloadedAudio);
    player.preloadedAudio = null;

    try {
      if (global.speechSynthesis) {
        global.speechSynthesis.cancel();
      }
    } catch (e) {}

    if (player.activeBtn) {
      updateBtnVisual(player.activeBtn, false);
      player.activeBtn = null;
    }

    restoreElementDom();
    player.activeEl = null;
  }

  function updateBtnVisual(btn, isSpeaking) {
    if (!btn) return;
    btn.classList.toggle('speaking', isSpeaking);
    if (btn.classList.contains('aula-tts-prompt-btn')) {
      const baseLabel = btn.dataset.ttsLabel || 'Escuchar';
      btn.textContent = isSpeaking ? '⏹️ Detener' : `🔊 ${baseLabel}`;
    }
  }

  function createChunkAudio(text) {
    const a = new Audio();
    a.preload = 'auto';
    a.src = TTS_BASE + encodeURIComponent(text);
    try { a.load(); } catch (e) {}
    return a;
  }

  function pickSpanishVoice() {
    if (!global.speechSynthesis || !global.speechSynthesis.getVoices) return null;
    const voices = global.speechSynthesis.getVoices() || [];
    return (
      voices.find((v) => /es[-_]MX/i.test(v.lang)) ||
      voices.find((v) => /es[-_]US|es[-_]419/i.test(v.lang)) ||
      voices.find((v) => /^es/i.test(v.lang)) ||
      null
    );
  }

  function speakChunkViaSpeechSynthesis(chunk, sid) {
    return new Promise((resolve) => {
      if (sid !== player.sessionId || !global.speechSynthesis) {
        resolve();
        return;
      }

      let assembled = '';
      const spansMap = [];
      for (let i = 0; i < chunk.tokens.length; i++) {
        const tok = chunk.tokens[i];
        const spoken = tok.spokenText || tok.text;
        if (i > 0 && !tok.isPunct) assembled += ' ';
        const startChar = assembled.length;
        assembled += spoken;
        spansMap.push({
          startChar: startChar,
          endChar: assembled.length,
          tokIdx: tok.idx,
          isPunct: tok.isPunct
        });
      }

      const utter = new SpeechSynthesisUtterance(assembled);
      utter.lang = 'es-MX';
      utter.rate = 0.92;
      const voice = pickSpanishVoice();
      if (voice) utter.voice = voice;

      let boundarySeen = false;
      let finished = false;
      const estDuration = estimateChunkDurationSec(chunk.tokens) * 1.06;
      const timeline = buildTimelineForChunk(chunk.tokens, estDuration);
      const startTime = performance.now();

      function tickFallback() {
        if (finished || sid !== player.sessionId) return;
        const elapsed = Math.max(0, (performance.now() - startTime) / 1000 - AUDIO_OUTPUT_LATENCY_SEC);
        if (!boundarySeen && elapsed >= 0.04) {
          for (let i = 0; i < timeline.length; i++) {
            if (elapsed >= timeline[i].start && elapsed <= timeline[i].end) {
              setActiveToken(timeline[i].tokIdx);
              break;
            }
          }
        }
        player.rafId = requestAnimationFrame(tickFallback);
      }

      let lastBoundarySpanPos = -1;
      utter.onboundary = (e) => {
        if (finished || sid !== player.sessionId) return;
        boundarySeen = true;
        const cIdx = typeof e.charIndex === 'number' ? e.charIndex : 0;
        let foundPos = -1;
        for (let i = 0; i < spansMap.length; i++) {
          if (cIdx >= spansMap[i].startChar && cIdx < spansMap[i].endChar) {
            foundPos = i;
            break;
          }
          if (spansMap[i].startChar > cIdx) {
            foundPos = Math.max(0, i - 1);
            break;
          }
        }
        if (foundPos < 0) foundPos = spansMap.length - 1;

        if (lastBoundarySpanPos >= 0 && foundPos > lastBoundarySpanPos + 1) {
          const between = spansMap[lastBoundarySpanPos + 1];
          if (between && between.isPunct) {
            setActiveToken(between.tokIdx);
            const targetIdx = spansMap[foundPos].tokIdx;
            setTimeout(() => {
              if (!finished && sid === player.sessionId) setActiveToken(targetIdx);
            }, 140);
            lastBoundarySpanPos = foundPos;
            return;
          }
        }
        setActiveToken(spansMap[foundPos].tokIdx);
        lastBoundarySpanPos = foundPos;
      };

      const done = () => {
        if (finished) return;
        finished = true;
        if (player.rafId) {
          cancelAnimationFrame(player.rafId);
          player.rafId = null;
        }
        resolve();
      };

      utter.onend = done;
      utter.onerror = done;

      try {
        global.speechSynthesis.cancel();
        global.speechSynthesis.speak(utter);
        player.rafId = requestAnimationFrame(tickFallback);
      } catch (err) {
        done();
      }
    });
  }

  function speakChunkViaGoogleTTS(chunk, sid, preloadedAudioInstance, nextChunkText) {
    return new Promise((resolve, reject) => {
      if (sid !== player.sessionId) {
        resolve();
        return;
      }

      const cleanForUrl = chunk.text.replace(/\s+/g, ' ').trim();
      if (!cleanForUrl) {
        resolve();
        return;
      }

      const audio = preloadedAudioInstance || createChunkAudio(cleanForUrl);
      player.audio = audio;
      player.preloadedAudio = null;

      const acousticEstSec = estimateChunkDurationSec(chunk.tokens);
      let timeline = buildTimelineForChunk(chunk.tokens, acousticEstSec);
      let lastBuiltDur = acousticEstSec;
      let settled = false;
      let playStarted = false;

      // Resolver la duración real confiable evitando lecturas parciales de Transfer-Encoding: chunked
      function getTrustedDuration() {
        const rawDur = audio.duration;
        if (rawDur && isFinite(rawDur) && rawDur > 0.15) {
          // Si ya descargó todo el clip (readyState >= 4) o la duración reportada es consistente con el texto completo
          if (audio.readyState >= 4 || rawDur >= acousticEstSec * 0.85) {
            return rawDur;
          }
          // Si el stream aún va a medio descargar y reporta una duración truncada, proteger con el piso fonético
          return Math.max(rawDur, acousticEstSec);
        }
        return acousticEstSec;
      }

      function refreshTimelineIfNeeded() {
        if (settled || sid !== player.sessionId) return;
        const trusted = getTrustedDuration();
        if (Math.abs(trusted - lastBuiltDur) > 0.025) {
          lastBuiltDur = trusted;
          timeline = buildTimelineForChunk(chunk.tokens, trusted);
        }
      }

      function finishOk() {
        if (settled) return;
        settled = true;
        if (player.rafId) {
          cancelAnimationFrame(player.rafId);
          player.rafId = null;
        }
        resolve();
      }

      function failAndFallback() {
        if (settled) return;
        settled = true;
        if (player.rafId) {
          cancelAnimationFrame(player.rafId);
          player.rafId = null;
        }
        cleanupAudioObj(audio);
        if (player.audio === audio) player.audio = null;
        reject(new Error('GoogleTTSUnavailable'));
      }

      const loadTimeout = setTimeout(() => {
        if (!settled && audio.readyState === 0) {
          failAndFallback();
        }
      }, 3600);

      audio.onloadedmetadata = refreshTimelineIfNeeded;
      audio.ondurationchange = refreshTimelineIfNeeded;

      audio.onplay = () => {
        clearTimeout(loadTimeout);
        if (sid !== player.sessionId) {
          cleanupAudioObj(audio);
          return;
        }
        refreshTimelineIfNeeded();

        // Pre-cargar desde ya el siguiente fragmento en segundo plano para transición instantánea y duración exacta
        if (nextChunkText && !player.preloadedAudio) {
          player.preloadedAudio = createChunkAudio(nextChunkText);
        }

        function syncFrame() {
          if (settled || sid !== player.sessionId) return;
          if (!player.activeEl || !player.activeEl.isConnected) {
            stop();
            return;
          }
          refreshTimelineIfNeeded();

          // Restar latencia física de salida para que el subrayado nunca vaya adelantado a la voz
          const ct = Math.max(0, (audio.currentTime || 0) - AUDIO_OUTPUT_LATENCY_SEC);
          if (timeline && timeline.length > 0) {
            let matchedIdx = -1;
            for (let i = 0; i < timeline.length; i++) {
              if (ct >= timeline[i].start && ct <= timeline[i].end) {
                matchedIdx = timeline[i].tokIdx;
                break;
              }
            }
            if (matchedIdx === -1 && ct > timeline[timeline.length - 1].end) {
              matchedIdx = timeline[timeline.length - 1].tokIdx;
            }
            if (matchedIdx !== -1) {
              setActiveToken(matchedIdx);
            }
          }
          if (!audio.paused && !audio.ended) {
            player.rafId = requestAnimationFrame(syncFrame);
          }
        }
        player.rafId = requestAnimationFrame(syncFrame);
      };

      audio.onended = () => {
        clearTimeout(loadTimeout);
        finishOk();
      };

      audio.onerror = () => {
        clearTimeout(loadTimeout);
        failAndFallback();
      };

      function triggerPlay() {
        if (playStarted || settled || sid !== player.sessionId) return;
        playStarted = true;
        refreshTimelineIfNeeded();
        audio.playbackRate = 1.0;
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            clearTimeout(loadTimeout);
            failAndFallback();
          });
        }
      }

      // Si el fragmento ya está completo en memoria (ej. pre-cargado), iniciar de inmediato;
      // si no, esperar brevemente (máx. 260 ms) a canplaythrough para obtener la duración exacta del MP3 completo.
      if (audio.readyState >= 4) {
        triggerPlay();
      } else {
        const readyWait = setTimeout(triggerPlay, 260);
        audio.oncanplaythrough = () => {
          clearTimeout(readyWait);
          triggerPlay();
        };
      }
    });
  }

  async function playChunksForCurrentTokens(chunks, sid, forceOfflineState) {
    let forceOffline = forceOfflineState.value;

    for (let c = 0; c < chunks.length; c++) {
      if (sid !== player.sessionId) return;
      if (!player.activeEl || !player.activeEl.isConnected) {
        stop();
        return;
      }

      const nextText = (c + 1 < chunks.length) ? chunks[c + 1].text : null;
      const preloaded = player.preloadedAudio;
      player.preloadedAudio = null;

      if (!forceOffline) {
        try {
          await speakChunkViaGoogleTTS(chunks[c], sid, preloaded, nextText);
        } catch (err) {
          if (sid !== player.sessionId) return;
          forceOffline = true;
          forceOfflineState.value = true;
          await speakChunkViaSpeechSynthesis(chunks[c], sid);
        }
      } else {
        cleanupAudioObj(preloaded);
        await speakChunkViaSpeechSynthesis(chunks[c], sid);
      }
    }
  }

  async function speakElement(targetEl, triggerBtn) {
    if (!targetEl || !targetEl.isConnected) return;

    if (player.speaking && player.activeEl === targetEl) {
      stop();
      return;
    }

    stop();
    injectStyles();

    const plainText = extractPlainText(targetEl);
    if (!plainText || plainText.length < 2) return;

    const { tokens, restoreRecords } = tokenizeElement(targetEl);
    if (tokens.length === 0) return;

    const sid = ++player.sessionId;
    player.activeEl = targetEl;
    player.activeBtn = triggerBtn || null;
    player.tokens = tokens;
    player.restoreRecords = restoreRecords;
    player.speaking = true;

    if (player.activeBtn) {
      updateBtnVisual(player.activeBtn, true);
    }

    const chunks = buildChunks(tokens);
    const forceOfflineState = { value: (typeof navigator !== 'undefined' && navigator.onLine === false) };
    await playChunksForCurrentTokens(chunks, sid, forceOfflineState);

    if (sid === player.sessionId) {
      stop();
    }
  }

  async function speakSequence(elements, triggerBtn) {
    const valid = (elements || []).filter((el) => el && el.isConnected && extractPlainText(el).length >= 2);
    if (valid.length === 0) return;

    if (player.speaking && player.activeBtn && triggerBtn && player.activeBtn === triggerBtn) {
      stop();
      return;
    }

    stop();
    injectStyles();

    const sid = ++player.sessionId;
    player.activeBtn = triggerBtn || null;
    player.speaking = true;
    if (player.activeBtn) updateBtnVisual(player.activeBtn, true);

    const forceOfflineState = { value: (typeof navigator !== 'undefined' && navigator.onLine === false) };

    for (let idx = 0; idx < valid.length; idx++) {
      if (sid !== player.sessionId) return;
      const el = valid[idx];
      if (!el.isConnected) continue;

      cleanupAudioObj(player.preloadedAudio);
      player.preloadedAudio = null;
      restoreElementDom();

      const { tokens, restoreRecords } = tokenizeElement(el);
      if (tokens.length === 0) continue;

      player.activeEl = el;
      player.tokens = tokens;
      player.restoreRecords = restoreRecords;

      const chunks = buildChunks(tokens);
      await playChunksForCurrentTokens(chunks, sid, forceOfflineState);
    }

    if (sid === player.sessionId) {
      stop();
    }
  }

  /* --------------------------------------------------------------------------
     6. CONEXIÓN AUTOMÁTICA DE BOTONES EN SITUACIONES Y OPCIONES
     -------------------------------------------------------------------------- */
  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = global.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (el.offsetParent === null && style.position !== 'fixed') return false;
    return true;
  }

  function hasMeaningfulText(el, minLen) {
    const txt = extractPlainText(el);
    if (!txt || txt.length < (minLen || 4)) return false;
    if (/^cargando/i.test(txt)) return false;
    return true;
  }

  function wirePromptRule(rule) {
    const els = document.querySelectorAll(rule.selector);
    els.forEach((el) => {
      if (el.closest('.aula-tts-ignore')) return;
      if (el.classList.contains('aula-tts-prompt-btn') || el.classList.contains('aula-tts-opt-btn')) return;

      let binding = player.wiredPromptMap.get(el);
      if (!binding || !binding.bar.isConnected) {
        const bar = document.createElement('div');
        bar.className = 'aula-tts-prompt-bar' + (rule.align === 'left' ? ' align-left' : '') + (rule.inline ? ' inline-bar' : '');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'aula-tts-prompt-btn';
        const lbl = rule.label || 'Escuchar';
        btn.dataset.ttsLabel = lbl;
        btn.textContent = `🔊 ${lbl}`;
        btn.title = 'Leer en voz alta con seguimiento palabra por palabra';
        btn._aulaTtsTarget = el;
        bar.appendChild(btn);

        if (rule.insert === 'after') {
          el.parentNode && el.parentNode.insertBefore(bar, el.nextSibling);
        } else if (rule.insert === 'inside-top') {
          el.insertBefore(bar, el.firstChild);
        } else {
          el.parentNode && el.parentNode.insertBefore(bar, el);
        }

        binding = { el, bar, btn, rule };
        player.wiredPromptMap.set(el, binding);
        player.promptBindings.push(binding);
      }

      const show = isElementVisible(el) && hasMeaningfulText(el, rule.minLength || 4);
      binding.bar.style.display = show ? (rule.inline ? 'inline-flex' : 'flex') : 'none';
    });
  }

  function wireOptionRule(rule) {
    const els = document.querySelectorAll(rule.selector);
    els.forEach((el) => {
      if (el.closest('.aula-tts-ignore')) return;
      if (!hasMeaningfulText(el, rule.minLength || 2)) return;

      let spk = el.querySelector(':scope > .aula-tts-opt-btn');
      if (!spk) {
        el.classList.add('aula-tts-has-opt-btn');
        spk = document.createElement('span');
        spk.className = 'aula-tts-opt-btn';
        spk.setAttribute('role', 'button');
        spk.setAttribute('tabindex', '0');
        spk.setAttribute('aria-label', 'Escuchar esta opción');
        spk.title = 'Escuchar esta opción';
        spk._aulaTtsTarget = el;
        el.appendChild(spk);
        player.wiredOptionSet.add(el);
      }
    });
  }

  function scanAndWire() {
    if (!player.config) return;

    player.promptBindings = player.promptBindings.filter((b) => {
      if (!b.el.isConnected) {
        if (b.bar && b.bar.parentNode) b.bar.parentNode.removeChild(b.bar);
        return false;
      }
      return true;
    });

    if (player.speaking && player.activeEl && (!player.activeEl.isConnected || !isElementVisible(player.activeEl))) {
      stop();
    }

    (player.config.prompts || []).forEach(wirePromptRule);
    (player.config.options || []).forEach(wireOptionRule);
  }

  function scheduleScan() {
    if (player.debounceTimer) clearTimeout(player.debounceTimer);
    player.debounceTimer = setTimeout(() => {
      player.debounceTimer = null;
      scanAndWire();
    }, 65);
  }

  function bindGlobalCaptureEvents() {
    if (global.__aulaTtsEventsBound) return;
    global.__aulaTtsEventsBound = true;

    ['pointerdown', 'mousedown', 'touchstart'].forEach((evtName) => {
      document.addEventListener(evtName, (e) => {
        const spk = e.target && e.target.closest ? e.target.closest('.aula-tts-opt-btn, .aula-tts-prompt-btn') : null;
        if (!spk) return;
        e.stopPropagation();
        e.stopImmediatePropagation();
      }, true);
    });

    document.addEventListener('click', (e) => {
      const spk = e.target && e.target.closest ? e.target.closest('.aula-tts-opt-btn, .aula-tts-prompt-btn') : null;
      if (!spk) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const targetEl = spk._aulaTtsTarget || (spk.classList.contains('aula-tts-opt-btn') ? spk.parentElement : null);
      if (targetEl) {
        speakElement(targetEl, spk);
      }
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const spk = e.target && e.target.closest ? e.target.closest('.aula-tts-opt-btn') : null;
      if (!spk) return;
      e.preventDefault();
      e.stopPropagation();
      const targetEl = spk._aulaTtsTarget || spk.parentElement;
      if (targetEl) speakElement(targetEl, spk);
    }, true);

    global.addEventListener('pagehide', stop);
    global.addEventListener('beforeunload', stop);
  }

  function init(config) {
    injectStyles();
    bindGlobalCaptureEvents();
    player.config = config || { prompts: [], options: [] };

    const start = () => {
      scanAndWire();
      if (player.observer) player.observer.disconnect();
      player.observer = new MutationObserver((mutations) => {
        let relevant = false;
        for (let i = 0; i < mutations.length; i++) {
          const m = mutations[i];
          if (m.type === 'attributes' && m.attributeName === 'class') {
            if (m.target && m.target.classList && m.target.classList.contains('aula-tts-tok')) continue;
          }
          if (m.target && m.target.classList && (m.target.classList.contains('aula-tts-prompt-bar') || m.target.classList.contains('aula-tts-prompt-btn') || m.target.classList.contains('aula-tts-opt-btn'))) {
            continue;
          }
          relevant = true;
          break;
        }
        if (relevant) scheduleScan();
      });

      player.observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  try {
    if (global.speechSynthesis && global.speechSynthesis.onvoiceschanged !== undefined) {
      global.speechSynthesis.getVoices();
    }
  } catch (e) {}

  global.AulaTTS = {
    init: init,
    speakElement: speakElement,
    speakSequence: speakSequence,
    stop: stop,
    rescan: scanAndWire
  };
})(window);
