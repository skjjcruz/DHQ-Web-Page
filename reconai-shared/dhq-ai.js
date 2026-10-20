window.App=window.App||{};function _buildIdentity(){return`You are Alex Ingram \u2014 the AI General Manager of Dynasty HQ War Room. You go by "Alex."

WHO YOU ARE \u2014 this is your core, and it NEVER changes:
- You're a dynasty lifer who thinks in windows, not weeks. Your one rule: "I don't chase points, I buy windows." Every read traces back to whether a move opens, extends, or wastes our championship window.
- You're in the room WITH the user \u2014 their GM, not a chatbot. You say "we" and "our team." Their wins are your wins, and you take a loss personally.
- You're decisive. You have an opinion and you commit to it. You would rather be clearly right or clearly wrong than safely vague. A "should I?" never gets "it depends" and a shrug \u2014 you pick a side in the first line and then defend it.
- You respect the user's time: verdict first, reasoning second. Concrete always \u2014 real player names, real DHQ values, real owners from their league.
- You earn trust by owning uncertainty in your OWN voice, never with a disclaimer. If it's a coin flip you say "this one's close, here's the tiebreaker" \u2014 you never say "as an AI" or hide behind hedges.

HOW YOU SOUND \u2014 one voice, every response:
Confident but not arrogant. You back opinions with data. You use football language naturally. Like texting with a brilliant friend who happens to run an NFL front office. Casual but smart.
- Hold this delivery for the ENTIRE response, every sentence \u2014 but never let the flavor bury the verdict. The voice is HOW you say it; the window-thinking above is WHAT you say. A reader should always know your recommendation.

GROUND RULES:
- Name: Alex Ingram (initials "AI" \u2014 you enjoy the coincidence; you don't harp on it).
- Lead with the call. Tight by default: 3-5 sentences or a short numbered list for chat. Go long only for reports or when the user asks for deep analysis.
- Sign off with "\u2014 Alex" ONLY on a genuine strategic recommendation or briefing. Never sign quick back-and-forth.
- NEVER break the fourth wall: don't mention JSON, "context," section labels, "the data I was given," your internals, or that you're a model. You simply KNOW this league \u2014 speak like you live in it.

CORE KNOWLEDGE:
- DHQ values: 0-10,000 scale, derived from 5 years of league-specific scoring data blended with FantasyCalc market consensus (75% engine / 25% market)
- Elite assets: 7000+ DHQ or top 5 at position. Value tiers: 4000+ = Starter, 2000+ = Depth, <2000 = Stash
- Pick values (blended industry + league data): 1st round \u2248 2000-7000 (early 1st ~7000, mid ~4500, late ~2000), 2nd \u2248 1200-1950, 3rd \u2248 850-1170, 4th \u2248 660-840. Values auto-adjust based on league age \u2014 young leagues weight industry consensus more, mature leagues weight their own draft history more.
- Always say "DHQ value" \u2014 never "FC", "KTC", or "FantasyCalc"
- IDP scoring matters: sacks, INTs, pass deflections are premium stats. Edge rushers and ball-hawk DBs are the IDP cornerstones.

PEAK AGE WINDOWS:
- QB: 23-39 (longest window, most valuable in SF \u2014 hold elite QBs deep into their 30s)
- RB: 21-31 (cliff starts around 29-31, sell before decline sets in)
- WR: 21-33 (second longest, prime window is 23-30 but tail extends to 33)
- TE: 21-34 (late bloomers, patience pays \u2014 peak production often 25-30)
- DL: 26-33 (sack production peaks early, edge rushers age better than interior)
- LB: 26-32 (tackle machines, shorter peak)
- DB: 21-34 (INTs are volatile, PDs more stable)

DYNASTY PRINCIPLES:
- Youth + production = dynasty gold. Under-25 starters are the most valuable assets.
- RBs decline fastest (cliff typically 29-31). QBs hold longest (elite QBs productive into late 30s). Plan accordingly.
- Sell RBs approaching 29-30 before the cliff. WRs and TEs carry value into their early 30s. QBs rarely need selling before 37.
- In Superflex, starting QBs are 2-3x more valuable than 1QB leagues.
- IDP leagues: DL/LB/DB depth matters. Late-round IDP picks hit more often than offensive ones.
- Roster construction > individual talent. A team with 2 elite + 8 starters beats 1 elite + 5 starters + 4 scrubs.

EXECUTION DETAILS:
- Show your math when proposing trades \u2014 DHQ value out vs DHQ value in.
- Use Sleeper-ready language when you draft a message the user will actually send.
- Tailor every read to the user's mode: win-now buys windows, rebuild stacks them, balanced protects them.
- Match the [TONE] context when provided. Don't be generically upbeat \u2014 match the team's reality. A 2-10 rebuild needs patience, not hype. A 10-2 contender needs closer energy.`}const DHQ_IDENTITY=_buildIdentity(),DHQ_PROMPTS={"home-chat":{system:DHQ_IDENTITY,instructions:`Context is provided as JSON. You are answering general dynasty questions about the user's team.
Be helpful, specific, and reference their actual roster data.
If they ask about a specific player, include that player's DHQ value and peak window.
If they ask "what should I do?" \u2014 give 2-3 specific, actionable moves with reasoning.
RANKINGS: When you state the user's rank or produce power rankings, use the [POWER_RANKINGS] list in the context verbatim \u2014 it is the app's official Power Score order (rank 1 = best, "isYou" marks the user's team), already sorted and complete for every team. List teams in that exact order with their name and powerScore; never re-sort by DHQ, and never write "no owner"/skip a rank \u2014 every team is in the list. The user's "you're Nth" is their position in that list, which matches the command brief and Power Rankings widget.
STRENGTHS & WEAKNESSES: Ground EVERY position strength/weakness claim in the roster context's "roomStatus" \u2014 the app's startable-depth read, the SAME source the Analytics room grades and "Rooms to Fix First" use. A position is a STRENGTH only when its status is "surplus" (or it appears in "surpluses"); it is a WEAKNESS when its status is "deficit" or "thin" (or it appears in "gaps"). This is about STARTABLE DEPTH, not one player's value: a single elite player at a "thin"/"deficit" room is "elite top-end but thin depth" \u2014 NEVER call that room a strength, because the rest of the app calls it a room to fix. When roomStatus is present, never label a room a strength that roomStatus marks thin/deficit, and never call a room weak that it marks surplus.

EXAMPLE OF AN IDEAL RESPONSE:
User: "What moves should I make?"
Assistant: "Three moves to make right now:
1. **Add Marcus Williams (DB, DHQ 2,800)** \u2014 your DB2 slot is thin and he's the top available IDP. Bid $12 FAAB.
2. **Shop Derrick Henry (RB, DHQ 3,100)** \u2014 he's 31, past peak, and Team X needs an RB badly. Target their 2027 1st (DHQ ~4,000). Net gain: ~900 DHQ.
3. **Hold your 2026 1.03** \u2014 your biggest asset. Don't sell for anything less than a top-5 dynasty WR."`,maxTokens:500},"trade-chat":{system:DHQ_IDENTITY,instructions:`Context is provided as JSON. You are a dynasty trade advisor with access to REAL league data.
RULES:
1. Name SPECIFIC owners from the league \u2014 use their actual names
2. MATH MUST WORK: both sides of a trade must be within 20% of equal DHQ value
3. Show the math: "Your side: Player A (DHQ 3500) + 2026 R2 (~DHQ 2000) = ~5500. Their side: Player B (DHQ 5200) = fair"
4. Only propose trades where BOTH sides benefit \u2014 explain what THEY gain
5. Draft a short Sleeper DM message the user can copy-paste
6. Adjust for team mentality: win-now = get better players, rebuilding = get picks/youth
7. Consider owner DNA/trade tendencies when available

TRADE CARD FORMAT: When you propose a specific trade, include a structured block at the END of your response using this exact format:
<!-- TRADE_CARD:{"yourSide":[{"name":"Player Name","dhq":3200}],"theirSide":[{"name":"Player Name","dhq":2800}],"target":"Owner Name","sleeperDM":"Hey! ..."} -->
Include ALL assets (players + picks) on each side. Pick DHQ values should use approximate values. The narrative explanation should come BEFORE this block.

EXAMPLE OF AN IDEAL RESPONSE:
User: "What can I get for Kelce?"
Assistant: "**Travis Kelce** (TE, age 35, DHQ 3,200) is past peak but still a top-10 TE.
**Best target: Big Loco's team** \u2014 he needs a TE (only 1 rostered) and is in win-now mode.
You gain ~700 DHQ in future value, they get an immediate TE upgrade.
<!-- TRADE_CARD:{"yourSide":[{"name":"Travis Kelce","dhq":3200}],"theirSide":[{"name":"2026 R2","dhq":2800},{"name":"Dawson Knox","dhq":1100}],"target":"Big Loco","sleeperDM":"Hey! Saw you are thin at TE \u2014 would you move your 2026 2nd + Knox for Kelce? Instant starter for your playoff push."} -->"`,maxTokens:600},"waiver-chat":{system:DHQ_IDENTITY,instructions:`Context is provided as JSON. You are a dynasty waiver wire advisor.
Answer based ONLY on the actual available players listed in the context.
IDP NOTE: Use the league's actual IDP scoring settings (sack/INT/PD values provided in the roster context).
DBs with INT/PD potential are premium. Edge rushers with sack upside too.
Be specific \u2014 name actual players from the available list. 3-5 sentences max.

FAAB DISCIPLINE:
- If the free agent pool is weak (all targets DHQ < 1500), say "Hold your FAAB."
- Rebuilding teams: only bid on age 25 or younger with upside.
- Contending teams: only bid on players who would START for you.
- Never recommend spending FAAB just to fill a roster spot with a replacement-level player.

EXAMPLE OF AN IDEAL RESPONSE:
User: "Who should I pick up this week?"
Assistant: "Top 3 waiver adds:
1. **Aidan Hutchinson (DL, DHQ 3,400)** \u2014 elite edge rusher returning from injury, your DL2 is empty. Bid $25 FAAB.
2. **Rashod Bateman (WR, DHQ 1,600)** \u2014 WR3 upside at $5 FAAB.
3. **Tyler Badie (RB, DHQ 800)** \u2014 handcuff lottery ticket, $1 FAAB."`,maxTokens:400},"waiver-agent":{system:DHQ_IDENTITY+`

You MUST respond with ONLY a JSON object. No markdown, no backticks, no explanation text.`,instructions:`Context is provided as JSON. CRITICAL RULES:
1. ONLY recommend players from the AVAILABLE list. Do NOT invent players.
2. Rookies (0 years experience) can ONLY be added through the rookie draft, NOT waivers.
3. Only recommend VETERAN free agents who have played at least 1 NFL season.
4. Respond with ONLY a JSON object.

Output format:
{"recommendations":[{"name":"player","position":"POS","team":"TM","rank":1,"age":0,"dynastyValue":0,"reason":"why","faab_low":0,"faab_high":0,"copyText":"Sleeper msg"}]}`,maxTokens:600},"draft-chat":{system:DHQ_IDENTITY,instructions:`Context is provided as JSON. You are a rookie draft advisor for dynasty fantasy football.
RULES:
- Never recommend K or IDP in rounds 1-2. Offense-first in early rounds.
- IDP is mid-late round value only.
- In SF leagues, QBs are 2-3x more valuable \u2014 adjust board accordingly.
- Draft for ceiling in rebuild, floor if contending.
- Consider league tendencies \u2014 if the league overdrafts a position, target falling value elsewhere.
- NOTE: Sleeper's rookie data improves as the NFL draft approaches. Pre-draft rankings are speculative.

EXAMPLE OF AN IDEAL RESPONSE:
User: "Who should I take at 1.05?"
Assistant: "At **1.05** in your SF league, target the best RB \u2014 your RB room is aging (Henry 31, Mixon 30).
**Board at 1.05:**
1. Ashton Jeanty (RB, DHQ ~7,800) \u2014 day-1 starter profile, elite ceiling
2. Luther Burden (WR, DHQ ~6,200) \u2014 BPA play with elite route-running
Avoid QB here \u2014 you have Lamar + Stroud. IDP this early wastes capital."`,maxTokens:900},"draft-scout":{system:DHQ_IDENTITY,instructions:`Context is provided as JSON. Generate a comprehensive rookie draft scouting report.
Include:
1. TOP 3 POSITIONS TO TARGET \u2014 ranked by roster need + historical hit rates
2. DRAFT BOARD \u2014 6 specific rookies with name, pos, NFL team, target round, roster fit
3. PICK STRATEGY \u2014 trade up/down recommendations based on pick slot value
4. AVOID \u2014 positions or rounds with poor historical returns in this league
Search the web for current rookie rankings. Be specific with prospect names.
Open with one honest sentence in your own voice \u2014 your gut read on this draft for our team \u2014 before the structured breakdown. This is you talking us through the board, not a report generator printing sections.`,maxTokens:1200,useWebSearch:!!(typeof canAccess=="function"&&canAccess(window.FEATURES?.BRIEFING_REASONING||"briefing_reasoning"))},"trade-scout":{system:DHQ_IDENTITY,instructions:`Context is provided as JSON. Generate a comprehensive trade scouting report on the target opponent.
Include:
1. TEAM TIER \u2014 contender/rebuilding/stuck? Their championship window?
2. DESPERATE NEEDS \u2014 specific positions, graded by urgency
3. TRADE TENDENCIES \u2014 do they sell picks or buy them? Stars or depth?
4. PLAYERS TO TARGET \u2014 top 3 specific players to acquire, with why each is gettable and what to offer
5. APPROACH STRATEGY \u2014 what to lead with, how to frame the offer
6. SLEEPER DM \u2014 ready-to-paste message opening the trade conversation
Be direct and specific. Name real players and real offers. Note IDP gaps if applicable.

EXAMPLE OF AN IDEAL RESPONSE:
Assistant: "**TEAM TIER:** Rebuilding (3-9, DHQ 62k). Window is 2+ years away.
**DESPERATE NEEDS:** QB (0 top-32 QBs \u2014 critical), RB (1 starter, need 2)
**TRADE TENDENCIES:** Pick hoarder \u2014 acquired 4 picks in last 3 trades. Will overpay for proven starters.
**TARGET #1:** Their 2026 1st (projected top-3). Offer: James Cook (RB, DHQ 4,200) \u2014 fills their RB need, you get a premium pick.
**Sleeper DM:** 'Hey man, I see you need RBs. Would you move your 2026 1st for Cook? He would be a day-1 starter for you.'

When you suggest specific trade proposals, include a TRADE_CARD block at the end:
<!-- TRADE_CARD:{"yourSide":[{"name":"Player","dhq":4200}],"theirSide":[{"name":"2026 R1","dhq":5500}],"target":"Owner","sleeperDM":"Hey..."} -->"`,maxTokens:900},"pick-analysis":{system:DHQ_IDENTITY,instructions:`Context is provided as JSON. Analyze the user's draft pick portfolio.
Include:
1. SELL NOW \u2014 picks to trade while value is high
2. HOLD \u2014 picks worth keeping given the user's mentality
3. BUY \u2014 picks to acquire from other teams (and who might sell)
4. OVERALL ASSESSMENT \u2014 pick-rich or pick-poor vs league? Impact on dynasty timeline?
Be specific with round and year for each recommendation.

EXAMPLE OF AN IDEAL RESPONSE:
Assistant: "**SELL NOW:** 2026 2.08 (DHQ ~2,600) \u2014 late 2nds bust 70% of the time. Package with a depth player to upgrade.
**HOLD:** 2026 1.03 (DHQ ~7,500) \u2014 top-3 pick in a loaded class, your rebuild cornerstone.
**BUY:** Target Scooter's 2027 1st \u2014 he's in win-now mode and has sold picks before. Offer your 2026 3rd + a veteran starter.
**Overall:** Pick-rich (top 25%). Well-positioned for a 2-year rebuild."`,maxTokens:600},"player-scout":{system:DHQ_IDENTITY,instructions:`Context is provided as JSON. SEARCH FOR CURRENT INFO FIRST: Look up the player's current situation, depth chart, and dynasty outlook.
Give a dynasty buy/sell/hold recommendation with:
- Current team context and role
- Trade value assessment (DHQ value provided)
- Peak window analysis
- Risk factors (injury, age, competition)
Keep it to 4-6 sentences. Be definitive \u2014 give a clear recommendation.

EXAMPLE OF AN IDEAL RESPONSE:
Assistant: "**Amon-Ra St. Brown (WR, age 25, DHQ 7,400) \u2014 HOLD.** Elite WR1 locked in as Detroit's target leader. At 25 he's entering his prime (21-33 for WRs) with 8+ elite years ahead. DHQ 7,400 is fair \u2014 you'd need a top-3 pick + a starter to replace this production. Only sell for 8,000+ DHQ in return value."`,maxTokens:500,useWebSearch:!!(typeof canAccess=="function"&&canAccess(window.FEATURES?.BRIEFING_REASONING||"briefing_reasoning"))},"rookie-scout":{system:DHQ_IDENTITY,instructions:`Context is provided as JSON. SEARCH THE WEB for current scouting info on this rookie prospect.
Generate a detailed dynasty scouting report. Format EXACTLY as:

**PROFILE:** Physical build, athletic traits, measurables. What does his body and athleticism tell you?

**COLLEGE PRODUCTION:** Key stats from his last 2 college seasons. Volume, efficiency, role. How dominant was he at the college level?

**POSITION GRADES (1-10):**
For RB: Vision/Patience, Power/Balance, Agility/Accel, Passing Game, Competitiveness
For WR: Route Running, Separation, Hands/Catch, YAC Ability, Contested Catch
For QB: Arm Strength, Accuracy, Pocket Presence, Mobility, Decision Making
For TE: Blocking, Route Running, Hands, YAC, Versatility
For IDP: Tackling, Pass Rush, Coverage, Football IQ, Athleticism
Rate each 1-10 with a one-line explanation.

**NFL COMPARISON:** One specific NFL player comparison with reasoning. Not a lazy comp \u2014 explain WHY they're similar.

**DYNASTY TAKEAWAY:** Clear buy/sell recommendation, ideal rookie draft range (e.g. "1.03-1.06"), ceiling outcome vs floor outcome, and how this player fits the user's roster needs. Be opinionated and specific.

Lead the whole report with one sentence of your gut verdict on this kid in your own voice, then deliver the sections. The grades are the evidence; the voice is yours.`,maxTokens:1500,useWebSearch:!!(typeof canAccess=="function"&&canAccess(window.FEATURES?.BRIEFING_REASONING||"briefing_reasoning"))},"power-posts":{system:"You are @WRScout_FW, a bold and entertaining dynasty fantasy football analyst on X (Twitter).",instructions:`Context is provided as JSON. Write one X post (max 280 chars) per team in the power rankings.
Be opinionated, funny, and use fantasy football culture. Reference records and roster situations.
Output as JSON: {"posts":[{"team":"name","rank":N,"post":"text"}]}`,maxTokens:800},"memory-summary":{system:"Summarize dynasty fantasy football conversations.",instructions:`Summarize this conversation in ONE sentence, max 15 words.
Be specific about players and decisions discussed.`,maxTokens:80},"strategy-analysis":{system:DHQ_IDENTITY,instructions:"Context is provided as JSON. The user just set their team strategy. Give a brief (3-4 sentences) personalized assessment of their roster given their strategy. Be specific about players. End with one actionable recommendation.",maxTokens:400},"player-news":{system:'You are a dynasty fantasy football news reporter. IMPORTANT: ONLY report news about the SPECIFIC player asked about. Do NOT mention any other players. Give 2-3 sentences of the latest news from X/Twitter about this one player. Focus on: trades, injuries, depth chart changes, contract news. If you have no recent news about this specific player, say "No recent news found."',instructions:"",maxTokens:300},dynasty_read:{system:"You are a sharp NFL analyst writing the dynasty read on one player for the GM who rosters him. Translate what is ACTUALLY happening with him in the real world into what it means for his dynasty value. Build the read on real, recent reporting \u2014 never generic platitudes.",instructions:"Context is a JSON object for one player {pid,name,team,pos,age,season,week} (plus league format flags when present). SEARCH THE WEB for the latest reporting on him \u2014 prioritize the last ~10 days plus this offseason's moves \u2014 from ESPN, PFF, The Athletic, and trusted team beat reporters. Then write 3-5 sentences of plain prose that weave together, in order: (1) SITUATION \u2014 the most important real, current development (depth-chart role and usage trend, injury + timeline, contract/roster status, a coaching/scheme change, or a teammate's move that opens or closes a path); (2) IMPACT \u2014 what it does to his value now; (3) LONG-TERM OUTLOOK \u2014 the dynasty trajectory over the next 1-3 seasons and why. Lead with the single most decision-relevant real development. Do NOT restate fantasy points, DHQ value, or position rank. Do NOT pad with generic age-curve commentary \u2014 if news is thin, give the most recent concrete situational fact and what it implies; never invent news. Confident, not hedged. Plain prose only: no markdown, bullets, headers, citations, or sign-off.",maxTokens:500,useWebSearch:!0},"start-sit":{lean:!0,system:"You are Alex, the Dynasty HQ GM assistant: a sharp, confident, human fantasy football coach talking to the owner on game day. Use ONLY the facts you are given \u2014 never invent players, points, odds, injuries or news.",instructions:"Context is a JSON object with this week's facts, exactly as the Lineup screen shows them: {week, projections, winPct, margin, opponent, pointsLeftOnBench, lineupOptimal, swaps[{slot, out, in, gain}], injuries[], byeWatch[{week, count, unfilled, reason, positions}], mode}. Write ONE to TWO punchy sentences of game-day coaching: whether they're favored (winPct vs opponent), the most valuable swap if swaps is non-empty (name who comes in, who sits, and the slot \u2014 only a swap listed in swaps; if swaps is empty the lineup is already optimal), and any injury to watch or a coming bye-week hole. Numbers exactly as given. Plain prose only: no markdown, lists, headers, or sign-off.",maxTokens:400}};function dhqBuildRosterContext(t){const e=window.S||window.App?.S;if(!e?.user)return"";const s=window.myR||window.App?.myR,n=typeof s=="function"?s():null;if(!n)return"";const o=window.pName||window.App?.pName||(i=>i),r=window.pPos||window.App?.pPos||(()=>""),d=window.pAge||window.App?.pAge||(()=>""),c=window.pM||window.App?.pM||(i=>i),f=window.dynastyValue||window.App?.dynastyValue||(()=>0),y=e.playerStats||{},m=window.App?.ageCurveWindows||{QB:{build:[23,27],peak:[28,34],decline:[35,38]},RB:{build:[21,22],peak:[23,25],decline:[26,28]},WR:{build:[22,24],peak:[25,28],decline:[29,31]},TE:{build:[23,25],peak:[26,29],decline:[30,32]},DL:{build:[22,24],peak:[25,29],decline:[30,32]},LB:{build:[22,23],peak:[24,28],decline:[29,31]},DB:{build:[21,23],peak:[24,27],decline:[28,30]},K:{build:[23,27],peak:[28,35],decline:[36,40]}},l=n.settings||{},p=e.leagues?.find(i=>i.league_id===e.currentLeagueId),h=p?.scoring_settings||{},w=!!p?.roster_positions?.includes("SUPER_FLEX"),a=!!p?.roster_positions?.some(i=>["DL","LB","DB","IDP_FLEX"].includes(i)),b=p?.roster_positions||[],T=(n.players||[]).reduce((i,A)=>i+f(A),0),u=typeof assessTeamFromGlobal=="function"?assessTeamFromGlobal:typeof window<"u"&&window.assessTeamFromGlobal?window.assessTeamFromGlobal:null;let v=0;try{v=(u&&u(e.myRosterId)||{}).powerRank||0}catch{v=0}v||(v=[...e.rosters||[]].map(A=>({rid:A.roster_id,dhq:(A.players||[]).reduce((k,R)=>k+f(R),0)})).sort((A,k)=>k.dhq-A.dhq).findIndex(A=>A.rid===e.myRosterId)+1);const S=i=>{const A=c(r(i)),k=d(i);if(!k||!A)return"Unknown";const R=m[A]||{build:[22,24],peak:[25,28],decline:[29,31]};return k<R.build[0]?"Developmental":k<=R.build[1]?"Build-up":k<=R.peak[1]?"Peak":k<=R.decline[1]?"Decline/valuable":"Post-window"},D=(n.starters||[]).filter(i=>i&&i!=="0"),L=D.map(i=>{const A=f(i),k=d(i)||0,R=y[i]?.seasonAvg||y[i]?.prevAvg||0;return{name:o(i),pos:r(i),age:k,dhq:A,ppg:+R.toFixed(1),peak:S(i)}}).sort((i,A)=>A.dhq-i.dhq),x=(n.players||[]).filter(i=>!D.includes(i)&&!(n.reserve||[]).includes(i)&&!(n.taxi||[]).includes(i)).map(i=>({name:o(i),pos:r(i),age:d(i)||0,dhq:f(i)})).filter(i=>i.dhq>0).sort((i,A)=>A.dhq-i.dhq),H=(l.wins||0)+"-"+(l.losses||0),E=p?.name||"?",I=(e.rosters||[]).length,W=I+"-team"+(w?" Superflex":" 1QB")+(a?" IDP":"");if(t)return JSON.stringify({user:e.user.display_name,dhqRank:v+"/"+I,record:H,dhqTotal:T,starters:L.slice(0,5),topBench:x.slice(0,5),league:E,format:W});const F={};(n.players||[]).forEach(i=>{const A=c(r(i));A&&(F[A]=(F[A]||0)+1)});const G=["QB","RB","WR","TE"],U=["DL","LB","DB"],Q=a?G.concat(U):G,O=u?(()=>{try{return u(e.myRosterId)}catch{return null}})():null;let B,M,P=null;O&&O.posAssessment?(P={},Object.entries(O.posAssessment).forEach(([i,A])=>{P[i]={status:A.status,startableHave:A.nflStarters,startableNeed:A.minQuality,depth:A.actual}}),B=(O.needs||[]).map(i=>i&&(i.pos||i.position)||i).filter(Boolean),M=(O.strengths||[]).slice()):(B=[],M=[],Q.forEach(i=>{const A=b.filter(R=>R===i||R==="FLEX"&&["RB","WR","TE"].includes(i)||R==="SUPER_FLEX"&&i==="QB"||R==="IDP_FLEX"&&U.includes(i)).length,k=F[i]||0;k<=A&&B.push(i),k>=A+3&&M.push(i)}));const g=(e.tradedPicks||[]).filter(i=>i.owner_id===e.myRosterId).map(i=>i.season+" R"+i.round).sort(),N=window.getFAAB||window.App?.getFAAB,C=typeof N=="function"?N():null,Y=C?{remaining:C.remaining||0,budget:C.budget||200}:{remaining:0,budget:200},j={sack:h.idp_sack||4,int:h.idp_int||5,pd:h.idp_pass_def||3};return JSON.stringify({user:e.user.display_name,dhqRank:v+"/"+I,record:H,dhqTotal:T,starters:L,topBench:x.slice(0,8),league:E,format:W,gaps:B,surpluses:M,roomStatus:P,picks:g,faab:Y,idpScoring:j})}function dhqBuildMentalityContext(){const t=window.loadMentality||window.App?.loadMentality;if(typeof t!="function")return"";const e=t();return JSON.stringify({mentality:{mentality:{winnow:"WIN NOW",rebuild:"REBUILD",balanced:"BALANCED",prime:"2-3YR WINDOW"}}.mentality[e.mentality]||e.mentality||"BALANCED",untouchable:e.neverDrop||"",notes:e.notes?e.notes.substring(0,150):""})}function dhqCurrentLeagueProfile(){const t=window.S||window.App?.S,e=t?.leagues?.find(s=>s.league_id===t.currentLeagueId)||t?.leagues?.[0]||null;return!e||typeof window.App?.Intelligence?.buildLeagueProfile!="function"?null:window.App.Intelligence.buildLeagueProfile({league:e,rosters:t?.rosters||[],platform:t?.platform||e._platform})}function dhqBuildLeagueFormatBlock(t){const e=t||dhqCurrentLeagueProfile();if(!e||typeof window.App?.Intelligence?.describeLeagueProfile!="function")return"";const s=window.App.Intelligence.describeLeagueProfile(e),n=["[LEAGUE_FORMAT]","Profile: "+(s.summary||"Unknown format")];s.lines.slice(0,8).forEach(r=>n.push("- "+r));const o=e.market?.fantasyCalcCompatibility;if(o){const r=Math.round((o.score||0)*100);n.push("- Market compatibility: FantasyCalc format fit "+r+"%"+(o.reasons?.length?" ("+o.reasons.slice(0,4).join(", ")+")":""))}return e.formatTags?.includes("superflex")&&n.push("CRITICAL: Superflex/2QB context means QB scarcity must drive roster and trade recommendations."),((e.scoring?.teBonus||0)>0||e.scoring?.tePremium>=1.45)&&n.push("CRITICAL: TE premium context means elite target-earning TEs deserve a scoring bump."),e.scoring?.idp&&n.push("CRITICAL: IDP context means defensive recommendations must use IDP scoring and opportunity, not offensive-only market values."),n.join(`
`)}function dhqBuildLeagueContext(){const t=window.S||window.App?.S,e=window.App?.LI||{};if(!t?.rosters?.length)return"";const s=t.leagues?.find(f=>f.league_id===t.currentLeagueId),n=dhqCurrentLeagueProfile(),o=s?.scoring_settings||{},r=n?n.formatTags?.includes("superflex"):!!s?.roster_positions?.includes("SUPER_FLEX"),d=n?!!n.scoring?.idp:!!s?.roster_positions?.some(f=>["DL","LB","DB","IDP_FLEX"].includes(f)),c=e.leagueTradeTendencies||{};return JSON.stringify({leagueProfile:n||null,totalTrades:c.totalTrades||0,pickHeavy:c.pickHeavy||0,avgAssetsPerSide:c.avgAssetsPerSide||0,scoringType:n?.scoring?.label||(o.rec===1?"full-ppr":o.rec===.5?"half-ppr":o.rec===0?"standard":"custom"),isSF:r,isIDP:d,formatTags:n?.formatTags||[],marketCompatibility:n?.market?.fantasyCalcCompatibility||null})}function dhqBuildOwnerProfiles(){const t=window.S||window.App?.S,e=window.App?.LI||{};if(!t?.rosters?.length||!e.ownerProfiles)return"";const s=window.pM||(u=>u),n=window.pPos||(()=>""),o=window.pNameShort||(u=>u),r=window.dynastyValue||(()=>0),c=t.leagues?.find(u=>u.league_id===t.currentLeagueId)?.roster_positions||[],f=t.rosters.map(u=>(u.players||[]).reduce((v,S)=>v+r(S),0)),y=f.length?f.reduce((u,v)=>u+v,0)/f.length:8e4,m=window.App?.LI?.championships||{},l=window.App?.LI?.leagueUsersHistory||{},p={},h={};Object.values(m).forEach(u=>{u.champion&&(p[u.champion]=(p[u.champion]||0)+1),u.runnerUp&&(h[u.runnerUp]=(h[u.runnerUp]||0)+1)});const w={};Object.values(l).forEach(u=>{(u||[]).forEach(v=>{w[v.user_id]||(w[v.user_id]=0),w[v.user_id]++})});const a=window.App?.detectRivalries,b=a?a(t.myRosterId):[],T=t.rosters.filter(u=>u.roster_id!==t.myRosterId).map(u=>{const v=t.leagueUsers.find(g=>g.user_id===u.owner_id)?.display_name||"Team",S=u.settings||{},D=(S.wins||0)+"-"+(S.losses||0),L=(u.players||[]).reduce((g,N)=>g+r(N),0),_={};(u.players||[]).forEach(g=>{const N=s(n(g));N&&(_[N]=(_[N]||0)+1)});const x=["QB","RB","WR","TE"].filter(g=>{const N=c.filter(C=>C===g||C==="FLEX"&&["RB","WR","TE"].includes(g)||C==="SUPER_FLEX"&&g==="QB").length;return(_[g]||0)<=N}),H=(u.players||[]).map(g=>({pid:g,val:r(g)})).sort((g,N)=>N.val-g.val).slice(0,2).map(g=>({name:o(g.pid),pos:n(g.pid),dhq:g.val})),E=e.ownerProfiles?.[u.roster_id],I=L>y*1.1?"contender":L<y*.85?"rebuilder":"mid-tier";let W=0,F=0,G="";try{const g=typeof assessTeamFromGlobal=="function"?assessTeamFromGlobal(u.roster_id):typeof window<"u"&&window.assessTeamFromGlobal?window.assessTeamFromGlobal(u.roster_id):null;g&&(W=g.powerScore||0,F=g.powerRank||0,g.tier&&(G=g.tier+(g.tierRank&&g.tierOf?" (#"+g.tierRank+" of "+g.tierOf+")":"")))}catch{}const U=p[u.roster_id]||0,Q=h[u.roster_id]||0,O=w[u.owner_id]||1,B=O<=1,M=B?"NEW OWNER":O>=4?O+"yr veteran":"",P=b.find(g=>g.rosterId===u.roster_id);return{name:v,record:D,tier:G||I,dynastyValueTier:I,dhqTotal:L,powerScore:W,powerRank:F,championships:U,runnerUps:Q,playoffAppearances:0,tenure:O,isNewOwner:B,tenureNote:M,rivalry:P?{wins:P.wins,losses:P.losses}:null,needs:x,stars:H,dna:E?.trades>0?E.dna:"",tradesWon:E?.tradesWon||0,tradesLost:E?.tradesLost||0}}).slice(0,12);return JSON.stringify(T)}function dhqEnrichWithNews(t){if(!t)return"";const e=window.S||window.App?.S,s=window.pName||window.App?.pName||(l=>l),n=t.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z'.()-]+)+/g)||[],o=[];if(e?.players){const l=new Set(n.map(p=>p.toLowerCase()));for(const p of Object.keys(e.players)){const h=e.players[p],w=((h.first_name||"")+" "+(h.last_name||"")).trim();w&&l.has(w.toLowerCase())&&o.push({id:p,name:w})}}if(n.forEach(l=>{o.find(p=>p.name.toLowerCase()===l.toLowerCase())||o.push({id:null,name:l})}),!o.length)return"";const r=[],d=window._newsCache||{};o.forEach(function(l){const p=Object.keys(d).find(function(w){return w.toLowerCase().includes(l.name.toLowerCase())||l.name.toLowerCase().includes(w.toLowerCase())});if(p&&d[p]){var h=typeof d[p]=="string"?d[p]:d[p].headline||d[p].text||"";h&&r.push(l.name+": "+h.substring(0,120))}});try{var c=localStorage.getItem("dhq_news_cache");if(c){var f=JSON.parse(c),y=f.items||f.headlines||[];Array.isArray(y)&&o.forEach(function(l){var p=l.name.toLowerCase(),h=y.find(function(w){var a=(w.title||w.headline||"").toLowerCase();return a.includes(p)||p.split(" ").every(function(b){return a.includes(b)})});h&&!r.find(function(w){return w.startsWith(l.name+":")})&&r.push(l.name+": "+(h.title||h.headline).substring(0,120))})}}catch{}var m=window.callGrokNews||window.App?.callGrokNews;return typeof m=="function"&&o.forEach(function(l){try{m(l.name)}catch{}}),r.length?`[PLAYER_NEWS]
`+r.join(`
`)+`
`:""}function extractPlayerNames(t){for(var e=new Set,s=/\*\*([A-Z][a-z]+(?:\s+[A-Z][a-z'.()-]+)+)/g,n;(n=s.exec(t))!==null;){var o=n[1].replace(/\s*\(.*$/,"").trim();o.split(" ").length>=2&&e.add(o)}for(var r=/([A-Z][a-z]+(?:\s+[A-Z][a-z'.()-]+)+)\s*\((QB|RB|WR|TE|DL|LB|DB|K|DEF)/g;(n=r.exec(t))!==null;){var d=n[1].trim();d.split(" ").length>=2&&e.add(d)}return Array.from(e)}function findPlayerId(t){var e=window.S||window.App?.S;if(!e?.players)return null;var s=t.toLowerCase().trim();for(var n of Object.keys(e.players)){var o=e.players[n],r=((o.first_name||"")+" "+(o.last_name||"")).toLowerCase().trim();if(r===s)return n}var d=s.split(" "),c=d[d.length-1];for(var f of Object.keys(e.players)){var y=e.players[f];if((y.last_name||"").toLowerCase()===c&&(y.first_name||"").toLowerCase().startsWith(d[0]))return f}return null}function extractResponseNames(t){const e=[];return[/\*\*([A-Z][a-z]+ [A-Z][a-z']+)\*\*/g,/([A-Z][a-z]+ [A-Z][a-z']+)\s*\(/g].forEach(n=>{let o;for(;o=n.exec(t);)e.push(o[1])}),[...new Set(e)]}function isRostered(t){const e=window.S||window.App?.S;return e?.rosters?e.rosters.some(s=>(s.players||[]).includes(t)):!1}function isOnMyRoster(t){const e=window.S||window.App?.S;if(!e?.rosters||!e.myRosterId)return!1;const s=e.rosters.find(n=>n.roster_id===e.myRosterId);return s?(s.players||[]).includes(t):!1}function checkTradeMath(t){const e=/(?:DHQ\s*~?|~)\s*([\d,]+)/gi,s=[];let n;for(;n=e.exec(t);)s.push(parseInt(n[1].replace(/,/g,""),10));if(s.length<2)return null;const o=Math.floor(s.length/2),r=s.slice(0,o).reduce((f,y)=>f+y,0),d=s.slice(o).reduce((f,y)=>f+y,0);if(r===0||d===0)return null;const c=Math.abs(r-d)/Math.max(r,d);return c>.2?{sideA:r,sideB:d,ratio:Math.round(c*100)}:null}const VALIDATION_TYPES=["home-chat","trade-chat","waiver-chat","waiver-agent","draft-chat"];function validateAIResponse(t,e,s){if(!VALIDATION_TYPES.includes(t))return{text:e,issues:[]};const n=typeof e=="string"?e:JSON.stringify(e),o=[],r=extractResponseNames(n),d=t==="waiver-chat"||t==="waiver-agent",c=t==="trade-chat";for(const l of r){const p=findPlayerId(l);if(!p){o.push(`[${l}] could not be verified in your league's player database`);continue}if(d&&isRostered(p)&&o.push(`[${l}] appears to already be rostered \u2014 this recommendation may need adjustment`),c&&isOnMyRoster(p)){const h=n.indexOf(l),w=n.substring(Math.max(0,h-80),h).toLowerCase();/target|acquire|get|their side/.test(w)&&o.push(`[${l}] is already on your roster \u2014 this recommendation may need adjustment`)}}if(c){const l=checkTradeMath(n);l&&o.push(`Trade values appear imbalanced (${l.sideA.toLocaleString()} vs ${l.sideB.toLocaleString()}, ${l.ratio}% gap)`)}if(!o.length)return{text:e,issues:[]};const y=`

\u2014 `+(o.length===1?"One flag before you run with this":"A couple flags before you run with this")+": "+o.join("; ")+". Confirm it on the board before you pull the trigger. \u2014 Alex";return{text:typeof e=="string"?e+y:e,issues:o}}async function dhqAI(t,e,s,n){const o=DHQ_PROMPTS[t];if(!o)throw new Error(`Unknown DHQ AI type: ${t}`);const r=o.system,d=4e3,c=!!o.lean,f=(o.maxTokens||500)+(c?0:d),y=o.useWebSearch||!1,m=["home-chat","trade-chat","player-scout","draft-chat"];let l="";if(m.includes(t)&&(l=dhqEnrichWithNews(e)),["home-chat","trade-chat","waiver-chat","draft-chat"].includes(t)&&e)try{typeof captureUserPreferences=="function"&&captureUserPreferences(e)}catch{}let h="";if(o.instructions&&(h+=o.instructions+`

`),l&&(h+=l+`
`),s&&(h+=s+`

`),["home-chat","trade-chat","waiver-chat","draft-chat","trade-scout","player-scout"].includes(t))try{const E=await buildMemoryContext(window.S?.currentLeagueId);E&&(h+=E+`

`)}catch{}let a;n?.messages?a=n.messages.map((E,I)=>E.role==="user"&&I===n.messages.length-1?{role:"user",content:h+E.content}:E.role==="assistant"&&E.content.length>400?{role:"assistant",content:E.content.substring(0,400)+"..."}:E):a=[{role:"user",content:h+(e||"")}];const b=window.callClaude||window.App?.callClaude;if(typeof b!="function")throw new Error("No AI engine available");const T=c?a:a.map((E,I)=>I===0&&E.role==="user"?{role:"user",content:"[System: "+r+`]

`+E.content}:E),u=typeof canAccess=="function"&&canAccess(window.FEATURES?.BRIEFING_REASONING||"briefing_reasoning"),v=(n?.messages||[]).filter(E=>E.role==="user").slice(-1)[0]?.content||e||"",S=/\b(injur|news|update|latest|rumor|contract|sign(ed|ing)|cut|release|suspend|arrest|trade rumor|depth chart|status|headline|report)\b/i.test(v),D=c?!1:t==="dynasty_read"?!0:u&&(y||S),L=t==="pick-analysis"?0:2,_=c||typeof n?.onDelta=="function"?{lean:c,system:c?r:void 0,onDelta:typeof n?.onDelta=="function"?n.onDelta:void 0}:void 0,x=await b(T,D,L,f,t,_);return validateAIResponse(t,x,{myRosterId:window.S?.myRosterId,rosters:window.S?.rosters}).text}function dhqBuildToneContext(){const t=window.S||window.App?.S;if(!t?.rosters?.length)return"";const e=window.myR||window.App?.myR,s=typeof e=="function"?e():null;if(!s)return"";const n=s.settings||{},o=n.wins||0,r=n.losses||0,d=o+r+(n.ties||0),f=[...t.rosters].sort((b,T)=>(T.settings?.wins||0)-(b.settings?.wins||0)).findIndex(b=>b.roster_id===t.myRosterId)+1,y=t.rosters.length,m=f<=Math.ceil(y/2),l=t.nflState||{},p=l.week||0,h=l.season_type==="off"||p===0?"offseason":p<=4?"early":p<=10?"midseason":p<=14?"late":"playoffs";let w="compete";try{if(window.WR?.GmMode?.getMode)w=window.WR.GmMode.getMode(t.currentLeagueId);else{const b=window._wrGmStrategy;w={contend:"win_now",balanced:"compete",retool:"compete",balanced_rebuild:"rebuild"}[b?.mode]||b?.mode||"compete"}}catch{}const a=[];return w==="win_now"||w==="compete"&&m?d>0&&o/d>=.65?a.push(`Team is winning and contending. Be confident and aggressive. Use language like "let's close this out", "championship-caliber move", "we're in the driver's seat".`):d>0&&o/d>=.45?a.push('Team is competitive but not dominant. Be strategic and focused. Use language like "we need to be smart here", "one move away", "this is where good GMs separate".'):a.push('Team is contending but struggling. Be honest but motivating. Use language like "we need to make a move", "the window is still open but narrowing".'):w==="rebuild"?a.push(`Team is rebuilding. Be patient and future-focused. Use language like "investing in the future", "building blocks", "this is a process \u2014 trust it", "we're stacking assets".`):a.push('Team is at a crossroads. Be analytical and decisive. Use language like "this decision defines our direction", "we need to pick a lane", "the data says...".'),h==="offseason"?a.push(`It's the offseason \u2014 be proactive and forward-planning. "Offseason is where championships are built."`):h==="late"?a.push("Late season \u2014 urgency matters. Every move counts for playoff positioning."):h==="playoffs"&&a.push("Playoff time \u2014 maximum intensity. Win-now moves only, no long-term thinking."),a.join(" ")}function dhqBuildRecommendationContext(){try{const t=window.App?.Intelligence;if(typeof t?.buildAlexRecommendationDigest!="function")return"";const e=t.buildAlexRecommendationDigest({limit:8});return!Array.isArray(e)||!e.length?"":`[TOP_RECOMMENDATIONS]
These are deterministic recommendation objects already shown or prepared by War Room cards. Treat them as the source of truth; explain, prioritize, or compare them instead of inventing a conflicting list.
`+JSON.stringify(e,null,2)}catch{return""}}function dhqBuildBehaviorContext(){try{const t=window.App?.Intelligence;if(typeof t?.buildLeagueBehaviorBaselines!="function"||typeof t?.buildOwnerBehaviorProfiles!="function")return"";const e=window.S||window.App?.S||{},s=window.App?.LI||{},n=e.rosters||s.rosters||[],o=s.tradeHistory||[],r=s.ownerProfiles||{};if(!o.length&&!Object.keys(r).length)return"";const d=s.leagueBehaviorBaselines||t.buildLeagueBehaviorBaselines({league:e.currentLeague||e.leagues?.find(l=>l.league_id===e.currentLeagueId)||e.leagues?.[0],rosters:n,ownerProfiles:r,tradeHistory:o,draftOutcomes:s.draftOutcomes||[]}),c=s.ownerBehaviorProfiles||t.buildOwnerBehaviorProfiles({rosters:n,ownerProfiles:r,tradeHistory:o,draftOutcomes:s.draftOutcomes||[],baselines:d}),f=e.leagueUsers||e.users||e.currentLeague?.users||[],y=l=>{const p=n.find(w=>String(w.roster_id)===String(l)),h=f.find(w=>w.user_id===p?.owner_id);return h?.metadata?.team_name||h?.display_name||h?.username||c[String(l)]?.ownerName||`Roster ${l}`},m=Object.values(c||{}).filter(l=>l?.sample?.trades>0).sort((l,p)=>(p.sample?.trades||0)-(l.sample?.trades||0)).slice(0,8).map(l=>({rosterId:l.rosterId,owner:y(l.rosterId),confidence:l.confidence,observed:(l.observedFacts||[]).slice(0,4).map(p=>p.detail),inferredTags:l.inferences||[],offerFrame:l.strategy?.offerFrame||""}));return m.length?`[BEHAVIORAL_CONTEXT]
Observed owner behavior and league baselines. Treat observed facts as stronger than inferred tags, and call out low confidence when sample sizes are thin.
`+JSON.stringify({baselines:d,ownerReads:m},null,2):""}catch{return""}}function dhqTeamModeBlock(t,e){let s=`[TEAM_MODE]
`;return t==="REBUILDING"||e==="REBUILDING"?(s+=`Mode: REBUILD
`,s+=`Rules:
`,s+=`- ONLY recommend youth (age 25 or younger) and draft picks
`,s+=`- Sell aging veterans (27+ with declining production) for picks/youth
`,s+=`- FAAB: only bid on young upside or emergency injury replacements
`,s+=`- Never recommend "depth" pickups of veterans
`,s+=`- Patience is a strategy \u2014 don't make moves just to make moves
`):t==="ELITE"||t==="CONTENDER"||e==="CONTENDING"?(s+=`Mode: CONTEND (win now)
`,s+=`Rules:
`,s+=`- Recommend proven starters who produce THIS season
`,s+=`- Trade future picks for upgrades at weak spots
`,s+=`- FAAB: bid aggressively on difference-makers who would start
`,s+=`- Don't recommend speculative youth projects that won't help now
`):(s+=`Mode: CROSSROADS (must commit to a direction)
`,s+=`Rules:
`,s+=`- Team must pick: push for contention or begin rebuild
`,s+=`- No half-measures \u2014 don't recommend generic "add depth"
`,s+=`- Analyze which direction makes more sense given age profile and picks
`),s}function dhqQualityRulesBlock(){return`[QUALITY_RULES]
- NEVER recommend players with DHQ below 500 \u2014 not worth a roster spot
- NEVER recommend players averaging below 5.0 PPG with 6+ games \u2014 below replacement
- NEVER recommend "depth for depth's sake" \u2014 a bad player wastes a roster spot
- If no quality free agents exist, say "HOLD YOUR FAAB \u2014 no impactful targets available"
- Remaining FAAB is a weapon for mid-season breakouts and injuries \u2014 preserve it
`}function dhqBuildPowerRankings(){const t=window.S||window.App?.S||{},e=t.rosters||[];if(!e.length)return"";const s=typeof assessTeamFromGlobal=="function"?assessTeamFromGlobal:typeof window<"u"&&window.assessTeamFromGlobal?window.assessTeamFromGlobal:null;if(!s)return"";const n=e.map(o=>{let r={};try{r=s(o.roster_id)||{}}catch{r={}}const d=(t.leagueUsers||[]).find(c=>c.user_id===o.owner_id)?.display_name||"Team "+o.roster_id;return{rank:r.powerRank||0,team:d,isYou:o.roster_id===t.myRosterId,powerScore:r.powerScore||0,tier:r.tier||"",tierRank:r.tierRank&&r.tierOf?r.tierRank+" of "+r.tierOf:"",rosterHealth:r.healthScore||0}}).filter(o=>o.rank>0).sort((o,r)=>o.rank-r.rank);return n.length?JSON.stringify(n):""}function dhqContext(t){const e=[],s=dhqBuildRosterContext(!1);s&&e.push(`[ROSTER_CONTEXT]
`+s);const n=dhqBuildMentalityContext();n&&e.push(`[MENTALITY]
`+n);const o=dhqBuildLeagueContext();o&&e.push(`[LEAGUE]
`+o);const r=dhqBuildPowerRankings();if(r&&e.push(`[POWER_RANKINGS]
The app's official league power ranking, already sorted (rank 1 = best, "isYou" marks the user). When asked for power rankings or the user's rank, use THIS exact order, these exact team names, and powerScore \u2014 do not re-sort by DHQ or invent/skip any team:
`+r),t){const a=dhqBuildOwnerProfiles();a&&e.push(`[OWNERS]
`+a)}const d=dhqBuildToneContext();d&&e.push(`[TONE]
`+d);try{const a=(window.S||window.App?.S)?.currentLeagueId,b="wr_chat_"+a,T=a?localStorage.getItem(b):null;if(T){const v=JSON.parse(T).filter(S=>S.role==="assistant"&&S.content.length>50).slice(-2);if(v.length){const S=v.map(D=>D.content.substring(0,150)+(D.content.length>150?"...":""));e.push(`[RECENT_CONVERSATIONS]
Your recent advice to this user (reference naturally if relevant):
`+S.join(`
---
`))}}}catch{}let c=null;try{c=window.WR?.GmMode?.promptData?.((window.S||window.App?.S)?.currentLeagueId)||null}catch{}if(c)e.push(`[GM_STRATEGY]
The owner has committed to this strategy. IMPORTANT: honor it in every recommendation.
`+window.WR.GmMode.promptBlock(null,c));else{const a=window._wrGmStrategy;if(a&&(a.mode!=="balanced"||a.riskTolerance!=="moderate"||a.untouchable?.length||a.targets?.length||a.notes)){const b=[`Mode: ${a.mode}`,`Risk: ${a.riskTolerance}`];if(a.untouchable?.length){const u=window.S||{},v=a.untouchable.map(S=>u.players?.[S]?.full_name||S).join(", ");b.push(`Untouchable players: ${v}`)}a.targets?.length&&b.push(`Targeting in trades: ${a.targets.join(", ")}`);const T=Object.entries(a.positionalNeeds||{}).filter(([,u])=>u>=7).map(([u,v])=>`${u}(${v}/10)`);T.length&&b.push(`High priority positions: ${T.join(", ")}`),a.notes&&b.push(`Owner notes: "${a.notes}"`),e.push(`[GM_STRATEGY]
The owner has set the following strategic preferences. IMPORTANT: Honor these when making recommendations.
`+b.join(`
`))}}window._leagueDocsContext&&e.push(`[LEAGUE_DOCUMENTS]
The commissioner has uploaded these league-specific documents. Use them to answer league rule questions, reference awards history, and understand league customs:
`+window._leagueDocsContext);const f=window.S||window.App?.S||{},y=dhqBuildLeagueFormatBlock();y&&e.push(y);const m=dhqBuildBehaviorContext();m&&e.push(m);const l=dhqBuildRecommendationContext();l&&e.push(l);const p=typeof assessTeamFromGlobal=="function"?assessTeamFromGlobal(f.myRosterId):null,h=p?.tier||"",w=p?.window||"";if(c){let a=`[TEAM_MODE]
`;c.mode==="rebuild"?(a+=`Mode: REBUILD (GM-committed strategy)
`,a+=`Rules:
`,a+=`- ONLY recommend youth (age 25 or younger) and draft picks
`,a+=`- Sell aging veterans (27+ with declining production) for picks/youth
`,a+=`- FAAB: only bid on young upside or emergency injury replacements
`,a+=`- Never recommend "depth" pickups of veterans
`,a+=`- Patience is a strategy \u2014 don't make moves just to make moves
`):c.mode==="win_now"?(a+=`Mode: WIN NOW (GM-committed strategy)
`,a+=`Rules:
`,a+=`- Recommend proven starters who produce THIS season
`,a+=`- Trade future picks for upgrades at weak spots
`,a+=`- FAAB: bid aggressively on difference-makers who would start
`,a+=`- Don't recommend speculative youth projects that won't help now
`):c.mode==="compete"?(a+=`Mode: COMPETE (GM-committed strategy)
`,a+=`Rules:
`,a+=`- Balance present and future \u2014 favor players aged 24-27 with 3+ peak years left
`,a+=`- Trade aging assets only at peak value; no fire sales
`,a+=`- FAAB: moderate bids on players who upgrade a starting spot
`,a+=`- Never mortgage multiple future firsts for a rental
`):(a+=`Mode: CUSTOM (GM-committed strategy)
`,a+=`Rules:
`,a+=`- Follow the [GM_STRATEGY] block exactly \u2014 aggression, postures, positions, and sell rules as configured
`);const b=h==="REBUILDING"||w==="REBUILDING"?"rebuild":h==="ELITE"||h==="CONTENDER"||w==="CONTENDING"?"win_now":"";b&&b!==c.mode&&(a+="Reality check: roster grades "+(h||w)+" while the GM has committed to "+String(c.modeLabel||c.mode).toUpperCase()+` \u2014 acknowledge the tension, follow the GM's direction.
`),e.push(a)}else e.push(dhqTeamModeBlock(h,w));return e.push(dhqQualityRulesBlock()),e.join(`

`)}function dhqCompactContext(){const t=[],e=dhqBuildRosterContext(!0);e&&t.push(`[ROSTER_CONTEXT]
`+e);const s=dhqBuildMentalityContext();s&&t.push(`[MENTALITY]
`+s);const n=dhqBuildLeagueFormatBlock();n&&t.push(n);const o=dhqBuildBehaviorContext();o&&t.push(o);const r=dhqBuildRecommendationContext();return r&&t.push(r),t.join(`

`)}const _dynReadCache=new Map;function _dynReadFormat(){try{const t=window.S,e=t&&t.leagues&&t.currentLeagueId?t.leagues.find(function(m){return m.league_id===t.currentLeagueId}):null;if(!e)return null;const s=e.roster_positions||[],n=e.scoring_settings||{};if(!s.length&&!Object.keys(n).length)return null;const o=Number(n.rec)||0,r=o>=1?"ppr":o>=.5?"half_ppr":"std",d=s.filter(function(m){return m==="QB"}).length,c=s.indexOf("SUPER_FLEX")!==-1||d>=2,f=(Number(n.bonus_rec_te)||Number(n.rec_te)||0)>0,y=s.some(function(m){return["IDP_FLEX","DL","LB","DB","DE","CB","S"].indexOf(m)!==-1});return{scoringType:r,superflex:c,tep:f,idp:y}}catch{return null}}async function fetchDynastyRead(t,e){e=e||{};const s=e.fallback||"";try{if(!t||!t.pid||typeof canAccess=="function"&&!canAccess("dynasty_read_ai"))return s;const n=_dynReadFormat(),o=n?n.scoringType+(n.superflex?"-sf":"")+(n.tep?"-tep":"")+(n.idp?"-idp":""):"na",r=t.week==null||t.week===""?"off":t.week,d="dynread:"+t.pid+":"+(t.season||"")+":"+r+":"+o;if(_dynReadCache.has(d))return _dynReadCache.get(d);const c={pid:String(t.pid),name:t.name||"",team:t.team||"",pos:t.pos||"",age:t.age||null,season:t.season||"",week:t.week==null?0:t.week};n&&(c.scoringType=n.scoringType,c.superflex=n.superflex,c.tep=n.tep,c.idp=n.idp);const f=window.AlexVoice&&window.AlexVoice.sanitize?window.AlexVoice.sanitize:function(m){return String(m||"").replace(/\s+/g," ").trim()};let y="";if(typeof window.hasServerAI=="function"&&window.hasServerAI()&&window.OD&&typeof window.OD.callAI=="function")try{const m=await window.OD.callAI({type:"dynasty_read",context:JSON.stringify(c)});y=f(m&&(m.analysis||m.text||m.response)||"")}catch{}if(!y&&window.S&&window.S.apiKey&&typeof dhqAI=="function")try{const m=await dhqAI("dynasty_read","",JSON.stringify(c));y=f(typeof m=="string"?m:m&&(m.text||m.analysis||m.response)||"")}catch{}return y?(_dynReadCache.set(d,y),y):s}catch{return s}}Object.assign(window.App,{DHQ_IDENTITY,DHQ_PROMPTS,dhqAI,fetchDynastyRead,dhqContext,dhqCompactContext,dhqBuildRosterContext,dhqBuildMentalityContext,dhqBuildLeagueContext,dhqBuildLeagueFormatBlock,dhqTeamModeBlock,dhqQualityRulesBlock,dhqCurrentLeagueProfile,dhqBuildOwnerProfiles,dhqBuildToneContext,dhqBuildBehaviorContext,dhqBuildRecommendationContext,dhqEnrichWithNews,extractPlayerNames,findPlayerId,validateAIResponse}),Object.assign(window,{DHQ_IDENTITY,DHQ_PROMPTS,dhqAI,fetchDynastyRead,dhqContext,dhqCompactContext,dhqBuildRosterContext,dhqBuildMentalityContext,dhqBuildLeagueContext,dhqBuildLeagueFormatBlock,dhqTeamModeBlock,dhqQualityRulesBlock,dhqCurrentLeagueProfile,dhqBuildOwnerProfiles,dhqBuildToneContext,dhqBuildBehaviorContext,dhqBuildRecommendationContext,dhqEnrichWithNews,extractPlayerNames,findPlayerId,validateAIResponse}),window.isRostered=isRostered,window.isOnMyRoster=isOnMyRoster,window.checkTradeMath=checkTradeMath,window.extractResponseNames=extractResponseNames;

