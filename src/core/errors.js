export class TileError extends Error {
 constructor(code,message,details={}){super(message);this.name='TileError';this.code=code;this.details=details;}
}
export function aborted(){return new DOMException('Operation canceled','AbortError');}
export const isAbort=error=>error?.name==='AbortError';
