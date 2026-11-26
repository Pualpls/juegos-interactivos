/* ============================================================================
   AULA TTS KARAOKE ENGINE (3° "A" · Escuela Primaria Federal "José Clemente Orozco")
   - Lectura en voz alta con Google AI TTS (es-MX) + respaldo offline (speechSynthesis)
   - Subrayado suave sincronizado palabra por palabra y pausas en signos (, ; : . ? !)
   - Botones de lectura para situaciones/preguntas y botones compactos en opciones
   - 100% Vanilla JS, cero dependencias externas, cero contaminación de textContent
   ============================================================================ */
(function (global) {
  'use strict';

  if (global.AulaTTS) return;

  const STYLE_ID = 'aula-tts-karaoke-styles';
  const TTS_BASE = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=es-MX&q=';

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

  // Estado global de reproducción
  const player = {
    activeEl: null,
    activeBtn: null,
    audio: null,
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

  /* --------------------------------------------------------------------------
     1. INYECCIÓN DE ESTILOS (CERO CAMBIO DE LAYOUT / COMPATIBLE CLARO Y OSCURO)
     -------------------------------------------------------------------------- */
  function injectStyles() {
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
     2. MODELO ACÚSTICO DE ESPAÑOL (SÍLABAS, NÚMEROS Y PAUSAS DE PUNTUACIÓN)
     -------------------------------------------------------------------------- */
  function estimateNumberSyllables(numStr) {
    const clean = numStr.replace(/[^\d]/g, '');
    if (!clean) return 1;
    const n = parseInt(clean, 10);
    if (isNaN(n)) return 2;
    if (n <= 15) return n === 0 ? 2 : (n <= 10 ? 2 : 3);
    if (n < 30) return 3.5;
    if (n < 100) return (n % 10 === 0) ? 3 : 4.5;
    if (n < 1000) {
      const rem = n % 100;
      return 3.5 + (rem > 0 ? estimateNumberSyllables(String(rem)) : 0);
    }
    return 6 + Math.min(4, clean.length);
  }

  function estimateWordWeight(rawText) {
    const t = rawText.replace(/[¿¡"«»()\[\]{}]/g, '').trim();
    if (!t) return 0.2;

    // Números (ej. 206, $35, 3°, 1,250)
    if (/^[\$]?\d+(?:[.,]\d+)*[°%]?$/.test(t)) {
      let extra = 0;
      if (t.includes('$')) extra += 2; // "pesos"
      if (t.includes('°')) extra += 2.5; // "grados / tercero"
      if (t.includes('%')) extra += 3; // "por ciento"
      const syl = estimateNumberSyllables(t) + extra;
      return 0.45 + syl * 0.62;
    }

    // Abreviaturas comunes de medidas
    const lower = t.toLowerCase();
    const abbrMap = {
      'cm': 4, 'mm': 4, 'km': 4, 'kg': 4, 'ml': 4, 'mg': 4,
      'm': 2, 'g': 2, 'l': 2, 'hrs': 2, 'min': 3, 'seg': 3
    };
    if (abbrMap[lower]) {
      return 0.45 + abbrMap[lower] * 0.60;
    }

    // Conteo aproximado de sílabas en español (grupos vocálicos)
    const vowelGroups = lower.match(/[aeiouáéíóúü]+/g);
    const sylCount = vowelGroups ? vowelGroups.length : 1;
    // Palabras monosílabas funcionales (el, la, de, y, a, en, con, que, se, su) son ligeramente más rápidas
    const fastWords = new Set(['el', 'la', 'lo', 'los', 'las', 'de', 'del', 'y', 'e', 'o', 'u', 'a', 'al', 'en', 'un', 'es', 'se', 'su', 'le', 'me', 'te', 'si', 'no', 'por', 'con', 'que', 'mas', 'más']);
    if (fastWords.has(lower)) {
      return 0.85;
    }
    return 0.44 + sylCount * 0.62 + Math.min(t.length, 15) * 0.032;
  }

  function estimatePunctWeight(punct, isLastInChunk) {
    if (/[.!?…]/.test(punct)) {
      return isLastInChunk ? 0.65 : 2.35;
    }
    if (/[,;:—–]/.test(punct)) {
      return isLastInChunk ? 0.85 : 1.45;
    }
    return 0.35;
  }

  /* --------------------------------------------------------------------------
     3. TOKENIZACIÓN SEGURA DEL DOM (PALABRAS + PAUSAS SIN ROMPER ESTRUCTURA)
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

    // Regex que separa:
    // 1. Espacios en blanco
    // 2. Números con separadores internos ($1,250, 3.5, 3°, 50%)
    // 3. Incisos como A) B) C) D) o 1.
    // 4. Signos de pausa: , ; : . ! ? … — –
    // 5. Palabras (incluyendo signos de apertura ¿ ¡ « " ( pegados a la palabra)
    // 6. Otros caracteres sueltos
    const TOKEN_RE = /(\s+)|([\$]?\d+(?:[.,]\d+)*[°%]?)|([A-Da-d]\))|([,;:.!?…—–]+)|([¿¡«"'(]*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9'-]+[»"')]*)|([^\s])/g;

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
          // Espacio en blanco: se deja intacto como nodo de texto
          const ws = document.createTextNode(piece);
          frag.appendChild(ws);
          insertedNodes.push(ws);
          continue;
        }

        const isPunct = Boolean(match[4]);
        // Ignorar emojis puros para no frenar el resaltado, pero conservarlos en pantalla
        const hasSpeakable = isPunct || /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/.test(piece);
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

        tokens.push({
          idx: tokIdx,
          text: piece,
          isPunct: isPunct,
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
     4. SEGMENTACIÓN EN BLOQUES (<= 165 CARACTERES PARA GOOGLE AI TTS)
     -------------------------------------------------------------------------- */
  function buildChunks(tokens, maxChars) {
    const limit = maxChars || 165;
    const chunks = [];
    let current = [];
    let currentText = '';

    function flush() {
      if (current.length === 0) return;
      const text = currentText.trim();
      if (text) {
        chunks.push({ tokens: current.slice(), text: text });
      }
      current = [];
      currentText = '';
    }

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const sep = (current.length === 0 || tok.isPunct) ? '' : ' ';
      const candidate = currentText + sep + tok.text;

      if (candidate.length > limit && current.length > 0) {
        // Intentar cortar en la última pausa dentro del bloque actual
        let splitAt = -1;
        for (let k = current.length - 1; k >= Math.floor(current.length * 0.45); k--) {
          if (current[k].isPunct) {
            splitAt = k;
            break;
          }
        }
        if (splitAt >= 0 && splitAt < current.length - 1) {
          const head = current.slice(0, splitAt + 1);
          const tail = current.slice(splitAt + 1);
          const headTxt = joinTokensText(head);
          if (headTxt) chunks.push({ tokens: head, text: headTxt });
          current = tail;
          currentText = joinTokensText(tail);
          const sep2 = (current.length === 0 || tok.isPunct) ? '' : ' ';
          current.push(tok);
          currentText += sep2 + tok.text;
        } else {
          flush();
          current.push(tok);
          currentText = tok.text;
        }
      } else {
        current.push(tok);
        currentText = candidate;
      }

      // Corte natural en final de oración si ya acumuló un tramo sustancial
      if (tok.isPunct && /[.!?…]/.test(tok.text) && currentText.length >= 65) {
        flush();
      }
    }
    flush();
    return chunks;
  }

  function joinTokensText(list) {
    let out = '';
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      out += ((i === 0 || t.isPunct) ? '' : ' ') + t.text;
    }
    return out.trim();
  }

  function buildTimelineForChunk(chunkTokens, totalDurationSec) {
    const leadIn = Math.min(0.08, totalDurationSec * 0.04);
    const tailOut = Math.min(0.11, totalDurationSec * 0.05);
    const usable = Math.max(0.22, totalDurationSec - leadIn - tailOut);

    const weights = chunkTokens.map((tok, i) => {
      const isLast = (i === chunkTokens.length - 1);
      return tok.isPunct ? estimatePunctWeight(tok.text, isLast) : estimateWordWeight(tok.text);
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
     5. REPRODUCCIÓN GOOGLE AI TTS + RESPALDO OFFLINE SPEECHSYNTHESIS
     -------------------------------------------------------------------------- */
  function stop() {
    player.sessionId++;
    player.speaking = false;

    if (player.rafId) {
      cancelAnimationFrame(player.rafId);
      player.rafId = null;
    }

    if (player.audio) {
      try {
        player.audio.onended = null;
        player.audio.onerror = null;
        player.audio.onloadedmetadata = null;
        player.audio.pause();
        player.audio.src = '';
      } catch (e) {}
      player.audio = null;
    }

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

      // Construir mapa de charIndex -> tokenIdx para sincronizar onboundary
      let assembled = '';
      const spansMap = [];
      for (let i = 0; i < chunk.tokens.length; i++) {
        const tok = chunk.tokens[i];
        if (i > 0 && !tok.isPunct) assembled += ' ';
        const startChar = assembled.length;
        assembled += tok.text;
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
      const estDuration = Math.max(0.7, chunk.tokens.reduce((s, t, i) => {
        const isLast = (i === chunk.tokens.length - 1);
        return s + (t.isPunct ? estimatePunctWeight(t.text, isLast) : estimateWordWeight(t.text)) * 0.21;
      }, 0));
      const timeline = buildTimelineForChunk(chunk.tokens, estDuration);
      const startTime = performance.now();

      function tickFallback() {
        if (finished || sid !== player.sessionId) return;
        const elapsed = (performance.now() - startTime) / 1000;
        if (!boundarySeen && elapsed >= 0.08) {
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

        // Si entre la palabra anterior y la nueva había un signo de pausa (coma/punto), mostrarlo brevemente
        if (lastBoundarySpanPos >= 0 && foundPos > lastBoundarySpanPos + 1) {
          const between = spansMap[lastBoundarySpanPos + 1];
          if (between && between.isPunct) {
            setActiveToken(between.tokIdx);
            const targetIdx = spansMap[foundPos].tokIdx;
            setTimeout(() => {
              if (!finished && sid === player.sessionId) setActiveToken(targetIdx);
            }, 130);
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

  function speakChunkViaGoogleTTS(chunk, sid) {
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

      const audio = new Audio();
      audio.referrerPolicy = 'no-referrer';
      audio.preload = 'auto';
      audio.src = TTS_BASE + encodeURIComponent(cleanForUrl);
      player.audio = audio;

      let settled = false;
      let timeline = null;

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
        reject(new Error('GoogleTTSUnavailable'));
      }

      // Timeout de seguridad si no hay internet o tarda demasiado en cargar
      const loadTimeout = setTimeout(() => {
        if (!settled && audio.readyState < 2) {
          try { audio.pause(); audio.src = ''; } catch (e) {}
          failAndFallback();
        }
      }, 2800);

      audio.onloadedmetadata = () => {
        if (sid !== player.sessionId) return;
        const dur = (audio.duration && isFinite(audio.duration) && audio.duration > 0.1)
          ? audio.duration
          : Math.max(0.8, chunk.tokens.length * 0.34);
        timeline = buildTimelineForChunk(chunk.tokens, dur);
      };

      audio.onplay = () => {
        clearTimeout(loadTimeout);
        if (sid !== player.sessionId) {
          try { audio.pause(); } catch (e) {}
          return;
        }
        if (!timeline) {
          const dur = (audio.duration && isFinite(audio.duration) && audio.duration > 0.1)
            ? audio.duration
            : Math.max(0.8, chunk.tokens.length * 0.34);
          timeline = buildTimelineForChunk(chunk.tokens, dur);
        }

        function syncFrame() {
          if (settled || sid !== player.sessionId) return;
          if (!player.activeEl || !player.activeEl.isConnected) {
            stop();
            return;
          }
          const ct = audio.currentTime || 0;
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

      audio.playbackRate = 0.96;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          clearTimeout(loadTimeout);
          failAndFallback();
        });
      }
    });
  }

  async function speakElement(targetEl, triggerBtn) {
    if (!targetEl || !targetEl.isConnected) return;

    // Si ya está leyendo este mismo elemento, detenerlo (toggle)
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

    const chunks = buildChunks(tokens, 165);
    let forceOffline = (typeof navigator !== 'undefined' && navigator.onLine === false);

    for (let c = 0; c < chunks.length; c++) {
      if (sid !== player.sessionId) return;
      if (!targetEl.isConnected) {
        stop();
        return;
      }

      if (!forceOffline) {
        try {
          await speakChunkViaGoogleTTS(chunks[c], sid);
        } catch (err) {
          if (sid !== player.sessionId) return;
          forceOffline = true;
          await speakChunkViaSpeechSynthesis(chunks[c], sid);
        }
      } else {
        await speakChunkViaSpeechSynthesis(chunks[c], sid);
      }
    }

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

    let forceOffline = (typeof navigator !== 'undefined' && navigator.onLine === false);

    for (let idx = 0; idx < valid.length; idx++) {
      if (sid !== player.sessionId) return;
      const el = valid[idx];
      if (!el.isConnected) continue;

      restoreElementDom();
      const { tokens, restoreRecords } = tokenizeElement(el);
      if (tokens.length === 0) continue;

      player.activeEl = el;
      player.tokens = tokens;
      player.restoreRecords = restoreRecords;

      const chunks = buildChunks(tokens, 165);
      for (let c = 0; c < chunks.length; c++) {
        if (sid !== player.sessionId) return;
        if (!el.isConnected) {
          stop();
          return;
        }
        if (!forceOffline) {
          try {
            await speakChunkViaGoogleTTS(chunks[c], sid);
          } catch (err) {
            if (sid !== player.sessionId) return;
            forceOffline = true;
            await speakChunkViaSpeechSynthesis(chunks[c], sid);
          }
        } else {
          await speakChunkViaSpeechSynthesis(chunks[c], sid);
        }
      }
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

    // Limpiar barras huérfanas si el elemento original fue reemplazado dinámicamente
    player.promptBindings = player.promptBindings.filter((b) => {
      if (!b.el.isConnected) {
        if (b.bar && b.bar.parentNode) b.bar.parentNode.removeChild(b.bar);
        return false;
      }
      return true;
    });

    // Si el elemento activo en lectura desapareció o se ocultó, detener voz
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

    // Bloquear propagación de toque/arrastre en el botón de bocina sin impedir el evento click
    ['pointerdown', 'mousedown', 'touchstart'].forEach((evtName) => {
      document.addEventListener(evtName, (e) => {
        const spk = e.target && e.target.closest ? e.target.closest('.aula-tts-opt-btn, .aula-tts-prompt-btn') : null;
        if (!spk) return;
        e.stopPropagation();
        e.stopImmediatePropagation();
      }, true);
    });

    // Interceptar clic en fase de captura: lee la opción/situación SIN seleccionar ni responder
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

    // Soporte de teclado accesible en la bocina de opciones
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const spk = e.target && e.target.closest ? e.target.closest('.aula-tts-opt-btn') : null;
      if (!spk) return;
      e.preventDefault();
      e.stopPropagation();
      const targetEl = spk._aulaTtsTarget || spk.parentElement;
      if (targetEl) speakElement(targetEl, spk);
    }, true);

    // Detener audio al cerrar o salir de la pestaña
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
        // Ignorar mutaciones causadas únicamente por nuestro resaltado karaoke
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

  // Precargar voces de respaldo en navegadores que las cargan de forma asíncrona
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
