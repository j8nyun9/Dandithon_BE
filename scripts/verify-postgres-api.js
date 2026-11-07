// End-to-end validation with synthetic data in a disposable PostgreSQL schema.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {createApp} from '../src/app.js';
import {PostgresSyncDatabase} from '../src/modules/postgres/sync-database.js';
if(!process.env.DATABASE_URL) throw Error('DATABASE_URL이 필요합니다.');
const schema='dandi_api_test_'+randomBytes(8).toString('hex');
const admin=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000});
const originalMode=process.env.AI_MODE,originalKey=process.env.OPENAI_API_KEY;
process.env.AI_MODE='live';process.env.OPENAI_API_KEY='fixture-only';
let app;
try {
 await admin.connect();
 await admin.query('BEGIN');
 await admin.query(`CREATE SCHEMA "${schema}"`);
 await admin.query(`SET LOCAL search_path TO "${schema}"`);
 await admin.query(readFileSync(fileURLToPath(new URL('../db/postgres-schema.sql',import.meta.url)),'utf8'));
 // Exercise the upgrade from the currently deployed schema.
 await admin.query('ALTER TABLE automation_status DROP COLUMN last_automatic_attempt');
 await admin.query("INSERT INTO automation_status(id,last_attempt,message,created_count) VALUES(1,42,'legacy',0)");
 await admin.query('COMMIT');
 const connect=()=>new PostgresSyncDatabase(process.env.DATABASE_URL,{schema,testMode:true});
 let searches=0;const connection=connect();app=createApp(':memory:',{db:connection,search:async()=>{searches++;return {items:[],citations:[]};}});app.seed();
 assert.equal(connection.prepare('SELECT last_automatic_attempt FROM automation_status WHERE id=1').get().last_automatic_attempt,42);
 connection.request('test-disconnect');
 assert.equal(connection.prepare('SELECT 1 AS value').get().value,1);
 connection.exec('BEGIN');connection.request('test-disconnect');
 assert.throws(()=>connection.prepare('SELECT 1 AS value').get(),/진행 중인 처리가 취소/);
 assert.equal(connection.prepare('SELECT 1 AS value').get().value,1);
 const login=async(email,password)=>{
  const r=await app.dispatch('POST','/api/auth/login',{email,password});assert.equal(r.status,200);return 'Bearer '+r.data.token;
 };
 const adminToken=await login('admin@demo.local','DemoAdmin!123');
 const student=await login('knu@demo.local','DemoStudent!123');
 await app.runAutomation();assert.equal(searches,2);
 const before=(await app.dispatch('GET','/api/admin/automation',{},adminToken)).data;
 assert.ok(before.next_automatic_attempt>Date.now());assert.equal(before.next_attempt,null);
 assert.equal((await app.dispatch('POST','/api/admin/automation/run',{},adminToken)).status,202);
 let after;for(let i=0;i<30;i++){after=(await app.dispatch('GET','/api/admin/automation',{},adminToken)).data;if(!after.running)break;await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(after.running,false);assert.equal(searches,4);assert.equal(after.next_automatic_attempt,before.next_automatic_attempt);
 const profile=await app.dispatch('GET','/api/v1/me',{},student);assert.equal(profile.status,200);assert.equal(Object.hasOwn(profile.data,'password_hash'),false);
 assert.equal((await app.dispatch('GET','/api/v1/schools')).data.length,5);
 const mission={organization_id:1,semester_id:1,title:'이관 검증 활동',notice:'가상 공고',source_url:'https://example.org/source',apply_url:'https://example.org/apply',eligibility:'학생',completion_policy:'관리자 확인',rules_version:'demo-v1',application_start:'2020-01-01',application_end:'2099-12-31',weights:{education:1},is_demo:true};
 const created=await app.dispatch('POST','/api/missions',mission,adminToken);assert.equal(created.status,201);
 const id=created.data.id;assert.ok(id>0);
 assert.equal((await app.dispatch('GET','/api/missions')).data.length,1);
 assert.equal((await app.dispatch('GET','/api/v1/missions',{},student)).data[0].classification_status,'classified');
 assert.equal((await app.dispatch('POST',`/api/missions/${id}/application-confirmation`,{},student)).status,200);
 assert.equal((await app.dispatch('POST',`/api/missions/${id}/submit`,{},student)).status,200);
 assert.equal((await app.dispatch('POST',`/api/missions/${id}/verification`,{user_id:1,status:'approved'},adminToken)).status,200);
 assert.equal((await app.dispatch('GET','/api/v1/me/participations',{},student)).data[0].status,'approved');
 assert.equal((await app.dispatch('POST',`/api/missions/${id}/verification`,{user_id:1,status:'approved'},adminToken)).status,400);
 assert.equal((await app.dispatch('GET','/api/community-progress')).data.completed_count,1);
 assert.equal((await app.dispatch('GET','/api/league')).data.schools.find(s=>s.school_id===1).completed_count,1);
 app.close();app=null;
 app=createApp(':memory:',{db:connect()});
 assert.equal((await app.dispatch('GET','/api/community-progress')).data.completed_count,1);
 console.log('가상 계정의 로그인, 신청, 승인, 중복 방지, 리그와 재연결 후 보존을 확인했습니다.');
} catch(error) {
 console.error('PostgreSQL API 검증에 실패했습니다:',String(error.message||'오류').replaceAll(process.env.DATABASE_URL,'[redacted]'));
 process.exitCode=1;
} finally {
 if(app) app.close();
 await admin.query('ROLLBACK').catch(()=>{});
 await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(()=>{});
 await admin.end().catch(()=>{});
 if(originalMode===undefined)delete process.env.AI_MODE;else process.env.AI_MODE=originalMode;
 if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;
}
