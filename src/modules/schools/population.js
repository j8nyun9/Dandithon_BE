// Only official pages, independently fetched, can substantiate an AI-discovered value.
const hosts=['academyinfo.go.kr','knu.ac.kr','yu.ac.kr','kmu.ac.kr','kumoh.ac.kr','daegu.ac.kr'];
const normalize=s=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
export function validatePopulation(candidate,school,citations,html,currentYear){
 if(!candidate||candidate.school!==school||!Number.isSafeInteger(candidate.count)||candidate.count<1||candidate.count>1000000||!Number.isInteger(candidate.year)||candidate.year<currentYear-3||candidate.year>currentYear||candidate.scope!=='학부 및 대학원 재학생 합계')return null;
 let url;try{url=new URL(candidate.url);}catch{return null;}if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.some(h=>url.hostname===h||url.hostname.endsWith('.'+h))||!citations.includes(url.href))return null;
 const evidence=typeof candidate.evidence==='string'?normalize(candidate.evidence):'';const page=normalize(html);if(evidence.length<15||evidence.length>500||!page.includes(evidence)||!evidence.includes(school)||!evidence.includes(String(candidate.year))||!/(학부)/.test(evidence)||!/대학원/.test(evidence)||!/재학생/.test(evidence)||!/(합계|총계|총원)/.test(evidence))return null;
 const digits=String(candidate.count);if(![...evidence.matchAll(/[0-9][0-9,]*/g)].some(x=>x[0].replace(/,/g,'')===digits))return null;
 return {school,count:candidate.count,year:candidate.year,url:url.href,evidence};
}
export async function fetchOfficialPage(url,{fetcher=fetch}={}){
 let u;try{u=new URL(url);}catch{throw Error('공식 출처 주소 오류');}if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))throw Error('공식 출처가 아닙니다.');
 const response=await fetcher(u.href,{redirect:'error',headers:{Accept:'text/html'},signal:AbortSignal.timeout(10000)});if(!response.ok||!/^(text\/html|application\/xhtml\+xml)/i.test(response.headers.get('content-type')||''))throw Error('공식 자료를 읽지 못했습니다.');
 const reader=response.body?.getReader();if(!reader)throw Error('공식 자료가 비어 있습니다.');let size=0,chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000){await reader.cancel();throw Error('공식 자료 크기 초과');}chunks.push(value);}}finally{reader.releaseLock();}
 const charset=(response.headers.get('content-type')||'').match(/charset\s*=\s*([^;\s]+)/i)?.[1]?.replace(/["']/g,'')||'utf-8';return new TextDecoder(charset).decode(Buffer.concat(chunks.map(x=>Buffer.from(x))));
}
