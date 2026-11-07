import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchNotice} from '../src/modules/public-notices/read.js';

test('VMS 중계 응답은 공고 ID를 확인하고 허용 항목만 사용한다',async()=>{
 process.env.VMS_RELAY_URL='https://relay.example'; process.env.VMS_RELAY_TOKEN='secret';
 try {
  const fetcher=async(url,options)=>{assert.equal(url,'https://relay.example/notice?seq=42');assert.equal(options.headers.Authorization,'Bearer secret');return Response.json({source:'VMS',external_id:'42',title:'봉사',fields:{organization:'센터',applicants:'개인정보'}});};
  const notice=await fetchNotice('https://vms.or.kr/partspace/recruitView.do?seq=42',{fetcher});
  assert.equal(notice.fields.organization,'센터');assert.equal(notice.fields.applicants,undefined);assert.doesNotMatch(notice.notice,/개인정보/);
  await assert.rejects(()=>fetchNotice('https://vms.or.kr/partspace/recruitView.do?seq=43',{fetcher:async()=>Response.json({source:'VMS',external_id:'42',title:'봉사',fields:{organization:'센터'}})}),/확인하지 못했습니다/);
 } finally {delete process.env.VMS_RELAY_URL;delete process.env.VMS_RELAY_TOKEN;}
});
