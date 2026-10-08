"""Focused candidate-author self-check; never independent IV or product scoring."""
import collections, hashlib, itertools, json, re, subprocess, sys
from pathlib import Path
import importlib.util
sys.dont_write_bytecode=True
BASE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('d3_generator',BASE/'d3-generate.py')
gen=importlib.util.module_from_spec(spec);spec.loader.exec_module(gen)

def read(name):return json.loads((BASE/name).read_text())
def lines(name):return [json.loads(l) for l in (BASE/name).read_text().splitlines()]
def digest(name):return gen.sha((BASE/name).read_bytes())
def canonical(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def witness_check(w,content):
    b=content.encode(); span=b[w['startUtf8']:w['endUtf8']]
    assert span==w['text'].encode() and gen.sha(span)==w['sha256']

def synthetic_contract_checks():
    # Validator-only abstract admission counterexamples. No benchmark or scorer.
    r=read('d3-residual-coverage-reconciliation.json')['residualClassClosure']
    gi={g['kind']:g for g in r['admissionGuards']}
    assert gi['NONMATERIAL_SPAN_NO_CREDIT']['outcome']['effect']=='NO_INDEPENDENT_MATERIAL_UNIT'
    assert gi['SOURCE_TYPE_LABEL_CONFLICT']['outcome']['effect']=='FAIL_CLOSED'
    assert not gi['SOURCE_TYPE_LABEL_CONFLICT']['outcome']['groupAcrossConflict']
    assert gi['NO_WHOLE_PASSAGE_INFERENCE']['outcome']['failure']=='D3_WHOLE_PASSAGE_EQUIVALENCE_INFERRED'
    assert gi['USED_MATERIAL_BINDING_REQUIRED']['failClosedOnMissingBinding']
    assert gi['QUALIFICATION_SCOPE_REQUIRED']['outcome']['effect']=='KEEP_QUALIFIED_PROPOSITIONS_DISTINCT'
    def admit(required_bindings,provided_bindings,claimed_relevant_units):
        if not required_bindings <= provided_bindings:raise ValueError('MISSING_APPLICABILITY')
        if len(claimed_relevant_units)!=len(set(claimed_relevant_units)):raise ValueError('DUPLICATE_CREDIT')
        return True
    for args,reason in [(({'scope','used-span'},{'scope'},[]),'MISSING_APPLICABILITY'),(({'scope'},{'scope'},['same-atomic-unit','same-atomic-unit']),'DUPLICATE_CREDIT')]:
        try:admit(*args)
        except ValueError as e:assert str(e)==reason
        else:raise AssertionError('unsafe abstract admission')
    assert admit({'scope','used-span'},{'scope','used-span'},['shared-atomic-unit','distinct-outside-proposition'])
    assert len({('typed-context','same-quotation'),('typed-context','same-quotation')})==1
    assert len({('play','leadership'),('learning','external-leadership')})==2
    return 'PASS_ABSTRACT_DECLARATIVE_GUARDS_ONLY_NO_OPERATIONAL_AUTHORITY'

import collections, hashlib, itertools, json, re
HIGH_FLAGS={'WORD_JACCARD_GE_0_4','WORD_CONTAINMENT_GE_0_75','CHARACTER_JACCARD_GE_0_6'}
PROCEDURE_COUNTS={'RULE_1':1913,'RULE_1_EXCEPTIONS':45,'RULE_2':416,'NONADJACENT_SENTENCE':358,'NONADJACENT_HIGH_LEXICAL_NO_SENTENCE':23}
DISPUTED_IDS=['D3PAIR-8d7fef31298927993e0329180138c415b04159908338978c2b8fd82f61ca9b63','D3PAIR-fc597758d79a2b34e5d44be2d04098a1d3ef0cc39ddd6281d9a35e85fd46c926','D3PAIR-6ec94e2cc921ab3e130cacc499d37a87f89c5a29b74089cddfb294c84ebcf223']

def original_sentences(text):
    result=collections.defaultdict(list)
    for match in re.finditer(r'[^.!?\n]+',text):
        normalized=gen.normal(match.group())
        if len(normalized.split())>=8:
            start=match.start()+len(match.group())-len(match.group().lstrip())
            end=match.end()-(len(match.group())-len(match.group().rstrip()))
            result[normalized].append((start,end))
    return result

def byte_witness(mid,text,start,end):
    before=text[:start].encode();b=text[start:end].encode()
    return {'memberId':mid,'startUtf8':len(before),'endUtf8':len(before)+len(b),'text':text[start:end],'sha256':gen.sha(b)}

def overlap_measure(left,right,texts,byid):
    l,r=texts[left],texts[right]
    length=max((n for n in range(1,min(len(l),len(r))+1) if l[-n:]==r[:n]),default=0)
    assert 81<=length<=160,(left,right,length)
    occurrences=[byte_witness(left,l,len(l)-length,len(l)),byte_witness(right,r,0,length)]
    payload={'courseId':byid[left]['courseId'],'sourceSlug':byid[left]['sourceSlug'],'documentIdentity':byid[left]['documentIdentity'],'occurrences':[{k:w[k] for k in ['memberId','startUtf8','endUtf8','sha256']} for w in occurrences]}
    return {'sourceSpanId':'D3SPAN-'+gen.sha(canonical(payload)),'identityPayload':payload,'overlapCharacters':length,'overlapUtf8Bytes':len(l[-length:].encode()),'occurrences':occurrences,'coordinates':'UTF-8 half-open local intervals; paired source-occurrence equivalence, not invented canonical-file offsets'}

def reproduce_procedure(byid,texts,pairs,initial_unresolved):
    sentences={mid:original_sentences(text) for mid,text in texts.items()}
    rows=[];anchor_keys=set();nonadj_values=set();boundary_values=set();span_rows=[]
    for pair in pairs:
        mids=[x['memberId'] for x in pair['members']];left,right=sorted(mids,key=lambda mid:byid[mid]['chunkIndex']);a,b=byid[left],byid[right]
        adjacent=a['documentIdentity']==b['documentIdentity'] and a['sourceSlug']==b['sourceSlug'] and a['courseId']==b['courseId'] and b['chunkIndex']-a['chunkIndex']==1
        common=sorted(set(sentences[left])&set(sentences[right]));high=sorted(set(pair['features'])&HIGH_FLAGS)
        assert bool(common)==('SHARED_SUBSTANTIAL_SENTENCE' in pair['features'])
        span=overlap_measure(left,right,texts,byid) if adjacent else None
        if span:span_rows.append(dict(span,pairId=pair['pairId']))
        if pair['pairId'] not in initial_unresolved:continue
        shared=[];outside=[]
        for normalized in common:
            occurrences=[];crosses=False
            for mid in mids:
                for start,end in sentences[mid][normalized]:
                    confined=bool(span) and ((start>=len(texts[left])-span['overlapCharacters']) if mid==left else end<=span['overlapCharacters'])
                    occurrences.append(dict(byte_witness(mid,texts[mid],start,end),confinedToOverlap=confined))
                    if adjacent and not confined:crosses=True
            shared.append({'normalized':normalized,'tokenCount':len(normalized.split()),'occurrences':occurrences,'hasOutsideOccurrence':crosses})
            if crosses:outside.append(normalized)
        if adjacent:cl='RULE_1_EXCEPTIONS' if high or outside else 'RULE_1';selected=outside
        elif common:cl='NONADJACENT_SENTENCE';selected=common;nonadj_values.update(common)
        elif high:cl='NONADJACENT_HIGH_LEXICAL_NO_SENTENCE';selected=[]
        else:
            assert a['courseId']==b['courseId'] and pair['features']==['SHARED_LOCAL_WORD_SHINGLES']
            cl='RULE_2';selected=[]
        if adjacent:boundary_values.update(outside)
        anchor_keys.update((a['courseId'],n) for n in selected)
        aw=gen.normal(texts[left]).split();bw=gen.normal(texts[right]).split();shingles={tuple(aw[i:i+5]) for i in range(len(aw)-4)}&{tuple(bw[i:i+5]) for i in range(len(bw)-4)}
        rows.append({'pairId':pair['pairId'],'class':cl,'members':pair['members'],'measurements':{'sameCourse':a['courseId']==b['courseId'],'sameDocument':a['documentIdentity']==b['documentIdentity'],'adjacent':adjacent,'chunkIndices':[a['chunkIndex'],b['chunkIndex']],'highLexicalFlags':high,'generatorFeatures':pair['features'],'sharedWord5gramCount':len(shingles),'sharedWord5grams':[' '.join(x) for x in sorted(shingles)],'sharedSubstantialSentences':shared,'outsideOverlapSentenceValues':outside,'sourceSpanId':span['sourceSpanId'] if span else None,'overlapCharacters':span['overlapCharacters'] if span else None}})
    rows.sort(key=lambda x:x['pairId']);span_rows.sort(key=lambda x:x['pairId'])
    assert dict(collections.Counter(x['class'] for x in rows))==PROCEDURE_COUNTS
    assert len(rows)==len({x['pairId'] for x in rows})==2755 and {x['pairId'] for x in rows}==set(initial_unresolved)
    ri={x['pairId']:x for x in rows};assert all(ri[x]['class']=='RULE_1_EXCEPTIONS' for x in DISPUTED_IDS)
    assert len(nonadj_values)==73 and len(boundary_values-nonadj_values)==4
    return rows,span_rows,sorted(anchor_keys),sentences

def procedure_validation(byid,texts,pairs,decisions,dispositions,m):
    binding=read('d3-owner-procedure-decision-binding.json')
    assert binding['expectedPartition']==PROCEDURE_COUNTS
    rows,spans,keys,sentences=reproduce_procedure(byid,texts,pairs,set(binding['originalUnresolvedPairIds']))
    assert rows==lines('d3-procedure-partition.jsonl')
    assert spans==lines('d3-source-span-overlaps.jsonl') and len(spans)==1958
    for span in spans:
        assert span['sourceSpanId']=='D3SPAN-'+gen.sha(canonical(span['identityPayload']))
        for w in span['occurrences']:witness_check(w,texts[w['memberId']])
        assert span['occurrences'][0]['text']==span['occurrences'][1]['text']
    exclusions=lines('d3-pair-exclusion-receipts.jsonl');ex={x['pairId']:x for x in exclusions}
    expected={r['pairId']:r for r in rows if r['class'] in ['RULE_1','RULE_2']}
    assert len(ex)==len(exclusions)==2329 and set(ex)==set(expected)
    assert collections.Counter(x['reasonCode'] for x in exclusions)=={'TECHNICAL_CHUNK_OVERLAP':1913,'LOW_INFORMATION_LEXICAL_SHINGLE':416}
    di={x['pairId']:x for x in decisions}
    for pid,r in ex.items():
        content={k:v for k,v in r.items() if k!='receiptId'}
        assert r['receiptId']=='D3EXCL-'+gen.sha(canonical(content))
        assert r['measurements']==expected[pid]['measurements'] and r['members']==expected[pid]['members']
        assert r['decision']==di[pid]['decision']=='PROCEDURALLY_EXCLUDED'
        assert di[pid]['exclusionReceiptId']==r['receiptId'] and di[pid]['reasonCode']==r['reasonCode']
        assert r['semanticVerdict'] is None and not r['independentEvidenceCreditEstablished']
    anchors=lines('d3-proposition-anchor-adjudications.jsonl');observed=[];anchor_by_pair=collections.defaultdict(list)
    for a in anchors:
        ids=sorted(x['memberId'] for x in a['carriers'])
        assert ids==sorted(mid for mid in texts if byid[mid]['courseId']==a['courseId'] and a['normalizedSentence'] in sentences[mid])
        assert a['anchorId']=='D3ANCH-'+gen.sha(canonical({'courseId':a['courseId'],'normalized':a['normalizedSentence'],'members':ids}))
        assert not a['wholePassageEquivalence'] and not a['independentlyVerified'] and not a['ownerAccepted']
        observed.append((a['courseId'],a['normalizedSentence']))
        for carrier in a['carriers']:
            mid=carrier['memberId'];assert carrier['passageSha256']==byid[mid]['passageSha256']
            expected_occurrences=[byte_witness(mid,texts[mid],start,end) for start,end in sentences[mid][a['normalizedSentence']]]
            assert carrier['occurrences']==expected_occurrences
            witness_check(carrier['contextWitness'],texts[mid])
            if carrier['typeSubjectContext']:witness_check(carrier['typeSubjectContext']['headingWitness'],texts[carrier['typeSubjectContext']['headingWitness']['memberId']])
        if a['decision']=='EQUIVALENT_SCOPED':
            assert len(a['groupIds'])==1 and all(a['semanticAnalysis'][k] for k in ['materialSubject','relationPredicate','polarity','qualifications'])
            group=next(g for g in m['groups'] if g['groupId']==a['groupIds'][0]);assert sorted(x['memberId'] for x in group['members'])==ids
        elif a['decision']=='SUBJECT_SCOPED_DISTINCT':
            assert len({x['typeSubjectContext']['subject'] for x in a['carriers']})>1 and not a['groupIds']
        else:assert a['decision'] in {'NONMATERIAL_EDITORIAL','NONMATERIAL_TABLE_HEADER','BIBLIOGRAPHIC_TITLE_ONLY','NONMATERIAL_LABEL_STRIP','ATOMIC_COMPARISON_DECOMPOSITION','LOCAL_SUBJECT_SCOPED_DISTINCT','QUALIFICATION_SCOPED_DISTINCT','SOURCE_LABEL_CONFLICT'} and not a['uncertaintyReason'] and a['guardIds']
        for pid in a['residualPairIds']:anchor_by_pair[pid].append(a['anchorId'])
    assert sorted(observed)==keys and len(anchors)==85 and len({a['normalizedSentence'] for a in anchors})==77
    residual=read('d3-residual-coverage-reconciliation.json')
    assert residual['anchorDecisionCounts']==dict(collections.Counter(x['decision'] for x in anchors))
    unresolved=sorted(x['pairId'] for x in decisions if x['decision']=='UNRESOLVED')
    assert residual['unresolvedPairIds']==unresolved and not unresolved
    assert residual['unresolvedAnchorIds']==[x['anchorId'] for x in anchors if x['decision']=='UNRESOLVED']
    rr={x['pairId']:x for x in residual['exceptionPairReviews']};expected_reviews={x['pairId'] for x in rows if x['class'] in ['RULE_1_EXCEPTIONS','NONADJACENT_HIGH_LEXICAL_NO_SENTENCE']}
    assert set(rr)==expected_reviews and len(rr)==68
    for pid,r in rr.items():
        assert (r['decision']=='BOUNDED_DISPOSITION' and not r['failure'] and r['guardIds']) or r.get('historicalOnly')
        for ctx in r['materialSubjectContexts']:witness_check(ctx['contextWitness'],texts[ctx['memberId']])
    for d in dispositions:
        assert d['procedurallyExcludedPairIds']==sorted(x['pairId'] for x in decisions if x['decision']=='PROCEDURALLY_EXCLUDED' and d['memberId'] in [m['memberId'] for m in x['members']])
        assert not d['acceptedForCounting']
    assert len(read('scoring-contract.json')['dimensions'])==len(read('scoring-contract.json')['gates'])==9
    assert collections.Counter(x['authorityFamily'] for x in byid.values())=={'non-maslow-historical-ingestion-1':1408,'maslow-historical-v1/b1':554,'maslow-historical-v1/b2':37}
    def reference_check(x):
        if isinstance(x,dict):
            if isinstance(x.get('path'),str) and re.fullmatch(r'[0-9a-f]{64}',str(x.get('sha256',''))):
                target=Path(x['path']);assert target.is_file(),'REFERENCE_MISSING '+str(target)
                assert gen.sha(target.read_bytes())==x['sha256'],'REFERENCE_DIGEST_DRIFT '+str(target)
                if isinstance(x.get('bytes'),int):assert target.stat().st_size==x['bytes']
            for v in x.values():reference_check(v)
        elif isinstance(x,list):
            for v in x:reference_check(v)
    for artifact in BASE.glob('*.json'):
        # Repository-relative source inventory is verified against gen.REPO in main.
        if artifact.name!='source-verification.json':reference_check(json.loads(artifact.read_text()))
    for name,h in binding['originalArtifactDigests'].items():
        allowed={'d3-semantic-equivalence-map.candidate.json','d3-counting-contract.json','d3-pair-adjudications.jsonl','d3-dispositions.jsonl','d3-proposition-anchor-adjudications.jsonl','d3-residual-coverage-reconciliation.json','d3-validate.py','test-base-contract.json','package-identity.json','static-validation.json','REPORT.md','AUDIT.md','SHA256SUMS'}
        if name not in allowed:assert digest(name)==h,'UNAUTHORIZED_OR_HISTORICAL_MUTATION '+name
    assert digest('d3-candidate-pairs.jsonl')=='3d49600625db5fde1ebc209eaf4ccaafc4578db00ea8a6b03fc24740817ae904'
    assert digest('d3-generation-receipt.json')==binding['originalArtifactDigests']['d3-generation-receipt.json']
    forbidden={'itemId','question','goldAnswer','requiredPropositions','prohibitedPropositions','adversarialTrap','itemPropositionMapping'}
    def scan(x):
        if isinstance(x,dict):
            assert not set(x)&forbidden
            for v in x.values():scan(v)
        elif isinstance(x,list):
            for v in x:scan(v)
        elif isinstance(x,str):assert not re.search(r'NBRR1-(?:HOLDOUT|ADV|DEV)-\d+',x,re.I)
    for obj in [rows,spans,exclusions,anchors,residual]:scan(obj)
    contract=read('d3-counting-contract.json');assert contract['zeroSilentFallback'] and not contract['applicabilityInterface']['bindingCreatedHere']
    assert contract['formula']['score']=='numerator/denominator when denominator>0; exact rational counts preserved.'
    assert all(k in contract['applicabilityInterface']['failures'] for k in ['D3_EXCLUDED_PAIR_APPLICABILITY_UNRESOLVED','D3_SOURCE_SPAN_INDEPENDENCE_UNRESOLVED','D3_USED_SPAN_BINDING_MISSING','D3_ACCEPTED_AUTHORITY_CONFLICT'])
    # Abstract counterexamples validate contract admission constraints only, not a scorer.
    same_span=('SPAN','atomic-A');assert len({same_span,same_span})==1
    distinct_proposition=('SPAN','atomic-B');assert len({same_span,distinct_proposition})==2
    outside=('OUTSIDE','atomic-C');assert len({same_span,outside})==2
    def admit(span_present,binding_present,independent_relevant_contributions):
        if not binding_present:raise ValueError('D3_USED_SPAN_BINDING_MISSING')
        if span_present and len(independent_relevant_contributions)!=len(set(independent_relevant_contributions)):raise ValueError('D3_SOURCE_SPAN_INDEPENDENCE_UNRESOLVED')
        return True
    for args,expected_error in [((True,False,[same_span]),'D3_USED_SPAN_BINDING_MISSING'),((True,True,[same_span,same_span]),'D3_SOURCE_SPAN_INDEPENDENCE_UNRESOLVED')]:
        try:admit(*args)
        except ValueError as error:assert str(error)==expected_error
        else:raise AssertionError('unsafe span admission')
    assert admit(True,True,[same_span,outside]) and admit(True,True,[same_span,distinct_proposition])
    return {'partitionReproduced':'PASS','partitionCounts':PROCEDURE_COUNTS,'excludedPairs':2329,'originalPairs':3276,'overlapSpanRecords':1958,'disputedPairMembership':'PASS_ALL_THREE_CANONICAL_IDS','normalizedAnchorValues':77,'courseScopedAnchorCases':85,'anchorDecisionCounts':residual['anchorDecisionCounts'],'unresolvedPairs':0,'unresolvedAnchorCases':len(residual['unresolvedAnchorIds']),'countingAdmissionCounterexamples':'PASS_ABSTRACT_CONTRACT_ONLY','historicalInputsUnchanged':'PASS','blindness':'PASS_CORPUS_ONLY_STRUCTURAL_CHECK_NOT_PROOF_OF_SEMANTIC_COMPLETENESS','semanticClosure':'PASS_BOUNDED_CANDIDATE_GUARDS','verdict':'D3_RESIDUAL_CLASS_CLOSURE_CANDIDATE_PENDING_INDEPENDENT_IV'}

def stored_passage_witnesses(byid):
    # Reuse existing physical witnesses; never rerun generation or all-pairs discovery.
    texts={}
    for d in lines('d3-pair-adjudications.jsonl'):
        for w in d['witnesses']:
            if w['startUtf8']==0 and w['sha256']==byid[w['memberId']]['passageSha256']:
                assert w['endUtf8']==byid[w['memberId']]['passageUtf8Bytes']
                if w['memberId'] in texts:assert texts[w['memberId']]==w['text']
                texts[w['memberId']]=w['text']
    assert len(texts)==1997
    # The two already-authorized isolated B2 identities have no pair witnesses.
    # Read their bound passage bytes only; no B1/B2 recovery or evidence search.
    for mid,row in byid.items():
        if mid not in texts:
            assert row['authorityFamily']=='maslow-historical-v1/b2'
            texts[mid]=Path(row['physicalLocator']['passagePath']).read_bytes().decode()
        b=texts[mid].encode();assert gen.sha(b)==row['passageSha256'] and len(b)==row['passageUtf8Bytes']
    return texts

def residual_class_validation(byid,texts,pairs,decisions,ds,m):
    r=read('d3-residual-coverage-reconciliation.json');c=r['residualClassClosure'];anchors=lines('d3-proposition-anchor-adjudications.jsonl');ai={a['anchorId']:a for a in anchors};di={d['pairId']:d for d in decisions}
    required={'NONMATERIAL_EDITORIAL':[0,6,28,32,42,63],'NONMATERIAL_TABLE_HEADER':[36,75],'BIBLIOGRAPHIC_TITLE_ONLY':[19,33,40],'NONMATERIAL_LABEL_STRIP':[2,5,7,8,9],'ATOMIC_COMPARISON_DECOMPOSITION':[30,45,59],'LOCAL_SUBJECT_SCOPED_DISTINCT':[25,68,69,70,71,72,73,74],'EQUIVALENT_SCOPED':[11,23,24,26,34,35,38,39,43],'QUALIFICATION_SCOPED_DISTINCT':[47],'SOURCE_LABEL_CONFLICT':[37,50,54,66,82]}
    assert required==c['anchorClassificationIndices']
    ixclass={i:cl for cl,ixs in required.items() for i in ixs}
    oldanchors=set(c['initialUnresolvedAnchorIds']);oldpairs=set(c['initialUnresolvedPairIds']);assert len(oldanchors)==42 and len(oldpairs)==426
    assert {a['catalogueIndex'] for a in anchors if a['anchorId'] in oldanchors}==set(ixclass)
    guards=c['admissionGuards'];gi={g['guardId']:g for g in guards};assert len(gi)==len(guards)
    assert read('d3-counting-contract.json')['residualClassAdmission']['guardIds']==[g['guardId'] for g in guards]
    # Guard data is sufficient to evaluate an exact ID/span trigger and a fail-closed outcome.
    for g in guards:
        assert g['guardId']=='D3GUARD-'+gen.sha(canonical({k:v for k,v in g.items() if k!='guardId'}))
        assert g['recordIds'] and g['trigger']['operator'] and g['outcome']['effect'] and g['traceRequired']
        assert g['failClosedOnMissingBinding'] and not g['wholePassageEquivalence']
        for w in g['occurrences']:witness_check(w,texts[w['memberId']])
    physical_checks=0;local_checks=0
    adapted=None
    def physical_check(w):
        nonlocal physical_checks,adapted
        witness_check(w,texts[w['memberId']]);row=byid[w['memberId']];loc=row['physicalLocator'];target=Path(loc.get('passagePath',loc.get('canonicalPath')));b=target.read_bytes()
        assert gen.sha(b)==(row['passageSha256'] if loc.get('passagePath') else row['documentIdentity'])
        if w['text'].encode() not in b:
            # Full contexts may join adapter blocks. Reproduce only affected bound passages.
            if adapted is None:
                import tempfile
                mids={carrier['memberId'] for a in anchors if a['anchorId'] in oldanchors for carrier in a['carriers']}
                script=(BASE/'d3-materialize.mts').read_text()
                script=script.replace("const base = new URL('.', import.meta.url);", 'const base = new URL('+json.dumps(BASE.as_uri()+'/')+');')
                script=script.replace("const pinned =", 'rows.splice(0, rows.length, ...rows.filter((r: any) => '+json.dumps(sorted(mids))+'.includes(r.memberId)));\nconst pinned =')
                with tempfile.TemporaryDirectory(prefix='d3-targeted-') as scratch:
                    f=Path(scratch)/'targeted.mts';f.write_text(script)
                    raw=subprocess.check_output([gen.NODE,'--import',str(gen.REPO/'node_modules/tsx/dist/loader.mjs'),str(f)],env={'PATH':'/usr/bin:/bin','TSX_DISABLE_CACHE':'1','TSX_TSCONFIG_PATH':str(gen.REPO/'tsconfig.json')})
                adapted={x['memberId']:x['content'] for x in json.loads(raw)}
                assert set(adapted)==mids
                assert all(adapted[mid]==texts[mid] for mid in mids),'TARGETED_ADAPTER_WITNESS_DRIFT'
            assert w['memberId'] in adapted
            witness_check(w,adapted[w['memberId']])
        physical_checks+=1
    for a in anchors:
        if a['anchorId'] not in oldanchors:continue
        assert a['decision']==ixclass[a['catalogueIndex']] and a['previousDecision']=='UNRESOLVED'
        assert a['guardIds'] and set(a['guardIds'])<=set(gi)
        for carrier in a['carriers']:
            for w in carrier['occurrences']:physical_check(w)
        cl=a['decision']
        if cl in ['NONMATERIAL_EDITORIAL','NONMATERIAL_TABLE_HEADER','BIBLIOGRAPHIC_TITLE_ONLY','NONMATERIAL_LABEL_STRIP']:
            assert not a['groupIds'] and a['countingDisposition']['sharedSpan']=='NO_INDEPENDENT_MATERIAL_UNIT'
            assert a['countingDisposition']['carrierPassagesRemainInUniverse'] and a['countingDisposition']['CAndRMembership']=='UNCHANGED'
        elif cl=='ATOMIC_COMPARISON_DECOMPOSITION':
            assert len(a['atomicCells'])==len(a['groupIds'])==2
            assert len({cell['subject'] for cell in a['atomicCells']})==2
            for cell in a['atomicCells']:
                assert cell['groupId'] in a['groupIds']
                for w in cell['occurrences']:physical_check(w)
        elif cl=='LOCAL_SUBJECT_SCOPED_DISTINCT':
            assert not a['groupIds'] and len(a['localSubjectBindings'])==len(a['carriers'])
            subjects=[]
            for binding in a['localSubjectBindings']:
                if binding['headingWitness']:physical_check(binding['headingWitness'])
                physical_check(binding['completionWitness']);subjects.append(binding['subject']);local_checks+=1
                if binding['memberId'].endswith('/239'):assert binding['subject']=='ENFP'
                if binding['memberId'].endswith('/52'):assert binding['subject']=='UNKNOWN'
            assert len(set(subjects))>1
        elif cl=='QUALIFICATION_SCOPED_DISTINCT':
            assert not a['groupIds'] and {x['qualification'] for x in a['qualifiedPropositions']}=={'PHYSICAL_OBJECTS_ONLY','PRINCIPLES_DIFFERENCES_NUANCES'}
            for qp in a['qualifiedPropositions']:
                physical_check(qp['qualificationWitness'])
                if qp['memberId'].endswith('/52'):assert qp['subject']=='UNKNOWN' and not qp['typeInferencePermitted']
        elif cl=='SOURCE_LABEL_CONFLICT':
            conflict=a['sourceLabelConflict'];assert not a['groupIds'] and conflict['unrepaired'] and not conflict['groupAcrossConflictPermitted']
            hw=conflict['localHeadingWitnesses'];cw=conflict['contradictoryAttributionWitnesses']
            assert any(w['text']=='### ENFP' for w in hw) and any('типе ENTP' in w['text'] and w['memberId'].endswith('/238') for w in cw)
            for w in hw+cw:physical_check(w)
    struct=set(sum([required[k] for k in ['NONMATERIAL_EDITORIAL','NONMATERIAL_TABLE_HEADER','BIBLIOGRAPHIC_TITLE_ONLY']],[]));templ=set(required['LOCAL_SUBJECT_SCOPED_DISTINCT']);lists_=set(required['NONMATERIAL_LABEL_STRIP']+required['ATOMIC_COMPARISON_DECOMPOSITION']);atom=set(required['EQUIVALENT_SCOPED']+required['QUALIFICATION_SCOPED_DISTINCT']+required['SOURCE_LABEL_CONFLICT'])
    membership=c['pairClassMembership'];mi={x['pairId']:x for x in membership};assert len(mi)==len(membership)==426 and set(mi)==oldpairs
    proc={p['pairId']:p for p in lines('d3-procedure-partition.jsonl')};spans={p['pairId']:p for p in lines('d3-source-span-overlaps.jsonl')}
    no_sentence=collections.Counter();nick_ids=collections.defaultdict(list)
    for pid in oldpairs:
        d=di[pid];assert d['decision']=='BOUNDED_DISPOSITION' and d['previousDecision']=='UNRESOLVED' and d['semanticVerdict'] is None
        assert not d['wholePassageEquivalence'] and d['guardIds'] and set(d['guardIds'])<=set(gi)
        assert d['boundedDisposition']['guardIds']==d['guardIds'] and not d['boundedDisposition']['independentCreditEstablished']
        anchor_ids=d['anchorAdjudicationIds'];ixs={ai[i]['catalogueIndex'] for i in anchor_ids if i in oldanchors}
        expected='NO_SHARED_SUBSTANTIAL_SENTENCE' if not anchor_ids else 'ALREADY_RESOLVED_PROPOSITION_SCOPE' if not ixs else 'TYPE_LEVEL_TEMPLATE' if ixs&templ else 'LIST_COMPARISON' if ixs&lists_ else 'ATOMIC_CONFLICT_SPAN' if ixs&atom else 'STRUCTURAL_SPAN_ONLY' if ixs<=struct else None
        assert expected and expected==mi[pid]['class']==d['residualClass']==d['boundedDisposition']['class']
        assert mi[pid]['anchorIds']==anchor_ids and mi[pid]['previouslyUnresolvedCatalogueIndices']==sorted(ixs)
        assert any(gi[g]['kind']=='NO_WHOLE_PASSAGE_INFERENCE' for g in d['guardIds'])
        if expected=='NO_SHARED_SUBSTANTIAL_SENTENCE':
            p=proc[pid];assert d['procedureClassPreserved']==p['class'];no_sentence[p['class']]+=1
            if p['class']=='RULE_1_EXCEPTIONS':
                assert not p['measurements']['outsideOverlapSentenceValues'] and d['sourceSpanId']==spans[pid]['sourceSpanId']
                assert any(gi[g]['kind']=='ADJACENT_SOURCE_SPAN_ONCE' for g in d['guardIds'])
            else:
                assert p['class']=='NONADJACENT_HIGH_LEXICAL_NO_SENTENCE' and d['nicknameRecords']
                assert any(gi[g]['kind']=='TYPE_QUALIFIED_NICKNAME_ONCE' for g in d['guardIds'])
                for nr in d['nicknameRecords']:
                    assert nr['nicknameId']=='D3NICK-'+gen.sha(canonical(nr['identityPayload']));physical_check(nr['witness']);nick_ids[nr['nicknameId']].append(nr['witness'])
        # Every anchor guard on this pair is directly bound, including mixed structural/type cases.
        assert {g for aid in anchor_ids for g in ai[aid].get('guardIds',[])}<=set(d['guardIds'])
    assert no_sentence=={'RULE_1_EXCEPTIONS':27,'NONADJACENT_HIGH_LEXICAL_NO_SENTENCE':23}
    observed=dict(collections.Counter(x['class'] for x in membership));assert observed==c['pairClassCounts'] and sum(observed.values())==426
    assert observed=={'STRUCTURAL_SPAN_ONLY':250,'TYPE_LEVEL_TEMPLATE':62,'NO_SHARED_SUBSTANTIAL_SENTENCE':50,'ALREADY_RESOLVED_PROPOSITION_SCOPE':22,'LIST_COMPARISON':23,'ATOMIC_CONFLICT_SPAN':19}
    # Author reproduces evidence membership and flags the 65/16 advisory aggregate discrepancy.
    assert c['reviewerComparison']['reportedPairCounts']['TYPE_LEVEL_TEMPLATE']==65
    assert 'challenged' in c['reviewerComparison']['authorReproduction']
    assert c['anchorClassCounts']=={cl:len(ixs) for cl,ixs in required.items()}
    for n,key in [('d3-pair-adjudications.jsonl','historicalAdjudicationLineSha256'),('d3-proposition-anchor-adjudications.jsonl','historicalAnchorLineSha256')]:
        idfield='pairId' if 'pair-' in n else 'anchorId';raw={json.loads(b)[idfield]:gen.sha(b) for b in (BASE/n).read_bytes().splitlines()}
        assert all(raw[i]==h for i,h in c[key].items()),'HISTORICAL_RECORD_BYTES_MUTATED'
    group_index={g['groupId']:g for g in m['groups']}
    assert len(c['originalGroupsCanonicalSha256'])==32
    for gid,h in c['originalGroupsCanonicalSha256'].items():assert gen.sha(canonical(group_index[gid]))==h
    assert len(c['newGroupIds'])==15 and len(group_index)==47
    conflict_mids={w['memberId'] for a in anchors if a['decision']=='SOURCE_LABEL_CONFLICT' for carrier in a['carriers'] for w in carrier['occurrences']}
    for gid in c['newGroupIds']:
        g=group_index[gid];scope=g['countingScope'];assert scope['corpusTargetId'] in oldanchors
        # No Ne group is made across the ENFP/ENTP attribution conflict.
        if scope['corpusTargetId'] in {a['anchorId'] for a in anchors if a['decision']=='SOURCE_LABEL_CONFLICT'}:raise AssertionError('GROUP_ACROSS_SOURCE_LABEL_CONFLICT')
        assert not (len(set(x['memberId'] for x in g['members'])&conflict_mids)>1 and 'Ne' in scope['materialSubject'])
        for member in g['members']:physical_check(member['witness'])
    assert sum(x['state'] is None for x in ds)==1964==c['unclosedPassageIdentityCount']
    assert all(x['state']==c['originalPassageStates'][x['memberId']] for x in ds)
    assert all(set(x.get('residualClosure',{}).get('guardIds',[]))<=set(gi) for x in ds)
    changed={'d3-proposition-anchor-adjudications.jsonl','d3-pair-adjudications.jsonl','d3-dispositions.jsonl','d3-residual-coverage-reconciliation.json','d3-semantic-equivalence-map.candidate.json','d3-counting-contract.json','d3-validate.py','package-identity.json','static-validation.json','REPORT.md','AUDIT.md','SHA256SUMS','test-base-contract.json'}
    for n,h in c['initialArtifactDigests'].items():
        if n not in changed:assert digest(n)==h,'OUT_OF_SCOPE_MUTATION '+n
    for source,h in c['physicalSourceDigests'].items():assert gen.sha(Path(source).read_bytes())==h
    contract=read('d3-counting-contract.json')
    assert contract['status']=='CANDIDATE_NOT_OWNER_ACCEPTED' and not contract['ownerAccepted'] and not contract['independentlyVerified']
    admission=contract['residualClassAdmission'];assert admission['metric']=='|unitKeys(R)| / |unitKeys(C)|'
    assert not admission['CAndRPredicatesChanged'] and not admission['runnerOrScorerImplemented'] and not admission['schemaMechanicsPromotedToAuthority']
    assert 'remain candidate interpretations' in contract['authorityPrecedence']['authored']
    assert not m['ownerAccepted'] and not m['independentlyVerified'] and not m['consumableForFinalBlindRun']
    assert not m['coverage']['wholePassagePartitionComplete']
    assert not r['unresolvedPairIds'] and not r['unresolvedAnchorIds']
    return {'all426BoundedAnd42AnchorsClosed':True,'anchorClassCounts':c['anchorClassCounts'],'pairClassCounts':observed,'reviewerPairAggregate':'CHALLENGED_62_19_VERSUS_65_16_NO_FORCED_MEMBERSHIP','physicalOccurrenceAndContextChecks':physical_checks,'localSubjectBindingsChecked':local_checks,'noSentenceSubclassCounts':dict(no_sentence),'admissionGuards':len(guards),'newGroups':15,'totalGroups':47,'historicalPairAndAnchorBytes':'PASS_EXACT','historicalGroups':'PASS_ALL32_UNCHANGED','unchangedPassageStates':'1964 UNCLOSED +33 GROUPED +2 PROCEDURALLY_DISTINCT','nicknameClaims':len(nick_ids),'countingAuthority':'CANDIDATE_ONLY_NOT_OWNER_ACCEPTED','wholePassageOntologyClaimed':False,'strictCompleteness':'PASS_BOUNDED_DISPOSITIONS_AND_FAIL_CLOSED_GUARDS'}

def main():
    u=lines('authorized-evidence-universe.jsonl');byid={x['memberId']:x for x in u}
    assert len(u)==len(byid)==1999 and digest('authorized-evidence-universe.jsonl')==gen.UNIVERSE_HASH
    texts=stored_passage_witnesses(byid)
    closure_snapshot=read('d3-residual-coverage-reconciliation.json')['residualClassClosure']
    pairs=lines('d3-candidate-pairs.jsonl');decisions=lines('d3-pair-adjudications.jsonl');ds=lines('d3-dispositions.jsonl');m=read('d3-semantic-equivalence-map.candidate.json');receipt=read('d3-generation-receipt.json')
    assert receipt['participants']==1999 and receipt['allUnorderedPairsCompared']==1997001
    assert receipt['candidatePairs']==len(pairs) and receipt['candidatePairsSha256']==digest('d3-candidate-pairs.jsonl')
    pi={x['pairId']:x for x in pairs};di={x['pairId']:x for x in decisions}
    assert len(pi)==len(pairs) and len(di)==len(decisions) and set(pi)==set(di)
    for pid,d in di.items():
        assert d['members']==pi[pid]['members']
        assert d['decision'] in ['EQUIVALENT','NOT_EQUIVALENT','UNRESOLVED','PROCEDURALLY_EXCLUDED','BOUNDED_DISPOSITION']
        content={k:v for k,v in d.items() if k!='adjudicationId'}
        assert d['adjudicationId']=='D3ADJ-'+gen.sha(gen.encode(content))
        for member in d['members']:assert byid[member['memberId']]['passageSha256']==member['passageSha256']
        for w in d['witnesses']:witness_check(w,texts[w['memberId']])
        assert d['rationale'] and d['propositionScope'] and d['contextualRestrictions']
    gi={g['groupId']:g for g in m['groups']};assert len(gi)==len(m['groups'])
    group_by_member=collections.defaultdict(set)
    for g in m['groups']:
        assert g['countingWeight']==1 and not g['independentlyVerified'] and not g['ownerAccepted']
        scope=g['countingScope'];ids=sorted(x['memberId'] for x in g['members'])
        assert g['groupId']=='D3-'+gen.sha(canonical({'scope':scope,'members':ids}))
        assert len(ids)==len(set(ids))>=2
        for member in g['members']:
            mid=member['memberId'];assert byid[mid]['courseId']==scope['courseId']
            assert member['passageSha256']==byid[mid]['passageSha256']
            witness_check(member['witness'],texts[mid]);group_by_member[mid].add(g['groupId'])
        for a,b in itertools.combinations(ids,2):
            matches=[d for d in decisions if [x['memberId'] for x in d['members']]==[a,b]]
            assert len(matches)==1
            if g['groupId'] not in closure_snapshot['newGroupIds']:
                assert g['groupId'] in matches[0].get('equivalentGroupIds',[])
            else:
                # Newly scoped groups are proved by direct witnesses, not an inferred graph edge.
                assert matches[0]['decision'] in ['BOUNDED_DISPOSITION','PROCEDURALLY_EXCLUDED','EQUIVALENT','NOT_EQUIVALENT']
    assert len(ds)==1999 and len({x['memberId'] for x in ds})==1999 and {x['memberId'] for x in ds}==set(byid)
    partners=collections.defaultdict(list)
    for d in decisions:
        for r in d['members']:partners[r['memberId']].append(d)
    for d in ds:
        mid=d['memberId'];ps=partners[mid]
        assert d['passageSha256']==byid[mid]['passageSha256']
        assert set(d['groupIds'])==group_by_member[mid]
        assert d['candidatePairIds']==sorted(p['pairId'] for p in ps)
        assert d['unresolvedPairIds']==sorted(p['pairId'] for p in ps if p['decision']=='UNRESOLVED')
        if d['state']=='GROUPED':assert d['groupIds']
        elif d['state']=='ADJUDICATED_DISTINCT':assert ps and all(p['decision']=='NOT_EQUIVALENT' for p in ps)
        elif d['state']=='PROCEDURALLY_DISTINCT':assert not ps
        else:assert d['state'] is None
        assert d['state']==closure_snapshot['originalPassageStates'][mid]
    known=read('d3-generation-seeds.json')['knownPairs']
    assert all(tuple(p['members']) in {tuple(x['memberId'] for x in d['members']) for d in decisions} for p in known)
    forbidden={'itemId','question','goldAnswer','requiredPropositions','prohibitedPropositions','adversarialTrap','itemPropositionMapping'}
    def blind(x):
        if isinstance(x,dict):
            assert not (set(x)&forbidden)
            for v in x.values():blind(v)
        elif isinstance(x,list):
            for v in x:blind(v)
        elif isinstance(x,str):assert not re.search(r'NBRR1-(?:HOLDOUT|ADV|DEV)-\d+',x,re.I)
    for obj in [m,pairs,decisions,ds,read('d3-generation-seeds.json')]:blind(obj)
    contract=read('d3-counting-contract.json')
    assert contract['zeroSilentFallback'] and not contract['applicabilityInterface']['bindingCreatedHere']
    assert contract['candidateMap']['sha256']==digest('d3-semantic-equivalence-map.candidate.json')
    assert read('test-base-contract.json')['d3']['candidate']['sha256']==digest('d3-semantic-equivalence-map.candidate.json')
    for f,h in read('package-identity.json')['contractDigests'].items():assert digest(f)==h
    for f,h in read('package-identity.json')['d3ArtifactDigests'].items():assert digest(f)==h
    sv=read('source-verification.json');repo=gen.REPO
    assert all(gen.sha((repo/x['path']).read_bytes())==x['sha256'] for x in sv['members'])
    manifest=json.loads((repo/'benchmarks/navigator-bounded-reasoning-rag-1/manifest.v1.json').read_bytes())
    inputs=[]
    for value in manifest['benchmarkContentIdentityInputs']:
        f,h=value.split(':');observed=gen.sha((repo/'benchmarks/navigator-bounded-reasoning-rag-1'/f).read_bytes());assert observed==h;inputs.append(f+':'+observed)
    bid=gen.sha(('\n'.join(inputs)+'\n').encode());assert bid==sv['benchmarkIdentity']
    assert subprocess.check_output(['git','--no-optional-locks','-C',str(repo),'rev-parse','HEAD'],text=True).strip()==sv['head']
    assert not subprocess.check_output(['git','--no-optional-locks','-C',str(repo),'status','--porcelain'],text=True).strip()
    old=read('static-validation.json').get('preCorrectionArtifactDigests',{})
    allowed={'d3-semantic-equivalence-map.candidate.json','d3-counting-contract.json','d3-pair-adjudications.jsonl','d3-dispositions.jsonl','d3-proposition-anchor-adjudications.jsonl','d3-residual-coverage-reconciliation.json','d3-validate.py','test-base-contract.json','package-identity.json','REPORT.md','AUDIT.md','SHA256SUMS','static-validation.json'}
    for f,h in old.items():
        if f not in allowed:assert digest(f)==h, 'UNAUTHORIZED_CANDIDATE_MUTATION '+f
    procedure_result=procedure_validation(byid,texts,pairs,decisions,ds,m)
    pair_counts=dict(collections.Counter(d['decision'] for d in decisions))
    state_counts=dict(collections.Counter(d['state'] or 'UNRESOLVED_IDENTITY' for d in ds))
    unresolved=pair_counts.get('UNRESOLVED',0)
    closure_result=residual_class_validation(byid,texts,pairs,decisions,ds,m)
    complete=unresolved==0 and closure_result['all426BoundedAnd42AnchorsClosed']
    assert m['D3MapComplete']==complete
    result={'kind':'AUTHOR_FOCUSED_VALIDATION_NOT_INDEPENDENT_IV','structuralIntegrity':'PASS','witnesses':'PASS_PHYSICAL_BYTES_AND_HASHES','blindness':'PASS_CORPUS_ONLY_STRUCTURAL_SCAN_NO_PROTECTED_INPUTS','countingSpecificationExamples':synthetic_contract_checks(),'privilegedApplicabilityBinding':'NOT_CREATED_FUTURE_ACCEPTANCE_BOUNDARY','candidatePairs':len(pairs),'pairDecisionCounts':pair_counts,'groups':len(gi),'dispositionCounts':state_counts,'unresolvedCandidateIdentities':sum(bool(x['unresolvedPairIds']) for x in ds),'unreviewedIdentityRows':state_counts.get('UNRESOLVED_IDENTITY',0),'universeCount':1999,'universeSha256':gen.UNIVERSE_HASH,'benchmarkIdentity':bid,'scoringDimensions':len(read('scoring-contract.json')['dimensions']),'nonCompensatoryGates':len(read('scoring-contract.json')['gates']),'sourceIdentitiesUnchanged':len(sv['members']),'repositoryClean':True,'D3MapComplete':complete,'semanticClosure':'PASS_CANDIDATE_ONLY' if complete else 'FAIL_UNRESOLVED_CANDIDATE_ADJUDICATIONS','verdict':'D3_RESIDUAL_CLASS_CLOSURE_CANDIDATE_PENDING_INDEPENDENT_IV' if complete else 'BLOCKED_D3_RESIDUAL_SEMANTIC_APPLICABILITY','counters':{'BENCHMARK_EXECUTIONS':0,'PROVIDER_CALLS':0,'PRODUCTION_CONTACT':0,'PRODUCT_SOURCE_CHANGES':0,'BENCHMARK_MUTATIONS':0,'GIT_MUTATIONS':0}}
    result['D3ProcedureImplementation']=procedure_result
    result['D3ResidualClassClosure']=closure_result
    result['counters']['PRODUCT_SOURCE_MUTATIONS']=result['counters'].pop('PRODUCT_SOURCE_CHANGES')
    if '--write' in sys.argv:
        prior=read('static-validation.json');prior['D3ResidualClassClosure']=result;(BASE/'static-validation.json').write_text(json.dumps(prior,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False,indent=2))
    if '--require-complete' in sys.argv and not complete:sys.exit(2)

if __name__=='__main__':main()
