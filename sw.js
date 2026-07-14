/* ============================================================
   VIZIO Money — service worker  ·  v0.3
   Estratégia: NETWORK-FIRST para o próprio código (HTML/CSS/JS/SVG),
   com o cache servindo apenas de rede de segurança offline.

   Por quê: o padrão AURA v3 (seção 5) alerta que sw.js cache-first
   "faz o navegador continuar servindo o antigo — inclusive para você,
   testando". Isso aconteceu de verdade aqui (o app abriu com o tema
   antigo depois de um deploy). Cache-first é ótimo para asset imutável
   e péssimo para app que muda toda hora. Invertido de propósito.
   ============================================================ */
const CACHE = 'vizio-money-v0.5';
const ASSETS = [
  './', './index.html', './landing.html', './brand.css', './aura.js', './auth.js',
  './brand/logo.svg', './manifest.webmanifest'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS).catch(() => {}))  // um asset faltando não derruba a instalação
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // CDN/fonts/Supabase: deixa passar

  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>                                   // offline: cai no cache
        caches.match(req).then(hit => hit || caches.match('./index.html'))
      )
  );
});
