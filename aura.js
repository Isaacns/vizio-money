/* =========================================================================
   MODO AURA — VIZIO · v3 "LUZ DA MARCA"
   Traduz o vocabulário luminoso do símbolo oficial (cubo de vidro) para a
   página inteira: feixes laterais, poça de luz no chão, brilho que respira,
   poeira luminosa e parallax pelo cursor.

   Sempre ativo (sem botão). Respeita prefers-reduced-motion: mantém a luz,
   remove o movimento. Auto-contido: window.AURA.

   Seletores em superset: Studio (#gate>.gate-inner, .wrap), Financiamento
   (.side/.main/.login-card), Consórcio (#login>.box, #app aside/main).
   ========================================================================= */
(function () {
  'use strict';
  if (window.__AURA_INIT__) return;
  window.__AURA_INIT__ = 1;

  /* ---------- cor de acento ---------- */
  function accentHex() {
    var v = window.VZ_ACCENT ||
      (getComputedStyle(document.documentElement).getPropertyValue('--blue') || '').trim() ||
      '#1C64F0';
    return v.charAt(0) === '#' ? v : '#1C64F0';
  }
  function rgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  var HEX = accentHex();
  var R = rgb(HEX).join(',');          // azul da marca
  var RL = rgb('#5AA0FF').join(',');   // brilho (topo do gradiente do símbolo)

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- CSS ---------- */
  var css = document.createElement('style');
  css.id = 'auraCSS';
  css.textContent = [
    /* camada fixa que carrega toda a luz; sofre o parallax */
    '.vz-afix{position:fixed;inset:-12%;z-index:0;pointer-events:none;',
    'will-change:transform;transition:transform .12s linear}',

    /* brilho ambiente que respira — o "ar" em volta do cubo */
    '.vz-glow{position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen;background:',
    'radial-gradient(46vw 46vw at 50% 34%,rgba(' + R + ',.30),transparent 62%),',
    'radial-gradient(60vw 44vw at 12% -6%,rgba(' + R + ',.16),transparent 66%),',
    'radial-gradient(52vw 40vw at 106% 4%,rgba(' + RL + ',.10),transparent 64%);',
    'animation:vzBreathe 7s ease-in-out infinite}',
    '@keyframes vzBreathe{0%,100%{opacity:.62;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}',

    /* poça de luz no chão — o pedestal do render */
    '.vz-floor{position:absolute;left:50%;bottom:-14%;width:120vw;height:52vh;',
    'transform:translateX(-50%);pointer-events:none;mix-blend-mode:screen;',
    'background:radial-gradient(50% 50% at 50% 50%,rgba(' + R + ',.26),rgba(' + R + ',.07) 45%,transparent 72%);',
    'filter:blur(12px);animation:vzFloor 9s ease-in-out infinite}',
    '@keyframes vzFloor{0%,100%{opacity:.55;transform:translateX(-50%) scaleY(1)}',
    '50%{opacity:.95;transform:translateX(-50%) scaleY(1.12)}}',

    /* feixes laterais — os dois raios que cortam a arte */
    '.vz-ray{position:absolute;top:44%;height:2px;pointer-events:none;mix-blend-mode:screen;',
    'filter:blur(1.4px);opacity:0}',
    '.vz-ray i{display:block;height:100%;border-radius:99px}',
    '.vz-ray.l{left:-6%;width:52%;transform:rotate(-3.2deg);animation:vzRayL 6s ease-in-out infinite}',
    '.vz-ray.r{right:-6%;width:52%;transform:rotate(3.2deg);animation:vzRayR 6s ease-in-out infinite .9s}',
    '.vz-ray.l i{background:linear-gradient(90deg,transparent,rgba(' + R + ',.55) 62%,rgba(' + RL + ',.95))}',
    '.vz-ray.r i{background:linear-gradient(270deg,transparent,rgba(' + R + ',.55) 62%,rgba(' + RL + ',.95))}',
    '@keyframes vzRayL{0%,100%{opacity:.18;transform:rotate(-3.2deg) translateX(-2%)}',
    '50%{opacity:.85;transform:rotate(-3.2deg) translateX(0)}}',
    '@keyframes vzRayR{0%,100%{opacity:.18;transform:rotate(3.2deg) translateX(2%)}',
    '50%{opacity:.85;transform:rotate(3.2deg) translateX(0)}}',

    /* poeira luminosa */
    '.vz-parts{position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen;opacity:.85}',

    /* o símbolo já vem com alfa limpo (sem véu de fundo); o glow fica no CSS
       da página, para o cubo pertencer à cena em vez de ficar colado nela. */

    /* conteúdo sempre acima da luz (superset dos apps) */
    '#login>.login-card,#login>.box,#login>.card{position:relative;z-index:2}',
    '#gate>.gate-inner{position:relative;z-index:2}',
    '#app{position:relative}',
    '#app>.side,#app>.main,#app>aside,#app>main{position:relative;z-index:1}',
    '#app .side>*,#app aside>*{position:relative;z-index:1}',
    '.wrap{position:relative;z-index:1}',

    /* sem movimento: a luz fica, a animação não */
    '@media (prefers-reduced-motion: reduce){',
    '.vz-glow,.vz-floor,.vz-ray{animation:none!important}',
    '.vz-ray{opacity:.5}.vz-afix{transition:none}}',

    '@media print{.vz-afix{display:none!important}}'
  ].join('');
  document.head.appendChild(css);

  /* ---------- parallax do cursor ---------- */
  var mx = 0, my = 0, cmx = 0, cmy = 0;
  addEventListener('pointermove', function (e) {
    mx = (e.clientX / innerWidth - .5) * 2;
    my = (e.clientY / innerHeight - .5) * 2;
  }, { passive: true });
  addEventListener('deviceorientation', function (e) {
    if (e.gamma != null) {
      mx = Math.max(-1, Math.min(1, e.gamma / 35));
      my = Math.max(-1, Math.min(1, (e.beta - 45) / 35));
    }
  }, { passive: true });

  /* ---------- poeira luminosa ---------- */
  function particles(canvas) {
    var ctx = canvas.getContext('2d'), parts = [], raf = 0;

    function size() {
      canvas.width = Math.max(1, innerWidth * 1.24);
      canvas.height = Math.max(1, innerHeight * 1.24);
    }
    function seed() {
      var n = Math.round((canvas.width * canvas.height) / 20000);
      n = Math.max(34, Math.min(110, n));
      parts = [];
      for (var i = 0; i < n; i++) {
        parts.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: Math.random() * 1.9 + .5,
          vx: (Math.random() - .5) * .22,
          vy: -(Math.random() * .30 + .05),   // sobe, como brasa de luz
          a: Math.random() * .5 + .22,
          z: Math.random() * 16 + 5,
          ph: Math.random() * 6.283
        });
      }
    }
    function loop(t) {
      cmx += (mx - cmx) * .06;
      cmy += (my - cmy) * .06;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.x += p.vx; p.y += p.vy;
        if (p.y < -20) { p.y = canvas.height + 20; p.x = Math.random() * canvas.width; }
        if (p.x < -20) p.x = canvas.width + 20;
        if (p.x > canvas.width + 20) p.x = -20;

        var tw = .65 + .35 * Math.sin(t / 900 + p.ph);   // cintila
        var dx = p.x + cmx * p.z, dy = p.y + cmy * p.z;

        ctx.beginPath(); ctx.arc(dx, dy, p.r, 0, 6.283);
        ctx.fillStyle = 'rgba(' + RL + ',' + (p.a * tw) + ')';
        ctx.fill();

        if (p.r > 1.2) {
          ctx.beginPath(); ctx.arc(dx, dy, p.r * 3.2, 0, 6.283);
          ctx.fillStyle = 'rgba(' + R + ',' + (p.a * tw * .13) + ')';
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(loop);
    }

    size(); seed();
    addEventListener('resize', function () { size(); seed(); });
    if (!reduce && !raf) raf = requestAnimationFrame(loop);
    return { stop: function () { if (raf) cancelAnimationFrame(raf), raf = 0; } };
  }

  /* ---------- parallax da camada ---------- */
  var afix = null;
  function tickFix() {
    if (!afix || reduce) return;
    afix.style.transform = 'translate(' + (cmx * 34) + 'px,' + (cmy * 28) + 'px)';
    requestAnimationFrame(tickFix);
  }

  function el(cls, html) {
    var d = document.createElement('div');
    d.className = cls;
    if (html) d.innerHTML = html;
    return d;
  }

  function mount() {
    if (!document.body) return;

    afix = el('vz-afix');
    afix.appendChild(el('vz-glow'));
    afix.appendChild(el('vz-ray l', '<i></i>'));
    afix.appendChild(el('vz-ray r', '<i></i>'));
    afix.appendChild(el('vz-floor'));

    var canvas = document.createElement('canvas');
    canvas.className = 'vz-parts';
    afix.appendChild(canvas);

    document.body.insertBefore(afix, document.body.firstChild);
    particles(canvas);
    tickFix();
  }

  window.AURA = { version: 3, always: true };

  if (document.readyState !== 'loading') mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
