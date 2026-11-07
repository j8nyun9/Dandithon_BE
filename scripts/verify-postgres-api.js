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
let app;
try {
 await admin.connect();
 await admin.query('BEGIN');
 await admin.query(`CREATE SCHEMA "${schema}"`);
 await admin.query(`SET LOCAL search_path TO "${schema}"`);
 await admin.query(readFileSync(fileURLToPath(new URL('../db/postgres-schema.sql',import.meta.url)),'utf8'));
 await admin.query('COMMIT');
 const connect=()=>new PostgresSyncDatabase(process.env.DATABASE_URL,{schema});
 app=createApp(':memory:',{db:connect()});app.seed();
 const login=async(email,password)=>{
  const r=await app.dispatch('POST','/api/auth/login',{email,password});assert.equal(r.status,200);return 'Bearer '+r.data.token;
 };
 const adminToken=await login('admin@demo.local','DemoAdmin!123');
 const student=await login('knu@demo.local','DemoStudent!123');
 const mission={organization_id:1,semester_id:1,title:'이관 검증 활동',notice:'가상 공고',source_url:'https://example.org/source',apply_url:'https://example.org/apply',eligibility:'학생',completion_policy:'관리자 확인',rules_version:'demo-v1',application_start:'2020-01-01',application_end:'2099-12-31',weights:{education:1},is_demo:true};
 const created=await app.dispatch('POST','/api/missions',mission,adminToken);assert.equal(created.status,201);
 const id=created.data.id;assert.ok(id>0);
 assert.equal((await app.dispatch('GET','/api/missions')).data.length,1);
 assert.equal((await app.dispatch('POST',`/api/missions/${id}/application-confirmation`,{},student)).status,200);
 assert.equal((await app.dispatch('POST',`/api/missions/${id}/submit`,{},student)).status,200);
 assert.equal((await app.dispatch('POST',`/api/missions/${id}/verification`,{user_id:1,status:'approved'},adminToken)).status,200);
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
}
