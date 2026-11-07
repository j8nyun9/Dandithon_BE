import {Worker} from 'node:worker_threads';

export class PostgresSyncDatabase {
 constructor(connectionString,{schema,testMode=false}={}){
  if(schema && !/^[a-z][a-z0-9_]*$/.test(schema)) throw Error('유효하지 않은 데이터베이스 스키마입니다.');
  this.workerData={connectionString,schema,testMode};this.closed=false;this.startWorker();
 }
 startWorker(){this.worker=new Worker(new URL('./sync-worker.js',import.meta.url),{workerData:this.workerData});this.worker.unref();}
 request(kind,sql='',params=[]){
  if(this.closed) throw Error('데이터베이스 연결이 닫혔습니다.');
  const shared=new SharedArrayBuffer(4*1024*1024+8), state=new Int32Array(shared,0,2);
  this.worker.postMessage({kind,sql,params,shared});
  if(Atomics.wait(state,0,0,25000)==='timed-out'){
   void this.worker.terminate();this.startWorker();
   throw Error('데이터베이스 응답 시간이 초과되었습니다. 다시 시도해 주세요.');
  }
  const response=JSON.parse(new TextDecoder().decode(new Uint8Array(shared,8,Atomics.load(state,1))));
  if(!response.ok) throw Error(response.error);
  return response.value;
 }
 exec(sql){return this.request('exec',sql);}
 prepare(sql){return {get:(...params)=>this.request('get',sql,params),all:(...params)=>this.request('all',sql,params),run:(...params)=>this.request('run',sql,params)};}
 close(){if(!this.closed){try{this.request('close');}finally{this.closed=true;void this.worker.terminate();}}}
}
