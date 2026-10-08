// Contract-authoring evidence check only. Does not import or invoke product/runner/scorer.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const repo='/Users/entp_psyche/Desktop/InvestProjects2026/structural-typology-navigator-main-reconciliation-1';
const out='/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/NAVIGATOR_BOUNDED_REASONING_RAG_1_POST_RECONCILIATION_TESTING_1_EXECUTION_CONTRACT_CLOSURE_1_CORR1_RESUME_1';
if(fs.existsSync(out)) throw Error('Refuse existing output');
fs.mkdirSync(out,{mode:0o700});
let contacts=0;
globalThis.fetch=async()=>{contacts++;throw Error('Authoring network denied');};
const {adaptMarkdownDocument}=await import(repo+'/src/lib/ingestion/adapters.ts');
const {buildIngestionPlan}=await import(repo+'/src/lib/ingestion/build-ingestion-plan.ts');
const hash=(b:any)=>crypto.createHash('sha256').update(b).digest('hex');
const corpus='/Users/entp_psyche/Desktop/Academy Texts Corpus';
const receiptsPath=corpus+'/_RAG_INGESTION/ACADEMY_MULTI_COURSE_RAG_EXPANSION_1_INGESTION_1/SOURCE_DOCUMENT_RECEIPTS.json';
const receipts=JSON.parse(fs.readFileSync(receiptsPath,'utf8')).receipts;
const rows:any[]=[];const checks:any[]=[];
for(const r of receipts){
 const f=path.join(corpus,r.canonicalFile);const bytes=fs.readFileSync(f);
 if(hash(bytes)!==r.canonicalFileSha256) throw Error('Canonical mismatch '+f);
 const doc=adaptMarkdownDocument(bytes.toString('utf8'),{sourceSlug:r.sourceSlug,sourceTitle:r.sourceTitle,sourceKind:r.sourceKind,language:r.language,documentMetadata:{}});
 const plan=buildIngestionPlan(doc,r.chunking);
 if(plan.normalizedContentSha256!==r.normalizedContentSha256 || plan.chunks.length!==r.chunkCount) throw Error('Document identity mismatch '+f);
 for(const c of plan.chunks){
  if(r.chunkIdentities[c.chunkIndex]?.chunkIndex!==c.chunkIndex || r.chunkIdentities[c.chunkIndex]?.contentSha256!==c.contentSha256 || hash(Buffer.from(c.content,'utf8'))!==c.contentSha256)throw Error('Chunk mismatch '+f+' '+c.chunkIndex);
  if(r.courseId!=='professional-development-stages')rows.push({memberId:r.courseId+'/'+r.sourceSlug+'/'+r.canonicalFileSha256+'/'+c.chunkIndex,courseId:r.courseId,sourceSlug:r.sourceSlug,documentIdentity:r.canonicalFileSha256,historicalDocumentId:r.documentId,chunkIndex:c.chunkIndex,passageSha256:c.contentSha256,passageUtf8Bytes:Buffer.byteLength(c.content),physicalLocator:{canonicalPath:f,receiptPath:receiptsPath},locator:c.locator,headingPath:c.headingPath,content:c.content,authorityFamily:'non-maslow-historical-ingestion-1',authorityRelation:r.authorityRole});
 }
 checks.push({canonicalPath:f,canonicalSha256:hash(bytes),documentId:r.documentId,chunks:plan.chunks.length,allContentHashesMatch:true,inBoundUniverse:r.courseId!=='professional-development-stages'});
}
const base=repo+'/benchmarks/navigator-bounded-reasoning-rag-1/evidence-authority/maslow-historical-v1';
for(const [family,name] of [['b1','forensic_manifest_554.jsonl'],['b2','forensic_manifest_37.jsonl']]){
 const mp=path.join(base,family,name);const manifest=fs.readFileSync(mp,'utf8').trimEnd().split('\n').map(x=>JSON.parse(x));
 for(const r of manifest){
  const slug=r.sourceSlug??'maslow-qa-2025-04-20';
  const fp=path.join(base,family,r.exactPassageArtifact??r.losslessContentArtifactReference);const bytes=fs.readFileSync(fp);
  if(hash(bytes)!==r.exactContentSha256||bytes.length!==r.exactContentUtf8ByteLength)throw Error('Maslow integrity mismatch '+fp);
  // Omit database IDs and their item-selection binding metadata from D3 input.
  rows.push({memberId:'maslow/'+slug+'/'+(r.canonicalDocumentSha256??r.canonicalMarkdownSha256)+'/'+r.historicalChunkIndex,courseId:'maslow',sourceSlug:slug,documentIdentity:r.canonicalDocumentSha256??r.canonicalMarkdownSha256,chunkIndex:r.historicalChunkIndex,passageSha256:hash(bytes),passageUtf8Bytes:bytes.length,physicalLocator:{manifestPath:mp,passagePath:fp},locator:r.locator,headingPath:r.headingPath??r.provenance?.headingPath??[],content:bytes.toString('utf8'),authorityFamily:'maslow-historical-v1/'+family});
 }
 checks.push({manifestPath:mp,manifestSha256:hash(fs.readFileSync(mp)),passages:manifest.length,allContentHashesMatch:true});
}
rows.sort((a,b)=>a.memberId<b.memberId?-1:a.memberId>b.memberId?1:0);
if(rows.length!==1999||new Set(rows.map(x=>x.memberId)).size!==1999)throw Error('Universe cardinality mismatch');
fs.writeFileSync(out+'/authorized-evidence-universe.jsonl',rows.map(({content,...r})=>JSON.stringify(r)).join('\n')+'\n');
fs.writeFileSync('/private/tmp/nbrr1_resume_passages.json',JSON.stringify(rows));
fs.writeFileSync(out+'/authority-static-validation.json',JSON.stringify({kind:'AUTHOR_STATIC_CHECK_NOT_INDEPENDENT_IV',benchmarkExecutions:0,providerCalls:0,productionContact:0,networkAttempts:contacts,universeCount:rows.length,nonMaslowCount:1408,maslowCount:591,excludedPDSCount:125,checks},null,2)+'\n');
console.log(JSON.stringify({universeCount:rows.length,documentsChecked:24,nonMaslowChunkHashesVerified:1533,maslowPassagesVerified:591,networkAttempts:contacts,out}));
