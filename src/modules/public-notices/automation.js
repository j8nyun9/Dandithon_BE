import {canonicalNoticeUrl} from './read.js';
export function verifiedCandidateUrls(result){
 const cited=new Set();for(const url of result.citations||[])try{const c=canonicalNoticeUrl(url);cited.add(`${c.kind}:${c.id}`);}catch{}
 const seen=new Set(),urls=[];for(const item of result.items||[]){try{const c=canonicalNoticeUrl(item.url);const key=`${c.kind}:${c.id}`;if(cited.has(key)&&!seen.has(key)){seen.add(key);urls.push(c.url);}}catch{}}
 return urls.slice(0,20);
}
export function noticeAssessment(notice,today){
 if(!notice||typeof notice.title!=='string'||!notice.title.trim())return {reason:'활동명을 확인하지 못했습니다.'};
 if(!notice.fields?.organization?.trim())return {reason:'모집 기관을 확인하지 못했습니다.'};
 if(!notice.fields.status?.trim())return {reason:'공식 공고에서 모집 상태를 확인하지 못했습니다.'};
 if(!/^모집\s*중$/.test(notice.fields.status.trim()))return {reason:'공식 공고의 모집 상태가 모집 중이 아닙니다.'};
 const dates=(notice.fields.application_period||'').match(/\d{4}[-.\/]\s*\d{1,2}[-.\/]\s*\d{1,2}/g);
 if(!dates||dates.length!==2)return {reason:'모집 시작일과 마감일을 확인하지 못했습니다.'};
 const normalize=s=>{const p=s.split(/[-.\/]/).map(x=>x.trim());const d=`${p[0]}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`;const time=Date.parse(d+'T00:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===d?d:null;};
 const [start,end]=dates.map(normalize);if(!start||!end||start>end)return {reason:'모집 기간 형식을 확인하지 못했습니다.'};
 if(today<start||today>end)return {reason:'현재 모집 기간이 아닙니다.'};
 return {dates:{start,end}};
}

export function qualifyNotice(notice,today){return noticeAssessment(notice,today).dates||null;}
