(function(){window.App=window.App||{},window.OD=window.OD||{};const f="dhq_assistant_tutorial_state_v1",I="gm-brief-v1",E=new Set(["scout","warroom"]);let a=null,y=!1;function g(t){const e=t||{};return e.productKey=E.has(e.productKey)?e.productKey:"scout",e.version=e.version||I,e.steps=Array.isArray(e.steps)?e.steps:[],e.legacyKeys=Array.isArray(e.legacyKeys)?e.legacyKeys:[],e.accent=e.accent||"#D4AF37",e.title=e.title||"Welcome to the war room",e.kicker=e.kicker||"Alex Ingram / Your AI GM",e.intro=e.intro||"I will get you oriented fast. The goal is simple: know where the decisions live, where the leverage is, and where to pull me in.",e.finishTitle=e.finishTitle||"We are ready",e.finishText=e.finishText||"That is the room. Start with the highest-signal move, and bring me in before you pull any trigger.",e}function z(){return new Date().toISOString()}function M(t,e){try{const o=localStorage.getItem(t);return o?JSON.parse(o):e}catch{return e}}function v(t,e){try{return localStorage.setItem(t,JSON.stringify(e)),!0}catch{return!1}}function p(){const t=M(f,{});return t&&typeof t=="object"&&!Array.isArray(t)?t:{}}function q(t,e){const o=p();o[t]=e,v(f,o)}function R(t){return t.legacyKeys.some(e=>{try{return!!localStorage.getItem(e)}catch{return!1}})}function O(t){return p()[t.productKey]||null}function k(t,e){return!!t&&t.product===e.productKey&&t.version===e.version&&!!t.completedAt}function _(t,e){return{product:t.productKey,version:t.version,completedAt:z(),skipped:!!e}}function h(t,e,o){try{window.OD?.track?.(t,{platform:e.productKey==="warroom"?"warroom":"reconai",module:"assistant_tutorial",entityType:"tutorial",entityId:e.productKey,metadata:{product:e.productKey,version:e.version,...o}})}catch{}}async function C(t){if(!window.OD?.loadTutorialState)return null;try{const e=await window.OD.loadTutorialState(t.productKey);return e?e.product?e:e[t.productKey]||null:null}catch{return null}}async function L(t,e){if(!window.OD?.saveTutorialState)return!1;try{return!!await window.OD.saveTutorialState(t.productKey,e)}catch{return!1}}async function A(t){const e=g(t);if(R(e)||k(O(e),e))return!1;const o=await C(e);return k(o,e)?(q(e.productKey,o),!1):!0}async function S(t,e){const o=g(t),r=e==="skipped"||e==="escape",i=_(o,r);return q(o.productKey,i),o.legacyKeys.forEach(n=>{try{localStorage.setItem(n,"1")}catch{}}),await L(o,i),h(r?"tutorial_skipped":"tutorial_completed",o,{reason:e||"completed"}),window.dispatchEvent(new CustomEvent("dhq:tutorial-complete",{detail:{product:o.productKey,version:o.version,reason:e||"completed"}})),i}function F(t){const e=p();t?delete e[t]:Object.keys(e).forEach(o=>delete e[o]),v(f,e)}function l(t){return String(t??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function B(){if(y||document.getElementById("dhq-assistant-tutorial-styles"))return;y=!0;const t=document.createElement("style");t.id="dhq-assistant-tutorial-styles",t.textContent=`
      .dhq-tutorial-root{position:fixed;inset:0;z-index:100000;pointer-events:none;color:var(--text,#fff);font-family:inherit;overflow:hidden;max-width:100vw}
      .dhq-tutorial-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(5px);pointer-events:auto}
      .dhq-tutorial-spotlight{position:fixed;border:2px solid var(--dhq-tutorial-accent,#D4AF37);border-radius:12px;box-shadow:0 0 0 2px rgba(212,175,55,.18),0 0 42px rgba(212,175,55,.28);pointer-events:none;transition:all .22s ease}
      .dhq-tutorial-panel{position:fixed;pointer-events:auto;box-sizing:border-box;width:calc(100vw - 32px);max-width:820px;max-height:calc(100vh - 32px);overflow:hidden;background:linear-gradient(135deg,rgba(9,9,9,.98),rgba(24,24,24,.98));border:1px solid rgba(212,175,55,.46);border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.72),inset 0 1px 0 rgba(255,255,255,.07);display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,240px);gap:16px;padding:18px}
      .dhq-tutorial-panel.is-center{left:50%;top:50%;transform:translate(-50%,-50%)}
      .dhq-tutorial-panel.is-anchored{width:calc(100vw - 32px);max-width:660px;grid-template-columns:minmax(0,1fr)}
      .dhq-tutorial-main{min-width:0}
      .dhq-tutorial-alex{display:flex;align-items:center;gap:10px;margin-bottom:13px}
      .dhq-tutorial-alex-face{width:40px;height:40px;border-radius:9px;flex-shrink:0;object-fit:cover;border:2px solid var(--dhq-tutorial-accent,#D4AF37);background:linear-gradient(135deg,#d4af37,#b8941e);display:flex;align-items:center;justify-content:center;font-weight:900;color:#0a0a0a;font-size:13px;letter-spacing:.02em}
      .dhq-tutorial-alex-id{display:flex;flex-direction:column;line-height:1.1}
      .dhq-tutorial-alex-id b{color:var(--dhq-tutorial-accent,#D4AF37);font-size:14px;font-weight:900;letter-spacing:.02em}
      .dhq-tutorial-alex-id small{color:rgba(255,255,255,.5);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;margin-top:2px}
      .dhq-tutorial-choices{display:flex;flex-direction:column;gap:8px;margin:12px 0 6px}
      .dhq-tutorial-choice{display:block;width:100%;text-align:left;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.035);border-radius:9px;padding:11px 13px;color:rgba(255,255,255,.82);font:inherit;cursor:pointer;transition:border-color .15s,background .15s}
      .dhq-tutorial-choice:hover{border-color:rgba(212,175,55,.45)}
      .dhq-tutorial-choice.is-active{border-color:var(--dhq-tutorial-accent,#D4AF37);background:rgba(212,175,55,.1)}
      .dhq-tutorial-choice b{display:block;color:#fff;font-size:14px;font-weight:850;margin-bottom:2px}
      .dhq-tutorial-choice.is-active b{color:var(--dhq-tutorial-accent,#D4AF37)}
      .dhq-tutorial-choice span{display:block;color:rgba(255,255,255,.58);font-size:12px;line-height:1.35}
      .dhq-tutorial-kicker{color:var(--dhq-tutorial-accent,#D4AF37);font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.11em;margin-bottom:7px}
      .dhq-tutorial-title{font-size:clamp(22px,3.2vw,32px);line-height:1.02;font-weight:900;color:#fff;letter-spacing:0;margin:0 0 8px}
      .dhq-tutorial-copy{font-size:14px;line-height:1.48;color:rgba(255,255,255,.76);margin:0 0 12px;max-width:58ch}
      .dhq-tutorial-meta{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0 13px}
      .dhq-tutorial-chip{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.045);border-radius:7px;padding:6px 8px;color:rgba(255,255,255,.72);font-size:12px;font-weight:750}
      .dhq-tutorial-board{border:1px solid rgba(212,175,55,.18);background:rgba(212,175,55,.055);border-radius:9px;padding:12px;align-self:stretch;min-width:0}
      .dhq-tutorial-board span{display:block;color:var(--dhq-tutorial-accent,#D4AF37);font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px}
      .dhq-tutorial-board strong{display:block;color:#fff;font-size:17px;line-height:1.1;margin-bottom:8px}
      .dhq-tutorial-board p{margin:0;color:rgba(255,255,255,.66);font-size:12px;line-height:1.45}
      .dhq-tutorial-progress{display:flex;align-items:center;gap:8px;margin-top:12px}
      .dhq-tutorial-rail{height:5px;flex:1;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
      .dhq-tutorial-fill{height:100%;border-radius:99px;background:var(--dhq-tutorial-accent,#D4AF37);width:0;transition:width .22s ease}
      .dhq-tutorial-count{font-size:11px;color:rgba(255,255,255,.56);font-weight:800;white-space:nowrap}
      .dhq-tutorial-actions{display:flex;align-items:center;gap:8px;margin-top:14px}
      .dhq-tutorial-btn{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:rgba(255,255,255,.78);border-radius:7px;padding:9px 12px;font:inherit;font-size:13px;font-weight:850;cursor:pointer;min-height:38px}
      .dhq-tutorial-btn:hover{border-color:rgba(212,175,55,.4);color:#fff}
      .dhq-tutorial-btn:disabled{opacity:.4;cursor:not-allowed}
      .dhq-tutorial-btn.is-primary{background:var(--dhq-tutorial-accent,#D4AF37);border-color:var(--dhq-tutorial-accent,#D4AF37);color:#080808;flex:1}
      @media(max-width:720px){
        .dhq-tutorial-backdrop{backdrop-filter:blur(3px)}
        /* Phone: pin above the host's bottom dock + home indicator.
           --wr-bottom-inset (dock + --sab) is the host registry var; the
           env() fallback keeps a standalone host clear of the home
           indicator. Top clears the notch/status bar; the panel scrolls
           internally if a step is taller than what's left. */
        .dhq-tutorial-panel,.dhq-tutorial-panel.is-anchored{left:calc(12px + var(--sal,env(safe-area-inset-left,0px)))!important;right:calc(12px + var(--sar,env(safe-area-inset-right,0px)))!important;bottom:calc(12px + var(--wr-bottom-inset,var(--sab,env(safe-area-inset-bottom,0px))))!important;top:auto!important;transform:none!important;width:auto;grid-template-columns:1fr;padding:15px;max-height:calc(100vh - 24px - var(--wr-bottom-inset,var(--sab,env(safe-area-inset-bottom,0px))) - var(--sat,env(safe-area-inset-top,0px)));max-height:calc(100dvh - 24px - var(--wr-bottom-inset,var(--sab,env(safe-area-inset-bottom,0px))) - var(--sat,env(safe-area-inset-top,0px)));overflow-y:auto;overscroll-behavior:contain}
        .dhq-tutorial-board{display:none}
        .dhq-tutorial-title{font-size:22px}
        .dhq-tutorial-copy{font-size:13px}
        .dhq-tutorial-actions{gap:7px}
        .dhq-tutorial-btn{padding:8px 10px;font-size:12px}
      }
      @media(prefers-reduced-motion:reduce){
        .dhq-tutorial-spotlight,.dhq-tutorial-fill{transition:none}
      }
    `,document.head.appendChild(t)}function j(t){if(t.alexAvatar===!1)return"";let e="AI";try{const o=localStorage.getItem("wr_alex_avatar")||"badge",r=(window.ALEX_AVATARS||[]).find(i=>i.id===o);r&&r.src&&(e=`<img src="${l(r.src)}" alt="Alex" style="width:100%;height:100%;object-fit:cover;border-radius:7px">`)}catch{}return`
      <div class="dhq-tutorial-alex">
        <span class="dhq-tutorial-alex-face">${e}</span>
        <span class="dhq-tutorial-alex-id"><b>Alex Ingram</b><small>AI General Manager</small></span>
      </div>
    `}function H(t){if(!Array.isArray(t.choices)||!t.choices.length)return"";let e="";try{e=t.choiceKey&&localStorage.getItem(t.choiceKey)||""}catch{}return`
      <div class="dhq-tutorial-choices" aria-label="${l(t.choicePrompt||"Choose one")}">
        ${t.choices.map(o=>`
          <button class="dhq-tutorial-choice${o.value===e?" is-active":""}" type="button" data-tutorial-choice="${l(o.value)}">
            <b>${l(o.label)}</b>${o.desc?`<span>${l(o.desc)}</span>`:""}
          </button>
        `).join("")}
      </div>
    `}function N(t){return[{key:"opening",title:t.title,desc:t.intro,kicker:t.kicker,position:"center",chips:t.openingChips||["90-second brief","GM room map","Replay anytime"],board:t.openingBoard||{label:"Opening Brief",title:"Front office orientation",body:"I will show you where decisions happen, where leverage shows up, and where to pull me in."}},...t.steps,{key:"finish",title:t.finishTitle,desc:t.finishText,kicker:"Ready for kickoff",position:"center",chips:t.finishChips||["Command center ready","Alex on call","Settings has replay"],board:t.finishBoard||{label:"Next Move",title:"Open the board",body:"Start with the highest-signal module, then ask Alex to pressure-test the move before you act."}}]}function b(){const t=document.getElementById("dhq-assistant-tutorial");t&&t.remove()}function G(t){if(t)try{if(typeof t.open=="function"){t.open();return}if(t.tabToOpen){const e=t.tabSelector||`[data-tab="${t.tabToOpen}"]`,o=document.querySelector(e);o&&o.click()}t.mobileTab&&typeof window.mobileTab=="function"?window.mobileTab(t.mobileTab):t.switchTab&&typeof window.switchTab=="function"&&window.switchTab(t.switchTab)}catch{}}function $(t){if(!t?.target)return null;try{return document.querySelector(t.target)}catch{return null}}function P(t,e){if(!e||t.position==="center")return{center:!0};const o=e.getBoundingClientRect(),r=16,i=Math.min(window.innerWidth*.92,660),n=330,d=window.innerWidth-o.right,u=o.left;let c,s=Math.max(r,Math.min(o.top,window.innerHeight-n-r));return d>=i+r?c=o.right+r:u>=i+r?c=o.left-i-r:(c=Math.max(r,Math.min(window.innerWidth-i-r,o.left)),s=Math.min(window.innerHeight-n-r,o.bottom+r)),{left:c,top:s}}function x(){if(!a)return;const{config:t,steps:e}=a,o=e[a.index];G(o),window.setTimeout(()=>{if(!a)return;const r=e[a.index],i=$(r);if(i&&r.scroll!==!1)try{i.scrollIntoView({block:"center",inline:"center",behavior:"smooth"})}catch{}window.setTimeout(()=>{a&&W(r,$(r))},r.renderDelay||140)},o.openDelay||0)}function W(t,e){const{config:o,steps:r,index:i}=a;b(),B();const n=document.createElement("div");n.id="dhq-assistant-tutorial",n.className="dhq-tutorial-root",n.style.setProperty("--dhq-tutorial-accent",o.accent),n.setAttribute("role","dialog"),n.setAttribute("aria-modal","true"),n.setAttribute("aria-label",t.title||o.title);const d=Math.round((i+1)/r.length*100),u=P(t,e),c=u.center,s=t.board||null,K=Array.isArray(t.chips)?t.chips:[];n.innerHTML=`
      <div class="dhq-tutorial-backdrop"></div>
      ${e?J(e):""}
      <section class="dhq-tutorial-panel ${c?"is-center":"is-anchored"}" style="${c?"":`left:${Math.round(u.left)}px;top:${Math.round(u.top)}px`}">
        <div class="dhq-tutorial-main">
          ${j(o)}
          <div class="dhq-tutorial-kicker">${l(t.kicker||`Step ${i+1} of ${r.length}`)}</div>
          <h2 class="dhq-tutorial-title">${l(t.title)}</h2>
          <p class="dhq-tutorial-copy">${l(t.desc)}</p>
          ${K.length?`<div class="dhq-tutorial-meta">${K.map(X=>`<span class="dhq-tutorial-chip">${l(X)}</span>`).join("")}</div>`:""}
          ${H(t)}
          <div class="dhq-tutorial-progress">
            <div class="dhq-tutorial-rail"><div class="dhq-tutorial-fill" style="width:${d}%"></div></div>
            <div class="dhq-tutorial-count">${i+1}/${r.length}</div>
          </div>
          <div class="dhq-tutorial-actions">
            <button class="dhq-tutorial-btn" type="button" data-tutorial-action="back" ${i===0?"disabled":""}>Back</button>
            <button class="dhq-tutorial-btn" type="button" data-tutorial-action="skip">Skip</button>
            <button class="dhq-tutorial-btn is-primary" type="button" data-tutorial-action="next">${i===r.length-1?"Finish Briefing":"Next"}</button>
          </div>
        </div>
        ${s?`
          <aside class="dhq-tutorial-board">
            <span>${l(s.label||"GM Note")}</span>
            <strong>${l(s.title||"")}</strong>
            <p>${l(s.body||"")}</p>
          </aside>
        `:""}
      </section>
    `,document.body.appendChild(n),V(n),a.seen.has(i)||(a.seen.add(i),h("tutorial_step_viewed",o,{stepIndex:i+1,stepKey:t.key||null,targetFound:!!e})),U(n)}function J(t){const e=t.getBoundingClientRect(),o=6;return`<div class="dhq-tutorial-spotlight" style="left:${Math.max(4,Math.round(e.left-o))}px;top:${Math.max(4,Math.round(e.top-o))}px;width:${Math.round(e.width+o*2)}px;height:${Math.round(e.height+o*2)}px"></div>`}function V(t){t.addEventListener("click",e=>{const o=e.target?.closest?.("[data-tutorial-action]")?.dataset?.tutorialAction;o==="next"&&T(),o==="back"&&D(),o==="skip"&&m("skipped");const r=e.target?.closest?.("[data-tutorial-choice]");if(r){const i=r.dataset.tutorialChoice,n=a?.steps?.[a.index];if(n?.choiceKey)try{localStorage.setItem(n.choiceKey,i)}catch{}t.querySelectorAll(".dhq-tutorial-choice").forEach(d=>d.classList.toggle("is-active",d.dataset.tutorialChoice===i));try{window.dispatchEvent(new CustomEvent("dhq:tutorial-choice",{detail:{key:n?.choiceKey||null,group:n?.choiceGroup||null,value:i}}))}catch{}}})}function U(t){window.setTimeout(()=>{const e=t.querySelector('[data-tutorial-action="next"]');try{e?.focus?.({preventScroll:!0})}catch{}},0)}function T(){if(a){if(a.index>=a.steps.length-1){m("completed");return}a.index+=1,x()}}function D(){!a||a.index<=0||(a.index-=1,x())}async function m(t){if(!a)return;const e=a.config;b(),a=null,window.removeEventListener("keydown",w,!0),await S(e,t)}function w(t){a&&(t.key==="Escape"?(t.preventDefault(),m("escape")):t.key==="ArrowRight"||t.key==="Enter"?(t.preventDefault(),T()):t.key==="ArrowLeft"&&(t.preventDefault(),D()))}async function Y(t,e){const o=g(t),r=e||{};if(a&&(b(),window.removeEventListener("keydown",w,!0),a=null),!r.force&&!await A(o))return!1;const i=N(o);return a={config:o,steps:i,index:0,seen:new Set,forced:!!r.force},window.addEventListener("keydown",w,!0),h(r.force?"tutorial_replayed":"tutorial_started",o,{forced:!!r.force}),r.force&&h("tutorial_started",o,{forced:!0}),x(),!0}window.App.AssistantTutorial={start:Y,shouldShow:A,complete:S,reset:F,isActive:()=>!!a,_readLocalState:p}})();

