/* Finite presentation choreography. UI and chapter text remain visible by default. */
(() => {
  const body = document.body;
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const effects = document.querySelector('#motion');
  const running = new Set();
  const canAnimate = () => effects.checked && !preference.matches && !document.hidden;
  const stop = () => {
    running.forEach(animation => animation.cancel());
    running.clear();
  };
  const animate = (element, frames, options) => {
    if (!element || !canAnimate() || !element.animate) return;
    const animation = element.animate(frames, options);
    running.add(animation);
    animation.finished.catch(() => {}).finally(() => running.delete(animation));
  };
  const sync = () => {
    body.classList.toggle('no-motion', !effects.checked || preference.matches);
    if (!canAnimate()) stop();
  };
  effects.addEventListener('change', sync);
  preference.addEventListener('change', () => {
    if (preference.matches) effects.checked = false;
    sync();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
  sync();
  body.classList.add('motion-ready');
  const flow = document.querySelector('.flow');
  flow.querySelectorAll('.flow-step').forEach((step, index) => {
    step.style.setProperty('--step-delay', `${index * 160}ms`);
  });
  if ('IntersectionObserver' in window) {
    const reveal = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        if (entry.target === flow) {
          flow.querySelectorAll('.flow-step').forEach((step, index) => {
            animate(step.querySelector('.flow-head'),
              [{opacity:.5, transform:'translateY(8px)'}, {opacity:1, transform:'none'}],
              {duration:380, delay:index * 160, easing:'cubic-bezier(.16,1,.3,1)'});
          });
        } else {
          animate(entry.target, [{opacity:.7}, {opacity:1}], {duration:350});
        }
        reveal.unobserve(entry.target);
      });
    }, {threshold:.15});
    reveal.observe(flow);
    reveal.observe(document.querySelector('.spec-title'));
    window.addEventListener('pagehide', () => {reveal.disconnect(); stop();}, {once:true});
  }
  const screen = document.querySelector('#screen');
  let previousPage = state.page;
  let previousRole = state.role;
  const updates = new MutationObserver(() => {
    // Animate navigation only; typing, validation and list updates stay immediate.
    if (previousPage !== state.page || previousRole !== state.role) {
      stop();
      animate(screen, [{opacity:.6, transform:'translateY(5px)'}, {opacity:1, transform:'none'}],
        {duration:180, easing:'cubic-bezier(.16,1,.3,1)'});
    }
    previousPage = state.page;
    previousRole = state.role;
  });
  updates.observe(screen, {childList:true});
  window.addEventListener('pagehide', () => {updates.disconnect(); stop();}, {once:true});
})();
