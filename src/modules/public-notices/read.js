import {networkFailureReason} from './network-errors.js';
import {request as httpsRequest} from 'node:https';
import {canonicalNoticeUrl,extractNotice} from './extract.js';
export {canonicalNoticeUrl,extractNotice} from './extract.js';
async function fetchVmsRelay(source,fetcher){
 const relay=process.env.VMS_RELAY_URL, token=process.env.VMS_RELAY_TOKEN;
 if(!relay||!token)throw new Error('VMS 중계 서버 설정이 불완전합니다.');
 let endpoint;try{endpoint=new URL(relay);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.port||endpoint.search||endpoint.hash)throw Error();}catch{throw new Error('VMS 중계 서버 주소를 확인해 주세요.');}
 endpoint.pathname='/notice';endpoint.searchParams.set('seq',source.id);
 let response;try{response=await fetcher(endpoint.toString(),{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new Error('VMS 중계 서버에 연결하지 못했습니다.');}
 if(!response.ok)throw new Error(`VMS 중계 서버가 공고를 확인하지 못했습니다 (HTTP ${response.status}).`);
 let data;try{const text=await response.text();if(text.length>20000)throw Error();data=JSON.parse(text);}catch{throw new Error('VMS 중계 서버의 응답 형식이 올바르지 않습니다.');}
 if(data.source!=='VMS'||data.external_id!==source.id||typeof data.title!=='string'||!data.title.trim()||!data.fields||typeof data.fields!=='object'||Array.isArray(data.fields))throw new Error('VMS 중계 서버의 공고 정보를 확인하지 못했습니다.');
 const fields={};const allowed=['application_period','organization','category','region','place','activity_period','beneficiaries','eligibility','status'];
 const clean=s=>s.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[연락처 제외]').replace(/(?:\+82[- ]?)?0\d{1,2}[-. )]?\d{3,4}[-. ]?\d{4}/g,'[연락처 제외]').slice(0,500);
 for(const key of allowed)if(typeof data.fields[key]==='string')fields[key]=clean(data.fields[key]);
 if(!Object.keys(fields).length)throw new Error('VMS 중계 서버의 공고 정보를 확인하지 못했습니다.');
 const title=clean(data.title).slice(0,200);
 return {source:'VMS',source_url:source.url,external_id:source.id,title,fields,notice:[`활동명: ${title}`,...Object.entries(fields).map(([k,v])=>`${k}: ${v}`)].join('\n')};
}
export async function fetchNotice(input,{fetcher=fetch}={}){
 const source=canonicalNoticeUrl(input);let response;
 if(source.kind==='VMS'&&(process.env.VMS_RELAY_URL||process.env.VMS_RELAY_TOKEN))return fetchVmsRelay(source,fetcher);
 try{response=await fetcher(source.url,{method:'GET',redirect:'error',headers:{'Accept':'text/html,application/xhtml+xml','User-Agent':'DandiLocalDemo/1.0'},signal:AbortSignal.timeout(10000)});}catch(error){throw new Error(`공식 사이트에 연결하지 못했습니다 (${networkFailureReason(error)}). 주소와 네트워크 또는 사이트 접근 제한을 확인해 주세요.`);}
 if(!response.ok)throw new Error(`공식 사이트가 요청을 처리하지 않았습니다 (HTTP ${response.status}).`);
 if(!/^(text\/html|application\/xhtml\+xml)/i.test(response.headers.get('content-type')||''))throw new Error('공고 페이지 형식이 아닙니다.');
 const reader=response.body?.getReader();if(!reader)throw new Error('공고 응답이 비어 있습니다.');const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1_000_000){await reader.cancel();throw new Error('공고 페이지 크기가 제한을 초과했습니다.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=Buffer.concat(chunks.map(chunk=>Buffer.from(chunk)));const charset=(response.headers.get('content-type')||'').match(/charset\s*=\s*([^;\s]+)/i)?.[1]?.replace(/["']/g,'').toLowerCase()||'utf-8';let html;try{html=new TextDecoder(charset).decode(bytes);}catch{throw new Error('공고 페이지 문자 형식을 읽지 못했습니다.');}
 return extractNotice(html,source);
}

// Admin-only caller; this checks a canonical official URL without importing data.
export async function diagnoseNoticeConnection(input,{fetcher,timeoutMs=30000,clock=Date.now}={}){
 const source=canonicalNoticeUrl(input);const start=clock();
 try{
  const options={method:'GET',headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'DandiLocalDemo/1.0'},signal:AbortSignal.timeout(timeoutMs)};
  const status=fetcher?await (async()=>{const response=await fetcher(source.url,{...options,redirect:'error'});if(response.body)await response.body.cancel().catch(()=>{});return response.status;})():await new Promise((resolve,reject)=>{
   const request=httpsRequest(source.url,options,response=>{const code=response.statusCode;response.destroy();resolve(code);});
   request.on('error',reject);request.end();
  });
  return {source:source.kind,reachable:true,http_status:status,elapsed_ms:clock()-start};
 }catch(error){return {source:source.kind,reachable:false,reason:networkFailureReason(error),elapsed_ms:clock()-start};}
}
