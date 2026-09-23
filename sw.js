const CACHE='schedule-app-v0.4.2';
const SHELL=['./','./index.html','./styles.css','./app.js','./rules-editor.js','./schedule-v03.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];

self.addEventListener('install',event=>
  event.waitUntil(
    caches.open(CACHE)
      .then(c=>c.addAll(SHELL))
      .then(()=>self.skipWaiting())
  )
);

self.addEventListener('activate',event=>
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  )
);

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);

  if(url.pathname.endsWith('/schedule-data.json') || url.pathname.endsWith('schedule-data.json')){
    event.respondWith(
      fetch(event.request)
        .then(res=>{
          const copy=res.clone();
          caches.open(CACHE).then(c=>c.put(event.request,copy));
          return res;
        })
        .catch(()=>caches.match(event.request))
    );
    return;
  }

  if(event.request.mode==='navigate'){
    event.respondWith(
      fetch(event.request,{cache:'no-store'})
        .then(res=>{
          const copy=res.clone();
          caches.open(CACHE).then(c=>c.put('./index.html',copy));
          return res;
        })
        .catch(()=>caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached=>
      cached || fetch(event.request).then(res=>{
        const copy=res.clone();
        caches.open(CACHE).then(c=>c.put(event.request,copy));
        return res;
      })
    )
  );
});
