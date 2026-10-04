// Bump this version whenever the app shell changes in a deployment.
const CACHE_PREFIX='kids-sleep-rotation-';
const CACHE=CACHE_PREFIX+'v5';
const SCOPE=self.registration.scope;
const SHELL=new URL('index.html',SCOPE).href;
const ASSETS=['./','index.html','manifest.webmanifest','icon.svg']
  .map(path=>new URL(path,SCOPE).href);
const ASSET_URLS=new Set(ASSETS);
const NETWORK_TIMEOUT_MS=4000;

self.addEventListener('install',event=>{
  // A failed precache leaves the existing worker active. Do not skipWaiting:
  // activate an update only after all pages using the old worker are closed.
  event.waitUntil(caches.open(CACHE).then(cache=>
    cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'})))
  ));
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE)
      .map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  // Handle only our app shell. Supabase, POSTs, and unrelated origin resources
  // go directly to the network; never cache API responses or confirmations.
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  url.search='';
  url.hash='';
  if(!ASSET_URLS.has(url.href))return;
  const cacheKey=(url.href===SCOPE||url.href===SHELL)?SHELL:url.href;
  const result=networkFirst(request,cacheKey);
  event.respondWith(result.then(value=>value.response));
  // Keep the worker alive until the cache write completes, not a detached promise.
  event.waitUntil(result.then(value=>value.saved).catch(()=>{}));
});

async function networkFirst(request,cacheKey){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),NETWORK_TIMEOUT_MS);
  try{
    const response=await fetch(request,{cache:'no-store',signal:controller.signal});
    const isHTML=cacheKey===SHELL;
    if(!response.ok||response.redirected||
      (isHTML&&!response.headers.get('content-type')?.includes('text/html'))){
      const cached=await cachedResponse(cacheKey);
      return {response:cached||response};
    }
    const copy=response.clone();
    const saved=caches.open(CACHE).then(cache=>cache.put(cacheKey,copy)).catch(()=>{});
    return {response,saved};
  }catch(error){
    const cached=await cachedResponse(cacheKey);
    if(cached)return {response:cached};
    throw error;
  }finally{clearTimeout(timeout)}
}

async function cachedResponse(cacheKey){
  const cache=await caches.open(CACHE);
  // Never fall back to another version's cache or store query/share URLs.
  return cache.match(cacheKey);
}
