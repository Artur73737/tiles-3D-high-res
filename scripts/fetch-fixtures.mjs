import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const directory=new URL('../test/fixtures/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',directory),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(directory,{recursive:true});
for(const entry of manifest){
 const destination=new URL(entry.file,directory);
 let existing;
 try{existing=await readFile(destination);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(existing){
  if(existing.length!==entry.bytes||digest(existing)!==entry.sha256)throw Error('Existing fixture differs from its recorded capture: '+entry.file);
  console.log('Verified '+entry.file);continue;
 }
 const response=await fetch(entry.url,{signal:AbortSignal.timeout(30000),credentials:'omit'});
 if(!response.ok)throw Error(entry.file+': HTTP '+response.status);
 const chunks=[];let length=0;
 for await(const chunk of response.body){length+=chunk.length;if(length>entry.bytes)throw Error(entry.file+': service response changed; expected the pinned capture');chunks.push(chunk);}
 const bytes=Buffer.concat(chunks);
 if(length!==entry.bytes||digest(bytes)!==entry.sha256)throw Error(entry.file+': SHA-256 mismatch; service response is no longer the pinned capture');
 await writeFile(destination,bytes,{flag:'wx'});console.log('Downloaded and verified '+entry.file);
}
