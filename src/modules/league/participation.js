/**
 * Confirmed completed participations only. One completed record contributes
 * one unit, divided by its fixed category weights. Size correction is a
 * separate policy and deliberately not applied here.
 */
export function participationTotals(records) {
 const axes={welfare:0,education:0,healthcare:0,blood:0,environment:0,culture:0};
 let completed=0;
 for(const record of records){
  if(record.status!=='approved') continue;
  const entries=Object.entries(record.weights);
  if(entries.length<1||entries.length>2||entries.some(([key,value])=>!(key in axes)||typeof value!=='number'||!Number.isFinite(value)||value<=0)||Math.abs(entries.reduce((sum,[,value])=>sum+value,0)-1)>1e-9) throw new Error('invalid category weights');
  // Existing safety policy: non-demo blood contribution is excluded.
  if(!record.is_demo && entries.some(([key])=>key==='blood')) continue;
  const eligible=entries;
  completed++;
  for(const [key,weight] of eligible) axes[key]+=weight;
 }
 return {completed,axes};
}
