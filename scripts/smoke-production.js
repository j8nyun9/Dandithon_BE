// Read-only HTTP smoke test with the real migrated database.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
if(!process.env.DATABASE_URL || !process.env.DANDI_SECRET || !process.env.ADMIN_PASSWORD) throw Error('비공개 환경 설정이 필요합니다.');
const listener=createServer();
await new Promise((resolve,reject)=>listener.listen(0,'127.0.0.1',resolve).once('error',reject));
const port=listener.address().port;
await new Promise(resolve=>listener.close(resolve));
const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),DANDI_DISABLE_AUTOMATION:'1'},stdio:'ignore'});
const base=`http://127.0.0.1:${port}`;
try {
 let healthy=false;
 for(let attempt=0;attempt<90;attempt++){
  if(child.exitCode!==null) throw Error('서버가 시작되지 않았습니다.');
  try {const res=await fetch(base+'/api/health');if(res.ok){healthy=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 if(!healthy) throw Error('서버 시작 시간이 초과되었습니다.');
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@demo.local',password:process.env.ADMIN_PASSWORD})});
 assert.equal(login.status,200);const token=(await login.json()).data.token;
 const missions=await fetch(base+'/api/admin/missions',{headers:{authorization:'Bearer '+token}});assert.equal(missions.status,200);
 const league=await fetch(base+'/api/league');assert.equal(league.status,200);assert.equal((await league.json()).data.schools.length,5);
 const schools=await fetch(base+'/api/v1/schools');assert.equal(schools.status,200);assert.equal((await schools.json()).data.length,5);
 const me=await fetch(base+'/api/v1/me',{headers:{authorization:'Bearer '+token}});assert.equal(me.status,200);assert.equal(Object.hasOwn((await me.json()).data,'password_hash'),false);
 const studentLogin=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'student01@demo.local',password:'DemoStudent!123'})});assert.equal(studentLogin.status,200);const studentToken=(await studentLogin.json()).data.token;
 for(const path of ['/api/v1/missions','/api/v1/me/participations','/api/v1/me/clicks']){const response=await fetch(base+path,{headers:{authorization:'Bearer '+studentToken}});assert.equal(response.status,200);assert.ok(Array.isArray((await response.json()).data));}
 console.log('실제 HTTP 서버에서 관리자 로그인, 활동 목록, 5개 학교 리그를 확인했습니다.');
} catch(error){console.error('서버 확인 실패:',error.message);process.exitCode=1;}
finally{child.kill();}
