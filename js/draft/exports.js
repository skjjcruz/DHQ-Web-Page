(function(){const{FONT_UI:h,FONT_DISPL:f}=window.DraftCC.styles;async function y(e){var x,u,w,k;try{await((x=window.ensureHtml2Canvas)==null?void 0:x.call(window))}catch{}if(typeof window.html2canvas!="function")return alert("html2canvas not loaded \u2014 cannot export PNG"),null;const i=e.picks.filter(t=>t.rosterId===e.userRosterId||t.isUser),r=window.DraftCC.state.gradeDraft(i,e.originalPool,{assessment:(w=(u=e.personas)==null?void 0:u[e.userRosterId])==null?void 0:w.assessment,variant:e.variant,leagueSize:e.leagueSize,rounds:e.rounds,budget:e.auctionBudget}),$=((k=window.App)==null?void 0:k.POS_COLORS)||{QB:"var(--k-ff6b6b, #ff6b6b)",RB:"var(--k-4ecdc4, #4ecdc4)",WR:"var(--k-45b7d1, #45b7d1)",TE:"var(--k-f7dc6f, #f7dc6f)",DL:"var(--k-e67e22, #e67e22)",LB:"var(--k-f0a500, #f0a500)",DB:"var(--k-5dade2, #5dade2)",K:"var(--k-bb8fce, #bb8fce)"},g=typeof window.wrIsPro!="function"||window.wrIsPro(),m=!g||r.letter==="?"?"var(--k-95a5a6, #95a5a6)":r.letter.startsWith("A")?"var(--k-2ecc71, #2ecc71)":r.letter.startsWith("B")?"var(--k-d4af37, #d4af37)":r.letter.startsWith("C")?"var(--k-f0a500, #f0a500)":"var(--k-e74c3c, #e74c3c)",a=document.createElement("div");a.style.cssText=`
            position: fixed;
            top: -9999px;
            left: -9999px;
            width: 1080px;
            height: 1920px;
            background: linear-gradient(180deg, var(--k-000000, #000000) 0%, var(--k-0a0a0a, #0a0a0a) 50%, var(--k-050505, #050505) 100%);
            color: var(--k-ffffff, #ffffff);
            font-family: ${h};
            padding: 80px 60px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
        `;const c=document.createElement("div");c.style.cssText="text-align:center;margin-bottom:60px",c.innerHTML=`
            <div style="font-family:${f};font-size:42px;font-weight:700;color:var(--k-d4af37, #d4af37);letter-spacing:0.12em;margin-bottom:8px">WAR ROOM</div>
            <div style="font-size:22px;color:var(--k-95a5a6, #95a5a6);letter-spacing:0.08em;text-transform:uppercase">Draft Command Center \xB7 ${e.season||""}</div>
            <div style="width:120px;height:2px;background:var(--k-d4af37, #d4af37);margin:20px auto 0"></div>
        `,a.appendChild(c);const s=document.createElement("div");s.style.cssText="text-align:center;margin-bottom:50px",s.innerHTML=g?`
            <div style="font-size:22px;color:var(--k-d4af37, #d4af37);letter-spacing:0.16em;text-transform:uppercase;margin-bottom:14px">Draft Grade</div>
            <div style="font-family:${f};font-size:260px;font-weight:700;color:${m};line-height:0.9;text-shadow:0 0 40px ${m}66">${r.letter}</div>
            <div style="font-size:28px;color:var(--k-ffffff, #ffffff);margin-top:14px">
                ${r.totalDHQ.toLocaleString()} total DHQ \xB7 ${i.length} picks \xB7 ${r.pct||0}% value
            </div>
        `:`
            <div style="font-size:22px;color:var(--k-d4af37, #d4af37);letter-spacing:0.16em;text-transform:uppercase;margin-bottom:14px">Draft Haul</div>
            <div style="font-family:${f};font-size:120px;font-weight:700;color:var(--k-d4af37, #d4af37);line-height:1">${r.totalDHQ.toLocaleString()}</div>
            <div style="font-size:28px;color:var(--k-ffffff, #ffffff);margin-top:14px">
                total DHQ \xB7 ${i.length} picks
            </div>
        `,a.appendChild(s);const d=document.createElement("div");d.style.cssText=`
            flex: 1;
            background: var(--acc-fill1, rgba(212,175,55,0.04));
            border: 2px solid var(--acc-line2, rgba(212,175,55,0.3));
            border-radius: 16px;
            padding: 28px 32px;
            margin-bottom: 40px;
        `;const l=document.createElement("div");l.style.cssText="font-size:22px;color:var(--k-d4af37, #d4af37);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:18px;font-weight:700",l.textContent="Your Picks",d.appendChild(l),i.forEach((t,v)=>{const n=$[t.pos]||"var(--k-95a5a6, #95a5a6)",o=document.createElement("div");o.style.cssText=`
                display: flex;
                align-items: center;
                padding: 14px 0;
                border-bottom: 1px solid var(--ov-4, rgba(255,255,255,0.06));
                font-size: 28px;
            `,o.innerHTML=`
                <span style="width:90px;color:var(--k-d4af37, #d4af37);font-weight:700">R${t.round}.${String(t.slot||0).padStart(2,"0")}</span>
                <span style="flex:1;color:var(--k-ffffff, #ffffff);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${C(t.name||"")}</span>
                <span style="padding:6px 14px;border-radius:10px;font-size:22px;font-weight:700;background:${n}22;color:${n};margin:0 18px">${t.pos||""}</span>
                <span style="min-width:120px;text-align:right;color:${b(t.dhq)};font-weight:700;font-family:'JetBrains Mono',monospace">${(t.dhq||0).toLocaleString()}</span>
            `,d.appendChild(o)}),a.appendChild(d);const p=document.createElement("div");p.style.cssText="text-align:center;font-size:18px;color:var(--k-95a5a6, #95a5a6);opacity:0.7",p.innerHTML=`
            <div>Mock Draft \xB7 ${e.mode||"solo"} \xB7 ${e.rounds}R \xD7 ${e.leagueSize}T</div>
            <div style="margin-top:6px;font-size:var(--text-body, 1rem);opacity:0.5">warroom.skjjcruz.com</div>
        `,a.appendChild(p),document.body.appendChild(a);try{const t=await window.html2canvas(a,{backgroundColor:"var(--k-000000, #000000)",scale:1,logging:!1,useCORS:!0});return t.toBlob(v=>{if(!v)return;const n=URL.createObjectURL(v),o=document.createElement("a");o.href=n,o.download=`war-room-draft-${e.season||"mock"}-${Date.now()}.png`,document.body.appendChild(o),o.click(),document.body.removeChild(o),URL.revokeObjectURL(n)},"image/png"),t}catch(t){return window.wrLog&&window.wrLog("exports.downloadDraftCard",t),alert("Export failed: "+((t==null?void 0:t.message)||t)),null}finally{a.parentNode&&a.parentNode.removeChild(a)}}function b(e){return e>=7e3?"var(--k-2ecc71, #2ecc71)":e>=4e3?"var(--k-3498db, #3498db)":e>=2e3?"var(--k-d4af37, #d4af37)":"var(--k-95a5a6, #95a5a6)"}function C(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}window.DraftCC=window.DraftCC||{},window.DraftCC.exports={downloadDraftCard:y}})();

