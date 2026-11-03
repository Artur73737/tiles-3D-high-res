const f=Math.fround;
const clamp=value=>Math.max(0,Math.min(1,value));

// TimeFadeMetric (shipping WASM 8336/12315). Keep f32 operations at the
// original boundaries; time storage and duration interpolation are f64.
export class TileFade {
 constructor(){this.alpha=0;this.threshold=-1;this.anchor=0;this.lastTime=-1;this.start=-1;this.point=null;this.dependencyFrame=-1;}
 reset(visible){this.alpha=visible?1:0;this.anchor=f(this.threshold+(visible?2:-2));this.start=-1;return this.alpha;}
 update(score,now){
  score=f(score);if(now<=this.lastTime)return this.alpha;this.lastTime=now;
  const lower=f(this.threshold-2),upper=f(this.threshold+2);
  if(score<=lower||(score<=this.threshold&&this.alpha===0))return this.reset(false);
  if(score>=upper||(score>=this.threshold&&this.alpha===1))return this.reset(true);
  const q=clamp(Math.abs(f(this.anchor-this.threshold))/2),duration=(1-q)+q*.5;
  if((score>this.threshold)===(this.anchor<=this.threshold)||this.start===-1){this.anchor=score;this.start=now-.05*duration;}
  const time=clamp(f(f(f(now)-f(this.start))/f(f(this.start+duration)-f(this.start))));
  if(this.anchor>=this.threshold){
   const spatial=score<=this.anchor?0:f(f(score-this.anchor)/f(upper-this.anchor));
   this.alpha=Math.max(this.alpha,spatial,time);
   if(this.alpha===1)this.reset(true);
  }else{
   // Preserve the compiled branch ordering, including its endpoint comparisons.
   const spatial=score<=this.anchor?0:score>=lower?1:f(f(score-this.anchor)/f(lower-this.anchor));
   this.alpha=Math.min(this.alpha,f(1-Math.max(spatial,time)));
   if(this.alpha===0)this.reset(false);
  }
  return this.alpha;
 }
 pair(score,now,point,frame){
  const previous=this.lastFrame===frame-1?this.point:null;this.lastFrame=frame;
  const alpha=this.update(score,now);
  if(alpha===0){this.point=null;return {current:false,blend:0};}
  if(alpha===1){this.point=null;return {current:true,blend:0};}
  this.point=point;
  if(previous&&point&&(f(f(point.x-previous.x)**2+f(point.y-previous.y)**2)>f(f(.1)*f(.1)))){this.reset(true);return {current:true,blend:0};}
  const x=clamp(alpha),s=f(f(x*x)*f(3-f(2*x)));
  return s<.5?{current:false,blend:f(f(2*s)+f(f(1-f(2*s))/64))}:{current:true,blend:f(f(2-f(2*s))+f(f(f(2*s)-1)/64))};
 }
}
