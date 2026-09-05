// shared/dhq-engine.js — DHQ Dynasty Valuation Engine
// Extracted from War Room Scout — shared by War Room Scout + War Room
window.App = window.App || {};
const DHQ_CORE=window.App.DhqCore||null;

// Sandbox gate (fix #7): host-based, matching the convention in
// shared/dev-preview-config.js / js/app.js. Unvalidated scoring changes
// stay behind this until proven in prod. Safe under headless VM (localhost).
function _dhqIsSandbox(){
  try{
    if(typeof window.isSandbox==='function')return!!window.isSandbox();
    const h=window.location?.hostname||'';
    return h==='localhost'||h==='127.0.0.1'||h==='[::1]'||h.includes('sandbox');
  }catch(e){return false;}
}

// ══════════════════════════════════════════════════════════════════
// LEAGUEINTEL — Your league's actual value system
// Builds IDP value from real scoring data + draft history + FAAB market
// ══════════════════════════════════════════════════════════════════

const LI_CACHE_KEY='dhq_leagueintel_labv2_1'; // v15 (2026-09-02): superflex QB market alignment — cached v14 values predate it
// LI staleness is season-aware: 8h is fine in the offseason (values drift
// slowly), but during the regular season rosters/FAAB/trades move daily, so
// the cache goes stale in 2h. Resolved at check time (not parse time) because
// nflState isn't loaded yet when this module parses.
const LI_TTL=8*60*60*1000; // 8 hours — offseason default
const LI_TTL_IN_SEASON=2*60*60*1000; // 2 hours — regular season
function _liTtl(){
  const ns=(window.App.S||window.S)?.nflState;
  return ns?.season_type==='regular'?LI_TTL_IN_SEASON:LI_TTL;
}
let LI={}; // LeagueIntel data object — populated async after connect
let LI_LOADED=false;

const DHQ_DEFAULT_AGE_CURVES={
  QB:{build:[23,27],peak:[28,34],decline:[35,38]},
  RB:{build:[21,22],peak:[23,25],decline:[26,28]},
  WR:{build:[22,24],peak:[25,28],decline:[29,31]},
  TE:{build:[23,25],peak:[26,29],decline:[30,32]},
  DL:{build:[22,24],peak:[25,29],decline:[30,32]},
  EDGE:{build:[22,24],peak:[25,29],decline:[30,32]},
  LB:{build:[22,23],peak:[24,28],decline:[29,31]},
  DB:{build:[21,23],peak:[24,27],decline:[28,30]},
  K:{build:[23,27],peak:[28,35],decline:[36,40]},
};

const DHQ_DEFAULT_DECAY_RATES={QB:0.12,RB:0.22,WR:0.18,TE:0.16,K:0.08,DL:0.15,EDGE:0.15,LB:0.16,DB:0.18};
const DHQ_DECLINE_END_FACTOR={QB:0.78,RB:0.62,WR:0.68,TE:0.70,K:0.82,DL:0.70,EDGE:0.70,LB:0.68,DB:0.66};

// ══════════════════════════════════════════════════════════════════
// SITMULT_TUNING — Situation-multiplier knobs (single source of truth)
// Every magic number in the sitMult assembly (~line ~960-1080) lives here so
// the multiplicative stack is auditable/tunable from one place. Values are
// the exact constants previously inlined — this is a behavior-preserving lift.
// The stack is applied left-to-right and clamped to [clamp.min, clamp.max].
// Factor groups map 1:1 to playerMeta.sitMultFactors keys.
// ══════════════════════════════════════════════════════════════════
const SITMULT_TUNING={
  // A) Team / roster status — offseason-aware availability penalties.
  status:{
    activeUnrosteredNoTeamInSeason:0.30, // mid-season, no NFL team, not rostered = retired/worthless
    activeUnrosteredNoTeamOffseasonRecent:0.50, // offseason, stale team but produced recently = unsigned FA
    activeUnrosteredNoTeamOffseasonStale:0.30, // offseason, no team, no recent production = likely retired
    activeUnrosteredHasTeam:0.55, // has NFL team but nobody rosters them = available FA
    activeRosteredNoTeamOffseason:1.0, // rostered, null team in offseason = Sleeper lag, no penalty
    activeRosteredNoTeamInSeason:0.65, // rostered, no team mid-season = cut/released
  },
  // B) Role detection vs positional starter PPG (recent production).
  role:{
    deepBackupPct:0.30, lowBackupPct:0.50, fringePct:0.70, premiumPct:1.30,
    deepBackup:{QB:0.45,other:0.65}, // QB rarely sees the field
    lowBackup:{QB:0.55,other:0.75}, // QB clipboard holder
    fringe:{QB:0.70,other:0.85}, // fringe starter / high backup
    premium:1.10, // premium starter (>=130% of starter PPG)
  },
  // C) Career trajectory by number of real starter seasons.
  trajectory:{
    franchise:1.18, // >=4 starter seasons: proven franchise player
    established:1.12, // >=3: established starter
    twoYear:1.05, // >=2: two-year starter
    oneYear:0.88, // ==1: one-year wonder
    zero:0.80, // 0 real starter seasons: all hype
    // Early-career grace: a player can't fairly be tagged "all hype" / "one-year
    // wonder" before they've had the NFL seasons to prove it. For years_exp<=2 the
    // oneYear/zero PENALTY is lifted toward 1.0 by this fraction (keyed on years_exp);
    // exp>=3 → no grace (full penalty). Only ever lifts a penalty, never adds a bonus.
    earlyCareerGrace:{0:1.0,1:1.0,2:0.5},
  },
  // D) Youth premium + D2) breakout upside (dynasty crown jewels).
  youth:{
    age22:{maxAge:22,minPpgPct:0.5,mult:1.25},
    age23:{maxAge:23,minPpgPct:0.5,mult:1.20},
    age25:{maxAge:25,minPpgPct:0.7,mult:1.10},
    upsideStrong:{maxAge:24,minPpgPct:0.85,minStarterSeasons:1,mult:1.15}, // young + starter-level
    upsideModerate:{maxAge:24,minPpgPct:0.65,minStarterSeasons:1,mult:1.08}, // young + approaching starter
    // D5) Early-career development floor: a young player in the build/developmental
    // age band shouldn't eat the full below-peak age discount ON TOP OF a thin
    // production base (the double-penalty that buries high-pick, slow-start sophs).
    // For years_exp<=2 we lift the EFFECTIVE age contribution (ageFactor) to this
    // floor via a sitMult credit — never above neutral, never for exp>=3.
    earlyCareerBuildFloor:{0:0.95,1:0.95,2:0.90},
  },
  // E) Durability — games-played penalties.
  durability:{
    gpThresh:10,
    chronic:0.82, // <=10 GP in two seasons (>=2 seasons of history)
    recent:0.90, // <=10 GP recently (>=1 season)
  },
  // F/G) Elite-production premium and replacement-level penalty by pos rank.
  posRank:{
    top3:1.20, top5:1.12, top10:1.05, // elite / star / solid-starter tiers
    bottom10PctCut:0.90, bottom10Pct:0.78, // bottom 10%: roster filler
    bottom25PctCut:0.75, bottom25Pct:0.88, // bottom 25%: replacement level
  },
  clamp:{min:0.40,max:1.60}, // final sitMult clamp
  warn:{lo:0.3,hi:1.8}, // raw (pre-clamp) sitMult outside this range logs a compounding warning
};

// ─────────────────────────────────────────────────────────────────────────
// EARLY-CAREER STASH FLOOR — the draft-capital / upside signal the veteran
// engine is otherwise blind to. The veteran value is ~75% realized production,
// so a 2nd/3rd-year player who flashed but sits behind a depth chart craters to
// a deep-bench score (e.g. a former Day-1/2/3 pick at ~180) even though the
// dynasty MARKET still prices his pedigree. NFL draft capital is not an input to
// the veteran engine anywhere (the only pedigree concept, isElitePedigree, needs
// 4+ starter seasons — structurally excludes the young). This floor injects that
// signal AFTER value assembly + FC blend, hybrid by design:
//   • CAPITAL where it's actually resolvable (round → stash-tier floor), and
//   • a MARKET backstop (capped fraction of the player's own FantasyCalc value)
//     for everyone else — because Sleeper's feed carries no NFL draft round/pick
//     and findProspect only holds the current incoming class.
// FLOOR ONLY (never lowers a score → producers/elites byte-identical), capped at
// stashCeiling (never manufactures a starter), guarded so a market-written-off
// bust can't be floored far above consensus, and decayed by years_exp (an
// unproven player earns less benefit-of-the-doubt the longer he's done nothing).
// Tune here. See [[project_sophomore_dhq_fix]] / [[project_rookie_dhq_pipeline]].
const EARLY_CAREER_FLOOR_TUNING={
  minYearsExp:1,   // skip true rookies (exp 0) — they have their own tuned FC/prospect pipeline
  maxYearsExp:2,   // 2nd/3rd-year players only; null/unknown years_exp → skip (no-op for established vets)
  floorPositions:['QB','RB','WR','TE'], // OFFENSE skill only. K/DEF/IDP are excluded: the engine
                   // deliberately suppresses them and (on MFL, which carries native NFL draft round)
                   // an unguarded capital floor would manufacture dynasty value for a backup kicker.
  stashCeiling:1500, // a floor may NEVER lift a player above this — stash tier, never a starter
  // Absolute floor by NFL draft round (pre-decay), on the 0-10000 scale. All well under any
  // starter value (an elite tops ~7500-10000), so this only rescues the cratered, never inflates.
  roundFloor:{1:1000,2:700,3:520,4:430,5:330,6:250,7:200},
  // Benefit-of-the-doubt fades as an unproven player accrues seasons with nothing to show.
  expDecay:{1:0.92,2:0.78},
  marketFloorFrac:0.55,  // market backstop: floor at this fraction of the format-scaled FC value
  marketGuardMult:0.90,  // when FC RANKS the player, a CAPITAL floor may not exceed this × his market
                         // value — stops a high pick the market has discounted from over-flooring.
  capitalNoMarketCeiling:450, // when FC has DROPPED/never-listed the player (fcScaled==0 — the strongest
                         // "market wrote him off" signal), cap the pedigree-only floor here (deep-stash
                         // tier, intentionally below the 500 FAAB-suggest gate) instead of leaving it
                         // unguarded. A delisted former R1/R2 can't be floored to a near-hold value.
};

// Seed NFL draft-capital map for recent classes (normalized name → {round[,pick,year]}). The
// veteran engine has NO native NFL-draft input (Sleeper omits it; findProspect = current class
// only), so this hand-seeded STARTER set supplies capital for already-in-league players. Coverage
// is NOT required for correctness: MFL leagues supply capital natively, current-class rookies
// resolve via findProspect, and every other early-career player falls back to the market backstop.
// Only `round` drives the floor — keep it accurate; pick/year are informational. Expand each year
// from an authoritative draft dataset. (Studs who already produce are omitted — the floor never
// binds for them; this leans toward the Day-2/3 fliers where it actually matters.)
const DHQ_NFL_DRAFT_CAPITAL={
  // ── 2025 class (entering Yr2) ──
  'donte thornton':{round:4,pick:108,year:2025}, // the motivating example — Raiders WR
  'jack bech':{round:2,year:2025},'tre harris':{round:2,year:2025},'luther burden':{round:2,year:2025},
  'jayden higgins':{round:2,year:2025},'jalen royals':{round:4,year:2025},'pat bryant':{round:3,year:2025},
  'elic ayomanor':{round:4,year:2025},'jaylin noel':{round:3,year:2025},'tory horton':{round:5,year:2025},
  // ── 2024 class (entering Yr3 — still inside the maxYearsExp window) ──
  // NOTE: 'jalynn polk' has NO space — _dhqNormName deletes the apostrophe in "Ja'Lynn Polk".
  'adonai mitchell':{round:2,year:2024},'jalynn polk':{round:2,year:2024},'keon coleman':{round:2,year:2024},
  'ladd mcconkey':{round:2,year:2024},'roman wilson':{round:3,year:2024},'jermaine burton':{round:3,year:2024},
  'malachi corley':{round:3,year:2024},'jalen mcmillan':{round:3,year:2024},'troy franklin':{round:4,year:2024},
  'javon baker':{round:4,year:2024},'devontez walker':{round:4,year:2024},'jamari thrash':{round:5,year:2024},
  'xavier legette':{round:1,year:2024},'ricky pearsall':{round:1,year:2024},'jonathon brooks':{round:2,year:2024},
  'trey benson':{round:3,year:2024},'blake corum':{round:3,year:2024},'marshawn lloyd':{round:3,year:2024},
  'braelon allen':{round:4,year:2024},'bucky irving':{round:4,year:2024},'ray davis':{round:4,year:2024},
  'audric estime':{round:5,year:2024},
};

// Name normalizer for the seed map. NFD-fold diacritics (Estimé→estime), DELETE apostrophes
// (Ja'Lynn→jalynn — so map keys must use that form, NOT a space), hyphen/underscore→space,
// drop Jr/Sr/II..V suffixes. Every seed-map key must equal _dhqNormName(realName).
function _dhqNormName(n){
  return String(n||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
    .replace(/[.'’`]/g,'').replace(/[-_]/g,' ')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g,'')
    .replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
}

// Resolve an early-career player's NFL draft capital from the best available source.
// Priority: platform-native (MFL) → seed map → current-class prospect CSV. null = unknown.
function _dhqResolveDraftCapital(p){
  if(!p)return null;
  // 1) Platform-native (MFL maps nfl_draft_round/pick onto the normalized player)
  const nr=parseInt(p.nfl_draft_round,10),np=parseInt(p.nfl_draft_pick,10);
  if(Number.isFinite(nr)&&nr>=1&&nr<=7)return{round:nr,pick:Number.isFinite(np)?np:null,source:'platform'};
  // 2) Seed map (recent classes, name-keyed)
  const rawName=p.full_name||((p.first_name||'')+' '+(p.last_name||'')).trim();
  const nm=_dhqNormName(rawName);
  const hit=nm&&DHQ_NFL_DRAFT_CAPITAL[nm];
  if(hit&&hit.round>=1&&hit.round<=7)return{round:hit.round,pick:hit.pick??null,source:'seed'};
  // 3) Current-class rookie (findProspect carries draftRound/draftPick)
  try{
    if(typeof window!=='undefined'&&typeof window.findProspect==='function'){
      const pr=window.findProspect(rawName);
      const r=parseInt(pr?.draftRound,10);
      if(Number.isFinite(r)&&r>=1&&r<=7)return{round:r,pick:parseInt(pr?.draftPick,10)||null,source:'prospect'};
    }
  }catch(_e){}
  return null;
}

function _dhqPeakWindowsFromCurves(curves){
  return Object.fromEntries(Object.entries(curves||{}).map(([pos,curve])=>[pos,curve.peak||[23,29]]));
}

function _dhqCurveForPos(pos,curves){
  const p=pos==='DE'||pos==='DT'||pos==='NT'||pos==='EDGE'?'DL':
    pos==='CB'||pos==='S'||pos==='SS'||pos==='FS'?'DB':
    pos==='OLB'||pos==='ILB'||pos==='MLB'?'LB':pos;
  return (curves||{})[p]||DHQ_DEFAULT_AGE_CURVES[p]||DHQ_DEFAULT_AGE_CURVES.WR;
}

function _dhqAgeCurvePhase(age,pos,curves){
  const curve=_dhqCurveForPos(pos,curves);
  if(!age)return'unknown';
  if(age<curve.build[0])return'developmental';
  if(age<=curve.build[1])return'build';
  if(age<=curve.peak[1])return'peak';
  if(age<=curve.decline[1])return'decline';
  return'post_decline';
}

function _dhqAgeCurveFactor(age,pos,curves,decayRates){
  const curve=_dhqCurveForPos(pos,curves);
  const [buildStart,buildEnd]=curve.build;
  const [peakStart,peakEnd]=curve.peak;
  const [,declineEnd]=curve.decline;
  const rate=(decayRates||{})[pos]||DHQ_DEFAULT_DECAY_RATES[pos]||0.16;
  const declineEndFactor=DHQ_DECLINE_END_FACTOR[pos]||0.68;

  if(!age)return 1.0;
  if(age<buildStart){
    const startAge=18;
    const progress=Math.max(0,Math.min(1,(age-startAge)/Math.max(1,buildStart-startAge)));
    return 0.72+0.08*progress;
  }
  if(age<=buildEnd){
    const progress=(age-buildStart)/Math.max(1,buildEnd-buildStart);
    return 0.82+0.16*Math.max(0,Math.min(1,progress));
  }
  if(age<peakStart)return 0.98;
  if(age<=peakEnd)return 1.0;
  if(age<=declineEnd){
    const progress=(age-peakEnd)/Math.max(1,declineEnd-peakEnd);
    return 1-(1-declineEndFactor)*Math.max(0,Math.min(1,progress));
  }

  const yearsPost=age-declineEnd;
  let factor=declineEndFactor-(yearsPost*rate);
  if(yearsPost>=3)factor*=0.75;
  if(yearsPost>=6)factor*=0.55;
  return Math.max(0.02,factor);
}

function _dhqPpgReliability(gp){
  if(DHQ_CORE?.ppgReliability)return DHQ_CORE.ppgReliability(gp);
  const games=Number(gp)||0;
  if(games>=12)return 1;
  if(games>=10)return +(0.96+(games-10)*0.02).toFixed(3);
  if(games>=8)return +(0.88+(games-8)*0.04).toFixed(3);
  if(games>=5)return +(0.70+(games-5)*0.06).toFixed(3);
  if(games>=3)return +(0.55+(games-3)*0.075).toFixed(3);
  return games>0?0.45:0;
}

function _dhqStarterCountsFromRoster(rosterPositions){
  if(DHQ_CORE?.starterCountsFromRoster){
    return DHQ_CORE.starterCountsFromRoster(rosterPositions,{includeDefense:true,minimumOne:true});
  }
  const starterCounts={QB:0,RB:0,WR:0,TE:0,K:0,DEF:0,DL:0,LB:0,DB:0};
  const add=(pos,amount)=>{
    pos=String(pos||'').toUpperCase();
    if(pos==='DE'||pos==='DT'||pos==='NT'||pos==='EDGE')pos='DL';
    if(pos==='CB'||pos==='S'||pos==='SS'||pos==='FS')pos='DB';
    if(pos==='OLB'||pos==='ILB'||pos==='MLB')pos='LB';
    if(pos==='DST'||pos==='D/ST')pos='DEF';
    if(starterCounts[pos]!=null)starterCounts[pos]+=amount;
  };

  (rosterPositions||[]).forEach(slot=>{
    if(['BN','IR','TAXI'].includes(slot))return;
    if(slot==='FLEX'){add('RB',0.4);add('WR',0.4);add('TE',0.2);}
    else if(slot==='SUPER_FLEX'){
      // Superflex means one additional startable QB slot. The model should
      // price the whole QB starter pool, not only locked-in QB slots.
      add('QB',1);
    }
    else if(slot==='IDP_FLEX'){add('DL',0.35);add('LB',0.35);add('DB',0.3);}
    else if(slot==='REC_FLEX'){add('WR',0.5);add('TE',0.5);}
    else add(slot,1);
  });

  Object.keys(starterCounts).forEach(pos=>{
    starterCounts[pos]=Math.max(1,starterCounts[pos]>0?Math.ceil(starterCounts[pos]):0);
  });
  return starterCounts;
}

function _dhqPositionScoringWeights(avgThresh,starterCounts,positions){
  if(DHQ_CORE?.positionScoringWeights)return DHQ_CORE.positionScoringWeights(avgThresh,starterCounts,positions);
  const active=(positions||[])
    .map(pos=>Number(avgThresh?.[pos]?.avgStarter)||0)
    .filter(v=>v>0)
    .sort((a,b)=>a-b);
  const median=active.length?active[Math.floor(active.length/2)]:1;
  const weights={};

  (positions||[]).forEach(pos=>{
    const avg=Number(avgThresh?.[pos]?.avgStarter)||median;
    const scoringRatio=avg>0?avg/Math.max(1,median):1;
    const demandRatio=(Number(starterCounts?.[pos])||1)/2;
    const scoringAdj=Math.pow(Math.max(0.35,Math.min(3.5,scoringRatio)),0.35);
    const demandAdj=Math.pow(Math.max(0.5,Math.min(2.5,demandRatio)),0.15);
    weights[pos]=+(scoringAdj*demandAdj).toFixed(3);
  });

  return weights;
}

function _dhqMarketBlendWeight(deviation,config){
  if(DHQ_CORE?.marketBlendWeight)return DHQ_CORE.marketBlendWeight(deviation,config);
  const d=Number(deviation)||0;
  return d>0.5?0.40:d>0.3?0.35:0.30;
}

// ── Ranking-sanity rail (SANDBOX-GATED) ──────────────────────────────────────
// Surgical alternative to a broad FC-blend: instead of pulling every player
// with a value disagreement toward market (which makes DHQ defer too much and
// lose its own signal), this touches ONLY the handful of real assets whose DHQ
// RANK diverges wildly from the FantasyCalc market rank — the "crazy outliers in
// order of ranking." It nudges just those toward market and leaves the entire
// rest of the board exactly as DHQ scored it, so DHQ keeps its power.
// Targets the production-model's known blind spots: over-rating aging/volume QBs
// (Stafford, Goff) and under-rating young studs/rookies (Nabers, young TEs).
const RANK_RAIL={gapTrigger:35,assetRankMax:150,pullBase:0.25,pullPerGap:0.004,maxPull:0.55};
function _dhqApplyRankSanityRail(playerScores,playerMeta){
  const fcList=Object.keys(playerScores).filter(pid=>{const m=playerMeta[pid];return m&&m.fcValue>0&&playerScores[pid]>0;});
  if(fcList.length<20)return [];
  const maxDHQ=Math.max(...fcList.map(pid=>playerScores[pid]));
  const maxFC=Math.max(...fcList.map(pid=>playerMeta[pid].fcValue));
  const scale=maxFC>0?maxDHQ/maxFC:1;
  const dhqRank={},fcRank={};
  fcList.slice().sort((a,b)=>playerScores[b]-playerScores[a]).forEach((pid,i)=>dhqRank[pid]=i+1);
  fcList.slice().sort((a,b)=>playerMeta[b].fcValue-playerMeta[a].fcValue).forEach((pid,i)=>fcRank[pid]=i+1);
  const {gapTrigger,assetRankMax,pullBase,pullPerGap,maxPull}=RANK_RAIL;
  const touched=[];
  fcList.forEach(pid=>{
    const dR=dhqRank[pid],fR=fcRank[pid],gap=dR-fR,absGap=Math.abs(gap);
    if(absGap<=gapTrigger)return;          // only egregious rank divergence
    if(fR>assetRankMax&&dR>assetRankMax)return; // and only among real assets
    const w=Math.min(maxPull,pullBase+(absGap-gapTrigger)*pullPerGap);
    const fcScaled=Math.round(playerMeta[pid].fcValue*scale);
    const before=playerScores[pid];
    const after=Math.min(10000,Math.max(0,Math.round(before*(1-w)+fcScaled*w)));
    playerScores[pid]=after;
    playerMeta[pid].rankRail={dhqRank:dR,fcRank:fR,gap,weight:+w.toFixed(2),before,after};
    touched.push(pid);
  });
  if(touched.length)console.log(`DHQ rank-sanity rail: nudged ${touched.length} rank-divergent assets toward market`);
  return touched;
}

function _dhqMostRecentSeason(seasons){
  const entries=Object.entries(seasons||{})
    .map(([yr,s])=>({year:Number(yr),...s}))
    .filter(s=>Number.isFinite(s.year)&&s.avg>0)
    .sort((a,b)=>b.year-a.year);
  return entries[0]||null;
}

function _dhqComputeProductionPPG(seasons){
  const entries=Object.entries(seasons||{})
    .map(([yr,s])=>({year:Number(yr),avg:Number(s.avg)||0,gp:Number(s.gp)||0,total:Number(s.total)||0}))
    .filter(s=>Number.isFinite(s.year)&&s.avg>0)
    .sort((a,b)=>b.year-a.year);
  if(!entries.length)return{ppg:0,rawPPG:0,lastYearPPG:0,lastYearAdj:0,lastYearGP:0,careerPPG:0,reliability:0,lastYear:null};

  const last=entries[0];
  const rel=_dhqPpgReliability(last.gp);
  const lastAdj=last.avg*rel;
  const priors=entries.slice(1);
  let careerTotal=0,careerWeight=0;
  priors.forEach((s,i)=>{
    const recency=1/(i+1);
    const w=recency*Math.max(0.45,_dhqPpgReliability(s.gp));
    careerTotal+=s.avg*w;
    careerWeight+=w;
  });
  const careerPPG=careerWeight>0?careerTotal/careerWeight:lastAdj;
  const blended=priors.length?(lastAdj*0.75+careerPPG*0.25):lastAdj;
  const rawAvg=entries.reduce((sum,s)=>sum+s.avg,0)/entries.length;
  return{
    ppg:+blended.toFixed(2),
    rawPPG:+rawAvg.toFixed(2),
    lastYearPPG:+last.avg.toFixed(2),
    lastYearAdj:+lastAdj.toFixed(2),
    lastYearGP:last.gp,
    careerPPG:+careerPPG.toFixed(2),
    reliability:rel,
    lastYear:last.year,
  };
}

// Depth-chart role — single source of truth lives in DHQ_CORE.depthRole.
// Delegate when core is present; the inline fallback below mirrors it EXACTLY
// (same 0-based rank convention on BOTH the player and depthCharts paths) so
// the two implementations can never drift. See dhq-core.js depthRole() for the
// indexing-convention rationale (raw Math.max(0,order) read is anchored to FC).
function _dhqDepthRole(pid,p,S,posMapLocal){
  if(DHQ_CORE?.depthRole)return DHQ_CORE.depthRole(pid,p,S,posMapLocal);
  const pos=posMapLocal?.(p?.position||'')||p?.position||'';
  const team=p?.team;
  const cleanTeam=team&&team!=='null'&&team!=='FA'?team:null;
  let rank=null,rolePos=p?.depth_chart_position||pos,source='';

  if(typeof p?.depth_chart_order==='number'&&Number.isFinite(p.depth_chart_order)){
    // Sleeper depth_chart_order is 1-indexed (starter=1). Keep the raw read for
    // the multiplier (it's calibrated to it); the label is fixed below (pos+rank).
    rank=Math.max(0,p.depth_chart_order);
    source='player';
  }

  if(rank==null&&cleanTeam&&S?.depthCharts?.[cleanTeam]){
    const dc=S.depthCharts[cleanTeam]||{};
    for(const[dpos,dplayers]of Object.entries(dc)){
      for(const[order,plObj]of Object.entries(dplayers||{})){
        const plId=typeof plObj==='object'?plObj?.player_id:plObj;
        if(plId!=null&&String(plId)===String(pid)){
          const parsed=Number(order);
          rank=Number.isFinite(parsed)?Math.max(0,parsed):0;
          rolePos=dpos||rolePos;
          source='depthCharts';
          break;
        }
      }
      if(rank!=null)break;
    }
  }

  if(rank==null)return{rank:null,label:'',mult:1,source:'',reason:''};

  // Depth label = real chart position (Sleeper 1-indexed): starter -> QB1, not QB2.
  const label=(rolePos||pos||'').toUpperCase()+String(Math.max(1,rank));
  let mult=1;
  if(pos==='QB'){
    mult=rank===0?1.15:rank===1?0.78:rank===2?0.52:0.35;
  }else if(pos==='RB'){
    mult=rank===0?1.08:rank===1?0.98:rank===2?0.86:rank===3?0.74:0.62;
  }else if(pos==='WR'){
    mult=rank<=1?1.04:rank===2?0.96:rank===3?0.88:rank===4?0.78:0.68;
  }else if(pos==='TE'){
    mult=rank===0?1.06:rank===1?0.88:rank===2?0.72:0.60;
  }else if(pos==='K'){
    mult=rank===0?1.03:0.60;
  }else{
    mult=rank<=1?1.02:rank<=3?0.92:0.82;
  }

  return{rank,label,mult:+mult.toFixed(3),source,reason:`NFL depth chart ${label}`};
}

function _dhqBuildOpportunityMap(S,playerSeasons,posMapLocal){
  const map={};
  Object.entries(playerSeasons||{}).forEach(([pid,ps])=>{
    const p=S?.players?.[pid];
    const team=p?.team;
    if(!team||team==='null'||team==='FA')return;
    const pos=ps.pos||posMapLocal?.(p?.position||'')||p?.position;
    if(!pos)return;
    const prod=_dhqComputeProductionPPG(ps.seasons);
    const role=_dhqDepthRole(pid,p,S,posMapLocal);
    if(!map[team])map[team]={byPos:{},targets:[]};
    if(!map[team].byPos[pos])map[team].byPos[pos]=[];
    const item={pid,pos,ppg:prod.lastYearPPG||prod.ppg||0,rank:role.rank,age:p?.age||0};
    map[team].byPos[pos].push(item);
    if(['RB','WR','TE'].includes(pos))map[team].targets.push(item);
  });
  Object.values(map).forEach(team=>{
    Object.values(team.byPos).forEach(arr=>arr.sort((a,b)=>{
      const ar=a.rank==null?99:a.rank,br=b.rank==null?99:b.rank;
      if(ar!==br)return ar-br;
      return b.ppg-a.ppg;
    }));
    team.targets.sort((a,b)=>b.ppg-a.ppg);
  });
  return map;
}

function _dhqOpportunityAdjustment({pid,pos,age,starterSeasons,team,opportunityMap,roleRank,recentPPG,posStarterPPG}){
  if(!team||!opportunityMap?.[team]||!['RB','WR','TE'].includes(pos))return{mult:1,label:'',blockers:[]};
  const teamMap=opportunityMap[team];
  const same=(teamMap.byPos[pos]||[]).filter(x=>String(x.pid)!==String(pid));
  const targets=(teamMap.targets||[]).filter(x=>String(x.pid)!==String(pid));
  const youngOrUnproven=(age&&age<=24)||starterSeasons<1;

  let blockers=[];
  if(pos==='RB'){
    blockers=same.filter(x=>x.ppg>=12&&(roleRank==null||x.rank==null||x.rank<=roleRank||x.ppg>=14));
  }else if(pos==='WR'){
    blockers=targets.filter(x=>{
      const elite=x.pos==='WR'?x.ppg>=14:x.pos==='TE'?x.ppg>=11:x.ppg>=13;
      return elite&&(x.pos!==pos||roleRank==null||x.rank==null||x.rank<=roleRank||x.ppg>=16);
    });
  }else if(pos==='TE'){
    blockers=targets.filter(x=>{
      const elite=x.pos==='WR'?x.ppg>=14:x.pos==='TE'?x.ppg>=10:x.ppg>=13;
      return elite&&(x.pos!=='TE'||roleRank==null||x.rank==null||x.rank<=roleRank||x.ppg>=12);
    });
  }

  const count=Math.min(3,blockers.length);
  if(count){
    let mult=1-(count*(youngOrUnproven?0.08:0.045));
    if(pos==='RB'&&count>=2)mult-=youngOrUnproven?0.06:0.03;
    mult=Math.max(youngOrUnproven?0.70:0.82,mult);
    return{
      mult:+mult.toFixed(3),
      label:count===1?'Elite teammate competition':`${count} elite teammate competitors`,
      blockers:blockers.slice(0,3).map(x=>x.pid),
    };
  }

  // ── Symmetric CLEAR-PATH reward (fix #7) ──
  // The model was penalty-only: it dinged blocked players but never credited a
  // genuinely uncontested lead role. Reward a player who is (a) the clear lead at
  // his spot, (b) has ZERO elite same-team competition (count===0, already true
  // here), and (c) actually produces. Bounded to <=+8%, damped for young/proven
  // profiles that already collect youth/upside/posRank sitMult layers (no
  // double-count). Sandbox-gated until validated in prod.
  if(_dhqIsSandbox()&&roleRank!=null&&recentPPG>0&&posStarterPPG>0){
    const ahead=same.some(x=>x.rank!=null&&x.rank<roleRank); // teammate ranked ahead?
    const pct=recentPPG/posStarterPPG;                       // production vs avg starter
    if(!ahead&&pct>=0.85){
      let bonus=Math.min(0.08,0.04+0.04*Math.min(1,(pct-0.85)/0.45));
      // RB already prices above the FC market — no extra lift; WR/TE under-price.
      const posW=pos==='RB'?0.0:1.0;
      bonus*=posW;
      if(youngOrUnproven)bonus*=0.5;          // youth premium already pays here
      else if(starterSeasons>=2)bonus*=0.7;   // proven-starter layer already pays
      const mult=+(1+bonus).toFixed(3);
      if(mult>1)return{mult,label:'Clear, uncontested lead role',blockers:[]};
    }
  }

  return{mult:1,label:'',blockers:[]};
}

function _dhqStatusAdjustment({p,pos,age,peakEnd,declineEnd,seasons,curSeason,lastCompletedSeason,isRostered,hasRealTeam,isOffseasonTeams}){
  const status=String(p?.status||'').toLowerCase();
  const latest=_dhqMostRecentSeason(seasons);
  const lastDone=Number(lastCompletedSeason)||Number(curSeason)-1;
  const gamesLast=Number((seasons||{})[lastDone]?.gp)||0;
  const yearsSincePlayed=latest?Math.max(0,lastDone-latest.year):99;
  const noTeam=!hasRealTeam;

  if(status.includes('retired')||status.includes('inactive')){
    return{mult:0,cap:0,code:'inactive',reason:p?.status==='Retired'?'Retired':'Inactive'};
  }

  if(noTeam&&yearsSincePlayed>=1){
    const pastCliff=age>=(declineEnd||peakEnd||30)||((pos==='QB'&&age>=39)||(pos==='K'&&age>=41));
    const qbRetireRisk=pos==='QB'&&age>=33;
    return{
      mult:qbRetireRisk?0.08:pastCliff?0.12:0.22,
      cap:qbRetireRisk?300:pastCliff?500:1000,
      code:'long_fa',
      reason:`No NFL team and no games in ${lastDone}`,
    };
  }

  if(noTeam&&!gamesLast&&latest&&latest.year<lastDone){
    return{mult:0.25,cap:1200,code:'stale_fa',reason:`No NFL team; last played in ${latest.year}`};
  }

  if(!isRostered&&noTeam&&!isOffseasonTeams){
    return{mult:0.30,cap:900,code:'unrostered_no_team',reason:'Unrostered with no NFL team'};
  }

  if(!isRostered&&noTeam&&isOffseasonTeams){
    return{mult:gamesLast?0.50:0.30,cap:gamesLast?1800:900,code:'offseason_fa',reason:'Offseason free agent'};
  }

  if(isRostered&&noTeam&&!isOffseasonTeams){
    return{mult:0.65,cap:2500,code:'rostered_no_team',reason:'Rostered but no NFL team'};
  }

  return{mult:1,cap:null,code:'active',reason:''};
}

// The intel build lives in IndexedDB as of 2026-09-02 — at full size it
// simply doesn't fit localStorage's ~5MB allowance (storage.set:
// dhq_leagueintel_v14 was the #1 quota error, 5 people in one day).
// A legacy localStorage copy is still honored once for migration, then
// freed; if IndexedDB is unavailable the old localStorage path remains.
async function loadLICache(){
  let d=null;
  if(DhqStorage.idbGet){try{d=await DhqStorage.idbGet(LI_CACHE_KEY);}catch(e){d=null;}}
  if(!d)d=DhqStorage.get(LI_CACHE_KEY,null);
  if(!d)return false;
  if(Date.now()-d.ts>_liTtl())return false;
  const S=window.App.S||window.S;
  if(!S||d.leagueId!==S.currentLeagueId)return false;
  LI=d.data;LI_LOADED=true;
  console.log('LeagueIntel loaded from cache');
  // Emit after current call stack clears — ensures UI listeners are registered first
  setTimeout(()=>{if(window.DhqEvents)window.DhqEvents.emit('li:loaded',{source:'cache'});},0);
  return true;
}

function saveLICache(){
  const S=window.App.S||window.S;
  // Strip non-serializable functions before caching
  const cacheable={...LI};
  delete cacheable.dhqPickValueFn;
  const payload={ts:Date.now(),leagueId:S.currentLeagueId,data:cacheable};
  const idb=DhqStorage.idbSet?DhqStorage.idbSet(LI_CACHE_KEY,payload):Promise.resolve(false);
  idb.then(ok=>{
    if(ok){DhqStorage.remove(LI_CACHE_KEY);} // free the old quota-killing copy
    else{DhqStorage.set(LI_CACHE_KEY,payload);} // no IndexedDB — old behavior
  }).catch(()=>{DhqStorage.set(LI_CACHE_KEY,payload);});
}

// Get LeagueIntel value for a player (replaces dynastyValue for IDP)
function livScore(pid){
  if(!LI_LOADED)return null;
  return LI.playerScores?.[pid]||null;
}

// Get FAAB recommendation for a player based on league history
function livFAABRange(pos){
  if(!LI_LOADED||!pos)return null;
  const market=LI.faabByPos?.[pos];
  if(!market||market.count<3||!market.avg)return null;
  return{low:Math.round(market.avg*0.7),high:Math.round(market.avg*1.3),avg:Math.round(market.avg),count:market.count};
}

// Get draft ADP for a position in this league
function livDraftADP(pos){
  if(!LI_LOADED||!pos)return null;
  return LI.adpByPos?.[pos]||null;
}

// Main LeagueIntel loader — THE valuation engine
// Caches historical data permanently (past drafts/stats never change)
// Only refreshes current season on each load
async function loadLeagueIntel(){
  if(LI_LOADED)return; // already loaded
  if(window._liLoading)return; // already in progress
  window._liLoading=true;
  const S=window.App.S||window.S;
  if(!S){console.warn('[Scout] No state object found (window.App.S or window.S)');window._liLoading=false;return;}
  const posMap=window.App.posMap||window.posMap;
  const pName=window.App.pName||window.pName||(id=>{const p=S.players?.[id];return p?(p.full_name||((p.first_name||'')+' '+(p.last_name||'')).trim()||id):id;});
  const pPos=window.App.pPos||window.pPos||(id=>S.players?.[id]?.position||'');
  const pAge=window.App.pAge||window.pAge||(id=>S.players?.[id]?.age||'');
  const sf=window.App.sf||window.sf||window.Sleeper?.sleeperFetch||(path=>fetch('https://api.sleeper.app/v1'+path).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}));
  // Season stats via the shared IndexedDB-backed cache (12h-ish TTL, immutable
  // past seasons) so 5 years of multi-MB blobs aren't re-downloaded on every
  // league open. Falls back to raw sf if the cached API isn't loaded.
  const sfStats=window.Sleeper?.fetchSeasonStats||(yr=>sf('/stats/nfl/regular/'+yr).catch(()=>({})));
  const SLEEPER=window.App.SLEEPER||window.SLEEPER||'https://api.sleeper.app/v1';
  try{
  if(await loadLICache()){window._liLoading=false;return;}
  if(!S.currentLeagueId){window._liLoading=false;return;}

  const league=S.leagues.find(l=>l.league_id===S.currentLeagueId);
  const sc=league?.scoring_settings||{};
  const rp=league?.roster_positions||[];
  const totalTeams=S.rosters?.length||16;
  const positions=['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
  const posMapLocal=p=>{const n=String(p||'').toUpperCase();if(['DE','DT','NT','EDGE','ED','IDL'].includes(n))return'DL';if(['CB','S','SS','FS'].includes(n))return'DB';if(['OLB','ILB','MLB'].includes(n))return'LB';if(['DST','D/ST'].includes(n))return'DEF';return n;};

  // Starter counts per position, including startable flex slots.
  const starterCounts=_dhqStarterCountsFromRoster(rp);

  // Unified scoring function
  function scorePts(s){
    if(!s)return 0;
    let pts=0;
    const add=(stat,mult)=>{pts+=(s[stat]||0)*(mult||0);};
    add('pass_yd',sc.pass_yd??0);add('pass_td',sc.pass_td??4);add('pass_int',sc.pass_int??-1);
    add('pass_2pt',sc.pass_2pt??0);add('pass_sack',sc.pass_sack??0);
    add('rush_yd',sc.rush_yd??0.1);add('rush_td',sc.rush_td??6);add('rush_2pt',sc.rush_2pt??0);add('rush_fd',sc.rush_fd??0);
    add('rec',sc.rec??0.5);add('rec_yd',sc.rec_yd??0.1);add('rec_td',sc.rec_td??6);add('rec_2pt',sc.rec_2pt??0);add('rec_fd',sc.rec_fd??0);
    add('fum_lost',sc.fum_lost??-0.5);add('fum_rec_td',sc.fum_rec_td??0);
    add('xpm',sc.xpm??0);add('xpmiss',sc.xpmiss??0);
    add('fgm',sc.fgm??0);add('fgm_0_19',sc.fgm_0_19??0);add('fgm_20_29',sc.fgm_20_29??0);
    add('fgm_30_39',sc.fgm_30_39??0);add('fgm_40_49',sc.fgm_40_49??0);
    add('fgm_50p',sc.fgm_50p??0);add('fgm_50_59',sc.fgm_50_59??0);add('fgm_60p',sc.fgm_60p??0);
    add('fgm_yds',sc.fgm_yds??0);
    add('fgmiss',sc.fgmiss??0);add('fgmiss_0_19',sc.fgmiss_0_19??0);add('fgmiss_20_29',sc.fgmiss_20_29??0);
    const idpF=[['idp_tkl_solo','tkl_solo'],['idp_tkl_ast','tkl_ast'],['idp_tkl_loss','tkl_loss'],
      ['idp_sack','sack'],['idp_qb_hit','qb_hit'],['idp_int','int'],['idp_ff','ff'],
      ['idp_fum_rec'],['idp_pass_def','pass_def'],['idp_pass_def_3p'],
      ['idp_def_td','def_td'],['idp_blk_kick'],['idp_safe'],['idp_sack_yd'],['idp_int_ret_yd'],['idp_fum_ret_yd']];
    idpF.forEach(names=>{const mult=sc[names[0]]??0;if(!mult)return;let v=0;for(const n of names){if(s[n]){v=s[n];break;}}pts+=v*mult;});
    add('st_td',sc.st_td??0);add('st_ff',sc.st_ff??0);add('st_fum_rec',sc.st_fum_rec??0);
    add('st_tkl_solo',sc.st_tkl_solo??0);add('kr_yd',sc.kr_yd??0);add('pr_yd',sc.pr_yd??0);
    return +pts.toFixed(1);
  }

  try{
    const t0=performance.now();

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Platform-agnostic data loading via DhqProviders
    // Supports Sleeper, MFL, ESPN, Yahoo through unified interface
    // ═══════════════════════════════════════════════════════════════
    const HIST_KEY=STORAGE_KEYS.HIST_KEY(S.currentLeagueId);
    const histCache=DhqStorage.get(HIST_KEY, null);
    const platform=S.platform||'sleeper';
    const provider=window.DhqProviders?window.DhqProviders.getProvider(platform):null;

    let chain, allDraftPicks, draftMeta, seasonStatsRaw, faabTxns, tradeTxns, bracketData, leagueUsersHistory;
    const curSeason = parseInt(S.season) || new Date().getFullYear();
    const uniqueYears = Array.from({length:5}, (_,i) => curSeason - 4 + i);

    if(histCache&&histCache.chain?.length>=1&&histCache.draftPicks?.length>0){
      // ── FAST PATH: Use permanent cache for historical data ──
      chain=histCache.chain;
      allDraftPicks=histCache.draftPicks;
      draftMeta=histCache.draftMeta;
      faabTxns=histCache.faabTxns||[];
      tradeTxns=histCache.tradeTxns||[];
      bracketData=histCache.bracketData||{};
      leagueUsersHistory=histCache.leagueUsersHistory||{};
      // Re-fetch current-season trades if cache is stale (> 6h)
      const TRADE_REFRESH_TTL=6*60*60*1000;
      if(provider&&(!histCache.ts||Date.now()-histCache.ts>TRADE_REFRESH_TTL)){
        const curChain=chain.find(c=>parseInt(c.season)===curSeason);
        if(curChain){
          try{
            const freshTrades=await provider.refreshTrades(curChain);
            tradeTxns=[...tradeTxns.filter(t=>parseInt(t.season)<curSeason),...freshTrades];
            DhqStorage.set(HIST_KEY,{...histCache,tradeTxns,ts:Date.now()});
            console.log(`[DHQ] Fast-path trade refresh (${platform}): ${freshTrades.length} current-season trades`);
          }catch(e){console.warn('[DHQ] fast-path trade refresh failed:',e?.message||e);}
        }
      }
      // Stats always fresh (universal — Sleeper stats API works for all platforms)
      seasonStatsRaw={};
      await Promise.all(uniqueYears.map(async yr=>{
        seasonStatsRaw[yr]=await sfStats(yr).catch(()=>({}));
      }));
      console.log(`DHQ FAST PATH (${platform}): cached chain(${chain.length}), drafts(${allDraftPicks.length}), faab(${faabTxns.length}), trades(${tradeTxns.length}) | fresh stats in ${((performance.now()-t0)/1000).toFixed(1)}s`);

    }else{
      // ── COLD PATH: Discover everything via provider ──
      console.log(`DHQ COLD PATH (${platform}): building from scratch...`);

      if(!provider){
        console.warn('[DHQ] No provider available — falling back to empty data');
        chain=[{id:S.currentLeagueId,season:S.season}];
        allDraftPicks=[];draftMeta=[];faabTxns=[];tradeTxns=[];bracketData={};leagueUsersHistory={};
        seasonStatsRaw={};
        await Promise.all(uniqueYears.map(async yr=>{seasonStatsRaw[yr]=await sfStats(yr).catch(()=>({}));}));
      }else{
        // Step 1: League chain
        chain=await provider.getLeagueChain(S.currentLeagueId,curSeason);
        if(!chain.length)chain=[{id:S.currentLeagueId,season:String(curSeason)}];

        // Step 2: All parallel — drafts + stats + transactions + brackets + users
        allDraftPicks=[];
        draftMeta=[];
        seasonStatsRaw={};
        faabTxns=[];
        tradeTxns=[];
        bracketData={};
        leagueUsersHistory={};

        const fetchPromises=[];

        // Drafts (per season via provider)
        fetchPromises.push((async()=>{
          const results=await Promise.all(chain.map(c=>provider.getDraftPicks(c).catch(()=>[])));
          results.forEach((picks,i)=>{
            if(picks.length){
              const rounds=picks.reduce((m,p)=>Math.max(m,p.round),0);
              draftMeta.push({season:chain[i].season,rounds,picks:picks.length});
              allDraftPicks.push(...picks);
            }
          });
        })());

        // Stats (universal — Sleeper stats API)
        fetchPromises.push(Promise.all(uniqueYears.map(async yr=>{
          seasonStatsRaw[yr]=await sfStats(yr).catch(()=>({}));
        })));

        // Transactions (trades + FAAB via provider)
        fetchPromises.push((async()=>{
          const results=await Promise.all(chain.map(c=>provider.getTransactions(c,curSeason).catch(()=>({trades:[],faab:[]}))));
          results.forEach(r=>{
            tradeTxns.push(...(r.trades||[]));
            faabTxns.push(...(r.faab||[]));
          });
        })());

        // Brackets (via provider — may return null)
        fetchPromises.push((async()=>{
          await Promise.all(chain.map(async c=>{
            const b=await provider.getBracket(c).catch(()=>null);
            if(b)bracketData[c.season]=b;
          }));
        })());

        // League users (via provider)
        fetchPromises.push((async()=>{
          await Promise.all(chain.map(async c=>{
            const users=await provider.getLeagueUsers(c).catch(()=>[]);
            if(users.length)leagueUsersHistory[c.season]=users;
          }));
        })());

        await Promise.all(fetchPromises);
      }

      // Cache historical data
      DhqStorage.set(HIST_KEY,{chain,draftPicks:allDraftPicks,draftMeta,faabTxns,tradeTxns,bracketData,leagueUsersHistory,ts:Date.now()});
      console.log(`DHQ COLD PATH (${platform}) complete in ${((performance.now()-t0)/1000).toFixed(1)}s: chain(${chain.length}), drafts(${allDraftPicks.length}), faab(${faabTxns.length}), trades(${tradeTxns.length}), brackets(${Object.keys(bracketData).length}), users(${Object.keys(leagueUsersHistory).length})`);
    }

	    console.log('Stats:',Object.entries(seasonStatsRaw).map(([y,s])=>y+':'+Object.keys(s).length+'p').join(' '));
	    const curStatsCount=Object.keys(seasonStatsRaw[curSeason]||{}).length;
	    const currentSeasonInProgress=['regular','post'].includes(S.nflState?.season_type||'')&&curStatsCount>0;
	    const lastCompletedSeason=currentSeasonInProgress?curSeason-1:(curStatsCount>100?curSeason:curSeason-1);

    // ═══════════════════════════════════════════════════════════════
    // STEP: Extract championship results from brackets
    // ═══════════════════════════════════════════════════════════════
    const championships={}; // { season: { champion: rosterId, runnerUp: rosterId, semiFinals: [rid, rid] } }
    Object.entries(bracketData||{}).forEach(([season,{winners,losers}])=>{
      if(!winners?.length)return;
      // Championship game = the title game (p===1). The final round also contains the
      // 3rd-place (p:3) game, so find(r===maxRound) can grab the wrong game. Fall back to
      // a lone highest-round game for old brackets with no placement field.
      const maxRound=Math.max(...winners.map(m=>m.r||0));
      let champMatch=winners.find(m=>m.p===1);
      if(!champMatch){
        const finals=winners.filter(m=>(m.r||0)===maxRound);
        if(finals.length===1)champMatch=finals[0];
      }
      if(champMatch){
        // Semi-finalists = losers of the two games that FEED the title game
        // (t1_from.w / t2_from.w are matchup numbers). Fall back to maxRound-1 losers.
        const byId={};winners.forEach(m=>{byId[m.m]=m;});
        let semiFinals=[champMatch.t1_from?.w,champMatch.t2_from?.w]
          .filter(x=>x!=null).map(mid=>byId[mid]?.l).filter(x=>x!=null);
        if(!semiFinals.length)semiFinals=winners.filter(m=>(m.r||0)===maxRound-1).map(m=>m.l).filter(Boolean);
        championships[season]={
          champion:champMatch.w||null,
          runnerUp:champMatch.l||null,
          semiFinals,
        };
      }
    });
    console.log('Championships:',Object.keys(championships).length,'seasons with bracket data');

    // ═══════════════════════════════════════════════════════════════
    // From here on: pure computation, no API calls
    // ═══════════════════════════════════════════════════════════════
    const playerSeasons={}; // pid -> {seasons:{[year]:{total,avg,gp},...}, pos, name}
    uniqueYears.forEach(yr=>{
      const stats=seasonStatsRaw[yr];if(!stats)return;
      Object.entries(stats).forEach(([pid,s])=>{
        const gp=s.gp||s.games_played||0;
        if(gp<3)return;
        const rawPos=S.players[pid]?.position;
        if(!rawPos)return;
        const pos=posMapLocal(rawPos);
        if(!positions.includes(pos)&&pos!=='K')return;
        const total=scorePts(s);
        if(total<=0)return;
        if(!playerSeasons[pid])playerSeasons[pid]={seasons:{},pos,name:pName(pid)||pid};
        playerSeasons[pid].seasons[yr]={total,avg:+(total/gp).toFixed(1),gp};
      });
    });
    console.log('Scored players:',Object.keys(playerSeasons).length);

    // ═══════════════════════════════════════════════════════════════
    // STEP 5: Positional scoring distributions per year
    //   → defines "quality starter" as top 15% of starter pool
    // ═══════════════════════════════════════════════════════════════
    const posYearDist={}; // pos -> year -> sorted [{pid,total,avg,gp}]
    uniqueYears.forEach(yr=>{
      Object.entries(playerSeasons).forEach(([pid,ps])=>{
        const s=ps.seasons[yr];if(!s)return;
        const pos=ps.pos;
        if(!positions.includes(pos))return;
        if(!posYearDist[pos])posYearDist[pos]={};
        if(!posYearDist[pos][yr])posYearDist[pos][yr]=[];
        posYearDist[pos][yr].push({pid,total:s.total,avg:s.avg,gp:s.gp});
      });
    });
    Object.values(posYearDist).forEach(years=>Object.values(years).forEach(arr=>arr.sort((a,b)=>b.total-a.total)));

    // Quality thresholds per position per year
    const qualThresh={}; // pos -> year -> {starterLine, eliteLine, avgStarter, pool}
    positions.forEach(pos=>{
      if(!posYearDist[pos])return;
      qualThresh[pos]={};
      Object.entries(posYearDist[pos]).forEach(([yr,players])=>{
        const pool=(starterCounts[pos]||2)*totalTeams;
        const top15=Math.max(1,Math.floor(pool*0.15));
        qualThresh[pos][yr]={
          starterLine:players[Math.min(pool-1,players.length-1)]?.total||0,
          eliteLine:players[Math.min(top15-1,players.length-1)]?.total||0,
          avgStarter:pool<=players.length?+(players.slice(0,pool).reduce((a,b)=>a+b.total,0)/pool).toFixed(1):0,
          pool, count:players.length
        };
      });
    });

    // Average thresholds across years (for stable hit determination)
    const avgThresh={}; // pos -> {starterLine, eliteLine}
    positions.forEach(pos=>{
      const yrs=Object.values(qualThresh[pos]||{});
      if(!yrs.length)return;
      avgThresh[pos]={
        starterLine:+(yrs.reduce((a,t)=>a+t.starterLine,0)/yrs.length).toFixed(1),
        eliteLine:+(yrs.reduce((a,t)=>a+t.eliteLine,0)/yrs.length).toFixed(1),
        avgStarter:+(yrs.reduce((a,t)=>a+t.avgStarter,0)/yrs.length).toFixed(1),
      };
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 6: Draft outcome analysis — was each pick a HIT?
    //   Hit = produced a quality starter season (top 15% at position)
    //   Starter = produced starter-level season
    // ═══════════════════════════════════════════════════════════════
    const draftOutcomes=[];
    const hitByRoundPos={};
    const pickSlotHistory={};

    allDraftPicks.forEach(dp=>{
      const ps=playerSeasons[dp.pid];
      const draftYr=parseInt(dp.season);
      const pos=dp.pos;
      const thresh=avgThresh[pos];

      // Find best post-draft season
      let bestTotal=0,bestAvg=0,bestYr=null,isHit=false,isStarter=false;
      if(ps){
        Object.entries(ps.seasons).forEach(([yr,s])=>{
          if(parseInt(yr)<draftYr)return; // only post-draft seasons count
          if(s.total>bestTotal){bestTotal=s.total;bestAvg=s.avg;bestYr=yr;}
          if(thresh&&s.total>=thresh.eliteLine)isHit=true;
          if(thresh&&s.total>=thresh.starterLine)isStarter=true;
        });
      }

      // For recent drafts (current season), give benefit of doubt to high-ceiling rookies
      // They haven't had time to prove themselves yet
      const seasonsAvailable=curSeason-draftYr;

      const outcome={
        ...dp,bestTotal,bestAvg,bestYr,isHit,isStarter,
        seasonsAvailable,
        // Normalized value: best season as % of avg starter threshold
        normValue:thresh?+(bestTotal/thresh.starterLine*100).toFixed(1):0
      };
      draftOutcomes.push(outcome);

      // Aggregate by round+position
      const key='R'+dp.round+'_'+pos;
      if(!hitByRoundPos[key])hitByRoundPos[key]={hits:0,starters:0,total:0,players:[]};
      const h=hitByRoundPos[key];
      h.total++;if(isHit)h.hits++;if(isStarter)h.starters++;
      h.players.push({name:dp.name,season:dp.season,hit:isHit,starter:isStarter,bestTotal,bestAvg});

      // Pick slot history
      if(!pickSlotHistory[dp.pick_no])pickSlotHistory[dp.pick_no]=[];
      pickSlotHistory[dp.pick_no].push({pos,name:dp.name,hit:isHit,starter:isStarter,season:dp.season,bestTotal});
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 7: DHQ_PICK_VALUE — value of every draft slot (1-112+)
    //   MUST decrease monotonically by pick number (earlier = better)
    //   Late round picks (R4-R7) are lottery tickets, not assets
    // ═══════════════════════════════════════════════════════════════
    const maxPicks=allDraftPicks.reduce((m,p)=>Math.max(m,p.pick_no),0);
    const dhqPickValues={}; // pick_no -> {value, hitRate, starterRate, avgNorm, samples}
    const hitRateByRound={};

    // First: calculate raw expected value per pick slot from actual outcomes
    for(let pick=1;pick<=maxPicks;pick++){
      const data=pickSlotHistory[pick]||[];
      const withTime=data.filter(d=>parseInt(d.season)<=curSeason-1);
      if(!withTime.length)continue;
      const starters=withTime.filter(d=>d.starter).length;
      const hits=withTime.filter(d=>d.hit).length;
      const avgNorm=+(withTime.reduce((a,d)=>{
        const pos=d.pos;const thresh=avgThresh[pos]?.starterLine||100;
        return a+(d.bestTotal/thresh*100);
      },0)/withTime.length).toFixed(1);
      dhqPickValues[pick]={
        value:0, // will be set below
        hitRate:+(hits/withTime.length*100).toFixed(0),
        starterRate:+(starters/withTime.length*100).toFixed(0),
        avgNorm,samples:withTime.length,allSamples:data.length
      };
    }

    // ── BLENDED PICK VALUES ──
    // The shared pick-value model owns the actual curve. League history may
    // only nudge that shared value up/down based on hit rates.
    //
    // League Age Weighting:
    //   1-3 seasons:  80% industry / 20% league
    //   4-5 seasons:  60% industry / 40% league
    //   6-8 seasons:  40% industry / 60% league
    //   9+ seasons:   20% industry / 80% league
    //
    const leagueSeasons = chain.length || 1;
    const leagueWeight = leagueSeasons >= 9 ? 0.80 :
                         leagueSeasons >= 6 ? 0.60 :
                         leagueSeasons >= 4 ? 0.40 : 0.20;
    const industryWeight = 1 - leagueWeight;
    console.log(`DHQ Pick Blend: ${leagueSeasons} seasons → ${Math.round(leagueWeight*100)}% league / ${Math.round(industryWeight*100)}% industry`);

    const draftRounds=draftMeta[0]?.rounds||7;

    for(let pick=1;pick<=maxPicks;pick++){
      if(!dhqPickValues[pick])continue;
      const rd=Math.ceil(pick/totalTeams);

      // Industry consensus value from shared/pick-value-model.js.
      const industryVal = typeof getIndustryPickValue === 'function'
        ? getIndustryPickValue(pick, totalTeams, draftRounds)
        : (({1:6500,2:3200,3:1600,4:800,5:400,6:200,7:100}[rd])||50);

      const hitBonus=dhqPickValues[pick].starterRate>0?
        Math.min(0.15,Math.max(-0.15,(dhqPickValues[pick].starterRate-50)/333)):0;
      const leagueAdjusted=industryVal*(1+hitBonus);

      // Blend: shared curve remains the anchor; league history is the nudge.
      const blended = (leagueAdjusted * leagueWeight) + (industryVal * industryWeight);
      dhqPickValues[pick].value=Math.round(blended);
      dhqPickValues[pick].leagueRaw=Math.round(leagueAdjusted);
      dhqPickValues[pick].industryVal=Math.round(industryVal);
      dhqPickValues[pick].blendWeights={league:Math.round(leagueWeight*100),industry:Math.round(industryWeight*100)};
    }

    // ── Enforce monotonic ordering within each round ──
    // Hit bonus + rounding can cause later picks to exceed earlier picks.
    // Clamp so each pick is <= the one before it (within same round).
    for(let rd=1;rd<=7;rd++){
      const start=(rd-1)*totalTeams+1;
      const end=Math.min(rd*totalTeams,maxPicks);
      let prevVal=Infinity;
      for(let pick=start;pick<=end;pick++){
        if(!dhqPickValues[pick])continue;
        if(dhqPickValues[pick].value>prevVal){
          dhqPickValues[pick].value=prevVal;
        }
        prevVal=dhqPickValues[pick].value;
      }
    }

    // Cross-round monotonic: last pick of round N must be >= first pick of round N+1
    for(let pick=2;pick<=maxPicks;pick++){
      if(!dhqPickValues[pick]||!dhqPickValues[pick-1])continue;
      if(dhqPickValues[pick].value>dhqPickValues[pick-1].value){
        dhqPickValues[pick].value=dhqPickValues[pick-1].value;
      }
    }

    // Round-level summary
    for(let rd=1;rd<=draftRounds;rd++){
      const rdPicks=draftOutcomes.filter(d=>d.round===rd&&d.seasonsAvailable>=1);
      const hits=rdPicks.filter(d=>d.isHit).length;
      const starters=rdPicks.filter(d=>d.isStarter).length;
      hitRateByRound[rd]={
        total:rdPicks.length,hits,starters,
        rate:rdPicks.length?+((starters/rdPicks.length*100).toFixed(0)):0,
        eliteRate:rdPicks.length?+((hits/rdPicks.length*100).toFixed(0)):0,
      };
      // Best positions per round
      const posByRound={};
      rdPicks.forEach(d=>{
        if(!posByRound[d.pos])posByRound[d.pos]={hits:0,starters:0,total:0};
        posByRound[d.pos].total++;if(d.isHit)posByRound[d.pos].hits++;if(d.isStarter)posByRound[d.pos].starters++;
      });
      hitRateByRound[rd].bestPos=Object.entries(posByRound)
        .map(([pos,d])=>({pos,rate:d.total>=2?+((d.starters/d.total*100).toFixed(0)):0,total:d.total,starters:d.starters,hits:d.hits}))
        .filter(p=>p.total>=2).sort((a,b)=>b.rate-a.rate);
    }

    // Future year discount for picks
    const curYear=curSeason;
    const dhqPickValueFn=(season,round,pickInRound)=>{
      const yr=parseInt(season)||curYear;
      const pick=(round-1)*totalTeams+Math.min(pickInRound||Math.ceil(totalTeams/2),totalTeams);
      const base=dhqPickValues[pick]?.value||dhqPickValues[pick-1]?.value||dhqPickValues[pick+1]?.value||0;
      const yearDiscount=Math.pow(0.88,Math.max(0,yr-curYear)); // 12% per year discount
      return Math.round(base*yearDiscount);
    };

    // ═══════════════════════════════════════════════════════════════
    // STEP 8: DHQ_PLAYER_VALUE — every player, 0-10000 scale
    //
    // WEIGHT ALLOCATION:
    //   Production Base:      40% (weighted PPG from league scoring)
    //   Age / Peak Curve:     25% (remaining productive years)
    //   Situation Multiplier: 20% (team, role, trajectory)
    //   Positional Scarcity:  10% (supply vs demand at position)
    //   Peak Years Bonus:      5% (additive per remaining peak year)
    // ═══════════════════════════════════════════════════════════════

    // Age curves: build-up, elite peak, and still-valuable decline bands.
    const ageCurveWindows=window.App.ageCurveWindows||DHQ_DEFAULT_AGE_CURVES;
    const peakWindows=_dhqPeakWindowsFromCurves(ageCurveWindows);
    window.App.ageCurveWindows=ageCurveWindows;
    window.App.peakWindows=peakWindows;

    // Position-specific decay rates after the valuable decline band.
    const decayRates=window.App.decayRates||DHQ_DEFAULT_DECAY_RATES;

    // ── Positional scarcity multipliers ──
    // In 16-team SF IDP: QB premium, IDP discount, TE unicorn
    const scarcityMult={};
    const isSF=rp.includes('SUPER_FLEX');
    positions.forEach(pos=>{
      const needed=(starterCounts[pos]||1)*totalTeams;
      const available=Object.values(playerSeasons).filter(p=>p.pos===pos&&Object.keys(p.seasons).length>=1).length;
      const ratio=needed/Math.max(1,available);
      // Base from supply/demand
      let mult=Math.min(1.3,0.8+ratio*0.5);
      // Manual overrides based on dynasty market reality
      if(pos==='QB'&&isSF)mult=Math.max(mult,1.25); // SF QB premium
      else if(pos==='TE')mult=Math.max(mult,1.15); // TE scarcity
      else if(pos==='WR')mult=Math.min(mult,1.0); // deepest position
      else if(pos==='K')mult=Math.min(mult,0.80); // kickers: dynasty weight handles main discount, scarcity stays low
      else if(['DL','LB','DB'].includes(pos)){
        // IDP scarcity: let supply/demand push value up in deep IDP leagues
        const idpStarters=(starterCounts.DL||0)+(starterCounts.LB||0)+(starterCounts.DB||0);
        const idpCap=idpStarters>=6?1.10:idpStarters>=3?1.0:0.90;
        mult=Math.min(mult,idpCap);
      }
      scarcityMult[pos]=+mult.toFixed(3);
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 8 (LAB V2 ENGINE — owner order 2026-09-05): the ratified
    // value formula IS the engine in this lab copy. The production
    // formula that lived here (situation stack, FC blend, rank rail,
    // SF-QB alignment, stash floors) is DELETED from this copy; the one
    // store every surface reads is priced by WrLabValuesV2 natively.
    // The real DHQ-Shared repo is untouched.
    // ═══════════════════════════════════════════════════════════════
    const rosteredSet=new Set(S.rosters.flatMap(r=>r.players||[]));
    let pffSnap={byName:{}};
    try{const _r=await fetch('js/lab/pff-snapshot.json');if(_r.ok)pffSnap=await _r.json();}catch(e){/* grades optional */}
    // isSF already computed above for the scarcity table — reuse it.
    const pprVal=(sc.rec!=null&&sc.rec>=0.9)?1:(sc.rec!=null&&sc.rec>=0.4)?0.5:0;
    let fcRows=[];
    try{const _fr=await fetch(`https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=${isSF?2:1}&numTeams=${totalTeams}&ppr=${pprVal}`);if(_fr.ok)fcRows=await _fr.json();}catch(e){/* leash optional */}
    const v2=window.WrLabValuesV2.computeFromData({
      league:{league_id:S.currentLeagueId,scoring_settings:sc,roster_positions:rp,season:curSeason},
      rosters:S.rosters,
      playersData:S.players,
      stA:seasonStatsRaw[curSeason-1]||{},
      stB:seasonStatsRaw[curSeason-2]||{},
      stCur:seasonStatsRaw[curSeason]||{},
      pff:pffSnap.byName||{},
      draftPicks:allDraftPicks.filter(dp=>parseInt(dp.season)===curSeason),
      pickValues:dhqPickValues,
      fcRows,
    });
    const playerScores=v2.values;
    const playerMeta=v2.meta;
    const rookieCount=Object.keys(playerMeta).filter(pid=>playerMeta[pid].rookie).length;
    const vetBlendCount=Object.keys(playerMeta).filter(pid=>playerMeta[pid].mkt!=null).length;
    const sourceSnapshots={labV2:{waiver:v2.waiver,builtAt:new Date().toISOString()}};
    // Slim rows + lineup context keep steps 9-11 and the AI tier tables fed.
    const recentPlayers=Object.keys(playerMeta)
      .filter(pid=>rosteredSet.has(pid))
      .map(pid=>({pid,pos:playerMeta[pid].pos,wPPG:playerMeta[pid].ppg||0,age:playerMeta[pid].age||0}))
      .sort((a,b)=>b.wPPG-a.wPPG);
    const scoringWeight=_dhqPositionScoringWeights(avgThresh,starterCounts,positions);
    const lineupContext=DHQ_CORE?.buildLineupContext?DHQ_CORE.buildLineupContext({
      rows:recentPlayers.map(p=>({pid:p.pid,position:p.pos,ppg:p.wPPG})),
      rosterPositions:rp,totalTeams,positions,starterCounts,includeDefense:true
    }):null;
    const _idpSt=(starterCounts.DL||0)+(starterCounts.LB||0)+(starterCounts.DB||0);
    const _idpWt=_idpSt>=6?0.80:_idpSt>=3?0.65:0.50;
    const baseDynastyWeight={QB:1.0,RB:1.0,WR:1.0,TE:0.95,K:0.30,DL:_idpWt,LB:_idpWt,DB:_idpWt};
    const posDynastyWeight={};
    positions.forEach(pos=>{
      const lineupPos=lineupContext?.position?.[pos]||null;
      const formatWeight=lineupPos?.importance||scoringWeight[pos]||1;
      posDynastyWeight[pos]=+((baseDynastyWeight[pos]||0.80)*formatWeight).toFixed(3);
    });
    console.log('DHQ player values (LAB V2 formula): '+Object.keys(playerScores).length+' players priced, '+rookieCount+' rookies at slot');

    // ═══════════════════════════════════════════════════════════════
    // STEP 9: Aggregate FAAB data (already fetched/cached above)
    // ═══════════════════════════════════════════════════════════════
    const faabByPos={};
    (faabTxns||[]).forEach(({pos,bid})=>{
      if(!faabByPos[pos])faabByPos[pos]={total:0,count:0,bids:[]};
      faabByPos[pos].total+=bid;faabByPos[pos].count++;faabByPos[pos].bids.push(bid);
    });
    Object.entries(faabByPos).forEach(([pos,d])=>{
      d.avg=+(d.total/d.count).toFixed(1);
      d.median=d.bids.sort((a,b)=>a-b)[Math.floor(d.bids.length/2)]||0;
      d.p75=d.bids[Math.floor(d.bids.length*0.75)]||0;
      delete d.bids;
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 9b: Trade history analysis — owner profiles + league tendencies
    // ═══════════════════════════════════════════════════════════════
    const ownerProfiles={};
    const playerTradeHistory={};
    const leagueTradeTendencies={totalTrades:0,byPos:{},avgAssetsPerSide:0,pickHeavy:0,playerHeavy:0};

    (tradeTxns||[]).forEach(t=>{
      leagueTradeTendencies.totalTrades++;
      const rids=t.roster_ids||[];

      rids.forEach(rid=>{
        if(!ownerProfiles[rid])ownerProfiles[rid]={trades:0,playersAcquired:[],playersSold:[],picksAcquired:0,picksSold:0,posAcquired:{},posSold:{}};
        const profile=ownerProfiles[rid];
        profile.trades++;

        const got=t.sides[rid]||{players:[],picks:[]};
        const otherRid=rids.find(r=>r!==rid);
        const gave=otherRid&&t.sides[otherRid]?t.sides[otherRid]:{players:[],picks:[]};

        // Players acquired
        got.players.forEach(pid=>{
          profile.playersAcquired.push(pid);
          const pos=posMapLocal(pPos(pid)||S.players?.[pid]?.position||'');
          if(pos)profile.posAcquired[pos]=(profile.posAcquired[pos]||0)+1;
        });

        // Players sold (what the OTHER side got = what this owner gave)
        gave.players.forEach(pid=>{
          profile.playersSold.push(pid);
          const pos=posMapLocal(pPos(pid)||S.players?.[pid]?.position||'');
          if(pos)profile.posSold[pos]=(profile.posSold[pos]||0)+1;
        });

        // Picks
        got.picks.forEach(()=>profile.picksAcquired++);
        gave.picks.forEach(()=>profile.picksSold++);
      });

      // Track which players have been traded and how often
      rids.forEach(rid=>{
        const side=t.sides[rid]||{players:[]};
        side.players.forEach(pid=>{
          if(!playerTradeHistory[pid])playerTradeHistory[pid]=[];
          playerTradeHistory[pid].push({season:t.season,week:t.week});
        });
      });

      // League tendencies
      const totalAssets=rids.reduce((s,rid)=>{
        const side=t.sides[rid]||{players:[],picks:[]};
        return s+side.players.length+side.picks.length;
      },0);
      leagueTradeTendencies.avgAssetsPerSide+=totalAssets/(rids.length||1);
      const hasPicks=rids.some(rid=>(t.sides[rid]?.picks||[]).length>0);
      if(hasPicks)leagueTradeTendencies.pickHeavy++;
      else leagueTradeTendencies.playerHeavy++;
    });

    // Compute owner DNA labels
    if(leagueTradeTendencies.totalTrades>0){
      leagueTradeTendencies.avgAssetsPerSide=+(leagueTradeTendencies.avgAssetsPerSide/leagueTradeTendencies.totalTrades).toFixed(1);
    }
    Object.entries(ownerProfiles).forEach(([rid,p])=>{
      // Classify owner trade style
      const pickBuyer=p.picksAcquired>p.picksSold*1.5;
      const pickSeller=p.picksSold>p.picksAcquired*1.5;
      const highVolume=p.trades>=leagueTradeTendencies.totalTrades/totalTeams*1.5;
      const lowVolume=p.trades<=1;
      p.dna=pickBuyer?'Rebuilder (pick collector)':pickSeller?'Win-now (pick seller)':highVolume?'Active trader':lowVolume?'Holds firm':'Balanced';
      // Most targeted position
      const topPos=Object.entries(p.posAcquired).sort((a,b)=>b[1]-a[1])[0];
      p.targetPos=topPos?topPos[0]:null;
    });

    console.log(`Trade analysis: ${leagueTradeTendencies.totalTrades} trades across ${Object.keys(ownerProfiles).length} owners`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 9c: Trade value analysis — per-trade fairness + enriched owner profiles
    // ═══════════════════════════════════════════════════════════════
    const PICK_VALUE_FALLBACK={1:7000,2:3500,3:1800,4:800};
    const getPickVal=(season,round)=>{
      if(typeof dhqPickValueFn==='function'){
        const v=dhqPickValueFn(season,round,Math.ceil(totalTeams/2));
        if(v>0)return v;
      }
      return PICK_VALUE_FALLBACK[round]||400;
    };

    const tradeHistory=(tradeTxns||[]).map(t=>{
      const rids=t.roster_ids||[];
      const sides={};
      rids.forEach(rid=>{
        const s=t.sides[rid]||{players:[],picks:[]};
        const playerVal=s.players.reduce((sum,pid)=>sum+(playerScores[pid]||0),0);
        const pickVal=s.picks.reduce((sum,pk)=>sum+getPickVal(pk.season,pk.round),0);
        sides[rid]={players:s.players,picks:s.picks,totalValue:playerVal+pickVal};
      });
      const vals=rids.map(rid=>sides[rid]?.totalValue||0);
      const maxVal=Math.max(...vals,1);
      const diff=rids.length===2?Math.abs(vals[0]-vals[1]):0;
      const diffPct=+(diff/maxVal*100).toFixed(1);
      const fairness=Math.round(100-Math.min(100,diffPct));
      let winner=null;
      if(rids.length===2&&vals[0]!==vals[1])winner=vals[0]>vals[1]?rids[0]:rids[1];
      return {
        season:t.season,week:t.week,ts:t.ts,
        roster_ids:rids,sides,
        fairness,winner,valueDiff:diff,valueDiffPct:diffPct
      };
    });

    // Enrich ownerProfiles with value-based trade metrics
    Object.values(ownerProfiles).forEach(p=>{
      p.tradesWon=0;p.tradesLost=0;p.tradesFair=0;
      p.avgValueDiff=0;p.partners={};
      p.biggestWin=null;p.biggestLoss=null;
      p.seasonActivity={};p.weekTiming={early:0,mid:0,late:0};
    });
    tradeHistory.forEach(t=>{
      const rids=t.roster_ids||[];
      rids.forEach(rid=>{
        const p=ownerProfiles[rid];if(!p)return;
        const otherRid=rids.find(r=>r!==rid);
        const myVal=t.sides[rid]?.totalValue||0;
        const theirVal=otherRid?t.sides[otherRid]?.totalValue||0:0;
        const net=myVal-theirVal;

        // Win/loss/fair
        if(t.valueDiffPct<=15)p.tradesFair++;
        else if(t.winner===rid)p.tradesWon++;
        else if(t.winner!==null)p.tradesLost++;

        p.avgValueDiff+=net;

        // Partners
        if(otherRid!=null)p.partners[otherRid]=(p.partners[otherRid]||0)+1;

        // Biggest win/loss
        if(net>0&&(!p.biggestWin||net>(p.biggestWin._net||0)))p.biggestWin={...t,_net:net};
        if(net<0&&(!p.biggestLoss||net<(p.biggestLoss._net||0)))p.biggestLoss={...t,_net:net};

        // Season activity
        p.seasonActivity[t.season]=(p.seasonActivity[t.season]||0)+1;

        // Week timing
        const w=t.week;
        if(w>=1&&w<=6)p.weekTiming.early++;
        else if(w>=7&&w<=12)p.weekTiming.mid++;
        else p.weekTiming.late++;
      });
    });
    // Finalize averages and clean up temp fields
    Object.values(ownerProfiles).forEach(p=>{
      if(p.trades>0)p.avgValueDiff=Math.round(p.avgValueDiff/p.trades);
      if(p.biggestWin)delete p.biggestWin._net;
      if(p.biggestLoss)delete p.biggestLoss._net;
    });

    console.log(`Trade value analysis: ${tradeHistory.length} trades enriched with fairness scores`);

    // ═══════════════════════════════════════════════════════════════
    // STEP 10: ADP by position in this league's drafts
    // ═══════════════════════════════════════════════════════════════
    const adpByPos={};
    positions.forEach(pos=>{
      const posPicksData=allDraftPicks.filter(p=>p.pos===pos);
      if(!posPicksData.length)return;
      const avgPick=posPicksData.reduce((a,p)=>a+p.pick_no,0)/posPicksData.length;
      const byRound={};
      posPicksData.forEach(p=>{if(!byRound[p.round])byRound[p.round]=0;byRound[p.round]++;});
      adpByPos[pos]={avgPick:+avgPick.toFixed(1),count:posPicksData.length,
        topRound:Object.keys(byRound).sort((a,b)=>byRound[b]-byRound[a])[0],byRound};
    });

    // ═══════════════════════════════════════════════════════════════
    // STEP 11: Positional tier analysis (for AI context)
    // ═══════════════════════════════════════════════════════════════
    const posTiers={};
    positions.forEach(pos=>{
      const posPlayers=recentPlayers.filter(p=>p.pos===pos).sort((a,b)=>b.wPPG-a.wPPG);
      if(!posPlayers.length)return;
      const need=(starterCounts[pos]||1)*totalTeams;
      const starter=posPlayers[Math.min(need-1,posPlayers.length-1)];
      const elite=posPlayers[Math.min(2,posPlayers.length-1)];
      posTiers[pos]={
        count:posPlayers.length,
        starterThreshold:+(starter?.wPPG||0).toFixed(2),
        eliteThreshold:+(elite?.wPPG||0).toFixed(2),
        startableCount:posPlayers.filter(p=>p.wPPG>=(starter?.wPPG||0)*0.85).length,
        starterPool:need,
        scarcity:+(need/Math.max(1,posPlayers.length)).toFixed(3),
        scarcityMult:+(scarcityMult[pos]||1).toFixed(2),
        scoringWeight:+(scoringWeight[pos]||1).toFixed(2),
        dynastyWeight:+(posDynastyWeight[pos]||0.80).toFixed(2),
        lineupSlots:lineupContext?.position?.[pos]?.lineupSlots||0,
        lineupPointShare:lineupContext?.position?.[pos]?.pointShare||0,
        lineupMarginalShare:lineupContext?.position?.[pos]?.marginalShare||0,
        lineupImportance:lineupContext?.position?.[pos]?.importance||1,
      };
    });

    // ═══════════════════════════════════════════════════════════════
    // STEPS 12-12d DELETED IN THE LAB COPY (owner order 2026-09-05):
    // FC veteran blend, FC/prospect rookie pricing, the rank-sanity
    // rail, superflex QB alignment, and early-career stash floors are
    // all retired here — the v2 formula owns the market leash and the
    // rookie slot rule natively. The real DHQ-Shared repo is untouched.
    // ═══════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════
    // STORE EVERYTHING
    // ═══════════════════════════════════════════════════════════════
    LI={
      // Player values (DHQ engine — league-derived)
      playerScores,     // pid -> 0-10000 DHQ value
      playerMeta,       // pid -> {pos, ppg, age, ageFactor, peakYrsLeft}
      // Pick values
      dhqPickValues,    // pick_no -> {value, hitRate, starterRate, avgNorm}
      dhqPickValueFn,   // (season,round,pickInRound) -> value 0-10000
      // Positional analysis
      posTiers,         // pos -> {starterThreshold, eliteThreshold, scarcity, ...}
      qualThresh,       // pos -> year -> {starterLine, eliteLine, avgStarter}
      avgThresh,        // pos -> {starterLine, eliteLine} averaged across years
      starterCounts,    // pos -> starters needed
      scarcityMult,     // pos -> multiplier
      scoringWeight,    // pos -> scoring-context adjustment
      posDynastyWeight, // pos -> final market/scoring context weight
      lineupContext,    // whole-lineup scoring context by position
      ageCurveWindows,  // pos -> {build, peak, decline}
      peakWindows,      // pos -> [start, end] elite ages
      // Draft intelligence
      draftOutcomes,    // full pick outcomes with hit/starter status
      hitByRoundPos,    // R1_QB -> {hits,starters,total,players}
      hitRateByRound,   // round -> {total,hits,starters,rate,eliteRate,bestPos}
      pickSlotHistory,  // pick_no -> [{pos,name,hit,starter}]
      draftMeta,        // [{season,rounds,picks}]
      adpByPos,         // pos -> {avgPick,count,byRound}
      // FAAB
      faabByPos,        // pos -> {avg,median,p75,count}
      // Meta
      totalPicks:allDraftPicks.length,
      totalFAABTxns:faabTxns.length,
      // Trade intelligence
      ownerProfiles,        // roster_id -> {trades,dna,targetPos,picksAcquired,tradesWon,tradesLost,...}
      playerTradeHistory,   // pid -> [{season,week}]
      leagueTradeTendencies, // {totalTrades,avgAssetsPerSide,pickHeavy,playerHeavy}
      tradeHistory,         // [{season,week,ts,roster_ids,sides,fairness,winner,valueDiff,valueDiffPct}]
      sourceSnapshots,
      rookieCount,
      // Championships & brackets (NEW)
      championships,        // { season: { champion, runnerUp, semiFinals } }
      bracketData,          // { season: { winners: [], losers: [] } }
      leagueUsersHistory,   // { season: [{ user_id, display_name }] }
      leagueYears:uniqueYears,
      builtAt:new Date().toISOString(),
    };
    LI_LOADED=true;
    saveLICache();

    const topPlayer=recentPlayers[0];
    console.log(`LeagueIntel COMPLETE:
  ${Object.keys(playerScores).length} players valued (${rookieCount} rookies from FC)
  ${allDraftPicks.length} draft picks analyzed (${draftMeta.length} drafts)
  ${faabTxns.length} FAAB transactions
  ${(tradeTxns||[]).length} trade transactions across ${Object.keys(ownerProfiles).length} owners
  ${uniqueYears.length} seasons scored (${uniqueYears.join(',')})
  Top player: ${pName(topPlayer?.pid)||topPlayer?.pid} (${topPlayer?.pos}) wPPG=${topPlayer?.wPPG} DHQ=${playerScores[topPlayer?.pid]}
  Pick 1.01 value: ${dhqPickValues[1]?.value}, R7 last pick: ${dhqPickValues[maxPicks]?.value}`);

    // Notify subscribers that LeagueIntel is ready (replaces direct render calls)
    if(window.DhqEvents)window.DhqEvents.emit('li:loaded',{source:'fresh'});

  }catch(e){
    console.warn('LeagueIntel error:',e);
  }
  }finally{window._liLoading=false;}
}

// Get display value — DHQ (LI) score
function bestValue(pid){
  const liv=livScore(pid);
  if(liv!=null)return liv;
  return dynastyValue(pid);
}

// Get FAAB bid recommendation string for display
function faabBidStr(pos,budget){
  const range=livFAABRange(pos);
  if(!range||range.count<3)return null;
  const pct=budget>0?Math.min(1,(range.p75||range.avg)/200):0;
  const myBid=Math.round(budget*pct*1.1); // bid 10% above market to win
  return`$${range.low}-$${range.p75} (league avg $${range.avg}, ${range.count} claims)`;
}

function dynastyValue(playerId){
  const S=window.App.S||window.S||{};
  const p=S.players?.[playerId];if(!p)return 0;
  if(p.status==='Inactive'||p.status==='Retired')return 0;
  // DHQ value (league-derived) is the sole value source
  if(LI_LOADED&&LI.playerScores?.[playerId]>0)return LI.playerScores[playerId];
  // If DHQ is loaded but player has no score, they're worthless
  if(LI_LOADED)return 0;
  return 0;
}

function getPlayerRank(playerId){
  const S=window.App.S||window.S||{};
  if(LI_LOADED&&LI.playerScores?.[playerId]>0){
    // Rank among ALL rostered players in the league (not all 2240 DHQ players)
    const rosteredPids=new Set();
    S.rosters.forEach(r=>(r.players||[]).forEach(pid=>rosteredPids.add(pid)));
    const allScores=Object.entries(LI.playerScores)
      .filter(([pid])=>rosteredPids.has(pid))
      .sort((a,b)=>b[1]-a[1]);
    const overall=allScores.findIndex(([pid])=>pid===String(playerId))+1;
    const pos=LI.playerMeta?.[playerId]?.pos;
    const posScores=allScores.filter(([pid])=>LI.playerMeta?.[pid]?.pos===pos);
    const posRank=posScores.findIndex(([pid])=>pid===String(playerId))+1;
    return{overall:overall||999,pos:posRank||99,trend:0};
  }
  return null;
}

function isNoValue(playerId){
  return LI_LOADED && dynastyValue(playerId)===0;
}

// ══════════════════════════════════════════════════════════════════
// Expose everything on window.App namespace
// ══════════════════════════════════════════════════════════════════
Object.defineProperty(window.App, 'LI', {
  get(){ return LI; },
  set(v){ LI = v; },
  configurable: true, enumerable: true
});
Object.defineProperty(window.App, 'LI_LOADED', {
  get(){ return LI_LOADED; },
  set(v){ LI_LOADED = v; },
  configurable: true, enumerable: true
});
window.App.loadLICache = loadLICache;
window.App.saveLICache = saveLICache;
window.App.loadLeagueIntel = loadLeagueIntel;
window.App.dynastyValue = dynastyValue;
window.App.getPlayerRank = getPlayerRank;
window.App.isNoValue = isNoValue;
window.App.bestValue = bestValue;
window.App.livScore = livScore;
window.App.livFAABRange = livFAABRange;
window.App.livDraftADP = livDraftADP;
window.App.ageCurveWindows = window.App.ageCurveWindows || DHQ_DEFAULT_AGE_CURVES;
window.App.peakWindows = _dhqPeakWindowsFromCurves(window.App.ageCurveWindows);
window.App.decayRates = window.App.decayRates || DHQ_DEFAULT_DECAY_RATES;
window.App.DhqValueTuning = {
  sitMultTuning: SITMULT_TUNING, // single source of truth for sitMult knobs (audit/tune here)
  earlyCareerFloorTuning: EARLY_CAREER_FLOOR_TUNING, // 2nd/3rd-yr stash-floor knobs (audit/tune here)
  nflDraftCapital: DHQ_NFL_DRAFT_CAPITAL, // seed draft-capital map (expand each draft year)
  ageCurveWindows: window.App.ageCurveWindows,
  peakWindows: window.App.peakWindows,
  ageCurvePhase: _dhqAgeCurvePhase,
  ageCurveFactor: _dhqAgeCurveFactor,
  ppgReliability: _dhqPpgReliability,
  starterCountsFromRoster: _dhqStarterCountsFromRoster,
  positionScoringWeights: _dhqPositionScoringWeights,
  computeProductionPPG: _dhqComputeProductionPPG,
  depthRole: _dhqDepthRole,
  buildOpportunityMap: _dhqBuildOpportunityMap,
  opportunityAdjustment: _dhqOpportunityAdjustment,
  statusAdjustment: _dhqStatusAdjustment,
};

// Bare window globals for inline handlers / cross-module access
window.dynastyValue = dynastyValue;
window.getPlayerRank = getPlayerRank;
window.isNoValue = isNoValue;
window.App.faabBidStr = faabBidStr;

// ── Module global exports (Vite migration) ───────────────────────────────────
window.loadLeagueIntel = loadLeagueIntel;
window.loadLICache = loadLICache;
window.saveLICache = saveLICache;
window.bestValue = bestValue;
window.livScore = livScore;
window.livFAABRange = livFAABRange;
window.livDraftADP = livDraftADP;
window.faabBidStr = faabBidStr;
