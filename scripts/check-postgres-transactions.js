// Exercises commit and rollback on a temporary table; no application data is changed.
import {createPostgresDatabase} from '../src/modules/postgres/database.js';
import {randomBytes} from 'node:crypto';
const db=createPostgresDatabase(process.env.DATABASE_URL);
try {
 await db.transaction(async query=>{
  await query('CREATE TEMP TABLE dandi_transaction_check (value integer) ON COMMIT DROP');
  await query('INSERT INTO dandi_transaction_check VALUES ($1)',[17]);
  const result=await query('SELECT value FROM dandi_transaction_check');
  if(result.rows[0]?.value!==17) throw Error('트랜잭션 조회값이 다릅니다.');
 });
 let rolledBack=false;
 const table='dandi_rollback_check_'+randomBytes(8).toString('hex');
 try {
  await db.transaction(async query=>{
   await query(`CREATE TABLE public."${table}" (value integer)`);
   await query(`INSERT INTO public."${table}" VALUES (1)`);
   throw Error('ROLLBACK_TEST');
  });
 } catch(error) { if(error.message==='ROLLBACK_TEST') rolledBack=true; else throw error; }
 if(!rolledBack) throw Error('트랜잭션 롤백을 확인하지 못했습니다.');
 const check=await db.query('SELECT to_regclass($1) AS name',['public.'+table]);
 if(check.rows[0].name!==null) throw Error('롤백 후 검증 테이블이 남았습니다.');
 console.log('Neon 트랜잭션 정상 동작 확인. 임시 데이터는 삭제됐습니다.');
} catch(error) {
 console.error('데이터베이스 트랜잭션 검사에 실패했습니다.');
 if(error.message && !/postgres(?:ql)?:\/\//i.test(error.message)) console.error(error.message.replaceAll(process.env.DATABASE_URL || '\u0000','[redacted]'));
 process.exitCode=1;
} finally { await db.close(); }
