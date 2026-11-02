import decode from './vendor/rocktree-decoder.cjs';
self.onmessage=async({data:{id,command,bytes}})=>{
 try{
  const result=await decode(command,new Uint8Array(bytes)),buffers=new Set();
  const collect=value=>{if(ArrayBuffer.isView(value))buffers.add(value.buffer);else if(value instanceof ArrayBuffer)buffers.add(value);else if(value&&typeof value==='object')for(const child of Object.values(value))collect(child);};
  collect(result.payload);self.postMessage({id,payload:result.payload},[...buffers]);
 }catch(error){self.postMessage({id,error:error.message});}
};
