(() => {
  'use strict';
  const root = document.documentElement;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reducedMotion.matches;
  let heroVisible = true;
  let animationId = 0;
  let phase = 0;
  let lastTime = 0;
  const motionButton = document.querySelector('.motion-toggle');
  const canvas = document.querySelector('#clarity-canvas');
  const context = canvas?.getContext('2d');
  const hero = document.querySelector('.hero');
  let width = 0, height = 0;
  let pointerX = 0, pointerY = 0, targetX = 0, targetY = 0;

  document.querySelector('#year').textContent = new Date().getFullYear();

  // Content is only hidden when its reveal observer can be installed.
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      }
    }, { threshold: 0.06 });
    document.querySelectorAll('.reveal').forEach(element => revealObserver.observe(element));
    root.classList.add('motion-enabled');
  }

  const menu = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#navigation');
  const setMenu = open => {
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
    navigation.classList.toggle('is-open', open);
  };
  menu.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true'));
  navigation.addEventListener('click', event => { if (event.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      menu.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.site-header')) setMenu(false);
  });
  window.matchMedia('(min-width: 801px)').addEventListener('change', () => setMenu(false));

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const activateTab = tab => {
    tabs.forEach(item => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowDown') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        activateTab(tabs[next]);
        tabs[next].focus();
      }
    });
  });

  const header = document.querySelector('.site-header');
  const progress = document.querySelector('.scroll-progress');
  const navLinks = [...navigation.querySelectorAll('a')];
  const sections = navLinks.map(link => link.pathname === window.location.pathname && link.hash ? document.querySelector(link.hash) : null);
  let scrollQueued = false;
  function updateScroll() {
    const scrollable = root.scrollHeight - window.innerHeight;
    progress.style.transform = `scaleX(${scrollable > 0 ? window.scrollY / scrollable : 0})`;
    header.classList.toggle('scrolled', window.scrollY > 20);
    let active = -1;
    sections.forEach((section, index) => { if (section && section.getBoundingClientRect().top <= 180) active = index; });
    navLinks.forEach((link, index) => {
      if (index === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    scrollQueued = false;
  }
  window.addEventListener('scroll', () => {
    if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(updateScroll); }
  }, { passive: true });
  updateScroll();

  // Legal pages share navigation and scroll behavior, without the hero animation.
  if (!canvas || !motionButton || !hero) return;

  // A light, locally rendered particle surface. No WebGL, libraries or remote assets.
  const points = [];
  const rows = 66, columns = 105;
  for (let row = 0; row < rows; row++) {
    const v = row / (rows - 1) * Math.PI * 2;
    for (let column = 0; column < columns; column++) {
      const u = column / (columns - 1) * Math.PI * 2;
      const radius = 1.16 + 0.38 * Math.cos(v);
      points.push({
        x: radius * Math.cos(u),
        y: radius * Math.sin(u),
        z: 0.46 * Math.sin(v) + 0.24 * Math.sin(3 * u + v),
        u, v,
        highlight: row % 11 === 0 && column % 7 === 0
      });
    }
  }

  function draw() {
    if (!context || !width || !height) return;
    context.clearRect(0, 0, width, height);
    pointerX += (targetX - pointerX) * 0.04;
    pointerY += (targetY - pointerY) * 0.04;
    const angleY = -0.42 + Math.sin(phase * 0.23) * 0.22 + pointerX * 0.13;
    const angleX = 0.92 + Math.sin(phase * 0.17) * 0.12 + pointerY * 0.12;
    const angleZ = -0.54 + phase * 0.045;
    const sy = Math.sin(angleY), cy = Math.cos(angleY);
    const sx = Math.sin(angleX), cx = Math.cos(angleX);
    const sz = Math.sin(angleZ), cz = Math.cos(angleZ);
    const scale = Math.min(width * 0.28, height * 0.275);
    for (const point of points) {
      const wave = Math.sin(point.u * 3 + point.v * 2 + phase * 0.4) * 0.025;
      const x1 = point.x * cy + point.z * sy;
      const z1 = -point.x * sy + (point.z + wave) * cy;
      const y1 = point.y * cx - z1 * sx;
      const z2 = point.y * sx + z1 * cx;
      const x2 = x1 * cz - y1 * sz;
      const y2 = x1 * sz + y1 * cz;
      const perspective = 4.7 / (4.7 - z2);
      const x = width / 2 + x2 * scale * perspective;
      const y = height / 2 + y2 * scale * perspective;
      const depth = (z2 + 1.8) / 3.6;
      const alpha = Math.min(0.9, 0.15 + depth * 0.7);
      context.fillStyle = point.highlight ? `rgba(117,251,225,${alpha})` : `rgba(224,241,255,${alpha})`;
      const size = (point.highlight ? 1.6 : 0.6 + depth * 0.6) * perspective;
      context.beginPath();
      context.arc(x, y, size, 0, Math.PI * 2);
      context.fill();
    }
  }

  function resizeCanvas() {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width; height = bounds.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (context) context.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function frame(time) {
    animationId = 0;
    if (paused || document.hidden || !heroVisible || !context) return;
    // Cap at 30fps; keep the animation clock stable across hidden tabs.
    if (time - lastTime >= 32) {
      phase += Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      draw();
    }
    animationId = requestAnimationFrame(frame);
  }
  function syncAnimation() {
    if (animationId) cancelAnimationFrame(animationId);
    animationId = 0;
    if (!paused && !document.hidden && heroVisible && context) {
      lastTime = performance.now();
      animationId = requestAnimationFrame(frame);
    }
  }
  function setMotion(value) {
    paused = value;
    root.classList.toggle('motion-paused', paused);
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.querySelector('.motion-label').textContent = paused ? 'Animation aktivieren' : 'Animation pausieren';
    motionButton.querySelector('.pause-icon').textContent = paused ? '▷' : 'Ⅱ';
    syncAnimation();
  }
  motionButton.addEventListener('click', () => setMotion(!paused));
  reducedMotion.addEventListener('change', event => setMotion(event.matches));
  document.addEventListener('visibilitychange', syncAnimation);
  canvas.addEventListener('pointermove', event => {
    if (paused || event.pointerType !== 'mouse') return;
    const bounds = canvas.getBoundingClientRect();
    targetX = (event.clientX - bounds.left) / width - 0.5;
    targetY = (event.clientY - bounds.top) / height - 0.5;
  });
  canvas.addEventListener('pointerleave', () => { targetX = 0; targetY = 0; });
  if ('ResizeObserver' in window) new ResizeObserver(resizeCanvas).observe(canvas);
  else window.addEventListener('resize', resizeCanvas);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      heroVisible = entries[0].isIntersecting;
      syncAnimation();
    }).observe(hero);
  }
  resizeCanvas();
  setMotion(paused);
})();
