// Viewer document (rendered inside the iframe created by createViewer).
// Layout: navbar (full width) / left sidebar (layers, enhance) / main view + footer / right sidebar
// (options). Corners get a 7px radius only where they do not touch the window edges.
import {LOGO_SVG,LOGO_FAVICON} from './logo.js';
export const CSS=`
:root{--bg:#383838;--panel:#0e0e0e;--raise:#171717;--line:#222;--line2:#323232;--text:#d8d8d8;--dim:#767676;--hi:#fff;--warn:#d9a53f;--err:#e5484d;--h:28px;--r:7px;--gap:4px;--mono:ui-monospace,'SF Mono','Cascadia Mono',Consolas,monospace}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font:12px/1.4 var(--mono);overflow:hidden;-webkit-font-smoothing:antialiased}
button,input{font:inherit;color:var(--text);background:#080808;border:1px solid var(--line2);outline:0;margin:0;border-radius:var(--r)}
button{height:var(--h);padding:0 11px;cursor:pointer;white-space:nowrap;text-transform:uppercase;letter-spacing:.08em;font-size:11px;flex:none;display:inline-flex;align-items:center;justify-content:center;gap:8px}
button:hover{color:var(--hi);border-color:var(--dim)}button.on{background:var(--hi);color:#000;border-color:var(--hi)}button:focus-visible,input:focus{border-color:var(--hi);position:relative;z-index:1}
button:disabled{opacity:.32;cursor:not-allowed;color:var(--dim)}button:disabled:hover{border-color:var(--line2)}
input{height:var(--h);padding:0 9px;width:100%;min-width:0;font-variant-numeric:tabular-nums}input::placeholder{color:#4a4a4a}
/* joined controls: only the outer corners are rounded */
.group,.step{display:flex;flex:none}.group>*,.step>*{border-radius:0}.group>*+*,.step>*+*{margin-left:-1px}
.group>:first-child,.step>:first-child{border-top-left-radius:var(--r);border-bottom-left-radius:var(--r)}.group>:last-child,.step>:last-child{border-top-right-radius:var(--r);border-bottom-right-radius:var(--r)}
/* layout */
.app{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-rows:44px minmax(0,1fr);gap:var(--gap);height:100%}
header{grid-column:1/4;display:flex;align-items:center;gap:8px;padding:0 8px;background:var(--panel);border-bottom:1px solid var(--panel);overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.brand{color:var(--hi);letter-spacing:.3em;font-size:11px;padding:0 8px 0 2px;flex:none;display:inline-flex;align-items:center;gap:9px}.brand .logo{display:block;flex:none}
.grow{flex:1}
.side{grid-row:2;width:268px;overflow:auto;background:var(--panel);scrollbar-width:thin;scrollbar-color:var(--line2) transparent}
#left{grid-column:1;border:1px solid var(--panel);border-width:1px 1px 0 0;border-top-right-radius:var(--r)}
#right{grid-column:3;width:300px;border:1px solid var(--panel);border-width:1px 0 0 1px;border-top-left-radius:var(--r)}
.no-left #left,.no-right #right{display:none}
.center{grid-column:2;grid-row:2;display:grid;grid-template-rows:minmax(0,1fr) 24px;gap:var(--gap);min-width:0;min-height:0}
.stage{position:relative;min-width:0;min-height:0;background:#000;border:0;border-radius:var(--r);overflow:hidden}
.stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block;border:0;outline:0}.stage canvas:focus,.stage canvas:focus-visible{outline:0;box-shadow:none}
footer{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 10px;background:var(--panel);border:1px solid var(--panel);border-bottom:0;border-radius:var(--r) var(--r) 0 0;font-size:11px;color:var(--dim);min-width:0}
/* a closed sidebar puts the centre against the window edge: those corners become square */
.no-left .center{grid-column:1/3}.no-right .center{grid-column:2/4}.no-left.no-right .center{grid-column:1/4}
.no-left .stage{border-top-left-radius:0;border-bottom-left-radius:0;border-left:0}.no-left footer{border-top-left-radius:0;border-left:0}
.no-right .stage{border-top-right-radius:0;border-bottom-right-radius:0;border-right:0}.no-right footer{border-top-right-radius:0;border-right:0}
#map2d{touch-action:none;cursor:crosshair}
.app[data-mode="2d"] #view3d,.app:not([data-mode="2d"]) #map2d{display:none}
.app[data-mode="2d"] .m3,.app:not([data-mode="2d"]) .m2,.app:not([data-mode="fly"]) .mf,.app[data-mode="fly"] .nf,.hide{display:none!important}
.app[data-view="globe"] #map2d{display:none!important}.app[data-view="globe"][data-mode] #view3d{display:block}
.app[data-view="globe"] .vf,.app:not([data-view="globe"]) .vg{display:none!important}
.app[data-view="globe"][data-mode="fly"] .help.vg.nf{display:none!important}
/* search */
.search{display:flex;flex:none;width:300px}.search input{border-radius:var(--r) 0 0 var(--r)}.search button{border-radius:0 var(--r) var(--r) 0;margin-left:-1px}
/* panels */
section{border-bottom:1px solid var(--line);padding:11px 12px}
h3{margin:0 0 9px;font-size:10px;font-weight:400;letter-spacing:.24em;color:var(--dim);text-transform:uppercase;display:flex;align-items:center;justify-content:space-between;gap:8px}
h3 button{height:22px;padding:0 9px;font-size:10px}
.row{display:grid;grid-template-columns:100px minmax(0,1fr);align-items:center;gap:8px;margin:0 0 6px}.row>.k{color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row.wide{grid-template-columns:1fr;gap:2px}.row.wide .checks{grid-template-columns:1fr 1fr}.row.top{align-items:start}.row.top>.k{line-height:var(--h)}
.row.off{opacity:.32;pointer-events:none}
.step input{text-align:center}.step button{width:var(--h);padding:0;font-size:14px;letter-spacing:0}
.checks{display:grid;grid-template-columns:1fr 1fr;gap:7px 10px;padding:7px 0}
.ck{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;min-width:0}.ck span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.box{width:12px;height:12px;border:1px solid var(--dim);flex:none;border-radius:3px}.ck[aria-checked="true"] .box{background:var(--hi);border-color:var(--hi)}.ck:focus-visible{outline:1px solid var(--hi);outline-offset:2px;border-radius:3px}
.dd{position:relative;min-width:0}.dd>button{width:100%;justify-content:space-between;text-transform:none;letter-spacing:0;font-size:12px;padding:0 10px}
.dd>button span{overflow:hidden;text-overflow:ellipsis}.dd>button i{width:7px;height:7px;border-right:1px solid var(--dim);border-bottom:1px solid var(--dim);transform:translateY(-2px) rotate(45deg);flex:none}
.dd.open>button{border-color:var(--hi)}.dd.open>button i{transform:translateY(2px) rotate(-135deg)}
.menu{position:fixed;z-index:20;background:var(--raise);border:1px solid var(--line2);border-radius:var(--r);max-height:300px;overflow-x:hidden;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--line2) transparent;padding:4px;margin:0;list-style:none;box-shadow:0 12px 32px rgba(0,0,0,.7)}
.menu li{height:var(--h);display:flex;align-items:center;gap:10px;padding:0 9px;cursor:pointer;white-space:nowrap;color:var(--text);border-radius:5px;min-width:0}.menu li>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}.menu li small{flex:none;max-width:48%;overflow:hidden;text-overflow:ellipsis}
.menu li small{color:var(--dim);margin-left:auto;font-size:10px;letter-spacing:.06em}
.menu li[aria-selected="true"]{color:var(--hi)}.menu li[aria-selected="true"]:before{content:'';width:5px;height:5px;background:var(--hi);border-radius:50%}
.menu li.act{background:#2a2a2a}.menu .empty{color:var(--dim);cursor:default}
.hint{color:var(--dim);font-size:11px;margin:6px 0 0}
.actions{display:flex;gap:8px;padding:12px}.actions>*{flex:1}
#status{white-space:pre;overflow:hidden;text-overflow:ellipsis;color:var(--text);font-variant-numeric:tabular-nums}#status.warn{color:var(--warn)}#status.err{color:var(--err)}#fps{flex:none;color:var(--dim);font-variant-numeric:tabular-nums}#attrib{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%}
/* overlays inside the main view */
.navctl{position:absolute;right:10px;bottom:10px;display:flex;flex-direction:column;z-index:2}
.navctl button{width:32px;height:32px;padding:0;font-size:16px;letter-spacing:0;background:rgba(8,8,8,.82);backdrop-filter:blur(4px);border-radius:0}.navctl button+button{margin-top:-1px}
.navctl button:first-child{border-radius:var(--r) var(--r) 0 0}.navctl button:last-child{border-radius:0 0 var(--r) var(--r)}
#north{font-size:10px;font-weight:600}#needle{display:block;position:relative;line-height:1;transition:transform .12s linear}#needle:before{content:"";position:absolute;left:50%;top:-7px;margin-left:-3px;border:3px solid transparent;border-bottom:4px solid #e5484d;border-top:0}
.help{position:absolute;left:10px;top:10px;right:56px;display:flex;flex-wrap:wrap;gap:6px;pointer-events:none;z-index:1}.help>span:not(.hk){display:contents}
.hk{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px 0 4px;background:rgba(12,12,12,.92);backdrop-filter:blur(6px);border:1px solid #2a2a2a;border-radius:var(--r);color:#d6d6d6;font-size:11px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.45)}
.hk kbd{font:inherit;font-size:10px;color:var(--hi);min-width:18px;height:17px;padding:0 5px;display:inline-flex;align-items:center;justify-content:center;background:#262626;border-bottom:1px solid #444;border-radius:4px;letter-spacing:.04em}.hk i{font-style:normal;color:#8a8a8a;margin:0 -2px}.hk em{font-style:normal;margin-left:2px}
/* Crosshair: the backdrop under each line is inverted and thresholded, so it is light over dark imagery and dark over light imagery. */
.cross{position:absolute;left:50%;top:50%;width:13px;height:13px;margin:-6px 0 0 -6px;pointer-events:none;z-index:1}.cross:before,.cross:after{content:'';position:absolute;background:transparent;-webkit-backdrop-filter:invert(1) grayscale(1) contrast(100);backdrop-filter:invert(1) grayscale(1) contrast(100)}.cross:before{left:6px;top:0;width:1px;height:13px}.cross:after{left:0;top:6px;width:13px;height:1px}
@media (max-width:820px){.app[data-input="mouse"] .side{position:absolute;top:48px;bottom:0;z-index:6;width:min(300px,86vw)}.app[data-input="mouse"] #left{left:0}.app[data-input="mouse"] #right{right:0}.app[data-input="mouse"] .center{grid-column:1/4!important}.app[data-input="mouse"] .search{width:200px}}
/* ---------- intelligence and tools (left sidebar, overlay, popup) ---------- */
.intel-group{margin:10px 0 4px;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#555}
.intel-layer{display:flex;align-items:center;justify-content:space-between;gap:8px}.intel-layer .checks{padding:4px 0;flex:1}
.badge{font-size:10px;color:var(--dim);font-variant-numeric:tabular-nums;white-space:nowrap}.badge.err{color:var(--err);cursor:help}
.intel-opts{margin:2px 0 8px 20px;padding-left:10px;border-left:1px solid var(--line)}.intel-opts .row{grid-template-columns:84px minmax(0,1fr)}.intel-opts .hint{margin:2px 0 4px}
.tool-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.tool-grid button{padding:0 6px;font-size:10px}
.tool-hint{min-height:28px}.tool-draft{padding:0 0 8px}.tool-io{padding:8px 0 0}.tool-io button{padding:0 6px;font-size:10px}
.tool-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto;scrollbar-width:thin}
.tool-list li{background:#121212;border:1px solid var(--line);border-radius:var(--r);padding:6px 7px;cursor:pointer}.tool-list li.sel{border-color:var(--dim)}
.tl-top{display:flex;align-items:center;gap:6px}.tl-top i{width:8px;height:8px;border-radius:2px;flex:none}.tl-top input{height:24px;padding:0 6px;background:transparent;border-color:transparent}.tl-top input:focus{border-color:var(--line2)}
.tl-top button{width:24px;height:24px;padding:0;font-size:13px;letter-spacing:0}.tool-list small{display:block;color:var(--dim);margin:3px 0 0 14px;font-size:10px;line-height:1.35}.tool-list small.err{color:var(--err)}
.profile-chart:not(:empty){margin-top:8px;background:#0a0a0a;border:1px solid var(--line);border-radius:var(--r);padding:4px}
.intel-popup{position:absolute;right:10px;top:10px;width:min(300px,calc(100% - 20px));max-height:calc(100% - 20px);overflow:auto;z-index:4;background:rgba(12,12,12,.94);backdrop-filter:blur(6px);border:1px solid #2a2a2a;border-radius:var(--r);box-shadow:0 6px 24px rgba(0,0,0,.55);padding:8px 10px;font-size:11px}
.ip-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.ip-head b{color:var(--hi);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ip-head button{width:22px;height:22px;padding:0;font-size:13px}
.intel-popup dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 10px;margin:0}.intel-popup dt{color:var(--dim)}.intel-popup dd{margin:0;overflow-wrap:anywhere}.intel-popup a{color:#64d2ff}
.ip-coords{margin-top:6px;color:var(--dim);font-variant-numeric:tabular-nums}
.app.tool-on .stage,.app.tool-on #map2d{cursor:crosshair}
.app[data-input="touch"] .intel-popup{left:8px;right:8px;top:auto;bottom:8px;width:auto;max-height:45%}
.app[data-input="touch"] .tool-grid button,.app[data-input="touch"] .tool-io button{font-size:11px}
/* ---------- touch devices (tablet, mobile). Desktop rules above are unchanged. ---------- */
.flypad,.scrim,.help.touch{display:none}
.app[data-input="touch"]{--h:38px;grid-template-rows:auto minmax(0,1fr)}
html:has(.app[data-input="touch"]),body:has(.app[data-input="touch"]){overscroll-behavior:none;-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%}
.app[data-input="touch"] button{font-size:12px;touch-action:manipulation}
.app[data-input="touch"] input{font-size:16px}
.app[data-input="touch"] header{flex-wrap:wrap;overflow:visible;padding:7px 8px;gap:7px;user-select:none;-webkit-user-select:none}
/* phones and tablets: the mark only, the word needs the room */
.app[data-input="touch"] .brand{order:0;padding:0 2px;gap:0}.app[data-input="touch"] .brand>span{display:none}
.app[data-input="touch"] #toggleLeft{order:1}.app[data-input="touch"] .search{order:2;flex:1 1 0;width:auto;min-width:0}.app[data-input="touch"] #toggle{order:3}
.app[data-input="touch"] .grow{order:4;flex-basis:100%;height:0}
.app[data-input="touch"] header .group{order:5;flex:1 1 auto}.app[data-input="touch"] header .group>*{flex:1}
.app[data-input="touch"] header .group.m2{order:6}
.app[data-device="tablet"] header .group{flex:0 1 auto}.app[data-device="tablet"] header .group>*{flex:none;min-width:64px}
.app[data-input="touch"] .center{grid-column:1/4!important}
.app[data-input="touch"] .stage,.app[data-input="touch"] footer{border-radius:0;border-left:0;border-right:0}
.app[data-input="touch"] footer{padding:0 10px}
/* sidebars become drawers over the view; one open at a time, tapping the scrim closes them */
.app[data-input="touch"] .side{position:fixed;top:var(--top,96px);bottom:0;z-index:30;width:min(340px,88vw);overscroll-behavior:contain;-webkit-overflow-scrolling:touch;box-shadow:0 0 32px rgba(0,0,0,.6)}
.app[data-input="touch"] #left{left:0;border-radius:0 var(--r) 0 0}
.app[data-input="touch"] #right{right:0;border-radius:var(--r) 0 0 0}
.app[data-input="touch"] .scrim{position:fixed;left:0;right:0;bottom:0;top:var(--top,96px);z-index:25;background:rgba(0,0,0,.5)}
.app[data-input="touch"]:not(.no-left) .scrim,.app[data-input="touch"]:not(.no-right) .scrim{display:block}
.app[data-input="touch"] .row{grid-template-columns:112px minmax(0,1fr);margin-bottom:8px}.app[data-input="touch"] .checks{gap:12px 10px}
.app[data-input="touch"] .box{width:16px;height:16px}.app[data-input="touch"] .menu li{height:40px}
.app[data-input="touch"] .menu{max-height:min(320px,50vh)}
/* overlays in the view */
.app[data-input="touch"] .navctl{right:12px;bottom:12px}.app[data-input="touch"] .navctl button{width:44px;height:44px;font-size:18px}
/* touch hints replace the mouse ones; mode / view classes still decide which one shows */
.app[data-input="touch"] .help:not(.touch){display:none!important}
.app[data-input="touch"] .help.touch{display:flex;right:66px;transition:opacity .4s}.app[data-input="touch"]:not(.hints-on) .help.touch{opacity:0}
.app[data-input="touch"] .hk{height:28px;font-size:12px}
.app[data-input="touch"][data-mode="fly"] .flypad{display:flex}
.flypad{position:absolute;left:14px;bottom:14px;align-items:flex-end;gap:12px;z-index:3;touch-action:none;user-select:none;-webkit-user-select:none}
.stick{width:124px;height:124px;border-radius:50%;background:rgba(12,12,12,.6);border:1px solid #3a3a3a;position:relative;backdrop-filter:blur(4px);touch-action:none}
.stick i{position:absolute;left:50%;top:50%;width:50px;height:50px;margin:-25px;border-radius:50%;background:rgba(255,255,255,.88);box-shadow:0 2px 10px rgba(0,0,0,.5);pointer-events:none}
.updown{display:flex;flex-direction:column;gap:8px}.updown button{width:50px;height:50px;padding:0;font-size:16px;background:rgba(8,8,8,.82);backdrop-filter:blur(4px)}
/* short landscape screens (phone on its side): one header row so the view keeps its height */
@media (orientation:landscape) and (max-height:500px){.app[data-input="touch"]{--h:36px}.app[data-input="touch"] header{flex-wrap:nowrap;padding:5px 8px;gap:6px}.app[data-input="touch"] .grow{display:none}.app[data-input="touch"] header .group{order:2;flex:none}.app[data-input="touch"] header .group>*{flex:none;padding:0 10px}.app[data-input="touch"] .search{order:3;min-width:120px}.app[data-input="touch"] header .group.m2{order:4}.app[data-input="touch"] #toggle{order:5}}
@media (orientation:landscape) and (max-height:500px){.app[data-input="touch"] .stick{width:104px;height:104px}.app[data-input="touch"] .updown button{width:44px;height:44px}}
`;
export const HTML=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tiles</title><link rel="icon" type="image/svg+xml" href="${LOGO_FAVICON}"><style>${CSS}</style></head><body>
<div class="app" id="app" data-mode="2d">
<header>
 <span class="brand">${LOGO_SVG}<span>TILES</span></span>
 <button id="toggleLeft" class="on" aria-label="Layers panel">Layers</button>
 <div class="group" role="tablist" aria-label="View"><button data-view="flat">Flat</button><button data-view="globe">Globe</button></div>
 <div class="group" role="tablist" aria-label="Mode"><button data-mode="2d">2D</button><button data-mode="3d">3D</button><button data-mode="fly">3D Fly</button></div>
 <div class="search" role="search"><input id="search" placeholder="Search a place" aria-label="Search a place" autocomplete="off" spellcheck="false"><button id="go" type="button">Go</button></div>
 <span class="grow"></span>
 <div class="group m2"><button id="maxzoom">Max zoom</button><button id="png">Export PNG</button></div>
 <button id="toggle" class="on" aria-label="Options panel">Options</button>
</header>
<aside class="side" id="left" aria-label="Layers"></aside>
<div class="center">
 <div class="stage" id="stage"><canvas id="map2d"></canvas><canvas id="view3d" tabindex="0"></canvas><div class="cross"></div>
  <div class="navctl"><button id="zin" type="button" aria-label="Zoom in">+</button><button id="zout" type="button" aria-label="Zoom out">−</button><button id="north" type="button" aria-label="Reset north"><span id="needle">N</span></button></div>
  <div class="help m2 vf"><span class="hk"><kbd>Drag</kbd><em>pan</em></span><span class="hk"><kbd>Wheel</kbd><em>zoom</em></span></div>
  <div class="help nf vg"><span class="hk"><kbd>Drag</kbd><em>pan</em></span><span class="hk"><kbd>Right drag</kbd><em>rotate + tilt</em></span><span class="hk"><kbd>Shift</kbd><i>/</i><kbd>Drag</kbd><em>rotate + tilt</em></span><span class="hk"><kbd>Wheel</kbd><em>zoom</em></span></div>
  <div class="help mf vg"><span class="hk"><kbd>Click</kbd><em>capture mouse</em></span><span class="hk"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><em>move</em></span><span class="hk"><kbd>E</kbd><i>/</i><kbd>Space</kbd><em>up</em></span><span class="hk"><kbd>Q</kbd><i>/</i><kbd>Ctrl</kbd><em>down</em></span><span class="hk"><kbd>Shift</kbd><em>×4 speed</em></span><span class="hk"><kbd>Wheel</kbd><em>set speed</em></span><span class="hk"><kbd>Esc</kbd><em>release</em></span></div>
  <div class="help touch m2 vf"><span class="hk"><kbd>Drag</kbd><em>pan</em></span><span class="hk"><kbd>Pinch</kbd><em>zoom</em></span></div>
  <div class="help touch m3 nf vf"><span class="hk"><kbd>Drag</kbd><em>orbit</em></span><span class="hk"><kbd>Pinch</kbd><em>zoom</em></span><span class="hk"><kbd>2-finger drag</kbd><em>pan</em></span></div>
  <div class="help touch nf vg"><span class="hk"><kbd>Drag</kbd><em>pan</em></span><span class="hk"><kbd>Pinch</kbd><em>zoom</em></span><span class="hk"><kbd>Twist</kbd><em>rotate</em></span><span class="hk"><kbd>2-finger drag</kbd><em>tilt</em></span></div>
  <div class="help touch mf"><span class="hk"><kbd>Stick</kbd><em>move</em></span><span class="hk"><kbd>Drag</kbd><em>look</em></span><span class="hk"><kbd>▲</kbd><i>/</i><kbd>▼</kbd><em>up / down</em></span></div>
  <div class="flypad" id="flypad"><div class="stick" id="stick"><i id="knob"></i></div><div class="updown"><button id="flyUp" type="button" aria-label="Fly up">▲</button><button id="flyDown" type="button" aria-label="Fly down">▼</button></div></div>
  <div class="help m3 vf"><span class="nf"><span class="hk"><kbd>Drag</kbd><em>orbit</em></span><span class="hk"><kbd>Right drag</kbd><em>pan</em></span><span class="hk"><kbd>Wheel</kbd><em>zoom</em></span></span><span class="mf"><span class="hk"><kbd>Click</kbd><em>capture mouse</em></span><span class="hk"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><em>move</em></span><span class="hk"><kbd>E</kbd><i>/</i><kbd>Space</kbd><em>up</em></span><span class="hk"><kbd>Q</kbd><i>/</i><kbd>Ctrl</kbd><em>down</em></span><span class="hk"><kbd>Shift</kbd><em>×4 speed</em></span><span class="hk"><kbd>Wheel</kbd><em>set speed</em></span><span class="hk"><kbd>Esc</kbd><em>release</em></span></span></div>
 </div>
 <footer><span id="status">Starting</span><span id="fps">— fps</span></footer>
</div>
<aside class="side" id="right" aria-label="Options"></aside>
<div class="scrim" id="scrim"></div>
</div></body></html>`;
