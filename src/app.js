import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {participationTotals} from './modules/league/participation.js';
import {fetchNotice} from './modules/public-notices/read.js';
import {searchOfficialSources,classifyNotice,generateSuggestion} from './modules/public-notices/search.js';
import {verifiedCandidateUrls,noticeAssessment} from './modules/public-notices/automation.js';
import {validatePopulation,fetchOfficialPage} from './modules/schools/population.js';

export const categories = ['volunteer','mentoring','community','sharing','scholarship','blood'];
const secret = process.env.DANDI_SECRET || 'local-demo-secret-do-not-deploy';
const sign = value => createHmac('sha256',secret).update(value).digest('hex');
const hash = (p,s=randomBytes(16).toString('hex')) => `${s}:${scryptSync(p,s,64).toString('hex')}`;
const verify = (p,h) => { const [s,v]=h.split(':'); const a=Buffer.from(hash(p,s).split(':')[1],'hex'), b=Buffer.from(v,'hex'); return a.length===b.length && timingSafeEqual(a,b); };
const err = (status,message,code='BAD_REQUEST') => Object.assign(new Error(message),{status,code});
const weightsOk = w => w && typeof w==='object' && !Array.isArray(w) && Object.keys(w).length>=1 && Object.keys(w).length<=2 && Object.entries(w).every(([k,v])=>categories.includes(k) && typeof v==='number' && Number.isFinite(v) && v>0 && v<=1) && Math.abs(Object.values(w).reduce((a,b)=>a+b,0)-1)<1e-9;
const validDate = v => typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v+'T00:00:00Z')) && new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const todayKst = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const canArchive = m => !m.archived_at && (m.status==='closed' || (m.application_end && m.application_end<todayKst()));
const accepting = m => !!m.created_by && !m.archived_at && m.status==='open' && ((m.application_start && m.application_end && m.application_start<=todayKst() && todayKst()<=m.application_end) || (m.is_demo && !m.application_start && !m.application_end));
const parseMission = m => ({...m,weights:JSON.parse(m.weights),is_demo:!!m.is_demo});
export function createApp(path=process.env.DB_PATH || 'dandi.sqlite', adapters={}) {
 const db = new DatabaseSync(path); db.exec(readFileSync(fileURLToPath(new URL('../db/schema.sql',import.meta.url)),'utf8')); db.exec('PRAGMA foreign_keys=ON');
 // Existing local databases are upgraded in place; missing dates remain unknown.
 const columns=db.prepare('PRAGMA table_info(missions)').all().map(x=>x.name);
 if(!columns.includes('application_start')) db.exec('ALTER TABLE missions ADD COLUMN application_start TEXT');
 if(!columns.includes('application_end')) db.exec('ALTER TABLE missions ADD COLUMN application_end TEXT');
 if(!columns.includes('archived_at')) db.exec('ALTER TABLE missions ADD COLUMN archived_at TEXT');
 if(!columns.includes('created_by')) db.exec('ALTER TABLE missions ADD COLUMN created_by INTEGER REFERENCES users(id)');
 if(!columns.includes('contribution_value')) db.exec('ALTER TABLE missions ADD COLUMN contribution_value REAL NOT NULL DEFAULT 1');
 if(!columns.includes('application_note')) db.exec("ALTER TABLE missions ADD COLUMN application_note TEXT NOT NULL DEFAULT ''");
 db.exec(`CREATE TABLE IF NOT EXISTS automatic_mission_sources(source_kind TEXT NOT NULL, external_id TEXT NOT NULL, mission_id INTEGER NOT NULL UNIQUE REFERENCES missions(id), verified_until INTEGER NOT NULL, PRIMARY KEY(source_kind,external_id)); CREATE TABLE IF NOT EXISTS automation_status(id INTEGER PRIMARY KEY CHECK(id=1), last_attempt INTEGER, message TEXT, created_count INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS automation_candidates(url TEXT PRIMARY KEY, title TEXT, result TEXT NOT NULL, checked_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS school_population_automation(id INTEGER PRIMARY KEY CHECK(id=1), last_attempt INTEGER, last_success INTEGER, message TEXT); CREATE TABLE IF NOT EXISTS school_population_latest(school_id INTEGER PRIMARY KEY REFERENCES schools(id),student_count INTEGER NOT NULL,reference_year INTEGER NOT NULL,source_url TEXT NOT NULL,evidence TEXT NOT NULL,updated_by INTEGER NOT NULL REFERENCES users(id));`);
 const get=(sql,...p)=>db.prepare(sql).get(...p), all=(sql,...p)=>db.prepare(sql).all(...p), run=(sql,...p)=>db.prepare(sql).run(...p);
 let running=false, timer=null, populationRunning=false;
 function copyPopulationToSemester(semester){run(`INSERT INTO school_semester_population(school_id,semester_id,student_count,reference_year,source_url,updated_by) SELECT school_id,?,student_count,reference_year,source_url,updated_by FROM school_population_latest WHERE 1 ON CONFLICT(school_id,semester_id) DO UPDATE SET student_count=excluded.student_count,reference_year=excluded.reference_year,source_url=excluded.source_url,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`,semester.id);}
 async function runPopulationAutomation(){
  if(populationRunning)return;populationRunning=true;
  try{
   const status=get('SELECT * FROM school_population_automation WHERE id=1');const semester=get('SELECT * FROM semesters WHERE start_at<=? AND end_at>=? ORDER BY start_at DESC LIMIT 1',todayKst(),todayKst());
   if(!semester)return;
   const now=Date.now();if(status?.last_success && now-status.last_success<365*86400000){if(get('SELECT COUNT(*) AS n FROM school_population_latest').n===5)copyPopulationToSemester(semester);return;}
   if(status?.last_attempt && now-status.last_attempt<86400000 && !(process.env.OPENAI_API_KEY && (status.message?.includes('API 키가 필요')||status.message?.includes('HTTP 400'))))return;
   if(process.env.AI_MODE!=='live'||!process.env.OPENAI_API_KEY)throw Error('학교 규모 조회에는 OpenAI API 키가 필요합니다.');
   const actor=get("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1");if(!actor)throw Error('관리자 계정이 필요합니다.');
   const schools=all('SELECT id,name FROM schools ORDER BY id');if(schools.length!==5)throw Error('학교 목록을 확인할 수 없습니다.');
   const result=await (adapters.populationSearch||searchOfficialSources)({apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_SEARCH_MODEL||'gpt-6-luna',domains:['academyinfo.go.kr','knu.ac.kr','yu.ac.kr','kmu.ac.kr','kumoh.ac.kr','daegu.ac.kr'],prompt:`공식 공개 자료에서 ${schools.map(s=>s.name).join(', ')} 5개 학교의 같은 기준연도 학부 및 대학원 재학생 합계를 검색하세요. 각 학교 이름, 연도, 인원, 학부 및 대학원 범위와 합계가 함께 적힌 공식 페이지의 정확한 짧은 원문을 확보하세요. JSON만 출력: {"items":[{"school":"학교명","count":12345,"year":2025,"scope":"학부 및 대학원 재학생 합계","url":"https://...","evidence":"원문 그대로"}]}. 확인하지 못하면 빈 배열. 숫자나 출처를 추정하지 마세요.`});
   const verified=[];for(const school of schools){const candidates=result.items.filter(x=>x.school===school.name);let found=null;for(const candidate of candidates.slice(0,2)){try{const html=await (adapters.populationFetch||fetchOfficialPage)(candidate.url);found=validatePopulation(candidate,school.name,result.citations,html,Number(todayKst().slice(0,4)));if(found)break;}catch{}}if(!found)throw Error(`${school.name}의 동일 기준 공식 재학생 수를 확인하지 못했습니다.`);verified.push({...found,id:school.id});}
   if(new Set(verified.map(x=>x.year)).size!==1)throw Error('학교별 자료의 기준연도가 다릅니다.');
   db.exec('BEGIN');try{for(const v of verified)run('INSERT INTO school_population_latest(school_id,student_count,reference_year,source_url,evidence,updated_by) VALUES(?,?,?,?,?,?) ON CONFLICT(school_id) DO UPDATE SET student_count=excluded.student_count,reference_year=excluded.reference_year,source_url=excluded.source_url,evidence=excluded.evidence,updated_by=excluded.updated_by',v.id,v.count,v.year,v.url,v.evidence,actor.id);copyPopulationToSemester(semester);run('INSERT INTO audit_log(actor_id,action,detail) VALUES(?,?,?)',actor.id,'school:population_auto',JSON.stringify({year:verified[0].year,schools:verified.map(v=>({school:v.school,count:v.count,source:v.url}))}));run('INSERT INTO school_population_automation(id,last_attempt,last_success,message) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET last_attempt=excluded.last_attempt,last_success=excluded.last_success,message=excluded.message',now,now,`${verified[0].year}년 공식 자료 갱신 완료`);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  }catch(e){run('INSERT INTO school_population_automation(id,last_attempt,message) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET last_attempt=excluded.last_attempt,message=excluded.message',Date.now(),e.message);}
  finally{populationRunning=false;}
 }

 const isDiscoverable=m=>{const source=get('SELECT verified_until FROM automatic_mission_sources WHERE mission_id=?',m.id);if(source && source.verified_until<=Date.now())return false;if(source && !m.application_start && !m.application_end)return !!m.created_by && !m.archived_at && m.status==='open';return accepting(m);};
 async function runAutomation(){
  if(running)return;running=true;
  let created=0, failures=0;
  try{
   if(!process.env.OPENAI_API_KEY || process.env.AI_MODE!=='live')throw Error('자동 수집에는 AI_MODE=live와 OpenAI API 키가 필요합니다.');
   const actor=get("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1");
   const semester=get('SELECT * FROM semesters WHERE start_at<=? AND end_at>=? ORDER BY start_at DESC LIMIT 1',todayKst(),todayKst());
   if(!actor||!semester)throw Error('관리자 계정과 현재 학기가 필요합니다.');
   const searches=await Promise.allSettled(['1365.go.kr','vms.or.kr'].map(domain=>(adapters.search||searchOfficialSources)({apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_SEARCH_MODEL||'gpt-6-luna',domains:domain==='1365.go.kr'?[]:[domain],prompt:`${domain} 봉사활동의 공식 상세 링크를 검색하세요. 1365의 경우 대학이나 공공기관 공지에서 공식 1365 링크를 찾아도 됩니다. 기준 날짜는 ${todayKst()} 입니다. 그 날짜에 모집 중인 대구 및 경북 지역 봉사활동의 개별 상세 공고를 가능한 많이 검색하세요. 과거에 종료된 공고는 제외하세요. 최근 공고의 개별 상세 URL을 최대 20개 JSON {"items":[{"url":"https://..."}]} 형식으로 반환하세요. 출처가 확인되지 않는 URL을 만들지 마세요.`})));
   const successful=searches.filter(x=>x.status==='fulfilled').map(x=>x.value);if(!successful.length)throw searches[0].reason;
   const search1365=searches[0].status==='fulfilled'?verifiedCandidateUrls(searches[0].value,{allow1365Suggestions:true}):[];const searchVms=searches[1].status==='fulfilled'?verifiedCandidateUrls(searches[1].value):[];const earlier=all('SELECT url FROM automation_candidates ORDER BY checked_at DESC').map(x=>x.url);const urls=[...new Set([...search1365,...searchVms,...earlier])].slice(0,40);const sourceFailures=searches.length-successful.length;const perSource=['1365.go.kr','vms.or.kr'].map((domain,i)=>{const outcome=searches[i];return outcome.status==='fulfilled'?`${domain.startsWith('1365')?'1365':'VMS'} ${verifiedCandidateUrls(outcome.value,{allow1365Suggestions:i===0}).length}건`:`${domain.startsWith('1365')?'1365':'VMS'} 검색 실패: ${String(outcome.reason?.message||'원인 미확인').slice(0,180)}`;}).join(', ');
   run('DELETE FROM automation_candidates');const record=(url,title,result)=>run('INSERT INTO automation_candidates(url,title,result,checked_at) VALUES(?,?,?,?) ON CONFLICT(url) DO UPDATE SET title=excluded.title,result=excluded.result,checked_at=excluded.checked_at',url,title||null,result,Date.now());
   // Previously imported notices must also be rechecked, even if search no longer returns them.
   const existing=all("SELECT m.source_url FROM automatic_mission_sources a JOIN missions m ON m.id=a.mission_id WHERE m.archived_at IS NULL AND m.status='open'").map(x=>x.source_url);
   for(const url of [...new Set([...urls,...existing])].slice(0,80)){let title=null,stage='공식 공고 읽기';try{
    const notice=await (adapters.fetchNotice||fetchNotice)(url);title=notice.title;const assessment=noticeAssessment(notice,todayKst()),dates=assessment.dates;
    const prior=get('SELECT mission_id FROM automatic_mission_sources WHERE source_kind=? AND external_id=?',notice.source,notice.external_id);
    if(notice.source==='1365'&&!/(대구|경북|경상북도)/.test(notice.fields.region||'')){if(prior)run('UPDATE automatic_mission_sources SET verified_until=0 WHERE mission_id=?',prior.mission_id);record(url,notice.title,'공식 공고에서 대구·경북 활동 지역을 확인하지 못했습니다.');continue;}
    if(!dates){if(prior)run('UPDATE automatic_mission_sources SET verified_until=0 WHERE mission_id=?',prior.mission_id);record(url,notice.title,assessment.reason);continue;}
    if(prior){run('UPDATE automatic_mission_sources SET verified_until=? WHERE mission_id=?',Date.now()+8*3600000,prior.mission_id);run('UPDATE missions SET application_start=?,application_end=?,application_period=?,application_note=? WHERE id=?',dates.start,dates.end,dates.start&&dates.end?`${dates.start} ~ ${dates.end}`:'모집 기간 미정',assessment.periodUnconfirmed?'모집 기간 미정: 공식 공고에서 신청 가능 여부를 확인하세요.':assessment.statusUnconfirmed?'모집 상태 미확인: 신청 가능 여부를 공식 공고에서 확인하세요.':'공식 공고에서 신청 조건을 확인하세요.',prior.mission_id);record(url,notice.title,assessment.statusUnconfirmed?'이미 등록됨 · 모집 상태 미확인':'이미 등록된 활동입니다.');continue;}
    if(!urls.includes(url))continue;
    stage='AI 분류';const suggestion=await (adapters.classify||classifyNotice)('structure',{notice:notice.notice},{apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-4.1-mini'});if(suggestion.mode!=='live'||!weightsOk(suggestion.result.weights)){failures++;record(url,notice.title,'AI 분류 결과를 확인하지 못했습니다.');continue;}
    stage='활동 저장';db.exec('BEGIN');try{
     let org=get('SELECT id FROM organizations WHERE name=?',notice.fields.organization);if(!org){const r=run('INSERT INTO organizations(name) VALUES(?)',notice.fields.organization);org={id:Number(r.lastInsertRowid)};}
     const r=run('INSERT INTO missions(organization_id,semester_id,title,notice,source_url,apply_url,eligibility,application_period,completion_policy,weights,rules_version,status,is_demo,application_start,application_end,created_by,contribution_value,application_note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',org.id,semester.id,notice.title,notice.notice,notice.source_url,notice.source_url,notice.fields.eligibility||'자세한 내용은 공식 공고 확인',dates.start&&dates.end?`${dates.start} ~ ${dates.end}`:'모집 기간 미정','관리자 확인',JSON.stringify(suggestion.result.weights),semester.rules_version,'open',0,dates.start,dates.end,actor.id,1,assessment.periodUnconfirmed?'모집 기간 미정: 공식 공고에서 신청 가능 여부를 확인하세요.':assessment.statusUnconfirmed?'모집 상태 미확인: 신청 가능 여부를 공식 공고에서 확인하세요.':'공식 공고에서 신청 조건을 확인하세요.');
     const id=Number(r.lastInsertRowid);run('INSERT INTO automatic_mission_sources VALUES(?,?,?,?)',notice.source,notice.external_id,id,Date.now()+8*3600000);run('INSERT INTO audit_log(actor_id,action,mission_id,detail) VALUES(?,?,?,?)',actor.id,'mission:auto_import',id,notice.source_url);db.exec('COMMIT');created++;record(url,notice.title,assessment.periodUnconfirmed?'신규 등록됨 · 모집 기간 미정':assessment.statusUnconfirmed?'신규 등록됨 · 모집 상태 미확인':'신규 등록되었습니다.');
    }catch(e){db.exec('ROLLBACK');throw e;}
   }catch(e){failures++;const message=String(e?.message||'');const detail=stage==='AI 분류'&&/^OpenAI API 요청이 실패했습니다/.test(message)?`AI 분류 실패: ${message.slice(0,250)}`:stage==='AI 분류'?'AI 분류 실패':stage==='활동 저장'?'활동 저장 실패':/공식 사이트에 연결하지 못했습니다/.test(message)?'공식 사이트 연결 실패':/공식 사이트가 요청을 처리하지 않았습니다 \(HTTP \d{3}\)/.test(message)?message:/공고 페이지 형식이 아닙니다|공고의 필수 정보를 읽지 못했습니다|공고 페이지 문자 형식을 읽지 못했습니다/.test(message)?message:'공식 공고 읽기 실패';record(url,title,detail);}}
   const skipped=get("SELECT COUNT(*) AS n FROM automation_candidates WHERE result NOT IN ('신규 등록되었습니다.','신규 등록됨 · 모집 상태 미확인','신규 등록됨 · 모집 기간 미정','이미 등록된 활동입니다.','이미 등록됨 · 모집 상태 미확인') AND result NOT LIKE '%실패%' AND result NOT LIKE '%처리하지 않았습니다%' AND result NOT LIKE '%페이지 형식%' AND result NOT LIKE '%필수 정보를 읽지 못했습니다%' AND result NOT LIKE '%문자 형식을 읽지 못했습니다%' AND result NOT LIKE '%AI 분류%'").n;
   const message=`확인 후보 ${urls.length}건, 신규 등록 ${created}건, 등록 보류 ${skipped}건, 처리 실패 ${failures}건 (${perSource})${sourceFailures?`, 검색 실패 사이트 ${sourceFailures}곳`:``}`;
   run('INSERT INTO automation_status(id,last_attempt,message,created_count) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET last_attempt=excluded.last_attempt,message=excluded.message,created_count=excluded.created_count',Date.now(),message,created);
  }catch(e){run('INSERT INTO automation_status(id,last_attempt,message,created_count) VALUES(1,?,?,0) ON CONFLICT(id) DO UPDATE SET last_attempt=excluded.last_attempt,message=excluded.message,created_count=0',Date.now(),e.message);}
  finally{running=false;}
 }
 function startAutomation(){if(timer)return;const previous=get('SELECT last_attempt,message FROM automation_status WHERE id=1');const interval=6*3600000;const newlyConfigured=process.env.OPENAI_API_KEY && process.env.AI_MODE==='live' && (previous?.message?.includes('API 키가 필요')||previous?.message?.includes('HTTP 400'));const delay=newlyConfigured?0:Math.max(0,interval-(Date.now()-(previous?.last_attempt||0)));timer=setTimeout(function tick(){runAutomation().then(()=>runPopulationAutomation()).finally(()=>{timer=setTimeout(tick,interval);timer.unref();});},delay);timer.unref();}
 function seed() {
  if(get('SELECT COUNT(*) AS n FROM users').n) return;
  db.exec('BEGIN'); try {
   for(const name of ['경북대학교','영남대학교','계명대학교','금오공과대학교','대구대학교']) run('INSERT INTO schools(name) VALUES(?)',name);
   run('INSERT INTO semesters(name,start_at,end_at,cutoff_at,rules_version) VALUES(?,?,?,?,?)','2026 2학기','2026-09-01','2027-02-28','2027-03-15','demo-v1');
   run('INSERT INTO organizations(name) VALUES(?)','시연 사회공헌기관');
   for (const [index,email] of ['knu','ynu','kmu','kumoh','daegu'].entries()) {
    const result=run('INSERT INTO users(email,password_hash,role,school_id,organization_id) VALUES(?,?,?,?,?)',`${email}@demo.local`,hash('DemoStudent!123'),'student',index+1,null);
    run('INSERT INTO enrollments(user_id,semester_id,school_id) VALUES(?,?,?)',Number(result.lastInsertRowid),1,index+1);
   }
   for (const [email,pw,role,org] of [['admin@demo.local','DemoAdmin!123','admin',null],['partner@demo.local','DemoPartner!123','partner',1]]) run('INSERT INTO users(email,password_hash,role,organization_id) VALUES(?,?,?,?)',email,hash(pw),role,org);
   db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
 }
 function auth(token) {
  if(!token?.startsWith('Bearer ')) return null;
  const [id,exp,sig,...rest]=token.slice(7).split('.'); if(rest.length || !id || !exp || !sig || Number(exp)<Date.now()/1000) return null;
  const expected=sign(`${id}.${exp}`); if(sig.length!==expected.length || !timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return null;
  return get('SELECT id,role,school_id,organization_id FROM users WHERE id=?',Number(id));
 }
 const role = (u,...allowed) => {if(!allowed.includes(u.role)) throw err(403,'권한이 없습니다.','FORBIDDEN');};
 const missionFor=(id,u) => {const m=get('SELECT * FROM missions WHERE id=?',Number(id)); if(!m) throw err(404,'미션이 없습니다.','NOT_FOUND'); if(u.role==='partner' && u.organization_id!==m.organization_id) throw err(403,'기관 권한이 없습니다.','FORBIDDEN'); return m;};
 function transition(m,userId,status,source,record,u) {
  if(!get('SELECT 1 FROM enrollments WHERE user_id=? AND semester_id=?',userId,m.semester_id)) throw err(400,'학기 등록 참가자가 아닙니다.');
  const previous=get('SELECT * FROM verifications WHERE mission_id=? AND user_id=?',m.id,userId);
  const allowed={none:['applied','started','pending','approved'],applied:['started','pending','cancelled'],started:['pending','cancelled'],pending:['approved','rejected','cancelled'],approved:['cancelled'],rejected:['pending'],cancelled:['pending']};
  if(!allowed[previous?.status||'none']?.includes(status)) throw err(400,'허용되지 않는 상태 전환입니다.');
  if(previous) run('UPDATE verifications SET status=?,source=COALESCE(?,source),external_record_id=COALESCE(?,external_record_id),reviewed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',status,source||null,record||null,u.id,previous.id);
  else run('INSERT INTO verifications(mission_id,user_id,status,source,external_record_id,reviewed_by) VALUES(?,?,?,?,?,?)',m.id,userId,status,source||null,record||null,u.id);
  run('INSERT INTO audit_log(actor_id,action,mission_id,user_id,detail) VALUES(?,?,?,?,?)',u.id,`verification:${status}`,m.id,userId,source||null);
 }
 async function ai(task,input) {
  if(process.env.AI_MODE==='live' && process.env.OPENAI_API_KEY) try {
   const result=await (adapters.generateSuggestion||generateSuggestion)(task,input,{apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-4.1-mini'});
   if(task==='structure' && !weightsOk(result.weights)) throw Error('invalid weights');
   if(task==='recommend' && (!Array.isArray(result.recommendations) || result.recommendations.some(x=>!x || !input.missions.some(m=>m.id===x.id) || typeof x.reason!=='string'))) throw Error('invalid recommendations');
   return {mode:'live',result,warning:'AI 제안은 원문과 자격을 담당자가 확인해야 합니다.'};
  } catch { /* explicit mock fallback */ }
  return {mode:'mock',result:task==='structure'?{title:null,eligibility:null,application_period:null,completion_policy:null,weights:{volunteer:1},note:'모의 제안: 원문을 확인하고 수정하세요.'}:{recommendations:input.missions.slice(0,5).map(m=>({id:m.id,reason:'등록된 미션입니다. 자격을 확인해 주세요.'}))},warning:'모의 응답: 실제 모델 미설정 또는 호출 실패'};
 }
 async function dispatch(method,url,body={},authorization='') {
  try {
   const parsed=new URL(url,'http://localhost'), p=parsed.pathname, q=parsed.searchParams;
   if(method==='GET' && p==='/api/health') return {status:200,data:{status:'ok'}};
   if(method==='GET' && p==='/api/activities') return {status:200,data:all("SELECT * FROM missions WHERE status='open'").filter(isDiscoverable).map(m=>({id:String(m.id),title:m.title,minutes:0,points:0}))};
   if(method==='POST' && p==='/api/auth/login') {
    const user=get('SELECT * FROM users WHERE email=?',String(body.email||'')); if(!user || !verify(String(body.password||''),user.password_hash)) throw err(401,'로그인 실패','UNAUTHORIZED');
    const payload=`${user.id}.${Math.floor(Date.now()/1000)+3600}`; return {status:200,data:{token:`${payload}.${sign(payload)}`,role:user.role,user_id:user.id,school_id:user.school_id,expires_in:3600}};
   }
   const u=auth(authorization); if(!u) throw err(401,'로그인이 필요합니다.','UNAUTHORIZED');
   // Application claims are personal records, and never imply institutional confirmation.
   const discoverableMissions=()=>{
    const rows=all("SELECT * FROM missions WHERE status='open'").filter(isDiscoverable);
    if(u.role!=='student') return rows;
    const excluded=new Set([...all('SELECT mission_id FROM application_claims WHERE user_id=?',u.id),...all("SELECT mission_id FROM verifications WHERE user_id=? AND status IN ('applied','started','pending','approved')",u.id)].map(r=>r.mission_id));
    return rows.filter(m=>!excluded.has(m.id));
   };
   if(method==='GET' && p==='/api/missions') return {status:200,data:discoverableMissions().map(parseMission)};
   if(method==='POST' && p==='/api/admin/public-notice/preview') {role(u,'admin');let notice;try{notice=await fetchNotice(body.url);}catch(e){throw err(400,e.message);}const suggestion=await ai('structure',{notice:notice.notice});return {status:200,data:{notice,suggestion}};}
   if(method==='POST' && p==='/api/ai/structure') {role(u,'admin','partner'); if(typeof body.notice!=='string'||!body.notice.trim()||body.notice.length>12000) throw err(400,'공고는 1~12000자여야 합니다.'); return {status:200,data:await ai('structure',{notice:body.notice})};}
   if(method==='POST' && p==='/api/ai/recommend') {role(u,'student'); const missions=discoverableMissions().map(parseMission).map(({id,title,eligibility,application_period,weights})=>({id,title,eligibility,application_period,weights})); return {status:200,data:await ai('recommend',{profile:body.profile||{},missions})};}
   if(method==='POST' && p==='/api/missions') {
    role(u,'admin'); const org=Number(body.organization_id); if(u.role==='partner' && u.organization_id!==org) throw err(403,'기관 권한이 없습니다.','FORBIDDEN');
    const fields=['title','notice','source_url','apply_url','eligibility','completion_policy','rules_version']; if(fields.some(k=>typeof body[k]!=='string'||!body[k].trim()) || !weightsOk(body.weights)) throw err(400,'필수 항목 또는 가중치 오류');
    if(!Number.isSafeInteger(org) || org<1 || !get('SELECT 1 FROM organizations WHERE id=?',org)) throw err(400,'등록된 기관 ID가 아닙니다.');
    const semesterId=Number(body.semester_id);if(!Number.isSafeInteger(semesterId)||semesterId<1||!get('SELECT 1 FROM semesters WHERE id=?',semesterId)) throw err(400,'등록된 학기 ID가 아닙니다.');
    if(!validDate(body.application_start) || !validDate(body.application_end) || body.application_start>body.application_end) throw err(400,'유효한 모집 시작일과 마감일을 확인하세요.');
    // 활동별 가중 점수는 사용하지 않고 승인된 활동 1건을 1회로 기록합니다.
    if(body.application_note!==undefined && (typeof body.application_note!=='string' || body.application_note.length>300)) throw err(400,'모집 안내는 300자 이내여야 합니다.');
    for(const k of ['source_url','apply_url']) {let v;try {v=new URL(body[k]);}catch{throw err(400,'유효한 HTTPS URL이 필요합니다.');} if(v.protocol!=='https:') throw err(400,'HTTPS URL이 필요합니다.');}
    const result=run('INSERT INTO missions(organization_id,semester_id,title,notice,source_url,apply_url,eligibility,application_period,completion_policy,weights,rules_version,status,is_demo,application_start,application_end,created_by,contribution_value,application_note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',org,Number(body.semester_id),body.title,body.notice,body.source_url,body.apply_url,body.eligibility,`${body.application_start} ~ ${body.application_end}`,body.completion_policy,JSON.stringify(body.weights),body.rules_version,'open',body.is_demo?1:0,body.application_start,body.application_end,u.id,1,body.application_note||''); return {status:201,data:{id:Number(result.lastInsertRowid)}};
   }
   if(method==='POST' && p==='/api/admin/automation/run') {role(u,'admin');if(running)throw err(409,'이미 확인 중입니다.');void runAutomation();return {status:202,data:{started:true}};}
   if(method==='GET' && p==='/api/admin/automation') {role(u,'admin');return {status:200,data:{...(get('SELECT last_attempt,message,created_count FROM automation_status WHERE id=1')||{}),candidates:all('SELECT url,title,result FROM automation_candidates ORDER BY checked_at,url'),configured:!!process.env.OPENAI_API_KEY && process.env.AI_MODE==='live',running}};}
   if(method==='GET' && p==='/api/admin/school-population-status') {role(u,'admin');return {status:200,data:{...(get('SELECT last_attempt,last_success,message FROM school_population_automation WHERE id=1')||{}),running:populationRunning}};}
   if(method==='GET' && p==='/api/admin/school-populations') {role(u,'admin');const semester=Number(q.get('semester_id')||1);if(!Number.isSafeInteger(semester)||semester<1||!get('SELECT 1 FROM semesters WHERE id=?',semester))throw err(400,'유효한 학기가 필요합니다.');return {status:200,data:all('SELECT s.id,s.name,p.student_count,p.reference_year,p.source_url,p.updated_at FROM schools s LEFT JOIN school_semester_population p ON p.school_id=s.id AND p.semester_id=? ORDER BY s.id',semester)};}
   if(method==='POST' && p==='/api/admin/school-populations') {role(u,'admin');const schoolId=Number(body.school_id),semester=Number(body.semester_id),count=body.student_count,year=body.reference_year;if(!Number.isSafeInteger(schoolId)||!get('SELECT 1 FROM schools WHERE id=?',schoolId)||!Number.isSafeInteger(semester)||!get('SELECT 1 FROM semesters WHERE id=?',semester))throw err(400,'학교 또는 학기를 확인해 주세요.');if(!Number.isSafeInteger(count)||count<1||count>1000000||!Number.isSafeInteger(year)||year<2000||year>2100)throw err(400,'재학생 수와 기준연도를 확인해 주세요.');let url;try{url=new URL(body.source_url);}catch{throw err(400,'출처 URL을 확인해 주세요.');}if(url.protocol!=='https:')throw err(400,'출처는 HTTPS URL이어야 합니다.');db.exec('BEGIN');try{run('INSERT INTO school_semester_population(school_id,semester_id,student_count,reference_year,source_url,updated_by) VALUES(?,?,?,?,?,?) ON CONFLICT(school_id,semester_id) DO UPDATE SET student_count=excluded.student_count,reference_year=excluded.reference_year,source_url=excluded.source_url,updated_at=CURRENT_TIMESTAMP,updated_by=excluded.updated_by',schoolId,semester,count,year,url.toString(),u.id);run('INSERT INTO audit_log(actor_id,action,detail) VALUES(?,?,?)',u.id,'school:population',JSON.stringify({school_id:schoolId,semester_id:semester,student_count:count,reference_year:year,source_url:url.toString()}));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return {status:200,data:{school_id:schoolId,semester_id:semester,student_count:count}};}
   if(method==='GET' && p==='/api/admin/missions') {role(u,'admin','partner');const rows=u.role==='admin'?all('SELECT * FROM missions WHERE archived_at IS NULL'):all('SELECT * FROM missions WHERE organization_id=? AND archived_at IS NULL',u.organization_id);return {status:200,data:rows.map(m=>({...parseMission(m),accepting:isDiscoverable(m),can_archive:!!canArchive(m)}))};}
   if(method==='GET' && p==='/api/verifications') {
    role(u,'admin','partner'); const sql="SELECT v.id,v.mission_id,v.user_id,v.status,v.source,v.external_record_id,m.title,m.organization_id FROM verifications v JOIN missions m ON m.id=v.mission_id"; const records=u.role==='admin'?all(sql):all(sql+' WHERE m.organization_id=?',u.organization_id); return {status:200,data:records};
   }
   if(method==='GET' && p==='/api/me/application-clicks') {role(u,'student');return {status:200,data:all("SELECT DISTINCT mission_id FROM events WHERE user_id=? AND event_type='click'",u.id).map(r=>r.mission_id)};}
   if(method==='GET' && p==='/api/me/application-candidates') {role(u,'student');return {status:200,data:all("SELECT m.id,m.title FROM missions m JOIN enrollments e ON e.semester_id=m.semester_id WHERE e.user_id=? AND m.created_by IS NOT NULL AND EXISTS(SELECT 1 FROM events x WHERE x.mission_id=m.id AND x.user_id=e.user_id AND x.event_type='click') AND NOT EXISTS(SELECT 1 FROM application_claims a WHERE a.mission_id=m.id AND a.user_id=e.user_id) AND NOT EXISTS(SELECT 1 FROM verifications v WHERE v.mission_id=m.id AND v.user_id=e.user_id AND v.status='approved')",u.id)};}
   if(method==='GET' && p==='/api/me/applications') {role(u,'student');return {status:200,data:all('SELECT mission_id FROM application_claims WHERE user_id=?',u.id).map(r=>r.mission_id)};}
   if(method==='GET' && p==='/api/me/verification-missions') {role(u,'student');return {status:200,data:all("SELECT m.* FROM missions m JOIN enrollments e ON e.semester_id=m.semester_id LEFT JOIN application_claims a ON a.mission_id=m.id AND a.user_id=e.user_id LEFT JOIN verifications v ON v.mission_id=m.id AND v.user_id=e.user_id WHERE e.user_id=? AND m.created_by IS NOT NULL AND (a.user_id IS NOT NULL OR v.status IN ('rejected','cancelled')) AND (v.status IS NULL OR v.status IN ('applied','started','rejected','cancelled'))",u.id).map(parseMission)};}
   if(method==='GET' && p==='/api/me/verifications') {role(u,'student');return {status:200,data:all('SELECT v.mission_id,v.status,v.updated_at,m.title,m.weights,m.application_start,m.application_end,m.application_period,m.eligibility,m.completion_policy,m.source_url,m.contribution_value,m.is_demo FROM verifications v JOIN missions m ON m.id=v.mission_id WHERE v.user_id=? ORDER BY v.updated_at DESC,v.id DESC',u.id).map(r=>({...r,weights:JSON.parse(r.weights),is_demo:!!r.is_demo}))};}
   const match=p.match(/^\/api\/missions\/(\d+)(?:\/(click|verification|submit|schedule|close|archive|publish|application-confirmation))?$/);
   if(match) {
    const id=Number(match[1]), m=['verification','schedule','close','archive','publish'].includes(match[2])?missionFor(id,u):get('SELECT * FROM missions WHERE id=?',id); if(!m) throw err(404,'미션이 없습니다.','NOT_FOUND');
    if(method==='GET' && !match[2] && m.created_by && m.status==='open' && !m.archived_at) {run("INSERT INTO events(mission_id,user_id,event_type) VALUES(?,?,'view')",id,u.id); return {status:200,data:parseMission(m)};}
    if(method==='POST' && match[2]==='click' && isDiscoverable(m)) {role(u,'student');run("INSERT INTO events(mission_id,user_id,event_type) VALUES(?,?,'click')",id,u.id);return {status:200,data:{apply_url:m.apply_url,notice:'클릭은 신청 또는 완료가 아닙니다.'}};}
    if(method==='POST' && match[2]==='application-confirmation') {role(u,'student');if(!m.created_by || !get("SELECT 1 FROM events WHERE mission_id=? AND user_id=? AND event_type='click'",id,u.id) || !get('SELECT 1 FROM enrollments WHERE user_id=? AND semester_id=?',u.id,m.semester_id)) throw err(400,'신청 링크를 이용한 학기 등록 활동만 표시할 수 있습니다.');run('INSERT OR IGNORE INTO application_claims(mission_id,user_id) VALUES(?,?)',id,u.id);return {status:200,data:{status:'self_reported',notice:'학생이 신청을 표시한 상태이며 기관 확인은 아닙니다.'}};}
    if(method==='POST' && match[2]==='submit') {role(u,'student'); if(!m.created_by || (!get('SELECT 1 FROM application_claims WHERE mission_id=? AND user_id=?',id,u.id) && !get("SELECT 1 FROM verifications WHERE mission_id=? AND user_id=? AND status IN ('rejected','cancelled')",id,u.id))) throw err(400,'신청 완료를 표시하거나 이전에 확인받은 활동만 요청할 수 있습니다.'); db.exec('BEGIN'); try {transition(m,u.id,'pending',null,null,u);db.exec('COMMIT');} catch(e){db.exec('ROLLBACK');throw e;} return {status:200,data:{status:'pending',notice:'담당자 확인 대기 중입니다. 증빙 업로드는 제공하지 않습니다.'}};}
    if(method==='POST' && match[2]==='schedule') {role(u,'admin','partner');if(!validDate(body.application_start)||!validDate(body.application_end)||body.application_start>body.application_end) throw err(400,'유효한 모집 시작일과 마감일을 확인하세요.');if(m.status!=='open'||m.archived_at) throw err(400,'마감 또는 삭제된 미션은 수정할 수 없습니다.');db.exec('BEGIN');try{run('UPDATE missions SET application_start=?,application_end=?,application_period=? WHERE id=?',body.application_start,body.application_end,`${body.application_start} ~ ${body.application_end}`,id);run('INSERT INTO audit_log(actor_id,action,mission_id,detail) VALUES(?,?,?,?)',u.id,'mission:schedule',id,`${body.application_start}~${body.application_end}`);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return {status:200,data:{id,application_start:body.application_start,application_end:body.application_end}};}
    if(method==='POST' && match[2]==='close') {role(u,'admin','partner');if(m.status!=='open'||m.archived_at) throw err(400,'이미 마감 또는 삭제된 미션입니다.');db.exec('BEGIN');try{run("UPDATE missions SET status='closed' WHERE id=?",id);run('INSERT INTO audit_log(actor_id,action,mission_id) VALUES(?,?,?)',u.id,'mission:close',id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return {status:200,data:{id,status:'closed'}};}
    if(method==='POST' && match[2]==='archive') {role(u,'admin','partner');if(!canArchive(m)) throw err(400,'마감된 미션만 삭제할 수 있습니다.');db.exec('BEGIN');try{run("UPDATE missions SET archived_at=CURRENT_TIMESTAMP,status='closed' WHERE id=?",id);run('INSERT INTO audit_log(actor_id,action,mission_id) VALUES(?,?,?)',u.id,'mission:archive',id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return {status:200,data:{id,archived:true}};}
    if(method==='POST' && match[2]==='publish') {role(u,'admin');if(m.created_by || m.archived_at) throw err(400,'이미 확인되었거나 삭제된 미션입니다.');db.exec('BEGIN');try{run('UPDATE missions SET created_by=? WHERE id=?',u.id,id);run('INSERT INTO audit_log(actor_id,action,mission_id) VALUES(?,?,?)',u.id,'mission:legacy-confirm',id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return {status:200,data:{id,confirmed:true}};}
    if(method==='POST' && match[2]==='verification') {role(u,'admin','partner'); db.exec('BEGIN'); try {transition(m,Number(body.user_id),body.status,body.source,body.external_record_id,u); db.exec('COMMIT');} catch(e){db.exec('ROLLBACK');throw e;} return {status:200,data:{status:body.status,verification:'관리자 확인'}};}
   }
   if(method==='POST' && p==='/api/admin/import-csv') {
    role(u,'admin','partner'); if(typeof body.csv!=='string'||body.csv.length>100000) throw err(400,'CSV 형식 오류');
    const lines=body.csv.trim().split(/\r?\n/); const header=lines.shift(); if(!['mission_id,user_id','mission_id,user_id,source,external_record_id'].includes(header) || !lines.length || lines.length>500) throw err(400,'CSV 헤더 또는 행 수 오류');
    db.exec('BEGIN'); try {for(const line of lines) {const cols=line.split(','); if((header==='mission_id,user_id' && cols.length!==2) || (header==='mission_id,user_id,source,external_record_id' && cols.length!==4) || !cols[0]?.trim() || !cols[1]?.trim()) throw err(400,'CSV 행의 필수 항목을 확인하세요.'); const [mid,uid,source,record]=cols; transition(missionFor(Number(mid),u),Number(uid),'approved',source,record,u);} db.exec('COMMIT');} catch(e){db.exec('ROLLBACK');throw e;} return {status:200,data:{imported:lines.length,verification:'관리자 확인'}};
   }
   if(method==='GET' && p==='/api/community-progress') {
    const semester=Number(q.get('semester_id')||1);if(!Number.isSafeInteger(semester)||semester<1||!get('SELECT 1 FROM semesters WHERE id=?',semester)) throw err(400,'유효한 학기가 필요합니다.');
    // Do not expose blood-related activity in the public community aggregate.
    const records=all("SELECT m.weights,m.contribution_value FROM verifications v JOIN missions m ON m.id=v.mission_id JOIN enrollments e ON e.user_id=v.user_id AND e.semester_id=m.semester_id WHERE v.status='approved' AND m.semester_id=?",semester).filter(r=>!Object.hasOwn(JSON.parse(r.weights),'blood'));
    const axes=Object.fromEntries(categories.filter(k=>k!=='blood').map(k=>[k,0]));
    for(const row of records) for(const [category,weight] of Object.entries(JSON.parse(row.weights))) axes[category]+=weight;
    for(const key of Object.keys(axes)) axes[key]=Math.round(axes[key]*10000)/10000;
    const configured=Number(process.env.COMMUNITY_GOAL_TARGET||100),target=Number.isInteger(configured)&&configured>0&&configured<=1000000?configured:100;
    return {status:200,data:{semester_id:semester,completed_count:records.length,target_count:target,total_contribution:Math.round(Object.values(axes).reduce((a,b)=>a+b,0)*10000)/10000,active_categories:Object.values(axes).filter(value=>value>0).length,axes,excludes_blood:true}};
   }
   if(method==='GET' && p==='/api/league') {
    const semester=Number(q.get('semester_id')||1);if(!Number.isSafeInteger(semester)||semester<1||!get('SELECT 1 FROM semesters WHERE id=?',semester))throw err(400,'유효한 학기가 필요합니다.');
    const schools=all('SELECT * FROM schools').map(s=>{
     const records=all("SELECT v.status,m.weights,m.is_demo FROM verifications v JOIN missions m ON m.id=v.mission_id JOIN enrollments e ON e.user_id=v.user_id AND e.semester_id=m.semester_id WHERE m.semester_id=? AND e.school_id=?",semester,s.id).map(r=>({...r,weights:JSON.parse(r.weights)}));
     const raw=participationTotals(records),population=get('SELECT student_count,reference_year,source_url FROM school_semester_population WHERE school_id=? AND semester_id=?',s.id,semester);
     const scale=population?1000/population.student_count:null;
     const axes=Object.fromEntries(Object.entries(raw.axes).map(([key,value])=>[key,scale===null?0:Math.round(value*scale*10000)/10000]));
     return {school_id:s.id,school:s.name,overall:scale===null?null:Math.round(raw.completed*scale*10000)/10000,completed_count:raw.completed,student_count:population?.student_count??null,reference_year:population?.reference_year??null,source_url:population?.source_url??null,axes};
    });schools.sort((a,b)=>a.overall===null?(b.overall===null?a.school_id-b.school_id:1):b.overall===null?-1:b.overall-a.overall||a.school_id-b.school_id);return {status:200,data:{semester_id:semester,rules:'승인 완료 건수 ÷ 해당 학기 학교 전체 재학생 수 × 1,000',schools}};
   }
   if(method==='GET' && p==='/api/partner/funnel') {
    role(u,'admin','partner'); const org=Number(q.get('organization_id')||u.organization_id||0); if(u.role==='partner'&&u.organization_id!==org) throw err(403,'기관 권한이 없습니다.','FORBIDDEN');
    const counts={}; for(const type of ['view','click']) {const n=get("SELECT COUNT(DISTINCT e.user_id) n FROM events e JOIN missions m ON m.id=e.mission_id WHERE m.organization_id=? AND e.event_type=? AND m.weights NOT LIKE '%blood%'",org,type).n; counts[type]=n>=5?n:null;}
    for(const status of ['applied','started','pending','approved']) {const n=get("SELECT COUNT(DISTINCT v.user_id) n FROM verifications v JOIN missions m ON m.id=v.mission_id WHERE m.organization_id=? AND v.status=? AND m.weights NOT LIKE '%blood%'",org,status).n; counts[status]=n>=5?n:null;} return {status:200,data:{counts,note:'5명 미만 비공개. 현재 상태 기준이며 클릭은 신청이 아닙니다. 헌혈 제외.'}};
   }
   throw err(404,'요청한 API가 없습니다.','NOT_FOUND');
  } catch(e) {return {status:e.status||400,error:{code:e.code||'BAD_REQUEST',message:e.status?e.message:'입력 오류 또는 중복 실적입니다.'}};}
 }
 return {dispatch,seed,startAutomation,runAutomation,runPopulationAutomation,close:()=>{if(timer)clearTimeout(timer);db.close();}};
}
