import {createServer} from 'node:http';
import {createApp} from './app.js';
import {PostgresSyncDatabase} from './modules/postgres/sync-database.js';
if(process.env.NODE_ENV==='production' && !process.env.DATABASE_URL) throw new Error('공개 서버에는 영구 DATABASE_URL이 필요합니다.');
if(process.env.NODE_ENV==='production' && (!process.env.DANDI_SECRET || process.env.DANDI_SECRET.length<32)) throw new Error('공개 서버에는 32자 이상의 DANDI_SECRET이 필요합니다.');
const db=process.env.DATABASE_URL?new PostgresSyncDatabase(process.env.DATABASE_URL):undefined;
const app=createApp(undefined,{db});
if(process.env.NODE_ENV==='production') app.assertPublicAccountsSafe();
if(process.argv.includes('--seed')) {app.seed();app.close();console.log('시연 데이터가 준비되었습니다.');}
else {
 const port=Number(process.env.PORT||3001);
 const host=process.env.HOST||'127.0.0.1';
 createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8'); res.setHeader('Cache-Control','no-store');
  let chunks=[],size=0;
  try {
   for await(const chunk of req) {size+=chunk.length;if(size>100000) throw new Error('too large');chunks.push(chunk);}
   const raw=Buffer.concat(chunks).toString(), body=raw?JSON.parse(raw):{};
   const result=await app.dispatch(req.method,req.url,body,req.headers.authorization); res.statusCode=result.status;if(result.status>=500)console.error('[API] 요청 처리 실패',result.error?.code||'SERVER_ERROR');res.end(JSON.stringify(result.error?{error:result.error}:{data:result.data}));
  } catch {res.statusCode=400;res.end(JSON.stringify({error:{code:'BAD_REQUEST',message:'요청 형식 또는 크기 오류'}}));}
 }).listen(port,host,()=>{console.log(`단디 API: http://${host}:${port}`);if(process.env.DANDI_DISABLE_AUTOMATION!=='1')app.startAutomation();});
}
