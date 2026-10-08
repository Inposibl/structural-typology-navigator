"""Bounded candidate-artifact static validation; no product/scorer execution."""
from pathlib import Path
import json,hashlib,subprocess
import jsonschema
ROOT=Path('/Users/entp_psyche/Desktop/InvestProjects2026')
REPO=ROOT/'structural-typology-navigator-main-reconciliation-1'
OUT=ROOT/'execution-infrastructure/NAVIGATOR_BOUNDED_REASONING_RAG_1_POST_RECONCILIATION_TESTING_1_EXECUTION_CONTRACT_CLOSURE_1_CORR1_RESUME_1'
SHA='a77c94742dd4f7fbbd3ee8f7feb8023a58051721'
def h(b):return hashlib.sha256(b).hexdigest()
def read(p):return json.loads(Path(p).read_text())
def write(n,d): (OUT/n).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
required=['evidence-materialization-contract.json','d3-counting-contract.json','d3-semantic-equivalence-map.candidate.json','d4-trace-schema.json','d4-hybrid-contract.json','runner-contract.json','environment-contract.json','network-contact-contract.json','timeout-retry-contract.json','scoring-contract.json','blindness-access-matrix.json','full123-accounting-contract.json','implementation-surface.json','test-base-contract.json']
assert all((OUT/n).is_file() for n in required)
alljson={f.name:read(f) for f in sorted(OUT.glob('*.json'))}
schema=alljson['d4-trace-schema.json']
# Schema uses only Draft7-compatible constraints plus locally resolved $defs pointers.
# This checks structure, not provenance/support and not a runtime adjudication.
jsonschema.Draft7Validator.check_schema(schema)
def refs(x):
 if isinstance(x,dict):
  if '$ref' in x:
   p=x['$ref'];assert p.startswith('#/');cur=schema
   for k in p[2:].split('/'):cur=cur[k]
  for v in x.values():refs(v)
 elif isinstance(x,list):
  for v in x:refs(v)
refs(schema)
sc=alljson['scoring-contract.json'];assert len(sc['dimensions'])==sc['dimensionCount']==9
assert len(sc['gates'])==sc['gateCount']==9
assert len({x['name'] for x in sc['dimensions']})==9 and len({x['name'] for x in sc['gates']})==9
assert sc['noAggregateScore'] and sc['noCrossDimensionCompensation'] and sc['noWeights']
assert sc['splitPolicy']['HOLDOUT']['unsupportedThreshold']==sc['splitPolicy']['ADVERSARIAL_SAFETY']['unsupportedThreshold']==0
assert alljson['runner-contract.json']['attempts']['harnessRetries']==0
assert alljson['timeout-retry-contract.json']['outerItemDeadlineMs'] is None
assert alljson['test-base-contract.json']['executionReady'] is False
ac=alljson['full123-accounting-contract.json'];assert ac['partition']['DEVELOPMENT']+ac['partition']['HOLDOUT']+ac['partition']['ADVERSARIAL_SAFETY']==ac['partition']['TOTAL']==123
assert ac['adversarialPartition']['VISIBLE_REGRESSION']+ac['adversarialPartition']['SEALED_BLIND']==24
rows=read('/private/tmp/nbrr1_resume_passages.json');by={x['memberId']:x for x in rows}
assert len(by)==1999
mp=alljson['d3-semantic-equivalence-map.candidate.json'];assert mp['groupCount']==len(mp['groups'])==5
assert mp['coverage']['semanticEquivalenceCoverage']=='INCOMPLETE_NOT_CLAIMED_COMPLETE'
assert not mp['consumableForFinalBlindRun']
scopeMembership=set();witnessCount=0
for g in mp['groups']:
 assert g['countingWeight']==1 and len(g['members'])>1
 assert len({m['passageSha256'] for m in g['members']})>1 # not byte-only grouping
 assert not g['independentlyVerified'] and not g['ownerAccepted']
 scope=g['countingScope'];scopeId=json.dumps(scope,ensure_ascii=False,sort_keys=True,separators=(',',':'))
 for m in g['members']:
  r=by[m['memberId']];assert r['courseId']==scope['courseId'] and r['passageSha256']==m['passageSha256']
  assert (scopeId,m['memberId']) not in scopeMembership;scopeMembership.add((scopeId,m['memberId']))
  w=m['witness'];b=r['content'].encode();assert b[w['startUtf8']:w['endUtf8']]==w['text'].encode() and h(w['text'].encode())==w['sha256'];witnessCount+=1
 canonical=dict(scope=scope,members=sorted(m['memberId'] for m in g['members']))
 assert g['groupId']=='D3-'+h(json.dumps(canonical,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
assert len(mp['coverage']['unreviewedMembers'])==1991
# Independent-input separation: candidate map has no protected item-selection fields.
text=json.dumps(mp,ensure_ascii=False)
assert 'NBRR1-HOLD-' not in text and 'NBRR1-ADV-' not in text
assert 'databaseIdentityAuthority' not in text and 'historicalChunkIdBindingEvidence' not in text

# Open DEVELOPMENT binding only, kept out of D3 grouping inputs.
gold=[json.loads(x) for x in (REPO/'benchmarks/navigator-bounded-reasoning-rag-1/development.gold.v1.jsonl').read_text().splitlines()]
openChecks=[]
for item in gold:
 for arr in ['goldEvidence','acceptableAlternativeEvidence']:
  for n,e in enumerate(item[arr]):
   ix=e['locator'].get('chunkIndex'); candidates=[r for r in rows if r['sourceSlug']==e['sourceSlug'] and r['chunkIndex']==ix and (r['courseId']=='maslow' or r['historicalDocumentId']==e['documentId'])]
   assert len(candidates)==1,(e,len(candidates));r=candidates[0]
   for k,v in e['locator'].items():
    actual=r['chunkIndex'] if k=='chunkIndex' else r['headingPath'] if k=='headingPath' else r['locator']['primary'].get(k)
    assert actual==v,(e,k,actual,v)
   openChecks.append(dict(itemId=item['id'],goldPointer=arr+'/'+str(n),sourceSlug=e['sourceSlug'],documentId=e['documentId'],chunkId=e['chunkId'],explicitChunkIndex=ix,resolvedMemberId=r['memberId'],passageSha256=r['passageSha256'],locatorMatches=True))
assert len(openChecks)==110
write('open-evidence-resolution-validation.json',dict(kind='OPEN_DEVELOPMENT_AUTHOR_STATIC_CHECK_NOT_INDEPENDENT_IV',occurrences=110,allResolved=True,missingIdentities=[],locatorMismatches=[],protectedParsed=False,usedAsD3Input=False,checks=openChecks))

referenceCount=0
def checkArtifacts(x):
 global referenceCount
 if isinstance(x,dict):
  if 'path' in x and 'sha256' in x and str(x['path']).startswith('/'):
   p=Path(x['path']);assert p.is_file();assert h(p.read_bytes())==x['sha256'],str(p);referenceCount+=1
  for v in x.values():checkArtifacts(v)
 elif isinstance(x,list):
  for v in x:checkArtifacts(v)
for x in alljson.values():checkArtifacts(x)
sv=alljson['source-verification.json']
for m in sv['members']:assert h((REPO/m['path']).read_bytes())==m['sha256'],m['path']
def git(*a):
 r=subprocess.run(['git','--no-optional-locks','-C',str(REPO),*a],capture_output=True,text=True);assert r.returncode==0;return r.stdout.strip()
assert git('rev-parse','HEAD')==SHA and git('status','--porcelain=v1')==''
result=dict(kind='AUTHOR_BOUNDED_STATIC_VALIDATION_NOT_INDEPENDENT_IV',syntax='PASS',d4SchemaStructure='PASS_DRAFT7_COMPATIBLE_SUBSET_AND_ALL_LOCAL_REFS_RESOLVED',requiredArtifactsPresent=len(required),scoringDimensions=9,nonCompensatoryGates=9,accountingPartition='49+50+24=123;10+14=24',universeCount=1999,D3GroupProposalCount=5,D3WitnessCount=witnessCount,D3SemanticCompletion='FAIL_EXPLICITLY_INCOMPLETE',openEvidenceOccurrencesResolved=110,artifactDigestRefsChecked=referenceCount,sourceByteIdentitiesUnchanged=len(sv['members']),repositoryClean=True,head=SHA,benchmarkExecutions=0,providerCalls=0,productionContact=0,overall='STRUCTURAL_CHECKS_PASS; CONTRACT_CLOSURE_INCOMPLETE_D3; NOT_READY_FOR_EXECUTION')
write('static-validation.json',result)
print(json.dumps(result))
