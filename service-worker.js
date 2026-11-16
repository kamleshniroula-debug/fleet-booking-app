/* Cache only application shell. Never cache customer IDs, OneDrive responses, or workbooks. */
const CACHE='pvr-shell-v1';
const SHELL=['./','./index.html','./jszip.min.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;const url=new URL(req.url);if(!SHELL.some(path=>new URL(path,self.registration.scope).pathname===url.pathname))return;event.respondWith(fetch(req).catch(()=>caches.match(req)));});
