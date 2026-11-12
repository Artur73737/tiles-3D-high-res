// Routing through a CORS proxy (serve.py: 'http://host:port/proxy?url='). A proxy that lists the hosts
// it forwards (serve.py's /proxy/health) only receives requests for those hosts; everything else goes
// direct, so an older or narrower proxy cannot break the requests it does not handle.
// proxy: {url, hosts: string[] | null (null: every host)} | null
export function routeUrl(url,proxy){
 if(!proxy?.url)return url;
 if(proxy.hosts){let host;try{host=new URL(url).hostname;}catch{return url;}if(!proxy.hosts.includes(host))return url;}
 return proxy.url+encodeURIComponent(url);
}

// A proxy that cannot be reached (serve.py stopped or restarting) is skipped for DOWN_MS: requests go
// direct meanwhile, then the proxy is tried again. Only a failure to reach the proxy itself counts; an
// HTTP answer from it (even an error) means it is up.
const DOWN_MS=30000,down=new Map();
export const proxyIsDown=url=>{const t=down.get(url);if(t==null)return false;if(Date.now()-t>DOWN_MS){down.delete(url);return false;}return true;};

export async function fetchVia(fetcher,url,init,proxy){
 const routed=proxy?.url&&!proxyIsDown(proxy.url)?routeUrl(url,proxy):url;
 if(routed===url)return fetcher(url,init);
 try{return await fetcher(routed,init);}
 catch(e){if(e?.name==='AbortError'||init?.signal?.aborted)throw e;down.set(proxy.url,Date.now());return fetcher(url,init);}
}

// Reads a serve.py-style health endpoint: {ok, hosts}. Returns {url, hosts} or null.
export async function discoverProxy(base,{fetch:fetcher=globalThis.fetch,timeoutMs=3000}={}){
 const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),timeoutMs);
 try{const r=await fetcher(new URL('proxy/health',base),{signal:ctl.signal});if(!r.ok)return null;const j=await r.json();
  return j?.ok?{url:new URL('proxy?url=',base).href,hosts:Array.isArray(j.hosts)?j.hosts:null}:null;}
 catch{return null;}finally{clearTimeout(t);}
}
