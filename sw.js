'use strict';
const CACHE='number-houses-v11';
const ROOT=new URL('./',self.location.href).href;
const FILES=['index.html','manifest.webmanifest','icon.svg','icon.png'].map(p=>new URL(p,ROOT).href);
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(async cache=>{
 // The full game is one HTML file. Optional icons must not prevent saving it.
 const response=await fetch(new Request(new URL('index.html',ROOT).href,{cache:'reload'}));
 if(!response.ok)throw new Error('Game download failed');
 const html=await response.clone().text();
 if(!html.includes('data-version="11"')||!html.includes('id="gameArea"'))throw new Error('Incomplete game');
 await cache.put(new URL('index.html',ROOT).href,response);
 await Promise.race([Promise.all(FILES.slice(1).map(file=>cache.add(file).catch(()=>{}))),new Promise(resolve=>setTimeout(resolve,2500))]);
}).then(()=>self.skipWaiting()))});
self.addEventListener('message',event=>{
 if(!event.data||event.data.type!=='VERIFY_OFFLINE'||!event.ports[0])return;
 event.waitUntil(caches.open(CACHE).then(cache=>cache.match(new URL('index.html',ROOT).href)).then(async response=>{
  const html=response&&await response.text();event.ports[0].postMessage({version:11,ready:!!(html&&html.includes('data-version="11"')&&html.includes('id="gameArea"'))});
 }).catch(()=>event.ports[0].postMessage({version:11,ready:false})));
});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('number-houses-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin)return;
 if(req.mode==='navigate'){
  // Saved game launch is entirely local. No background refresh holds Safari open.
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(new URL('index.html',ROOT).href)).then(saved=>saved||fetch(req)));return;
 }
 if(FILES.includes(url.href))event.respondWith(caches.open(CACHE).then(cache=>cache.match(req)).then(saved=>saved||fetch(req)));
});
