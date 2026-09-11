const express=require('express');
const fs=require('fs');
const app=express();
app.use(express.json({limit:'200kb'}));

const INVITES=JSON.parse(process.env.BROKER_INVITES||'{}');
const ADMIN_KEY=process.env.ADMIN_KEY||'';
const STORE='/tmp/broker-reviews.json';
const CASES=[
{id:'BRV-2026-W37-001',route:'EX-UKRAINE → Turkish Black Sea',commodity:'Wheat SF47 / Corn SF49',cargo:'5,000-7,000',vessel:'Coaster',mid:73.04,low:64.13,high:81.96,confidence:'LOW',direction:'UP',regime:'CONFIRMED_TIGHTENING'},
{id:'BRV-2026-W37-002',route:'EX-UKRAINE → Turkish Black Sea',commodity:'Wheat SF47 / Corn SF49',cargo:'10,000-15,000',vessel:'Small Handy',mid:71.04,low:62.13,high:79.95,confidence:'LOW',direction:'UP',regime:'CONFIRMED_TIGHTENING'},
{id:'BRV-2026-W37-003',route:'EX-UKRAINE → Marmara, Turkey',commodity:'Wheat SF47 / Corn SF49',cargo:'5,000-7,000',vessel:'Coaster',mid:75.79,low:66.97,high:84.61,confidence:'LOW',direction:'UP',regime:'CONFIRMED_TIGHTENING'},
{id:'BRV-2026-W37-004',route:'EX-UKRAINE → Marmara, Turkey',commodity:'Wheat SF47 / Corn SF49',cargo:'10,000-15,000',vessel:'Small Handy',mid:73.66,low:64.86,high:82.47,confidence:'LOW',direction:'UP',regime:'CONFIRMED_TIGHTENING'},
{id:'BRV-2026-W37-005',route:'EX-UKRAINE → East Mediterranean',commodity:'Wheat SF47 / Corn SF49',cargo:'5,000-7,000',vessel:'Coaster',mid:90.86,low:73.28,high:108.44,confidence:'LOW',direction:'UP',regime:'CONFIRMED_TIGHTENING'}
];

let pool=null;
if(process.env.DATABASE_URL){
  const {Pool}=require('pg');
  pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
}
async function initDb(){
  if(!pool)return;
  await pool.query(`CREATE TABLE IF NOT EXISTS broker_reviews(
    id BIGSERIAL PRIMARY KEY,
    review_id TEXT NOT NULL,
    broker_slug TEXT NOT NULL,
    broker_name TEXT,
    broker_company TEXT,
    fair_mid NUMERIC,
    fair_low NUMERIC,
    fair_high NUMERIC,
    direction TEXT,
    market_state TEXT,
    accept_model TEXT,
    confidence INTEGER,
    reason_code TEXT,
    comment TEXT,
    permission TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(review_id,broker_slug)
  )`);
}
function invite(req){const broker=String(req.query.broker||req.body.broker||'');const key=String(req.query.key||req.body.key||'');return INVITES[broker]===key?broker:null;}
function loadReviews(){try{return JSON.parse(fs.readFileSync(STORE,'utf8'))}catch{return []}}
function saveReviews(x){fs.writeFileSync(STORE,JSON.stringify(x,null,2))}

app.get('/health',(req,res)=>res.json({ok:true,service:'dry-bulk-broker-validation',database:!!pool}));
app.get('/api/cases',(req,res)=>{const broker=invite(req);if(!broker)return res.status(403).json({error:'invalid invitation'});res.json({broker,cases:CASES});});
app.post('/api/reviews',async(req,res)=>{
  const broker=invite(req);if(!broker)return res.status(403).json({error:'invalid invitation'});
  const x=req.body||{};if(!CASES.find(c=>c.id===x.review_id))return res.status(400).json({error:'unknown case'});
  const rec={review_id:x.review_id,broker,broker_name:x.broker_name||'',broker_company:x.broker_company||'',fair_mid:x.fair_mid??null,fair_low:x.fair_low??null,fair_high:x.fair_high??null,direction:x.direction||'',market_state:x.market_state||'',accept_model:x.accept_model||'',confidence:x.confidence??null,reason_code:x.reason_code||'',comment:x.comment||'',permission:x.permission||'PILOT_ANALYSIS',created_at:new Date().toISOString()};
  if(pool){
    await pool.query(`INSERT INTO broker_reviews(review_id,broker_slug,broker_name,broker_company,fair_mid,fair_low,fair_high,direction,market_state,accept_model,confidence,reason_code,comment,permission) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(review_id,broker_slug) DO UPDATE SET broker_name=EXCLUDED.broker_name,broker_company=EXCLUDED.broker_company,fair_mid=EXCLUDED.fair_mid,fair_low=EXCLUDED.fair_low,fair_high=EXCLUDED.fair_high,direction=EXCLUDED.direction,market_state=EXCLUDED.market_state,accept_model=EXCLUDED.accept_model,confidence=EXCLUDED.confidence,reason_code=EXCLUDED.reason_code,comment=EXCLUDED.comment,permission=EXCLUDED.permission,created_at=now()`,[rec.review_id,rec.broker,rec.broker_name,rec.broker_company,rec.fair_mid,rec.fair_low,rec.fair_high,rec.direction,rec.market_state,rec.accept_model,rec.confidence,rec.reason_code,rec.comment,rec.permission]);
  } else {
    let rows=loadReviews();rows=rows.filter(r=>!(r.review_id===rec.review_id&&r.broker===broker));rows.push(rec);saveReviews(rows);
  }
  console.log('BROKER_REVIEW '+JSON.stringify({...rec,broker:'[invite]'}));res.json({ok:true});
});
app.get('/api/admin/reviews',async(req,res)=>{
  if(!ADMIN_KEY||req.query.key!==ADMIN_KEY)return res.status(403).json({error:'forbidden'});
  if(pool){const q=await pool.query('SELECT * FROM broker_reviews ORDER BY created_at DESC');return res.json(q.rows);}
  res.json(loadReviews());
});

const css=`body{margin:0;background:#f4f7fa;color:#102638;font-family:Inter,Arial,sans-serif}header{background:linear-gradient(120deg,#062b43,#176a87);color:white;padding:24px}.wrap{max-width:980px;margin:auto;padding:20px}.card{background:white;border:1px solid #dce5ed;border-radius:14px;padding:18px;margin-bottom:14px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}input,select,textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccd8e2;border-radius:8px}button{background:#176a87;color:white;border:0;border-radius:8px;padding:11px 16px;font-weight:700}.muted{color:#68798c}.pill{display:inline-block;padding:4px 9px;background:#eef3f7;border-radius:99px;margin:2px;font-size:12px}.hero{font-size:34px;font-weight:800;line-height:1.05}.cta{font-size:18px;line-height:1.5}@media(max-width:700px){.grid{grid-template-columns:1fr}.hero{font-size:28px}}`;
function shell(body){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dry Bulk Freight Intelligence</title><style>${css}</style></head><body><header><b>Dry Bulk Freight Intelligence</b><div>Independent Broker Validation Pilot</div></header><div class="wrap">${body}</div></body></html>`}

app.get('/',(req,res)=>{
  const broker=String(req.query.broker||'');const key=String(req.query.key||'');
  if(!broker&&!key){
    return res.type('html').send(shell(`<div class="card"><div class="hero">Broker-grade dry-bulk freight intelligence, validated with market experts.</div><p class="cta">We are testing an AI-assisted decision-support tool for Black Sea / Mediterranean dry-bulk freight pricing. Selected brokers receive private review links to assess anonymised cases and compare their market view with the model.</p><p class="muted">No client lists, fixture archives or proprietary databases are requested. Participation is by invitation only.</p></div><div class="card"><b>How the pilot works</b><p>1. Open your private invitation link.<br>2. Review 5 anonymised cases.<br>3. Enter your fair range, direction and confidence.<br>4. Submit optional comments on why you agree or disagree.</p></div>`));
  }
  const page=`<div class="card"><p>We are validating an AI-assisted decision-support tool for dry-bulk freight pricing. This review contains a few anonymised Black Sea / Mediterranean cases. No client list, fixture archive or proprietary database is requested.</p><div id="invite" class="muted"></div><div class="grid"><input id="name" placeholder="Your name (optional)"><input id="company" placeholder="Company (optional)"></div></div><div id="app" class="card">Loading invitation…</div><script>const q=new URLSearchParams(location.search),broker=q.get('broker'),key=q.get('key');let cases=[];async function load(){let r=await fetch('/api/cases?broker='+encodeURIComponent(broker||'')+'&key='+encodeURIComponent(key||''));if(!r.ok){document.getElementById('app').innerHTML='<b>Invitation link is invalid or expired.</b>';return}let d=await r.json();cases=d.cases;document.getElementById('invite').innerHTML='<b>Private invitation for '+(d.broker||'broker')+'</b>';render()}function render(){document.getElementById('app').innerHTML=cases.map((c,i)=>'<div class="card"><b>'+c.route+'</b><p>'+c.commodity+' · '+c.cargo+' · '+c.vessel+'</p><span class="pill">Model '+c.mid.toFixed(1)+' USD/mt</span><span class="pill">Range '+c.low.toFixed(1)+'–'+c.high.toFixed(1)+'</span><span class="pill">'+c.confidence+'</span><span class="pill">'+c.direction+'</span><div class="grid" style="margin-top:12px"><input id="mid'+i+'" type="number" step="0.1" placeholder="Your fair mid"><input id="low'+i+'" type="number" step="0.1" placeholder="Your fair low"><input id="high'+i+'" type="number" step="0.1" placeholder="Your fair high"><select id="dir'+i+'"><option>UP</option><option>FLAT</option><option>DOWN</option><option>UNCERTAIN</option></select><select id="acc'+i+'"><option>ACCEPT</option><option>PARTIAL</option><option>REJECT</option></select><select id="conf'+i+'"><option value="5">Confidence 5 — very high</option><option value="4">Confidence 4</option><option value="3" selected>Confidence 3</option><option value="2">Confidence 2</option><option value="1">Confidence 1 — very low</option></select><select id="reason'+i+'"><option>TONNAGE</option><option>CARGO_FLOW</option><option>OWNER_PRESSURE</option><option>CHARTERER_RESISTANCE</option><option>SECURITY</option><option>PORT</option><option>SEASONALITY</option><option>VESSEL_POSITIONING</option><option>CARGO_SIZE</option><option>ROUTE_SPREAD</option><option>OTHER</option></select></div><textarea id="com'+i+'" rows="2" placeholder="Short comment (optional)" style="margin-top:10px"></textarea><button onclick="save('+i+')" style="margin-top:10px">Submit review</button> <span id="st'+i+'" class="muted"></span></div>').join('')}function val(id){let v=document.getElementById(id).value;return v===''?null:Number(v)}async function save(i){let c=cases[i],body={broker,key,review_id:c.id,broker_name:document.getElementById('name').value,broker_company:document.getElementById('company').value,fair_mid:val('mid'+i),fair_low:val('low'+i),fair_high:val('high'+i),direction:document.getElementById('dir'+i).value,market_state:c.regime,accept_model:document.getElementById('acc'+i).value,confidence:Number(document.getElementById('conf'+i).value),reason_code:document.getElementById('reason'+i).value,comment:document.getElementById('com'+i).value,permission:'PILOT_ANALYSIS'};let r=await fetch('/api/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});document.getElementById('st'+i).textContent=r.ok?' Saved ✓':' Error saving';}load();</script>`;
  res.type('html').send(shell(page));
});

initDb().then(()=>app.listen(process.env.PORT||10000,'0.0.0.0',()=>console.log('Broker validation portal listening'))).catch(e=>{console.error('DB init failed',e);process.exit(1)});
