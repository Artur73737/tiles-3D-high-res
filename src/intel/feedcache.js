// Persistent cache for feeds with a download policy (CelesTrak: one download per group every 2 h).
// A copy younger than minAgeMs is used without asking the service; an older one is refreshed, and if the
// service refuses or fails, the saved copy (up to maxAgeMs old) is used instead.
import {ResilientByteCache} from '../core/net/cache.js';
import {fetchJson} from './layer.js';

let shared=null;
const cache=()=>shared??=new ResilientByteCache({name:'tiles-intel-v1',maxBytes:64*1024*1024,memoryBytes:16*1024*1024});
const enc=new TextEncoder(),dec=new TextDecoder();

// Returns {data, fetchedAt, fromCache}.
export async function cachedJson(url,{minAgeMs,maxAgeMs,signal,timeoutMs,store=cache()}){
 let saved=null;try{saved=await store.get(url);}catch{}
 const age=saved?Date.now()-saved.fetchedAt:Infinity,read=()=>JSON.parse(dec.decode(saved.bytes));
 if(saved&&age<minAgeMs)return {data:read(),fetchedAt:saved.fetchedAt,fromCache:true};
 try{
  const data=await fetchJson(url,{signal,timeoutMs}),fetchedAt=Date.now(),bytes=enc.encode(JSON.stringify(data)).buffer;
  try{await store.put(url,{bytes,fetchedAt,expiresAt:fetchedAt+maxAgeMs,url});}catch{}
  return {data,fetchedAt,fromCache:false};
 }catch(e){
  if(e?.name==='AbortError'||!saved)throw e;
  return {data:read(),fetchedAt:saved.fetchedAt,fromCache:true,error:e};
 }
}
