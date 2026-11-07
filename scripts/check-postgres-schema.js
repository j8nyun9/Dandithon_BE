// Verify DDL and source-column compatibility without leaving tables on Neon.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const path=process.env.DB_PATH || 'dandi.sqlite';
if(!existsSync(path) || !process.env.DATABASE_URL) throw Error('기존 SQLite 파일과 DATABASE_URL 환경변수가 필요합니다.');
const source=new DatabaseSync(path,{readOnly:true});
const client=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true}});
const schema='dandi_check_'+randomBytes(8).toString('hex');
try {
 await client.connect();
 await client.query('BEGIN');
 await client.query(`CREATE SCHEMA "${schema}"`);
 await client.query(`SET LOCAL search_path TO "${schema}"`);
 await client.query(readFileSync(fileURLToPath(new URL('../db/postgres-schema.sql',import.meta.url)),'utf8'));
 const tables=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name);
 for(const table of tables) {
  const escaped=table.replaceAll('"','""');
  const expected=source.prepare(`PRAGMA table_info("${escaped}")`).all().map(x=>x.name).sort();
  const result=await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',[schema,table]);
  const got=result.rows.map(x=>x.column_name).sort();
  if(JSON.stringify(expected)!==JSON.stringify(got)) throw Error(`${table}: 원본과 대상의 열이 일치하지 않습니다.`);
 }
 await client.query('ROLLBACK');
 console.log(`${tables.length}개 테이블의 스키마가 일치합니다. 검증용 스키마는 저장하지 않았습니다.`);
} catch(error) {
 await client.query('ROLLBACK').catch(()=>{});
 console.error('데이터베이스 구조 확인에 실패했습니다. 데이터는 변경하지 않았습니다.');
 if(error.message && !/postgres(?:ql)?:\/\//i.test(error.message)) console.error(error.message.replaceAll(process.env.DATABASE_URL,'[redacted]'));
 process.exitCode=1;
} finally { source.close(); await client.end().catch(()=>{}); }
