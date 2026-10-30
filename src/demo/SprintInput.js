export class SprintInput {
 constructor({doubleTapMs=300}={}){this.keys={};this.doubleTapMs=doubleTapMs;this.lastForward=-Infinity;}
 down(code,time,repeat=false){if(code==='KeyW'&&!repeat&&!this.keys.KeyW){this.keys.sprint=time-this.lastForward<=this.doubleTapMs;this.lastForward=time;}this.keys[code]=true;}
 up(code){this.keys[code]=false;if(code==='KeyW')this.keys.sprint=false;}
 reset(){for(const code of Object.keys(this.keys))this.keys[code]=false;this.lastForward=-Infinity;}
}
