import { createServer } from 'node:http';
import { activities } from './routes/activities.js';
const port = Number(process.env.PORT || 3001);
export const server = createServer((req,res) => {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  const path = new URL(req.url, 'http://localhost').pathname;
  if(req.method === 'GET' && path === '/api/health') return res.end(JSON.stringify({data:{status:'ok'}}));
  if(req.method === 'GET' && path === '/api/activities') return res.end(JSON.stringify({data:activities}));
  res.statusCode=404;res.end(JSON.stringify({error:{code:'NOT_FOUND',message:'요청한 API가 없습니다.'}}));
});
server.listen(port,'127.0.0.1',() => console.log(`단디 API: http://127.0.0.1:${port}`));
