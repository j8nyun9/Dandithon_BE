// One-time copy. Run only after the PostgreSQL-backed API has been verified.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const tables = ['schools','semesters','organizations','users','enrollments','missions','events','verifications','audit_log','application_claims','school_semester_population','automatic_mission_sources','automation_status','automation_candidates','school_population_automation','school_population_latest','app_migrations','mission_category_history'];
const generatedIds = ['schools','semesters','organizations','users','missions','events','verifications','audit_log'];
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const sourcePath = process.env.DB_PATH || 'dandi.sqlite';
const dryRun = process.argv.includes('--dry-run');
const verifyOnly = process.argv.includes('--verify-only');
if (!existsSync(sourcePath)) throw new Error('SQLite 원본 파일이 없습니다. DB_PATH를 확인해 주세요.');
if (!dryRun && !process.env.DATABASE_URL) throw new Error('DATABASE_URL 환경변수가 필요합니다.');

const source = new DatabaseSync(sourcePath, {readOnly:true});
let client;
try {
 source.exec('BEGIN');
 const actual = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name);
 const missing=tables.filter(t=>!actual.includes(t)), unknown=actual.filter(t=>!tables.includes(t));
 if(missing.length || unknown.length) throw new Error(`SQLite 스키마가 예상과 다릅니다. 누락: ${missing.join(', ') || '없음'}; 추가: ${unknown.join(', ') || '없음'}`);
 const counts=Object.fromEntries(tables.map(t=>[t,source.prepare(`SELECT COUNT(*) AS n FROM ${quote(t)}`).get().n]));
 if(dryRun) {
  console.log('원본 스키마 확인 완료. 레코드 수:', JSON.stringify(counts));
 } else {
  client = new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true}});
  await client.connect();
  await client.query('BEGIN');
  const targetSchema=verifyOnly?'dandi_verify_'+randomBytes(8).toString('hex'):'public';
  if(verifyOnly) await client.query(`CREATE SCHEMA ${quote(targetSchema)}`);
  await client.query(`SET LOCAL search_path TO ${quote(targetSchema)}`);
  const present=await client.query('SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname=$1 AND tablename=ANY($2::text[])',[targetSchema,tables]);
  if(present.rowCount) throw new Error('대상 데이터베이스에 단디 테이블이 이미 있습니다. 덮어쓰지 않습니다.');
  await client.query(readFileSync(fileURLToPath(new URL('../db/postgres-schema.sql',import.meta.url)),'utf8'));
  for(const table of tables) {
   const columns=source.prepare(`PRAGMA table_info(${quote(table)})`).all().map(c=>c.name);
   const destination=await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',[targetSchema,table]);
   const expected=new Set(destination.rows.map(r=>r.column_name));
   if(columns.length!==expected.size || columns.some(c=>!expected.has(c))) throw new Error(`${table} 테이블의 열이 일치하지 않습니다.`);
   const sql=`INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map((_,i)=>'$'+(i+1)).join(',')})`;
   for(const row of source.prepare(`SELECT * FROM ${quote(table)}`).iterate()) await client.query(sql,columns.map(c=>row[c]));
   const count=await client.query(`SELECT COUNT(*)::integer AS n FROM ${quote(table)}`);
   if(count.rows[0].n!==counts[table]) throw new Error(`${table} 레코드 수가 일치하지 않습니다.`);
  }
  for(const table of generatedIds) await client.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE(MAX(id), 1), COUNT(*) > 0) FROM ${quote(table)}`,[table]);
  await client.query(verifyOnly?'ROLLBACK':'COMMIT');
  console.log(verifyOnly?'검증용 복사와 레코드 수 확인 완료. 복사한 데이터는 저장하지 않았습니다:':'데이터 복사 및 레코드 수 확인 완료:', JSON.stringify(counts));
 }
 source.exec('COMMIT');
} catch(error) {
 if(client) await client.query('ROLLBACK').catch(()=>{});
 source.exec('ROLLBACK');
 // Connection errors can contain credentials; do not print the original error.
 console.error('이관을 완료하지 못해 변경 사항을 되돌렸습니다. 원본은 변경하지 않았습니다.');
 if(error.message && !/postgres(?:ql)?:\/\//i.test(error.message)) console.error(error.message.replaceAll(process.env.DATABASE_URL || '\u0000','[redacted]'));
 process.exitCode=1;
} finally {
 source.close();
 if(client) await client.end().catch(()=>{});
}
