const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { normalizeContractCc, referenceCopyTemplate } = require('../src/services/contractDelivery');
const { renderContractHtml, getAcknowledgements, buildContractData } = require('../src/services/contractTemplate');
const { generateContractPDF } = require('../src/services/contractPdfService');
const rows = [], mail = [];
let failReference = false;
function from() {
  let filters=[],op='select',payload,one=false;
  const run=()=>{
    if(op==='insert'){const row={id:`c-${rows.length}`,created_at:new Date().toISOString(),...payload};rows.push(row);return{data:row,error:null};}
    const found=rows.filter(r=>filters.every(([k,v])=>r[k]===v));
    if(op==='update')found.forEach(r=>Object.assign(r,payload));
    return{data:one?found[0]:found,error:null};
  };
  const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},insert(v){op='insert';payload=v;return q;},update(v){op='update';payload=v;return q;},order(){return q;},limit(){return q;},single(){one=true;return Promise.resolve(run());},maybeSingle(){one=true;return Promise.resolve(run());},then(a,b){return Promise.resolve(run()).then(a,b);}};return q;
}
const dbPath=path.resolve(__dirname,'../src/db.js'),mailPath=path.resolve(__dirname,'../src/services/emailService.js');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{from}};
require.cache[mailPath]={id:mailPath,filename:mailPath,loaded:true,exports:{sendEmail:async()=>true,sendContractEmail:async(...args)=>{if(failReference&&args[1].startsWith('Reference copy:'))throw Error('copy failed');mail.push(args);}}};
const app=express();app.use(express.json());app.use('/api/contracts',require('../src/routes/contracts'));
let server,base;
test.before(async()=>{await new Promise(r=>{server=app.listen(0,'127.0.0.1',r);});base=`http://127.0.0.1:${server.address().port}`;});
test.after(()=>server.close());
async function call(method,url,body){const r=await fetch(base+'/api/contracts'+url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json()};}
const payload={client_name:'Existing Owner',business_name:'Sky Beach',client_email:'owner@example.com',project_cost:220000,deposit_percent:50,contract_version:'continuation-v1',project_type:'Phase 2 continuation',project_description:'Approved operations scope',payment_arrangement:'50% upfront and 50% upon completion.'};

test('CC validation rejects malformed addresses, header injection and oversized lists, and deduplicates safely',()=>{
 assert.deepEqual(normalizeContractCc('Gary@example.com, gary@example.com; owner@example.com','OWNER@example.com'),['gary@example.com']);
 assert.deepEqual(normalizeContractCc(''),[]);
 for(const value of ['not-an-email','Person <gary@example.com>','gary@example.com\r\nBcc:x@example.com',{},[null]])assert.throws(()=>normalizeContractCc(value));
 assert.throws(()=>normalizeContractCc(Array.from({length:6},(_,i)=>`person${i}@example.com`)));
 const copy=referenceCopyTemplate({...payload,sign_token:'secret-signing-token',agreement_reference:'TEST'});
 assert.doesNotMatch(JSON.stringify(copy),/secret-signing-token|sign-contract\?/);
});
test('a continuing agreement preserves the earlier project and uses matching HTML/PDF acknowledgements',async()=>{
 const html=renderContractHtml(payload);
 assert.match(html,/CONTINUING DEVELOPMENT AGREEMENT/);
 assert.match(html,/earlier agreement remains in force/);
 assert.match(html,/110,000\.00/);
 assert.doesNotMatch(html,/10% per month|new client.*required|PROJECT SERVICE AGREEMENT &amp; TERMS ACCEPTANCE/);
 const acks=getAcknowledgements(payload);assert.equal(acks.length,4);assert.match(acks[0].text(buildContractData(payload)),/50%/);
 const pdf=await generateContractPDF({...payload,status:'draft'});assert.equal(pdf.subarray(0,4).toString(),'%PDF');
 assert.match(renderContractHtml({...payload,contract_version:'v1'}),/PROJECT SERVICE AGREEMENT/);
});
test('create remains a draft with no email; send CC gets a PDF without a signing token; resend preserves terms',async()=>{
 let r=await call('POST','/',payload);assert.equal(r.status,200);const id=r.body.id;
 assert.equal(r.body.status,'draft');assert.equal(r.body.company_signed_at,null);assert.equal(mail.length,0);
 r=await call('POST',`/${id}/send`,{cc_emails:'bad-address'});assert.equal(r.status,400);assert.equal(mail.length,0);assert.equal(rows[0].status,'draft');
 r=await call('POST',`/${id}/send`,{cc_emails:'Gary@example.com,owner@example.com'});assert.equal(r.status,200);assert.deepEqual(r.body.cc_emails,['gary@example.com']);assert.equal(mail.length,2);
 assert.equal(mail[0][7],undefined);assert.match(mail[0][3],/sign-contract\?token=/);
 assert.deepEqual(mail[1][7],['gary@example.com']);assert.ok(Buffer.isBuffer(mail[1][4]));assert.doesNotMatch(mail[1][3]+mail[1][2],new RegExp(rows[0].sign_token));
 assert.deepEqual(rows[0].terms_snapshot_json.delivery_cc,['gary@example.com']);assert.equal(rows[0].status,'sent');
 rows[0].project_cost=999;rows[0].project_description='mutated';
 r=await call('POST',`/${id}/send`,{cc_emails:[]});assert.equal(r.status,200);assert.equal(rows[0].terms_snapshot_json.project_cost,220000);assert.equal(rows[0].terms_snapshot_json.project_description,'Approved operations scope');
});
test('CC delivery failure reports a warning without losing the successful signer invitation',async()=>{
 let r=await call('POST','/',payload);const id=r.body.id;failReference=true;
 r=await call('POST',`/${id}/send`,{cc_emails:['cc@example.com']});
 assert.equal(r.status,200);assert.match(r.body.ccWarning,/signing invitation was sent/);assert.equal(rows.find(r=>r.id===id).status,'sent');failReference=false;
});
test('signing uses addendum acknowledgements and sends the signed PDF to the saved CC recipients',async()=>{
 const r=await call('POST','/',payload);const id=r.body.id;
 await call('POST',`/${id}/send`,{cc_emails:['cc@example.com']});
 const row=rows.find(r=>r.id===id);
 const result=await call('POST',`/public/${row.sign_token}/sign`,{legal_name:'Existing Owner',signature_type:'typed',signature_data:'Existing Owner',acknowledgements:{deposit_ack:true,variable_pricing_ack:true,key_clauses_ack:true,signature_confirmation:true}});
 assert.equal(result.status,200);
 const signedMail=mail.findLast(args=>args[1].startsWith('✅ Signed:'));
 assert.deepEqual(signedMail[7],['cc@example.com']);assert.ok(Buffer.isBuffer(signedMail[4]));
});

test('send dialog requires an explicit send action and passes the selected CC addresses',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');const nodes=new Map(),calls=[];
 function node(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,classList:{add(){},remove(){}},focus(){},checkValidity(){return true;},reportValidity(){}});return nodes.get(id);}
 const context=vm.createContext({document:{getElementById:node},window:{location:{origin:'https://example.test'}},console,showAlert:async()=>{},apiFetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url==='/api/contracts'?[]:{success:true,cc_emails:['gary@example.com']}};}});
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../public/js/contracts.js'),'utf8'),context);
 await new Promise(r=>setImmediate(r));calls.length=0;
 vm.runInContext(`openDeliveryModal({id:'existing',client_email:'owner@example.com',terms_snapshot_json:{delivery_cc:['old@example.com']}},()=>{})`,context);
 assert.equal(node('deliveryCc').value,'old@example.com');assert.equal(calls.length,0);
 node('deliveryCc').value='Gary@example.com, gary@example.com';
 await vm.runInContext('submitContractDelivery()',context);
 assert.equal(calls.length,1);assert.deepEqual(JSON.parse(calls[0].options.body),{cc_emails:['gary@example.com']});
});
