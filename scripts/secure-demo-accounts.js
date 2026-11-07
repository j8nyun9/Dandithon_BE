// Run after data migration, before publishing. Never print credentials.
import {randomBytes,scryptSync} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import pg from 'pg';
if(!process.env.DATABASE_URL) throw Error('DATABASE_URL이 필요합니다.');
const filename='.deployment-credentials';
const random=()=>randomBytes(24).toString('base64url');
const adminPassword=random(),partnerPassword=random(),secret=random();
const hash=password=>{const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;};
// Fail instead of overwriting previously issued credentials.
writeFileSync(filename,`DANDI_SECRET=${secret}\nADMIN_EMAIL=admin@demo.local\nADMIN_PASSWORD=${adminPassword}\nPARTNER_EMAIL=partner@demo.local\nPARTNER_PASSWORD=${partnerPassword}\n`,{flag:'wx',mode:0o600});
const client=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000});
try {
 await client.connect();await client.query('BEGIN');await client.query('SET LOCAL search_path TO public');
 for(const [email,role,password] of [['admin@demo.local','admin',adminPassword],['partner@demo.local','partner',partnerPassword]]) {
  const result=await client.query('UPDATE users SET password_hash=$1 WHERE email=$2 AND role=$3',[hash(password),email,role]);
  if(result.rowCount!==1) throw Error(`${role} 시연 계정이 없습니다.`);
 }
 await client.query('COMMIT');
 console.log('관리자와 기관 계정의 비밀번호를 변경했습니다. 비공개 자격 정보 파일을 확인하세요.');
} catch {
 await client.query('ROLLBACK').catch(()=>{});
 console.error('계정 보호 설정 결과를 확인하지 못했습니다. 연결 오류 시 저장 여부가 불확실할 수 있어 자격 정보 파일은 보존했습니다.');process.exitCode=1;
} finally {await client.end().catch(()=>{});}
