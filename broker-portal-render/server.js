const express=require('express');
const crypto=require('crypto');
const {Pool}=require('pg');
const app=express();
app.use(express.json({limit:'200kb'}));

const INVITE_HASHES={
  artur:'4d227f69064856ab82ec9fcbd42332abdd5b66dcbdb238aeb59e85223cfad43f',
  velomar:'cb08085a62f4f1d8f386e7650fdf190ffea18bb65aba650fc2a0620d094aacf9',
  chayka:'bfa98502b34e9a9f170dfcecdf07b2a4bc9d4ce778d082a25fa85655ba41bfeb',
  genaker:'e5f741e07cf60c2b650570329dd6e0240d20ec9aef26b516fc264a397006b6a7',
  neos:'c805011d2f049990f552191ed62a984cb5d4f85f82bfddcca614fc5265c08f8c'
};
const BROKER_LABELS={artur:'Artur / STRIBROK',velomar:'Velomar Shipping',chayka:'Chayka Group Logistic',genaker:'Genaker',neos:'NEOS Shipping'};
const BASELINE_VERSION='W37-2026-v0.1';
const BASELINE_COMMIT='611f7e77f759265ae1ef59aec41fbe056de66645';
const CASES=[
{id:'BRV-2026-W37-001',route:'EX-UKRAINE → Turkish Black Sea',commodity:'Wheat SF47 / Corn SF49',cargo:'5,000-7,000',vessel:'Coaster',mid:73.04,low:64.13,high:81.96,confidence:'LOW',direction:'UP',regime:'CONFIRMED_TIGHTENING'},
{id:'BRV-2026-W37-002',route:'EX-UKRAINE → Turkish Black Sea',commodity:'Wheat SF47 / Corn SF49',cargo:'10,000-15,000',vessel:'Small Handy',mid:71.04,low:62.13,high:79.95,confidence:'LOW',direction:'UP',regime:'CONFIRMED_TIGHTENING'},
{id:'BRV-2026-W37-003',route:'EX-UKRAINE → Marmara, Turkey',commodity:'Wheat SF47 / Corn SF49',cargo:'5,000-7,000',vessel:'Coaster',mid:75.79,low:66.97,high:84.61,confidence:'LOW',direction:'UP',regime:'CONFIRMED_TIGHTENING'},
{id:'BRV-2026-W37-004',route:'EX-UKRAINE → Marmara, Turkey',commodity:'Wheat SF47 / Corn SF49',cargo:'10,000-15,000',vessel:'Small Handy',mid:73.66,low:64.86,high:82.47,confidence:'LOW',direction:'UP',regime:'CONFIRMED_TIGHTENING'},
{id:'BRV-2026-W37-005',route:'EX-UKRAINE → East Mediterranean',commodity:'Wheat SF47 / Corn SF49',cargo:'5,000-7,000',vessel:'Coaster',mid:90.86,low:73.28,high:108.44,confidence:'LOW',direction:'UP',regime:'CONFIRMED_TIGHTENING'}
];

const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:undefined});
function hash(s){return crypto.createHash('sha256').update(String(s||'')).digest('hex')}
function invite(req){const broker=String(req.query.broker||req.body.broker||'').toLowerCase();const key=String(req.query.key||req.body.key||'');return INVITE_HASHES[broker]&&hash(key)===INVITE_HASHES[broker]?broker:null}
function num(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
function validDir(v){return ['UP','FLAT','DOWN','UNCERTAIN'].includes(v)}

async function init(){
  await pool.query(`CREATE TABLE IF NOT EXISTS broker_reviews(
    id BIGSERIAL PRIMARY KEY,
    review_id TEXT NOT NULL,
    broker TEXT NOT NULL,
    broker_name TEXT,
    broker_company TEXT,
    fair_mid NUMERIC NOT NULL,
    fair_low NUMERIC,
    fair_high NUMERIC,
    direction TEXT NOT NULL,
    confidence INTEGER NOT NULL,
    reason_code TEXT,
    comment TEXT,
    validation_mode TEXT NOT NULL DEFAULT 'BLIND_FIRST',
    baseline_version TEXT NOT NULL,
    baseline_commit TEXT NOT NULL,
    model_mid NUMERIC NOT NULL,
    model_low NUMERIC NOT NULL,
    model_high NUMERIC NOT NULL,
    model_direction TEXT NOT NULL,
    model_confidence TEXT NOT NULL,
    market_state TEXT,
    model_minus_broker_mid NUMERIC NOT NULL,
    first_submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(review_id,broker)
  )`);
}

app.get('/health',async(req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true,service:'dry-bulk-broker-validation',mode:'blind-first',storage:'postgres',baseline:BASELINE_VERSION})}catch(e){res.status(503).json({ok:false,storage:'postgres',error:'database unavailable'})}});
app.get('/api/cases',(req,res)=>{const broker=invite(req);if(!broker)return res.status(403).json({error:'invalid invitation'});const blindCases=CASES.map(({id,route,commodity,cargo,vessel})=>({id,route,commodity,cargo,vessel}));res.json({broker,label:BROKER_LABELS[broker]||broker,cases:blindCases,validation_mode:'BLIND_FIRST',baseline_version:BASELINE_VERSION});});
app.post('/api/reviews',async(req,res)=>{
  const broker=invite(req);if(!broker)return res.status(403).json({error:'invalid invitation'});
  const x=req.body||{};const c=CASES.find(z=>z.id===x.review_id);if(!c)return res.status(400).json({error:'unknown case'});
  const fairMid=num(x.fair_mid),fairLow=num(x.fair_low),fairHigh=num(x.fair_high),confidence=num(x.confidence);
  if(fairMid===null)return res.status(400).json({error:'fair midpoint is required'});
  if(fairLow!==null&&fairHigh!==null&&fairLow>fairHigh)return res.status(400).json({error:'fair low cannot exceed fair high'});
  if(!validDir(x.direction))return res.status(400).json({error:'invalid direction'});
  if(confidence===null||confidence<1||confidence>5)return res.status(400).json({error:'confidence must be 1-5'});
  const diff=Number((c.mid-fairMid).toFixed(2));
  try{
    await pool.query(`INSERT INTO broker_reviews(review_id,broker,broker_name,broker_company,fair_mid,fair_low,fair_high,direction,confidence,reason_code,comment,validation_mode,baseline_version,baseline_commit,model_mid,model_low,model_high,model_direction,model_confidence,market_state,model_minus_broker_mid)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'BLIND_FIRST',$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT(review_id,broker) DO NOTHING`,[x.review_id,broker,x.broker_name||'',x.broker_company||'',fairMid,fairLow,fairHigh,x.direction,confidence,x.reason_code||'',x.comment||'',BASELINE_VERSION,BASELINE_COMMIT,c.mid,c.low,c.high,c.direction,c.confidence,c.regime,diff]);
    const saved=await pool.query('SELECT first_submitted_at FROM broker_reviews WHERE review_id=$1 AND broker=$2',[x.review_id,broker]);
    res.json({ok:true,locked:true,submitted_at:saved.rows[0]?.first_submitted_at||null,reveal:{model_mid:c.mid,model_low:c.low,model_high:c.high,model_direction:c.direction,model_confidence:c.confidence,regime:c.regime,difference_mid:diff}});
  }catch(e){console.error('BROKER_REVIEW_DB_ERROR',e);res.status(500).json({error:'review could not be persisted'})}
});

const css=`body{margin:0;background:#f4f7fa;color:#102638;font-family:Inter,Arial,sans-serif}header{background:linear-gradient(120deg,#062b43,#176a87);color:white;padding:24px}.wrap{max-width:980px;margin:auto;padding:20px}.card{background:white;border:1px solid #dce5ed;border-radius:14px;padding:18px;margin-bottom:14px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}input,select,textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccd8e2;border-radius:8px}button{background:#176a87;color:white;border:0;border-radius:8px;padding:11px 16px;font-weight:700;cursor:pointer}.muted{color:#68798c}.hero{font-size:32px;font-weight:800;line-height:1.08}.cta{font-size:18px;line-height:1.5}.invite{background:#eaf7f2;border:1px solid #bfe2d7;padding:10px;border-radius:9px;margin-bottom:12px}.blind{background:#fff7e8;border:1px solid #ead39c;padding:10px;border-radius:9px;margin:10px 0}.reveal{background:#eef7ff;border:1px solid #bfd8ea;padding:10px;border-radius:9px;margin-top:10px}@media(max-width:700px){.grid{grid-template-columns:1fr}.hero{font-size:27px}}`;
function shell(body){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dry Bulk Freight Intelligence</title><style>${css}</style></head><body><header><b>Dry Bulk Freight Intelligence</b><div>Independent Broker Validation Pilot</div></header><div class="wrap">${body}</div></body></html>`}
app.get('/',(req,res)=>{
  const broker=String(req.query.broker||'');const key=String(req.query.key||'');
  if(!broker&&!key){return res.type('html').send(shell(`<div class="card"><div class="hero">Broker-grade dry-bulk freight intelligence, validated with market experts.</div><p class="cta">We are testing an AI-assisted decision-support tool for Black Sea / Mediterranean dry-bulk freight pricing. Selected brokers receive private review links to assess anonymised cases.</p><p class="muted">No client lists, fixture archives or proprietary databases are requested. Participation is by invitation only.</p></div><div class="card"><b>Scientific validation design</b><p>Expert views are collected blind, before model estimates are revealed, to reduce anchoring bias. After submission, the model indication is shown for comparison.</p></div>`));}
  const page=`<div class="card"><p>We are validating an AI-assisted decision-support tool for dry-bulk freight pricing. This review contains a few anonymised Black Sea / Mediterranean cases.</p><div id="invite" class="invite">Checking private invitation…</div><div class="blind"><b>Blind-first review:</b> please enter your independent market view before seeing the model estimate. Each first submission is permanently locked for the pilot; the model result is revealed only afterward.</div><div class="grid"><input id="name" placeholder="Your name (optional)"><input id="company" placeholder="Company (optional)"></div></div><div id="app" class="card">Loading cases…</div><script>const q=new URLSearchParams(location.search),broker=q.get('broker'),key=q.get('key');let cases=[];async function load(){let r=await fetch('/api/cases?broker='+encodeURIComponent(broker||'')+'&key='+encodeURIComponent(key||''));if(!r.ok){document.getElementById('invite').textContent='Private invitation';document.getElementById('app').innerHTML='<b>Invitation link is invalid or expired.</b>';return}let d=await r.json();cases=d.cases;document.getElementById('invite').innerHTML='<b>Private invitation for '+d.label+'</b>';render()}function render(){document.getElementById('app').innerHTML=cases.map((c,i)=>'<div class="card"><b>'+c.route+'</b><p>'+c.commodity+' · '+c.cargo+' · '+c.vessel+'</p><div class="grid"><input id="mid'+i+'" type="number" step="0.1" placeholder="Your fair mid (required)"><input id="low'+i+'" type="number" step="0.1" placeholder="Your fair low"><input id="high'+i+'" type="number" step="0.1" placeholder="Your fair high"><select id="dir'+i+'"><option>UP</option><option>FLAT</option><option>DOWN</option><option>UNCERTAIN</option></select><select id="conf'+i+'"><option value="5">Confidence 5 — very high</option><option value="4">Confidence 4</option><option value="3" selected>Confidence 3</option><option value="2">Confidence 2</option><option value="1">Confidence 1 — very low</option></select><select id="reason'+i+'"><option>TONNAGE</option><option>CARGO_FLOW</option><option>OWNER_PRESSURE</option><option>CHARTERER_RESISTANCE</option><option>SECURITY</option><option>PORT</option><option>SEASONALITY</option><option>VESSEL_POSITIONING</option><option>CARGO_SIZE</option><option>ROUTE_SPREAD</option><option>OTHER</option></select></div><textarea id="com'+i+'" rows="2" placeholder="Short comment (optional)" style="margin-top:10px"></textarea><button id="btn'+i+'" onclick="save('+i+')" style="margin-top:10px">Submit independent view</button> <span id="st'+i+'" class="muted"></span><div id="reveal'+i+'"></div></div>').join('')}function val(id){let v=document.getElementById(id).value;return v===''?null:Number(v)}async function save(i){let c=cases[i],body={broker,key,review_id:c.id,broker_name:document.getElementById('name').value,broker_company:document.getElementById('company').value,fair_mid:val('mid'+i),fair_low:val('low'+i),fair_high:val('high'+i),direction:document.getElementById('dir'+i).value,confidence:Number(document.getElementById('conf'+i).value),reason_code:document.getElementById('reason'+i).value,comment:document.getElementById('com'+i).value};let r=await fetch('/api/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let d=await r.json();if(!r.ok){document.getElementById('st'+i).textContent=' '+(d.error||'Error saving');return}document.getElementById('st'+i).textContent=' Saved and locked ✓';document.getElementById('btn'+i).disabled=true;document.getElementById('reveal'+i).innerHTML='<div class="reveal"><b>Model revealed after your independent submission</b><br>Model: '+d.reveal.model_mid.toFixed(1)+' USD/mt · Range '+d.reveal.model_low.toFixed(1)+'–'+d.reveal.model_high.toFixed(1)+' · '+d.reveal.model_direction+' · '+d.reveal.model_confidence+' confidence<br>Your midpoint difference vs model: '+d.reveal.difference_mid.toFixed(1)+' USD/mt</div>'}load();</script>`;
  res.type('html').send(shell(page));
});

init().then(()=>app.listen(process.env.PORT||10000,'0.0.0.0',()=>console.log('Broker validation portal listening with Postgres persistence'))).catch(e=>{console.error('DB_INIT_FAILED',e);process.exit(1)});
