const test=require('node:test');
const assert=require('node:assert/strict');
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';process.env.SUPABASE_ANON_KEY ||= 'test-key';
const {monthBounds,validateJournalLines}=require('../src/services/accountingViewModel');
const {summarizeCashFlow}=require('../src/services/reportingService');
test('report month bounds handle February, leap years and 30-day months',()=>{
 assert.deepEqual(monthBounds('2026-02'),{start:'2026-02-01',end:'2026-02-28'});
 assert.equal(monthBounds('2028-02').end,'2028-02-29');assert.equal(monthBounds('2026-04').end,'2026-04-30');
 assert.throws(()=>monthBounds('2026-13'));
});
test('journal validation rejects non-finite, negative, empty, unbalanced and impossible-date postings',()=>{
 const lines=[{accountCode:'1000',debitAmount:100,creditAmount:0},{accountCode:'4000',debitAmount:0,creditAmount:100}];
 assert.doesNotThrow(()=>validateJournalLines(lines,'2026-10-29'));
 assert.throws(()=>validateJournalLines(lines,'2026-02-30'));
 for(const bad of [NaN,Infinity,-5,0])assert.throws(()=>validateJournalLines([{...lines[0],debitAmount:bad},lines[1]],'2026-10-29'));
 assert.throws(()=>validateJournalLines([{...lines[0],creditAmount:1},lines[1]],'2026-10-29'));
 assert.throws(()=>validateJournalLines([{...lines[0],debitAmount:99},lines[1]],'2026-10-29'));
});
test('cash flow counts asset purchases and owner capital once, and excludes transfers and noncash assets',()=>{
 const l=(id,code,dr,cr)=>({journal_id:id,chart_of_accounts:{code},debit:dr,credit:cr});
 const result=summarizeCashFlow([
 l('capital','1010',1000,0),l('capital','3000',0,1000),
 l('asset','1500',200,0),l('asset','1010',0,200),
 l('sale','1010',300,0),l('sale','4000',0,300),
 l('expense','5000',50,0),l('expense','1010',0,50),
 l('draw','3010',100,0),l('draw','1010',0,100),
 l('transfer','1000',40,0),l('transfer','1010',0,40),
 l('noncash','1500',500,0),l('noncash','2000',0,500)
 ],'2026-01-01','2026-12-31');
 assert.equal(result.operating.net,250);assert.equal(result.investing.net,-200);assert.equal(result.financing.net,900);assert.equal(result.netCashMovement,950);
 assert.equal(result.operating.net+result.investing.net+result.financing.net,result.netCashMovement);
});
test('financial reads continue beyond the Supabase row cap and propagate failures',async()=>{
 const {readAll}=require('../src/services/ledgerReadService');
 const rows=Array.from({length:1203},(_,id)=>({id}));let requests=0;
 const result=await readAll(()=>({range(start,end){requests++;return Promise.resolve({data:rows.slice(start,end+1),error:null});}}));
 assert.equal(result.length,1203);assert.equal(requests,3);
 await assert.rejects(readAll(()=>({range(){return Promise.resolve({data:null,error:{message:'offline'}});}})),/offline/);
});
