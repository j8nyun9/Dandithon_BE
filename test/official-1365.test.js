import test from 'node:test';
import assert from 'node:assert/strict';
import {parse1365List,searchOfficial1365} from '../src/modules/public-notices/official-1365.js';

const list=(code,region,id)=>`<select><option value="${code}" selected>지역</option></select><ul><li><input id="progrmRegistNo_${id}" name="progrmRegistNo"><a href="javascript:show(${id})"><ul><li>환경</li></ul><span>${region}</span><span>모집중</span></a></li></ul>`;
test('1365 목록은 공식 검색 지역과 모집중이 확인된 공고만 반환한다',()=>{
 const area={code:'6270000',name:'대구광역시'};
 assert.equal(parse1365List(list('6270000','대구광역시','42'),area)[0].id,'42');
 assert.deepEqual(parse1365List(list('6270000','서울특별시','42'),area),[]);
 assert.deepEqual(parse1365List(list('6270000','대구광역시','42').replace('모집중','모집완료'),area),[]);
 assert.throws(()=>parse1365List(list('6470000','대구광역시','42'),area),/검색 조건/);
});
test('1365 공식 목록은 대구와 경북을 각각 검색하고 지역 근거를 보존한다',async()=>{
 const calls=[];const fetcher=async url=>{const u=new URL(url);calls.push(u);const code=u.searchParams.get('searchHopeArea1');return new Response(code==='6270000'?list(code,'대구광역시','101'):list(code,'경상북도','202'),{status:200});};
 const r=await searchOfficial1365({today:'2026-11-08',fetcher});assert.equal(r.items.length,2);assert.deepEqual(r.regions,{'101':'대구광역시','202':'경상북도'});assert.equal(r.partial,false);assert.equal(calls.length,2);assert.ok(calls.every(u=>u.hostname==='www.1365.go.kr'&&u.searchParams.get('searchSrvcStts')==='0'));
});
test('한 지역 검색이 실패하면 성공한 지역만 사용하고 부분 결과로 표시한다',async()=>{
 const r=await searchOfficial1365({today:'2026-11-08',fetcher:async url=>{const code=new URL(url).searchParams.get('searchHopeArea1');if(code==='6270000')throw Error('network');return new Response(list(code,'경상북도','202'),{status:200});}});
 assert.equal(r.partial,true);assert.equal(r.items.length,1);assert.deepEqual(r.regions,{'202':'경상북도'});
});
