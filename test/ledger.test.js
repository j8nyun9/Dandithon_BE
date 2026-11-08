import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../src/app.js';
test('공개 시즌 의연록은 승인자만 학교별 한 번 표시하고 개인 식별 필드를 제외한다', async()=>{
 const db=new DatabaseSync(':memory:');const app=createApp(':memory:',{db});app.seed();
 try {
  db.prepare('UPDATE users SET name=? WHERE id=1').run('김명석');
  db.prepare('UPDATE users SET name=? WHERE id=2').run('대기학생');
  assert.equal((await app.dispatch('GET','/api/ledger?semester_id=1')).data.participants.length,0);
  const token=(await app.dispatch('POST','/api/auth/login',{email:'admin@demo.local',password:'DemoAdmin!123'})).data.token;
  for(let i=0;i<3;i++){
   const r=await app.dispatch('POST','/api/missions',{organization_id:1,semester_id:1,title:'시연 활동 '+i,notice:'시연',source_url:'https://example.org/notice',apply_url:'https://example.org/apply',eligibility:'대학생',application_start:'2026-01-01',application_end:'2099-12-31',completion_policy:'확인',rules_version:'demo-v1',weights:{welfare:1},is_demo:true},'Bearer '+token);
   assert.equal(r.status,201);
   const result=await app.dispatch('POST',`/api/missions/${r.data.id}/verification`,{user_id:i===2?2:1,status:i===2?'pending':'approved'},'Bearer '+token);
   assert.equal(result.status,200);
  }
  const r=await app.dispatch('GET','/api/ledger?semester_id=1');assert.equal(r.status,200);assert.equal(r.data.participants.length,1);assert.equal(r.data.participants[0].name,'김명석');assert.equal(r.data.participants[0].school_name,'경북대학교');assert.equal(r.data.participants[0].approved_count,2);
  assert.deepEqual(Object.keys(r.data.participants[0]).sort(),['approved_count','name','school_id','school_name']);
  assert.equal((await app.dispatch('GET','/api/ledger?semester_id=999')).status,404);
  assert.equal((await app.dispatch('GET','/api/ledger?semester_id=bad')).status,400);
 } finally {app.close();}
});
