// Request priority: a number or a tuple of numbers compared left to right, higher first.
// Example: [tier, -distanceMeters] serves every tile of a higher tier before any lower one,
// and nearer tiles first within a tier.
export function compareRequestPriority(a,b){
 const x=Array.isArray(a)?a:[a??0],y=Array.isArray(b)?b:[b??0];
 for(let i=0;i<Math.max(x.length,y.length);i++)if((x[i]??0)!==(y[i]??0))return (y[i]??0)-(x[i]??0);
 return 0;
}
