import {canonicalNoticeUrl} from './read.js';
export function verifiedCandidateUrls(result,{allow1365Suggestions=false}={}){
 const cited=new Set();for(const url of result.citations||[])try{const c=canonicalNoticeUrl(url);cited.add(`${c.kind}:${c.id}`);}catch{}
 const seen=new Set(),urls=[];for(const item of [...(result.items||[]),...(result.citations||[]).map(url=>({url}))]){try{const c=canonicalNoticeUrl(item.url);const key=`${c.kind}:${c.id}`;if((cited.has(key)||(allow1365Suggestions&&c.kind==='1365'))&&!seen.has(key)){seen.add(key);urls.push(c.url);}}catch{}}
 return urls.slice(0,40);
}
export function noticeAssessment(notice,today){
 if(!notice||typeof notice.title!=='string'||!notice.title.trim())return {reason:'활동명을 확인하지 못했습니다.'};
 if(!notice.fields?.organization?.trim())return {reason:'모집 기관을 확인하지 못했습니다.'};
 const status=notice.fields.status?.trim()||'';
 if(/(모집|신청|접수)\s*(완료|마감|종료|중단)|정원\s*(마감|초과)/.test(notice.title))return {reason:'공고 제목에 모집 종료가 표시돼 있습니다.'};
 if(status&&!/^모집\s*중$/.test(status))return {reason:'공식 공고의 모집 상태가 모집 중이 아닙니다.'};
 const dates=(notice.fields.application_period||'').match(/\d{4}[-.\/]\s*\d{1,2}[-.\/]\s*\d{1,2}/g);
 if(!dates||dates.length!==2){if(!dates&&/^모집\s*중$/.test(status))return {dates:{start:null,end:null},periodUnconfirmed:true,statusUnconfirmed:false};return {reason:'모집 시작일과 마감일을 확인하지 못했습니다.'};}
 const normalize=s=>{const p=s.split(/[-.\/]/).map(x=>x.trim());const d=`${p[0]}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`;const time=Date.parse(d+'T00:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===d?d:null;};
 const [start,end]=dates.map(normalize);if(!start||!end||start>end)return {reason:'모집 기간 형식을 확인하지 못했습니다.'};
 if(today<start||today>end)return {reason:'현재 모집 기간이 아닙니다.'};
 return {dates:{start,end},statusUnconfirmed:!status};
}

export function qualifyNotice(notice,today){return noticeAssessment(notice,today).dates||null;}
