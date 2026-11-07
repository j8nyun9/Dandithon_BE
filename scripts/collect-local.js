// Run the existing collector from the user's PC, using the shared database.
// Values come from ignored local environment files and are never printed.
import {createApp} from '../src/app.js';
import {PostgresSyncDatabase} from '../src/modules/postgres/sync-database.js';
import {fetchNotice} from '../src/modules/public-notices/read.js';
import {classifyNotice} from '../src/modules/public-notices/search.js';

if(!process.env.DATABASE_URL||!process.env.OPENAI_API_KEY||!process.env.ADMIN_PASSWORD||!process.env.DANDI_SECRET) throw Error('DB 주소, OpenAI 키 또는 관리자 비밀 설정이 없습니다.');
const root=process.env.DANDI_API_URL||'https://dandi-backend.onrender.com';
const parsed=new URL(root);
if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw Error('서버 주소를 확인해 주세요.');
let app;
try {
 const login=await fetch(new URL('/api/auth/login',parsed),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@demo.local',password:process.env.ADMIN_PASSWORD}),signal:AbortSignal.timeout(90000)});
 const data=await login.json();if(!login.ok||data.data?.role!=='admin')throw Error('서버 관리자 로그인에 실패했습니다.');
 const stateResponse=await fetch(new URL('/api/admin/automation',parsed),{headers:{authorization:'Bearer '+data.data.token},signal:AbortSignal.timeout(90000)});
 const state=await stateResponse.json();if(!stateResponse.ok||!state.data?.collector_lock_supported)throw Error('서버에 PC 수집기 지원 버전이 아직 배포되지 않았습니다.');
 if(state.data.running)throw Error('다른 수집이 진행 중입니다. 끝난 뒤 다시 시도해 주세요.');
 if(process.argv.includes('--check')) {
  console.log('서버의 PC 수집기 지원과 준비 상태를 확인했습니다. 공고를 수집하거나 변경하지 않았습니다.');
 } else {
 process.env.AI_MODE='live';
 let checked=0;
 const db=new PostgresSyncDatabase(process.env.DATABASE_URL);
 app=createApp(undefined,{db,fetchNotice:async url=>{checked++;console.log(`공식 공고 확인 중: ${checked}건`);return fetchNotice(url);},classify:async(...args)=>classifyNotice(...args)});
 const localLogin=await app.dispatch('POST','/api/auth/login',{email:'admin@demo.local',password:process.env.ADMIN_PASSWORD});
 if(localLogin.status!==200||localLogin.data.user_id!==data.data.user_id)throw Error('연결된 서버와 데이터베이스 관리자 계정이 일치하지 않습니다.');
 console.log('PC에서 공식 공고 검색을 시작합니다. 완료될 때까지 창을 닫지 마세요.');
 const result=await app.runAutomation({force:true});
 if(!result.started)throw Error('다른 수집이 진행 중입니다. 끝난 뒤 다시 시도해 주세요.');
 if(result.leaseLost)throw Error('연결이 끊겨 수집이 중단되었습니다. 잠시 후 다시 시도해 주세요.');
 const summary=await app.dispatch('GET','/api/admin/automation',{},'Bearer '+localLogin.data.token);
 if(summary.status!==200)throw Error('수집 결과를 확인하지 못했습니다.');
 console.log('수집 완료:',summary.data.message||'결과 없음');
 }
} catch(error) {
 const message=String(error?.message||'알 수 없는 오류');
 const safe=message.replaceAll(process.env.DATABASE_URL,'[비공개]').replaceAll(process.env.OPENAI_API_KEY,'[비공개]').replaceAll(process.env.ADMIN_PASSWORD,'[비공개]').replaceAll(process.env.DANDI_SECRET,'[비공개]');
 console.error('PC 수집을 완료하지 못했습니다:',safe);process.exitCode=1;
} finally {if(app)app.close();}
