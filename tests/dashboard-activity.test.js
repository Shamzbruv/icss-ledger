const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRecentJournalActivity } = require('../src/services/dashboardActivityService');
function database(result) {
    const calls=[];
    const query={};
    for(const method of ['select','eq','order','limit','abortSignal']) query[method]=(...args)=>{calls.push([method,...args]);return query;};
    query.then=(resolve,reject)=>Promise.resolve(result).then(resolve,reject);
    return {calls,from(table){calls.push(['from',table]);return query;}};
}
test('dashboard reads posted entries from the current ledger and totals debit lines in base currency', async()=>{
    const db=database({data:[{id:'journal-1',journal_series:'GJ',narration:'Invoice posted',journal_date:'2026-10-29',journal_lines:[{debit:'123.45'},{debit:'6.55'},{debit:'0'}]}],error:null});
    const entries=await loadRecentJournalActivity(db);
    assert.ok(db.calls.some(c=>c[0]==='from'&&c[1]==='journals'));
    assert.ok(db.calls.some(c=>c[0]==='eq'&&c[1]==='status'&&c[2]==='posted'));
    assert.deepEqual(entries,[{type:'accounting',id:'journal-1',title:'Journal GJ',description:'Invoice posted',amount:130,currency:'JMD',status:'POSTED',date:'2026-10-29'}]);
});
test('empty accounting activity is supported and database failures are not hidden', async()=>{
    assert.deepEqual(await loadRecentJournalActivity(database({data:[],error:null})),[]);
    await assert.rejects(loadRecentJournalActivity(database({data:null,error:{message:'connection unavailable'}})),/Could not load recent accounting activity/);
});
