// Public 1365 regional list; URLs and fields are confirmed again on detail pages.
const listUrl='https://www.1365.go.kr/vols/P9210/partcptn/timeCptn.do';
const areas=[{code:'6270000',name:'대구광역시'},{code:'6470000',name:'경상북도'}];
export function parse1365List(html,area){
 if(typeof html!=='string'||html.length>2000000)throw Error('1365 목록 형식을 확인하지 못했습니다.');
 const options=[...html.matchAll(/<option\b[^>]*>/gi)].map(x=>x[0]);
 if(!options.some(x=>new RegExp(`\\bvalue=["']${area.code}["']`,'i').test(x)&&/\bselected\b/i.test(x)))throw Error('1365 지역 검색 조건을 확인하지 못했습니다.');
 const matches=[...html.matchAll(/\bid=["']progrmRegistNo_(\d{1,15})["']/gi)];const items=[];
 for(let i=0;i<matches.length;i++){
  const m=matches[i],limit=Math.min(matches[i+1]?.index??html.length,m.index+12000);const end=html.indexOf('</a>',m.index);
  if(end<0||end>limit)continue;
  const text=html.slice(m.index,end+4).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
  if(!text.includes(area.name)||!/모집\s*중/.test(text))continue;
  const url=new URL(listUrl);url.searchParams.set('type','show');url.searchParams.set('progrmRegistNo',m[1]);
  items.push({url:url.toString(),id:m[1],region:area.name});
 }
 return items;
}
export async function searchOfficial1365({today,fetcher=fetch}={}){
 const start=today||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start))throw Error('1365 검색 날짜를 확인하지 못했습니다.');
 const endDate=new Date(start+'T00:00:00Z');if(Number.isNaN(endDate.getTime()))throw Error('1365 검색 날짜를 확인하지 못했습니다.');endDate.setUTCDate(endDate.getUTCDate()+90);const end=endDate.toISOString().slice(0,10);
 const results=await Promise.allSettled(areas.map(async area=>{
  const q=new URLSearchParams({searchFlag:'search',firstSearch:'N',searchHopeArea1:area.code,searchSrvcStts:'0',adultPosblAt:'Y',searchProgrmBgnde:start,searchProgrmEndde:end,cPage:'1',flag:'A01'});
  const response=await fetcher(`${listUrl}?${q}`,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'DandiLocalDemo/1.0'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`1365 목록 HTTP ${response.status}`);
  const html=await response.text();return parse1365List(html,area);
 }));
 const success=results.filter(r=>r.status==='fulfilled');if(!success.length)throw Error('1365 공식 지역별 목록에 연결하지 못했습니다.');
 const unique=new Map();for(const result of success)for(const item of result.value)if(!unique.has(item.id))unique.set(item.id,item);
 const found=[...unique.values()].slice(0,20);return {items:found.map(({url})=>({url})),citations:found.map(x=>x.url),regions:Object.fromEntries(found.map(x=>[x.id,x.region])),partial:success.length!==areas.length};
}
