/* ========================================================
   PRETEXT TYPOGRAPHY & KINETIC TEXT ENGINE
   Powered by @chenglou/pretext@0.0.9 (Latest)
   Fast, accurate DOM-free text measurement & layout
   ======================================================== */
(() => {
  const Pretext = window.Pretext;
  if (!Pretext) {
    console.warn('[Pretext] Pretext library not found on window. Skipping initialization.');
    return;
  }

  // Set locale for accurate unicode and grapheme cluster segmentation
  if (typeof Pretext.setLocale === 'function') {
    Pretext.setLocale('ru');
  }

  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const motionCheckbox = document.querySelector('#motion');
  const runningAnimations = new Set();

  const canAnimate = () => {
    const motionAllowed = motionCheckbox ? motionCheckbox.checked : true;
    return motionAllowed && !preference.matches && !document.hidden;
  };

  const cancelAllAnimations = () => {
    runningAnimations.forEach(anim => {
      try { anim.cancel(); } catch (e) {}
    });
    runningAnimations.clear();
  };

  // Sync with motion toggle and preference changes
  if (motionCheckbox) {
    motionCheckbox.addEventListener('change', () => {
      if (!canAnimate()) cancelAllAnimations();
    });
  }
  preference.addEventListener('change', () => {
    if (preference.matches) cancelAllAnimations();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAllAnimations();
  });

  /* --------------------------------------------------------
     Pretext Layout & Measurement Cache
     -------------------------------------------------------- */
  const preparedCache = new Map();
  const preparedSegmentsCache = new Map();

  const getComputedFont = (el) => {
    const s = getComputedStyle(el);
    return `${s.fontWeight || '400'} ${s.fontSize || '16px'} ${s.fontFamily || 'sans-serif'}`;
  };

  const getPrepared = (text, font) => {
    const key = `${font}:::${text}`;
    let prep = preparedCache.get(key);
    if (!prep) {
      prep = Pretext.prepare(text, font);
      preparedCache.set(key, prep);
    }
    return prep;
  };

  const getPreparedWithSegments = (text, font) => {
    const key = `${font}:::${text}`;
    let prep = preparedSegmentsCache.get(key);
    if (!prep) {
      prep = Pretext.prepareWithSegments(text, font);
      preparedSegmentsCache.set(key, prep);
    }
    return prep;
  };

  /* --------------------------------------------------------
     Pretext Russian Typography & Orphan Prevention
     -------------------------------------------------------- */
  // Short prepositions & conjunctions that should not hang at line ends
  const PREPOSITIONS = new Set([
    'в', 'во', 'и', 'с', 'со', 'к', 'ко', 'о', 'об', 'обо', 'у', 'на', 'по', 'не', 'ни',
    'за', 'из', 'изо', 'от', 'ото', 'до', 'под', 'подо', 'над', 'при', 'без', 'безо',
    'для', 'как', 'так', 'но', 'а', 'или', 'да'
  ]);

  const optimizeRussianTypography = (text) => {
    if (!text || typeof text !== 'string') return text;
    // Normalize spaces
    let clean = text.replace(/[\s\u00A0]+/g, ' ').trim();
    const words = clean.split(' ');
    if (words.length <= 1) return clean;

    // 1. Prevent single-word widows on the last line: bind last two words with non-breaking space
    if (words.length >= 2) {
      const last = words.pop();
      const prev = words.pop();
      words.push(`${prev}\u00A0${last}`);
    }

    // 2. Glue short prepositions/conjunctions to the following word
    for (let i = 0; i < words.length - 1; i++) {
      const lower = words[i].toLowerCase().replace(/[.,!?:;«»()"]/g, '');
      if (PREPOSITIONS.has(lower)) {
        words[i] = words[i] + '\u00A0' + words[i + 1];
        words.splice(i + 1, 1);
        i--;
      }
    }

    return words.join(' ');
  };

  /* --------------------------------------------------------
     Typography Optimizer for Elements
     -------------------------------------------------------- */
  const optimizeElementTypography = (el) => {
    if (!el || el.dataset.pretextOptimized === 'true') return;
    // If element contains structured child headline spans (.headline-line), optimize each span
    const headlineLines = el.querySelectorAll('.headline-line');
    if (headlineLines.length > 0) {
      headlineLines.forEach(lineEl => {
        const text = lineEl.textContent.trim();
        const optimized = optimizeRussianTypography(text);
        if (optimized !== text) {
          // preserve em / child elements if any
          const em = lineEl.querySelector('em');
          if (!em) {
            lineEl.textContent = optimized;
          }
        }
      });
      el.dataset.pretextOptimized = 'true';
      return;
    }

    // For plain text elements
    if (el.children.length === 0) {
      const text = el.textContent.trim();
      if (!text) return;
      const optimized = optimizeRussianTypography(text);
      if (optimized !== text) {
        el.textContent = optimized;
      }
      el.dataset.pretextOptimized = 'true';
    }
  };

  /* --------------------------------------------------------
     Pretext Kinetic Line Reveal Animation
     -------------------------------------------------------- */
  const animateKineticLines = (el, options = {}) => {
    if (!el) return;
    const {
      staggerMs = 80,
      duration = 460,
      delay = 0,
      easing = 'cubic-bezier(0.16, 1, 0.3, 1)',
      onComplete
    } = options;

    if (!canAnimate()) {
      el.classList.add('pretext-revealed');
      onComplete?.();
      return;
    }

    // Special handling for elements with existing .headline-line spans (like .launch h1, .pitch h2)
    // Their per-line staggered animations are driven natively by CSS keyframes (headline-arrive)
    // with per-line delay (60ms for line 1, 220ms for line 2) to eliminate any WebGL/layout tearing.
    const headlineSpans = el.querySelectorAll('.headline-line');
    if (headlineSpans.length > 0) {
      el.classList.add('pretext-revealed');
      onComplete?.();
      return;
    }

    // For elements with <br> breaks (like #mechanics-title, #team-title), split by <br> to preserve <em>
    if (el.innerHTML.includes('<br')) {
      const parts = el.innerHTML.split(/<br\s*\/?>/i);
      el.innerHTML = parts.map((p, i) =>
        `<span class="pretext-line-wrapper"><span class="pretext-line" style="--line-idx:${i}">${p.trim()}</span></span>`
      ).join('');
      const lineEls = el.querySelectorAll('.pretext-line');
      lineEls.forEach((lineEl, idx) => {
        if (!lineEl.animate) return;
        const anim = lineEl.animate([
          { opacity: 0, transform: 'translateY(16px)' },
          { opacity: 1, transform: 'none' }
        ], {
          duration,
          delay: delay + (idx * staggerMs),
          easing
        });
        runningAnimations.add(anim);
        anim.finished.catch(() => {}).finally(() => {
          runningAnimations.delete(anim);
          if (idx === lineEls.length - 1) {
            el.classList.add('pretext-revealed');
            onComplete?.();
          }
        });
      });
      return;
    }

    // For headings / paragraphs without fixed headline lines:
    // Pretext measures and lays out the text lines DOM-free!
    const font = getComputedFont(el);
    const text = el.textContent.trim();
    if (!text) return;

    const width = el.clientWidth || 400;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;

    try {
      const prep = getPreparedWithSegments(text, font);
      const layoutRes = Pretext.layoutWithLines(prep, width, lineHeight);
      if (!layoutRes || !layoutRes.lines || layoutRes.lines.length <= 1) {
        // Single line fallback: animate element smoothly
        const anim = el.animate([
          { opacity: 0, transform: 'translateY(14px)' },
          { opacity: 1, transform: 'none' }
        ], {
          duration,
          delay,
          easing
        });
        runningAnimations.add(anim);
        anim.finished.catch(() => {}).finally(() => {
          runningAnimations.delete(anim);
          el.classList.add('pretext-revealed');
          onComplete?.();
        });
        return;
      }

      // Pretext gave us exact lines! Wrap them in kinetic line containers
      const lineHtml = layoutRes.lines.map((l, i) =>
        `<span class="pretext-line-wrapper"><span class="pretext-line" style="--line-idx:${i}">${escapeHtml(l.text)}</span></span>`
      ).join('');

      el.innerHTML = lineHtml;
      const lineEls = el.querySelectorAll('.pretext-line');
      lineEls.forEach((lineEl, idx) => {
        if (!lineEl.animate) return;
        const anim = lineEl.animate([
          { opacity: 0, transform: 'translateY(16px)' },
          { opacity: 1, transform: 'none' }
        ], {
          duration,
          delay: delay + (idx * staggerMs),
          easing
        });
        runningAnimations.add(anim);
        anim.finished.catch(() => {}).finally(() => {
          runningAnimations.delete(anim);
          if (idx === lineEls.length - 1) {
            el.classList.add('pretext-revealed');
            onComplete?.();
          }
        });
      });
    } catch (err) {
      // Fallback if Pretext layout throws on unusual content
      el.classList.add('pretext-revealed');
      onComplete?.();
    }
  };

  /* --------------------------------------------------------
     Kinetic Number / Tag Decoder & Scramble
     -------------------------------------------------------- */
  const scrambleChars = '0123456789ABCDEF#@$%*';
  const animateScramble = (el, targetText, options = {}) => {
    if (!el || !targetText) return;
    const {
      duration = 380,
      onComplete
    } = options;

    if (!canAnimate()) {
      el.textContent = targetText;
      onComplete?.();
      return;
    }

    const font = getComputedFont(el);
    let naturalWidth = 0;
    try {
      const prep = getPreparedWithSegments(targetText, font);
      naturalWidth = Pretext.measureNaturalWidth(prep);
    } catch (e) {
      naturalWidth = el.clientWidth || 40;
    }

    if (naturalWidth > 0) {
      el.style.setProperty('--pretext-width', `${Math.ceil(naturalWidth + 2)}px`);
    }
    el.classList.add('pretext-scramble-slot');

    const startTime = performance.now();
    const length = targetText.length;

    const frame = (now) => {
      if (!canAnimate()) {
        el.textContent = targetText;
        onComplete?.();
        return;
      }
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const resolvedCount = Math.floor(progress * length);

      let output = '';
      for (let i = 0; i < length; i++) {
        if (i < resolvedCount) {
          output += targetText[i];
        } else if (targetText[i] === ' ' || targetText[i] === '/' || targetText[i] === '+' || targetText[i] === ':') {
          output += targetText[i];
        } else {
          output += scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
        }
      }
      el.textContent = output;

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        el.textContent = targetText;
        onComplete?.();
      }
    };

    requestAnimationFrame(frame);
  };

  /* --------------------------------------------------------
     Pretext Zero-Reflow Exact Height Calculation
     -------------------------------------------------------- */
  const calculateExactHeight = (text, font, width, lineHeight) => {
    try {
      const prep = getPrepared(text, font);
      const res = Pretext.layout(prep, width, lineHeight);
      return Math.ceil(res.height);
    } catch (e) {
      return 0;
    }
  };

  /* --------------------------------------------------------
     Helper: Escape HTML
     -------------------------------------------------------- */
  const escapeHtml = (str) => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /* --------------------------------------------------------
     Autotour & Dynamic Story Card Pretext Integration
     -------------------------------------------------------- */
  const hookTourStoryCard = () => {
    const tourCard = document.querySelector('#tour-story-card');
    const tourTitle = document.querySelector('#tour-story-title');
    const tourDesc = document.querySelector('#tour-story-desc');
    const tourStageTag = document.querySelector('#tour-stage-tag');

    if (!tourCard || !tourTitle || !tourDesc) return;

    // Observe changes to tour story card content and apply Pretext layout & animation
    let lastDesc = tourDesc.textContent;
    let lastTitle = tourTitle.textContent;

    const observer = new MutationObserver(() => {
      const newTitle = tourTitle.textContent;
      const newDesc = tourDesc.textContent;
      if (newTitle !== lastTitle || newDesc !== lastDesc) {
        lastTitle = newTitle;
        lastDesc = newDesc;

        // 1. Optimize typography (widow & preposition glue)
        optimizeElementTypography(tourTitle);
        optimizeElementTypography(tourDesc);

        // 2. Pretext Zero-Reflow height transition
        const font = getComputedFont(tourDesc);
        const width = tourDesc.clientWidth || 320;
        const lineHeight = parseFloat(getComputedStyle(tourDesc).lineHeight) || 20;
        const textHeight = calculateExactHeight(tourDesc.textContent, font, width, lineHeight);

        if (textHeight > 0 && canAnimate()) {
          // Softly highlight the update
          tourCard.style.transform = 'scale(0.995)';
          setTimeout(() => { tourCard.style.transform = 'none'; }, 180);
        }

        // 3. Staggered reveal for new narrative step
        if (canAnimate()) {
          animateKineticLines(tourTitle, { duration: 320, staggerMs: 50 });
          animateKineticLines(tourDesc, { duration: 380, delay: 60, staggerMs: 60 });
          if (tourStageTag) {
            animateScramble(tourStageTag, tourStageTag.textContent, { duration: 300 });
          }
        }
      }
    });

    observer.observe(tourCard, { childList: true, subtree: true, characterData: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  };

  /* --------------------------------------------------------
     Viewport Scroll Revealer for Story Sections
     -------------------------------------------------------- */
  const initScrollRevealer = () => {
    if (!('IntersectionObserver' in window)) return;

    const targets = document.querySelectorAll(`
      .launch h1,
      .pitch h2,
      .overview h2,
      .spec-title h2,
      #mechanics-title,
      #team-title,
      #rpg-title,
      #terminal-title,
      #career-title,
      .flow-step,
      .section-intro,
      .team-heading p
    `);

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const target = entry.target;

        // 1. Optimize typography with Pretext
        optimizeElementTypography(target);

        // 2. Trigger kinetic line animation if heading or step
        if (canAnimate() && !target.classList.contains('pretext-revealed')) {
          if (target.matches('h1, h2, h3, #mechanics-title, #team-title, #rpg-title, #terminal-title, #career-title')) {
            animateKineticLines(target, { duration: 480, staggerMs: 75 });
          }
        }

        observer.unobserve(target);
      });
    }, { threshold: 0.12 });

    targets.forEach(target => observer.observe(target));
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  };

  /* --------------------------------------------------------
     Topbar Mode Tabs Pretext Re-Animation
     -------------------------------------------------------- */
  const initViewModeHooks = () => {
    const tabs = document.querySelectorAll('.mode-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const view = tab.dataset.view;
        setTimeout(() => {
          if (view === 'demo') {
            const h = document.querySelector('.pitch h2');
            if (h && canAnimate()) animateKineticLines(h, { duration: 360 });
          } else if (view === 'economy') {
            const h = document.querySelector('#mechanics-title');
            if (h && canAnimate()) animateKineticLines(h, { duration: 360 });
          } else if (view === 'docs') {
            const h = document.querySelector('.spec-title h2');
            if (h && canAnimate()) animateKineticLines(h, { duration: 360 });
          }
        }, 120);
      });
    });
  };

  /* --------------------------------------------------------
     Initial Boot
     -------------------------------------------------------- */
  const boot = () => {
    // 1. Optimize initial critical headings
    document.querySelectorAll('.launch h1, .pitch h2, .overview h2, #mechanics-title, #team-title').forEach(el => {
      optimizeElementTypography(el);
    });

    // 2. Animate launch hero headline line-by-line
    const launchH1 = document.querySelector('.launch h1');
    if (launchH1 && canAnimate()) {
      animateKineticLines(launchH1, { duration: 520, staggerMs: 90 });
    }

    // 3. Connect story tour card hooks
    hookTourStoryCard();

    // 4. Connect view mode tab hooks
    initViewModeHooks();

    // 5. Connect viewport scroll observer
    initScrollRevealer();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(boot);
      } else {
        boot();
      }
    }, { once: true });
  } else {
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(boot);
    } else {
      boot();
    }
  }

  // Window resize re-optimization (debounced)
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      document.querySelectorAll('[data-pretext-optimized]').forEach(el => {
        el.removeAttribute('data-pretext-optimized');
        optimizeElementTypography(el);
      });
    }, 180);
  });

  // Expose API for external modules (e.g. app.js, presentation-story.js)
  window.PretextEngine = {
    version: '0.0.9',
    Pretext,
    canAnimate,
    optimizeRussianTypography,
    optimizeElementTypography,
    animateKineticLines,
    animateScramble,
    calculateExactHeight,
    cancelAllAnimations
  };
})();
