import {createServer} from 'node:http';
import {createApp} from './app.js';
const app=createApp();
if(process.argv.includes('--seed')) {app.seed();app.close();console.log('시연 데이터가 준비되었습니다.');}
else {
 const port=Number(process.env.PORT||3001);
 createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8'); res.setHeader('Cache-Control','no-store');
  let chunks=[],size=0;
  try {
   for await(const chunk of req) {size+=chunk.length;if(size>100000) throw new Error('too large');chunks.push(chunk);}
   const raw=Buffer.concat(chunks).toString(), body=raw?JSON.parse(raw):{};
   const result=await app.dispatch(req.method,req.url,body,req.headers.authorization); res.statusCode=result.status;res.end(JSON.stringify(result.error?{error:result.error}:{data:result.data}));
  } catch {res.statusCode=400;res.end(JSON.stringify({error:{code:'BAD_REQUEST',message:'요청 형식 또는 크기 오류'}}));}
 }).listen(port,'127.0.0.1',()=>{console.log(`단디 API: http://127.0.0.1:${port}`);app.startAutomation();});
}
