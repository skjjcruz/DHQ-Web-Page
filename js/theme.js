(function(){"use strict";const i=new Map;let n=null;function w(){return document.documentElement.getAttribute("data-wr-theme")||"default"}function b(d){return n||(n=document.createElement("span"),n.setAttribute("aria-hidden","true"),n.style.cssText="position:absolute!important;left:-99999px;top:0;width:0;height:0;pointer-events:none;",(document.body||document.documentElement).appendChild(n)),n.style.color="",n.style.color=d,getComputedStyle(n).color}window.wrAlpha=function(d,f){if(d==null||d==="")return d;const o=String(d),g=w()+"|"+o+"|"+f,m=i.get(g);if(m!==void 0)return m;let s;try{const c=b(o).match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/),u=Math.round(parseInt(f,16)/255*1e3)/1e3;s=c?`rgba(${c[1]}, ${c[2]}, ${c[3]}, ${u})`:o}catch{s=o}return i.set(g,s),s},window.addEventListener("wr_theme_changed",()=>i.clear())})(),(function(){"use strict";const i="wr_dashboard_theme",n="wr-theme-dynamic",w=new Set([]);function b(){const t=String(window.location.hostname||"").toLowerCase(),a=new URLSearchParams(window.location.search||"");return t.includes("sandbox")||a.has("dev")||a.get("mode")==="sandbox"||a.get("sandbox")==="true"}function d(t){return!!o[t]&&(!w.has(t)||b())}function f(t){return d(t)?t:"default"}const o={default:{id:"default",name:"Dynasty HQ",preview:"\u{1F3F4}",fonts:{display:"Rajdhani, sans-serif",ui:"'DM Sans', sans-serif",mono:"'JetBrains Mono', monospace",sizeScale:1},colors:{bg:"#08080B",card:"#121217",cardHover:"rgba(212,175,55,0.06)",accent:"#D4AF37",accentDark:"#B8941E",text:"#F5F2EA",textMuted:"#BDB8AD",textFaint:"rgba(189,184,173,0.62)",positive:"#2ECC71",negative:"#E74C3C",info:"#5DADE2",warn:"#F0A500",purple:"#9B8AFB",border:"rgba(212,175,55,0.2)",borderHover:"rgba(212,175,55,0.4)"},card:{background:"#121217",border:"1px solid rgba(212,175,55,0.2)",borderHover:"1px solid rgba(212,175,55,0.4)",radius:"10px",shadow:"none",shadowHover:"0 4px 16px rgba(0,0,0,0.3)"},badge:{radius:"10px",fontWeight:700},effects:{scanlines:!1,glow:!1,pixelate:!1,hoverScale:1,transition:"0.15s ease"}},light:{id:"light",name:"Light Mode",preview:"\u2600\uFE0F",fonts:{display:"Rajdhani, sans-serif",ui:"'DM Sans', sans-serif",mono:"'JetBrains Mono', monospace",sizeScale:1},colors:{bg:"#F6F4EF",card:"#FFFFFF",cardHover:"#ECE7DC",accent:"#8C6410",accentDark:"#64480C",text:"#15130F",textMuted:"#4E4638",textFaint:"rgba(21,19,15,0.58)",positive:"#0E7A3A",negative:"#B42318",info:"#075E9E",warn:"#A15C00",purple:"#5B3EA6",border:"rgba(90,74,42,0.22)",borderHover:"rgba(90,74,42,0.38)"},card:{background:"#FFFFFF",border:"1px solid rgba(90,74,42,0.18)",borderHover:"1px solid rgba(90,74,42,0.34)",radius:"10px",shadow:"0 1px 4px rgba(35,28,18,0.08)",shadowHover:"0 6px 16px rgba(35,28,18,0.14)"},badge:{radius:"10px",fontWeight:700},effects:{scanlines:!1,glow:!1,pixelate:!1,hoverScale:1,transition:"0.15s ease"}}},g={"000000":"#1a1814","050505":"#f1eee6","0a0a0a":"#f1eee6","0a0a0c":"#f1eee6","0a0b0d":"#f1eee6","0d0b12":"#ffffff","0d0d0d":"#f1eee6","0d0d13":"#ffffff","0f0f14":"#ffffff",111111:"#ffffff",111117:"#ffffff",111318:"#ffffff",121217:"#ffffff","14121c":"#f3f0f8","14130f":"#f5f2e9","1a1a1a":"#ffffff","1c1830":"#efebf7","201d12":"#f4efe1","10243f":"#e8eef6",ffffff:"#1a1814",f4f1e8:"#1a1814",f7e9b0:"#6e5410",d8d8de:"#3a352c",c7cdd7:"#3e4654",d0d0d0:"#44403a",c0c0c0:"#4a463e",a8acb8:"#4c5160",d0e7fa:"#15577f",808080:"#57534b","85929e":"#4e5660","8d887e":"#57524a","95a5a6":"#4f595a","7f8c8d":"#4c5658","6c7a7d":"#44504e",666666:"#4a4a4a","2ecc71":"#0e7a3a","27ae60":"#0c6e33","2e7d32":"#266b2a","1b5e20":"#1b5e20","34d399":"#0c7a48","81c784":"#2e7d32","8ad17a":"#3a8030","1abc9c":"#0c8276","00c8b4":"#047a6e","4ecdc4":"#0c857c","147d8a":"#147d8a","1a99aa":"#14707e",d4af37:"#8c6410",b8941e:"#6e4e0c",cd7f32:"#875322",f0a500:"#945600",f1c40f:"#84680a",f39c12:"#8a5600",f7dc6f:"#7a6000",fbbf24:"#8a6200","8b6914":"#8b6914",fb923c:"#b05312",e67e22:"#ae5414","3498db":"#15659e","5dade2":"#0e6398","45b7d1":"#0e7388","60a5fa":"#1e58be","7db7e8":"#15619c","3fa7d6":"#0e6890",e74c3c:"#be3a2c",c0392b:"#b23022",cc0000:"#b00020",ff6b6b:"#c63a30",f87171:"#c03a30",fca5a5:"#be5048",e86a5a:"#be4334",e91e63:"#c2185b",f472b6:"#b23280","7c6bf8":"#5538c0","9b8afb":"#6048c8",bb8fce:"#74448e",a5b4fc:"#4f5fc0",a78bfa:"#6244c8",a855f7:"#7a2ec0",c678dd:"#8636a4","9b59b6":"#743a8e"},m={1:"rgba(20,16,8,0.035)",2:"rgba(20,16,8,0.05)",3:"rgba(20,16,8,0.06)",4:"rgba(20,16,8,0.075)",5:"rgba(20,16,8,0.09)",6:"rgba(20,16,8,0.11)",7:"rgba(20,16,8,0.2)",8:"rgba(20,16,8,0.45)",9:"rgba(20,16,8,0.62)"},s={fill1:"rgba(140,100,16,0.07)",fill2:"rgba(140,100,16,0.10)",fill3:"rgba(140,100,16,0.14)",line1:"rgba(140,100,16,0.30)",line2:"rgba(140,100,16,0.42)",line3:"rgba(140,100,16,0.55)",line4:"rgba(140,100,16,0.70)"},c={solid:"#ffffff",veil:"rgba(255,255,255,0.72)"};function u(){const t=[];for(const a in g)t.push(`    --k-${a}: ${g[a]};`);for(const a in m)t.push(`    --ov-${a}: ${m[a]};`);for(const a in s)t.push(`    --acc-${a}: ${s[a]};`);for(const a in c)t.push(`    --surf-${a}: ${c[a]};`);return`:root[data-wr-theme="light"] {
${t.join(`
`)}
}
`}function p(t){let a=document.getElementById(n);a||(a=document.createElement("style"),a.id=n,document.head.appendChild(a));const r=o[t]||o.default,e=r.colors||{};let l=`
:root[data-wr-theme="${t}"] {
    --gold: ${e.accent||"#D4AF37"};
    --dark-gold: ${e.accentDark||"#B8941E"};
    /* --page-bg is the backdrop; --black is now the card elevation tone above it. */
    --page-bg: ${e.bg||"#08080B"};
    --black: ${e.card||e.bg||"#14141A"};
    --off-black: ${e.cardHover&&e.cardHover.startsWith("#")?e.cardHover:"#1F1F26"};
    --charcoal: ${e.cardHover||"#2A2A2A"};
    --silver: ${e.textMuted||"#D0D0D0"};
    --white: ${e.text||"#FFFFFF"};
    --text-primary: ${e.text||"#FFFFFF"};
    --text-secondary: ${e.textMuted||"#D0D0D0"};
    --text-muted: ${e.textMuted||"#D0D0D0"};
    --text-faint: ${e.textFaint||"rgba(255,255,255,0.4)"};
    --surface-0: ${e.bg||"#08080B"};
    --surface-1: ${e.card||e.bg||"#14141A"};
    --surface-2: ${e.cardHover&&e.cardHover.startsWith("#")?e.cardHover:"#1F1F26"};
    --surface-3: ${e.cardHover||"#2A2A2A"};
    --good: ${e.positive||"#2ECC71"};
    --warn: ${e.warn||"#F0A500"};
    --bad: ${e.negative||"#E74C3C"};
    --info: ${e.info||"#3498DB"};
    --purple: ${e.purple||"#7C6BF8"};
    --win-green: ${e.positive||"#2ECC71"};
    --loss-red: ${e.negative||"#E74C3C"};
    --font-title: ${r.fonts?.display||"Rajdhani, sans-serif"};
    --font-display: var(--font-title);
    --font-body: ${r.fonts?.ui||"'DM Sans', sans-serif"};
    --font-ui: var(--font-body);
    --font-mono: ${r.fonts?.mono||"'JetBrains Mono', monospace"};
}
[data-wr-theme="${t}"] body { background: var(--page-bg) !important; }
`;e.bg&&e.bg!=="#0A0A0A"&&(l+=`
[data-wr-theme="${t}"] body { background: ${e.bg} !important; }
[data-wr-theme="${t}"] .wr-sidebar { background: ${e.card||e.bg} !important; border-color: ${e.border} !important; }
[data-wr-theme="${t}"] .wr-main-content { background: ${e.bg} !important; }
[data-wr-theme="${t}"] .header {
    background: ${e.card} !important;
    border-bottom-color: ${e.borderHover} !important;
    box-shadow: ${r.card.shadow} !important;
}
[data-wr-theme="${t}"] .wr-module-strip,
[data-wr-theme="${t}"] .wr-module-nav,
[data-wr-theme="${t}"] .wr-module-toolbar,
[data-wr-theme="${t}"] .wr-glass {
    background: ${e.card} !important;
    border-color: ${e.border} !important;
}
`),t==="light"&&(l+=u(),l+=`
[data-wr-theme="light"] .wr-content-frame,
[data-wr-theme="light"] .wr-content-frame > div,
[data-wr-theme="light"] .wr-module-strip,
[data-wr-theme="light"] .wr-glass,
[data-wr-theme="light"] .tc-trade-root,
[data-wr-theme="light"] .tc-dhq-shell,
[data-wr-theme="light"] .analytics-shell {
    color: ${e.text} !important;
}

[data-wr-theme="light"] .tc-dhq-shell,
[data-wr-theme="light"] .tc-dhq-shell [class*="tc-dhq-"],
[data-wr-theme="light"] .tc-trade-root [class*="tc-card"],
[data-wr-theme="light"] .tc-trade-root [class*="tc-panel"],
[data-wr-theme="light"] .tc-trade-root [class*="tc-package"],
[data-wr-theme="light"] .tc-trade-root [class*="tc-partner"],
[data-wr-theme="light"] .draft-gm-command,
[data-wr-theme="light"] .draft-hq-panel,
[data-wr-theme="light"] .draft-hq-action-card,
[data-wr-theme="light"] .draft-rec-card,
[data-wr-theme="light"] .draft-run-list div,
[data-wr-theme="light"] .mock-draftcast-rail,
[data-wr-theme="light"] .mock-cast-clock,
[data-wr-theme="light"] .mock-cast-controls div,
[data-wr-theme="light"] .mock-status-row div,
[data-wr-theme="light"] .mock-panel,
[data-wr-theme="light"] .mock-opponent-shell,
[data-wr-theme="light"] .mock-trade-card {
    background: ${e.card} !important;
    color: ${e.text} !important;
    border-color: ${e.border} !important;
    box-shadow: ${r.card.shadow} !important;
}

[data-wr-theme="light"] .wr-content-frame [style*="color: var(--white)"],
[data-wr-theme="light"] .wr-content-frame [style*="color:var(--white)"],
[data-wr-theme="light"] .wr-content-frame [style*="color: var(--text-primary)"],
[data-wr-theme="light"] .wr-content-frame [style*="color:var(--text-primary)"] {
    color: ${e.text} !important;
}

[data-wr-theme="light"] .wr-content-frame [style*="color: var(--silver)"],
[data-wr-theme="light"] .wr-content-frame [style*="color:var(--silver)"],
[data-wr-theme="light"] .wr-content-frame [style*="color: var(--text-secondary)"],
[data-wr-theme="light"] .wr-content-frame [style*="color:var(--text-secondary)"] {
    color: ${e.textMuted} !important;
    opacity: 1 !important;
}

[data-wr-theme="light"] .wr-content-frame table,
[data-wr-theme="light"] .wr-content-frame tr,
[data-wr-theme="light"] .wr-content-frame td,
[data-wr-theme="light"] .wr-content-frame th {
    color: ${e.text} !important;
}

/* Analytics module: its structural panel/card/table CSS lives in index.html with
   hardcoded white/gold rgba fills (not codemod vars), so it does NOT flip on its own
   and renders washed-out (near-white on white) in light mode. Repaint the structural
   surfaces here. The semantic signal-severity (.analytics-signal-*) and delta indicator
   (.analytics-delta-fill/-benchmark) classes are intentionally left alone so their
   color coding survives. */
[data-wr-theme="light"] .analytics-panel,
[data-wr-theme="light"] .analytics-kpi,
[data-wr-theme="light"] .analytics-signal,
[data-wr-theme="light"] .analytics-readout,
[data-wr-theme="light"] .analytics-mini-table,
[data-wr-theme="light"] .analytics-evidence-head,
[data-wr-theme="light"] .analytics-embed-summary,
[data-wr-theme="light"] .analytics-embed-summary > div,
[data-wr-theme="light"] .analytics-pick-strip,
[data-wr-theme="light"] .analytics-pick-leaders,
[data-wr-theme="light"] .analytics-proof-card,
[data-wr-theme="light"] .analytics-era-card,
[data-wr-theme="light"] .analytics-lab-card,
[data-wr-theme="light"] .analytics-command-panel,
[data-wr-theme="light"] .analytics-report-lab,
[data-wr-theme="light"] .analytics-report-preview,
[data-wr-theme="light"] .analytics-report-templates,
[data-wr-theme="light"] .analytics-head-meta,
[data-wr-theme="light"] .analytics-data-row {
    background: ${e.card} !important;
    border-color: ${e.border} !important;
    color: ${e.text} !important;
    box-shadow: ${r.card.shadow} !important;
}
[data-wr-theme="light"] .analytics-room-chip,
[data-wr-theme="light"] .analytics-filter-row,
[data-wr-theme="light"] .analytics-definition,
[data-wr-theme="light"] .analytics-delta-track {
    background: ${e.cardHover} !important;
    border-color: ${e.border} !important;
    color: ${e.text} !important;
}
[data-wr-theme="light"] .analytics-shell {
    background: ${e.bg} !important;
}
`),r.effects.scanlines&&(l+=`
[data-wr-theme="${t}"] .wr-widget {
    position: relative;
}
[data-wr-theme="${t}"] .wr-widget::after {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
        0deg,
        transparent 0px, transparent 2px,
        rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 4px
    );
    pointer-events: none;
    z-index: 10;
    border-radius: ${r.card.radius};
}
`),r.effects.glow&&(l+=`
[data-wr-theme="${t}"] .wr-data-value {
    text-shadow: 0 0 6px currentColor;
}
[data-wr-theme="${t}"] .wr-widget {
    box-shadow: ${r.card.shadow};
}
`),l+=`
[data-wr-theme="${t}"] .wr-dashboard-grid {
    background: ${r.colors.bg} !important;
}
`,a.textContent=l}const h={themes:o,current:"default",get:function(){return o[f(this.current)]||o.default},set:function(t){if(!o[t])return;const a=f(t);this.current=a;try{localStorage.setItem(i,a)}catch{}document.documentElement.setAttribute("data-wr-theme",a),p(a),window.dispatchEvent(new CustomEvent("wr_theme_changed",{detail:{theme:a}}))},list:function(){return Object.keys(o).filter(t=>d(t))},listAll:function(){return Object.keys(o)},isAvailable:function(t){return d(t)},isSandboxMode:function(){return b()},color:function(t){return this.get().colors[t]},font:function(t){return this.get().fonts[t]},cardStyle:function(t){const a=this.get();return Object.assign({background:a.card.background,border:a.card.border,borderRadius:a.card.radius,boxShadow:a.card.shadow,overflow:"hidden",height:"100%",transition:a.effects.transition},t||{})},cardHoverStyle:function(){const t=this.get();return{border:t.card.borderHover,boxShadow:t.card.shadowHover,background:t.colors.cardHover}},fontSize:function(t){return t*this.get().fonts.sizeScale+"rem"},badgeStyle:function(t,a){const r=this.get();return{fontSize:this.fontSize(.6),fontWeight:r.badge.fontWeight,padding:"1px 6px",borderRadius:r.badge.radius,background:a||t+"18",color:t||r.colors.accent,border:"1px solid "+(t||r.colors.accent)+"44"}}};try{const t=localStorage.getItem(i);t&&o[t]&&(h.current=f(t),h.current!==t&&localStorage.setItem(i,h.current))}catch{}document.documentElement.setAttribute("data-wr-theme",h.current),p(h.current),window.WrTheme=h})();

