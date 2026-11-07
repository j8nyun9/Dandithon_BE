export const categories=['welfare','education','healthcare','blood','environment','culture'];
const legacy={mentoring:'education',community:'culture',sharing:'welfare',scholarship:'education',blood:'blood'};
function generalType(text){if(/헌혈|혈액\s*기증/.test(text))return 'blood';if(/환경\s*정화|플로깅|쓰레기|재활용|생태|하천\s*정화/.test(text))return 'environment';if(/의료|병원|건강\s*검진|간병/.test(text))return 'healthcare';if(/교육|학습|멘토|상담|학습지도/.test(text))return 'education';if(/문화|예술|공연|음악회|행사|문화유산/.test(text))return 'culture';return 'welfare';}
export function migrateWeights(weights,title='',notice=''){
 if(!weights||typeof weights!=='object'||Array.isArray(weights))throw Error('invalid mission weights');
 const result={};for(const [key,value] of Object.entries(weights)){const mapped=key==='volunteer'?generalType(`${title} ${notice}`):legacy[key]||key;if(!categories.includes(mapped)||typeof value!=='number'||!Number.isFinite(value)||value<=0)throw Error('invalid mission weights');result[mapped]=(result[mapped]||0)+value;}
 if(Object.keys(result).length<1||Object.keys(result).length>2||Math.abs(Object.values(result).reduce((a,b)=>a+b,0)-1)>1e-9)throw Error('invalid mission weights');return result;
}
