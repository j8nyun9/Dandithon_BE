// Test the import against synthetic data and roll back all destination changes.
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createApp} from '../src/app.js';
if(!process.env.DATABASE_URL) throw Error('DATABASE_URL이 필요합니다.');
const directory=mkdtempSync(join(tmpdir(),'dandi-migration-'));
const path=join(directory,'fixture.sqlite');
let app;
try {
 app=createApp(path); app.seed();
 const login=await app.dispatch('POST','/api/auth/login',{email:'admin@demo.local',password:'DemoAdmin!123'});
 const result=await app.dispatch('POST','/api/missions',{organization_id:1,semester_id:1,title:'이관 테스트',notice:'테스트 공고',source_url:'https://example.org/source',apply_url:'https://example.org/apply',eligibility:'대학생',completion_policy:'관리자 확인',rules_version:'demo-v1',application_start:'2026-01-01',application_end:'2027-01-01',weights:{education:1}},'Bearer '+login.data.token);
 if(result.status!==201) throw Error('테스트 활동을 만들지 못했습니다.');
 app.close(); app=null;
 const child=spawnSync(process.execPath,['scripts/migrate-sqlite-to-postgres.js','--verify-only'],{env:{...process.env,DB_PATH:path},encoding:'utf8'});
 if(child.status!==0) throw Error('합성 데이터 이관 검사에 실패했습니다.');
 console.log('테스트 데이터 이관과 롤백을 확인했습니다. 실제 사용자 데이터는 전송하지 않았습니다.');
} finally {if(app) app.close();rmSync(directory,{recursive:true,force:true});}
