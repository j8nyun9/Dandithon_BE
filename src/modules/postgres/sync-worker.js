import { parentPort, workerData } from 'node:worker_threads';
import pg from 'pg';

// SQLite API compatibility for the single-process demo. Network I/O runs here,
// but callers wait synchronously; this is not a scalable production adapter.
pg.types.setTypeParser(20, value => {
 const n=Number(value);
 if(!Number.isSafeInteger(n)) throw Error('정수 범위를 초과했습니다.');
 return n;
});
let client=null;
let connected=false;
let inTransaction=false;
const connectionError=e=>/^(08|57P0)/.test(String(e?.code||''))||['ECONNRESET','EPIPE','ETIMEDOUT','ECONNREFUSED'].includes(e?.code)||/connection terminated|connection (?:is )?closed|connection error|not queryable|socket hang up/i.test(String(e?.message||''));
async function connect(){
 if(connected) return;
 if(client) await client.end().catch(()=>{});
 const next=new pg.Client({connectionString:workerData.connectionString,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,statement_timeout:10000});
 client=next;
 next.on('error',()=>{if(client===next)connected=false;});
 next.on('end',()=>{if(client===next)connected=false;});
 await next.connect();connected=true;
}

function translate(sql,kind) {
 let index=0;
 let query=sql.replace(/\?/g,() => '$'+(++index));
 const ignored=/^\s*INSERT OR IGNORE INTO\s/i.test(query);
 if(ignored) query=query.replace(/INSERT OR IGNORE INTO/i,'INSERT INTO')+' ON CONFLICT DO NOTHING';
 query=query.replace(/\bCURRENT_TIMESTAMP\b/gi,'CURRENT_TIMESTAMP::text');
 if(kind==='run' && /^\s*INSERT INTO\s+(organizations|missions|users)\b/i.test(query)) query+=' RETURNING id';
 return query;
}
async function execute(message){
  if(message.kind==='close'){if(client)await client.end().catch(()=>{});connected=false;return {ok:true,value:null};}
  if(!connected&&inTransaction){inTransaction=false;throw Error('데이터베이스 연결이 끊겨 진행 중인 처리가 취소되었습니다. 다시 시도해 주세요.');}
  await connect();
  let result;
  if(message.kind==='test-disconnect'&&workerData.testMode){await client.end();connected=false;return {ok:true,value:null};}
  else if(message.kind==='exec' && (/^\s*PRAGMA\s/i.test(message.sql)||/^\s*CREATE TABLE\s/i.test(message.sql))) result={ok:true,value:null};
  else if(message.kind==='exec' && /^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(message.sql)) {
   const command=message.sql.trim().toUpperCase();
   await client.query(command);
   inTransaction=command==='BEGIN';
   if(inTransaction) await client.query(`SET LOCAL search_path TO "${workerData.schema||'public'}"`);
   result={ok:true,value:null};
  } else {
   const standalone=!inTransaction;
   try {
    if(standalone){await client.query('BEGIN');await client.query(`SET LOCAL search_path TO "${workerData.schema||'public'}"`);}
    const tableInfo=message.sql.match(/^\s*PRAGMA table_info\((missions|users)\)/i);
    const response=tableInfo
     ?await client.query('SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1',[tableInfo[1].toLowerCase()])
     :await client.query(translate(message.sql,message.kind),message.params||[]);
    if(standalone) await client.query('COMMIT');
    const value=message.kind==='get'?(response.rows[0]??null):message.kind==='all'?response.rows:message.kind==='run'?{changes:response.rowCount,lastInsertRowid:response.rows[0]?.id??0}:null;
    result={ok:true,value};
   } catch(error){if(standalone) await client.query('ROLLBACK').catch(()=>{});throw error;}
  }
 return result;
}
parentPort.on('message',async message=>{
 const state=new Int32Array(message.shared,0,2), out=new Uint8Array(message.shared,8);
 let result;
 const wasInTransaction=inTransaction;
 try {result=await execute(message);}
 catch(error) {
  if(connectionError(error)){
   connected=false;inTransaction=false;
   // Retry read-only statements once. Never replay writes or a lost transaction.
   const canRetry=!wasInTransaction&&((['get','all'].includes(message.kind)&&/^\s*(SELECT\b|PRAGMA table_info\()/i.test(message.sql))||(message.kind==='exec'&&/^\s*BEGIN\s*$/i.test(message.sql)));
   if(canRetry)try{result=await execute(message);}catch(retryError){error=retryError;if(connectionError(error)){connected=false;inTransaction=false;}}
  }
  if(!result)result={ok:false,error:String(error.message||'database error').slice(0,500)};
 }
 let encoded=new TextEncoder().encode(JSON.stringify(result));
 if(encoded.length>out.length) encoded=new TextEncoder().encode(JSON.stringify({ok:false,error:'데이터베이스 응답 크기가 허용 범위를 초과했습니다.'}));
 out.set(encoded);Atomics.store(state,1,encoded.length);Atomics.store(state,0,1);Atomics.notify(state,0);
});
