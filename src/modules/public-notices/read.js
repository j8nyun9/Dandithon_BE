const sources={
 'www.vms.or.kr':{path:'/partspace/recruitView.do',id:'seq',kind:'VMS'},
 'vms.or.kr':{path:'/partspace/recruitView.do',id:'seq',kind:'VMS'},
 'www.1365.go.kr':{path:'/vols/P9210/partcptn/timeCptn.do',id:'progrmRegistNo',kind:'1365'},
 '1365.go.kr':{path:'/vols/P9210/partcptn/timeCptn.do',id:'progrmRegistNo',kind:'1365'},
};
export function canonicalNoticeUrl(input){
 let url;try{url=new URL(input);}catch{throw new Error('올바른 공고 주소를 입력해 주세요.');}
 const source=sources[url.hostname];const id=url.searchParams.get(source?.id||'');
 if(url.protocol!=='https:'||url.username||url.password||url.port||!source||!(url.pathname===source.path||(source.kind==='1365'&&/^\/vols\/\d{1,20}\/partcptn\/timeCptn\.do$/.test(url.pathname)))||!id||!/^\d{1,15}$/.test(id)) throw new Error('1365 또는 VMS의 개별 모집 공고 주소만 입력할 수 있습니다.');
 const clean=new URL(`https://${source.kind==='1365'?'www.1365.go.kr':url.hostname}${source.path}`);if(source.kind==='1365')clean.searchParams.set('type','show');clean.searchParams.set(source.id,id);return {url:clean.toString(),kind:source.kind,id};
}
function plain(html){
 return html.replace(/<[^>]*>/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10ffff))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(Math.min(parseInt(n,16),0x10ffff))).replace(/&(?:nbsp|amp|lt|gt|quot|apos);/gi,m=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[m.toLowerCase()]||' ')).replace(/\s+/g,' ').trim().slice(0,500);
}
function scrub(value){return value.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[연락처 제외]').replace(/(?:\+82[- ]?)?0\d{1,2}[-. )]?\d{3,4}[-. ]?\d{4}/g,'[연락처 제외]');}
const allowedLabels=new Map([['모집기간','application_period'],['봉사활동처','organization'],['모집기관','organization'],['활동분야','category'],['봉사분야','category'],['봉사지역','region'],['봉사장소','place'],['활동기간','activity_period'],['봉사기간','activity_period'],['봉사대상','beneficiaries'],['자격요건','eligibility'],['모집상태','status']]);
export function extractNotice(html,source){
 if(typeof html!=='string'||html.length>2_000_000)throw new Error('공고 내용을 읽을 수 없습니다.');
 // Page content may contain applicant and contact details: only whitelist titles and labelled public program fields.
 const safe=html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|noscript|iframe|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ');
 const fields={};
 for(const match of safe.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th\s*>\s*<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)){
  const label=plain(match[1]).replace(/\s/g,'');const key=allowedLabels.get(label);if(key&&!fields[key])fields[key]=scrub(plain(match[2]));
 }
 const anchor=safe.search(/<th\b[^>]*>\s*(?:<[^>]+>\s*)*(?:모집\s*기간|봉사\s*활동처|모집\s*기관)/i);
 const headings=[...safe.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]\s*>/gi)].map(m=>({title:scrub(plain(m[1])),index:m.index})).filter(x=>x.title&&x.title.length<=200&&!/^(봉사자\s*모집(?:\s*및\s*신청)?|봉사신청|사회복지자원봉사(?:인증관리)?|카카오맵\s*지도|지도)$/i.test(x.title));
 const before=anchor<0?[]:headings.filter(x=>x.index<anchor);const title=(before.at(-1)||headings[0])?.title||'';
 // Only a status badge immediately adjacent to this notice's heading can establish recruitment state.
 const heading=before.at(-1)||headings[0];if(!fields.status && heading){const context=safe.slice(Math.max(0,heading.index-160),Math.min(safe.length,heading.index+350));const badge=context.match(/<span\b[^>]*class=["'][^"']*(?:status|state|badge)[^"']*["'][^>]*>\s*(모집\s*중|모집\s*마감|모집\s*완료)\s*<\/span>/i);if(badge)fields.status=badge[1].replace(/\s/g,'');}
 const lines=[title&&`활동명: ${title}`,...Object.entries(fields).map(([k,v])=>`${k}: ${v}`)].filter(Boolean);
 if(!title || Object.keys(fields).length===0)throw new Error('공고의 필수 정보를 읽지 못했습니다. 사이트 구조나 접근 제한을 확인해 주세요.');
 return {source:source.kind,source_url:source.url,external_id:source.id,title,fields,notice:lines.join('\n')};
}
export async function fetchNotice(input,{fetcher=fetch}={}){
 const source=canonicalNoticeUrl(input);let response;
 try{response=await fetcher(source.url,{method:'GET',redirect:'error',headers:{'Accept':'text/html,application/xhtml+xml','User-Agent':'DandiLocalDemo/1.0'},signal:AbortSignal.timeout(10000)});}catch{throw new Error('공식 사이트에 연결하지 못했습니다. 주소와 네트워크 또는 사이트 접근 제한을 확인해 주세요.');}
 if(!response.ok)throw new Error(`공식 사이트가 요청을 처리하지 않았습니다 (HTTP ${response.status}).`);
 if(!/^(text\/html|application\/xhtml\+xml)/i.test(response.headers.get('content-type')||''))throw new Error('공고 페이지 형식이 아닙니다.');
 const reader=response.body?.getReader();if(!reader)throw new Error('공고 응답이 비어 있습니다.');const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1_000_000){await reader.cancel();throw new Error('공고 페이지 크기가 제한을 초과했습니다.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=Buffer.concat(chunks.map(chunk=>Buffer.from(chunk)));const charset=(response.headers.get('content-type')||'').match(/charset\s*=\s*([^;\s]+)/i)?.[1]?.replace(/["']/g,'').toLowerCase()||'utf-8';let html;try{html=new TextDecoder(charset).decode(bytes);}catch{throw new Error('공고 페이지 문자 형식을 읽지 못했습니다.');}
 return extractNotice(html,source);
}
