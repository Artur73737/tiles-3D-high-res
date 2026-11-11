// Device class for the viewer: 'desktop' (mouse and keyboard), 'tablet' or 'mobile' (touch).
// A touch device is one whose primary pointer is coarse, or that has touch points and no fine
// pointer at all. Tablet vs mobile is decided by the shorter screen side, so rotating the
// device does not switch class.
export const DEVICES=['desktop','tablet','mobile'];

export function detectDevice(win,override='auto'){
 if(DEVICES.includes(override))return override;
 const mq=q=>{try{return win.matchMedia?.(q).matches??false;}catch{return false;}};
 const touchPoints=win.navigator?.maxTouchPoints??0;
 const touch=mq('(pointer: coarse)')||(touchPoints>0&&!mq('(any-pointer: fine)'));
 if(!touch)return 'desktop';
 const w=win.screen?.width||win.innerWidth,h=win.screen?.height||win.innerHeight;
 return Math.min(w,h)<600?'mobile':'tablet';
}

export const inputOf=device=>device==='desktop'?'mouse':'touch';
