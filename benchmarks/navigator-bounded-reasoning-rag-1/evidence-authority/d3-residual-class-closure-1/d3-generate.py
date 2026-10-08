"""Deterministic corpus-only candidate generation; similarity never adjudicates."""
from pathlib import Path
import collections, hashlib, itertools, json, re, subprocess, sys, unicodedata

BASE = Path(__file__).resolve().parent
REPO = Path('/Users/entp_psyche/Desktop/InvestProjects2026/structural-typology-navigator-main-reconciliation-1')
NODE = '/Users/entp_psyche/.nvm/versions/node/v22.23.2/bin/node'
UNIVERSE_HASH = '0715ed576d0b4d514437138b190f54a4aaec5f58f6b70969cc7a88efd80f719e'
PARAMETERS = {
    'normalization': 'NFKC, casefold, ё->е, Unicode dash->space, punctuation->space, collapse whitespace; original passage bytes never modified',
    'spellingVariantFeature': 'character 5-grams over normalized text; no unbounded spell correction',
    'wordJaccard': [2,5], 'wordContainment': [3,4], 'minimumWordIntersection': 12,
    'characterJaccard': [3,5], 'minimumCharacterIntersection': 100,
    'sharedWord5grams': 3, 'sharedSentenceMinimumTokens': 8,
    'documentTwinLineJaccard': [4,5], 'substantialLineMinimumTokens': 8,
    'ordering': 'Unicode memberId order; unordered pairs lexicographic; feature names sorted; no nearest-neighbor truncation',
    'coverageRationale': 'Multiple independent recall channels: full duplicates; spelling/format variants; moderate vocabulary similarity; high containment; repeated sentences and local shingles for partial overlaps, templates and table rows. Compare all courses/documents. Twin documents add all aligned chunk indices. Prior 14 pairs and five proposition-group cliques retained irrespective of threshold.',
    'limitations': 'Lexical recall is finite: unrelated wording, translation, distant paraphrase, short claims under eight tokens and repeated propositions with no retained surface may escape. Candidate completeness is procedure-relative, never proof of absence. Shared windows may be chunk overlap or template text, requiring contextual adjudication.'
}

def sha(b): return hashlib.sha256(b).hexdigest()
def encode(x): return (json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()
def normal(s):
    s=unicodedata.normalize('NFKC',s).casefold().replace('ё','е')
    return ' '.join(re.findall(r'[^\W_]+',s,flags=re.UNICODE))
def materialize():
    env={'PATH':'/usr/bin:/bin','TSX_DISABLE_CACHE':'1','TSX_TSCONFIG_PATH':str(REPO/'tsconfig.json')}
    r=subprocess.run([NODE,'--import',str(REPO/'node_modules/tsx/dist/loader.mjs'),str(BASE/'d3-materialize.mts')],env=env,capture_output=True,check=True)
    return {x['memberId']:x['content'] for x in json.loads(r.stdout)}
def generate():
    ub=(BASE/'authorized-evidence-universe.jsonl').read_bytes()
    assert sha(ub)==UNIVERSE_HASH
    rows=sorted([json.loads(l) for l in ub.splitlines()],key=lambda x:x['memberId'])
    texts=materialize()
    assert len(rows)==len(texts)==1999 and set(texts)=={x['memberId'] for x in rows}
    for r in rows: assert sha(texts[r['memberId']].encode())==r['passageSha256']
    features=[]
    sentence_index=collections.defaultdict(list)
    shingle_index=collections.defaultdict(list)
    for i,r in enumerate(rows):
        s=texts[r['memberId']]; n=normal(s); words=n.split()
        sentences={normal(t) for t in re.split(r'[.!?\n]+',s) if len(normal(t).split())>=8}
        shingles={tuple(words[j:j+5]) for j in range(len(words)-4)}
        features.append((n,set(words),{n[j:j+5] for j in range(len(n)-4)}))
        for t in sorted(sentences):sentence_index[t].append(i)
        for t in sorted(shingles):shingle_index[t].append(i)
    reasons=collections.defaultdict(set)
    for ids in sentence_index.values():
        for a,c in itertools.combinations(ids,2):reasons[a,c].add('SHARED_SUBSTANTIAL_SENTENCE')
    shared=collections.Counter()
    for ids in shingle_index.values():
        shared.update(itertools.combinations(ids,2))
    for k,v in shared.items():
        if v>=PARAMETERS['sharedWord5grams']:reasons[k].add('SHARED_LOCAL_WORD_SHINGLES')
    for a,c in itertools.combinations(range(len(rows)),2):
        n,w,ch=features[a]; nn,ww,cc=features[c]
        if rows[a]['passageSha256']==rows[c]['passageSha256']:reasons[a,c].add('EXACT_PASSAGE_DUPLICATE')
        if n==nn:reasons[a,c].add('NORMALIZED_PASSAGE_DUPLICATE')
        inter=len(w&ww); union=len(w|ww); smaller=min(len(w),len(ww))
        if inter>=12 and inter*5>=union*2:reasons[a,c].add('WORD_JACCARD_GE_0_4')
        if inter>=12 and inter*4>=smaller*3:reasons[a,c].add('WORD_CONTAINMENT_GE_0_75')
        ci=len(ch&cc); cu=len(ch|cc)
        if ci>=100 and ci*5>=cu*3:reasons[a,c].add('CHARACTER_JACCARD_GE_0_6')
    docs=collections.defaultdict(list)
    for i,r in enumerate(rows):docs[r['documentIdentity']].append(i)
    lines={d:{normal(line) for i in ids for line in texts[rows[i]['memberId']].splitlines() if len(normal(line).split())>=8} for d,ids in docs.items()}
    twins=[]
    for a,c in itertools.combinations(sorted(docs),2):
        x,y=lines[a],lines[c]; inter=len(x&y); union=len(x|y)
        if union and inter*5>=union*4:
            twins.append({'documents':[a,c],'sharedSubstantialLines':inter,'unionSubstantialLines':union})
            ai={rows[i]['chunkIndex']:i for i in docs[a]}; ci={rows[i]['chunkIndex']:i for i in docs[c]}
            for ix in sorted(ai.keys()&ci.keys()):reasons[tuple(sorted((ai[ix],ci[ix])))].add('DOCUMENT_TWIN_ALIGNED_INDEX')
    seeds=json.loads((BASE/'d3-generation-seeds.json').read_text())
    byid={r['memberId']:i for i,r in enumerate(rows)}
    for p in seeds['knownPairs']:
        reasons[tuple(sorted(byid[x] for x in p['members']))].add('KNOWN_EXPLORATORY_PAIR')
    for g in seeds['groups']:
        for a,c in itertools.combinations(sorted(byid[m['memberId']] for m in g['members']),2):reasons[a,c].add('PRIOR_PROPOSITION_GROUP_PAIR')
    pairs=[]
    for (a,c),why in sorted(reasons.items()):
        members=[{'memberId':rows[i]['memberId'],'passageSha256':rows[i]['passageSha256']} for i in (a,c)]
        pairs.append({'pairId':'D3PAIR-'+sha(encode(members)),'members':members,'features':sorted(why)})
    pb=b''.join(encode(p) for p in pairs)
    procedure={'parameters':PARAMETERS,'generatorSha256':sha(Path(__file__).read_bytes()),'materializerSha256':sha((BASE/'d3-materialize.mts').read_bytes()),'seedSha256':sha((BASE/'d3-generation-seeds.json').read_bytes())}
    receipt={'kind':'OFFLINE_GENERATION_RECEIPT_NOT_SEMANTIC_ACCEPTANCE','procedure':procedure,'procedureId':'D3PROC-'+sha(encode(procedure)),'universeSha256':sha(ub),'participants':1999,'allUnorderedPairsCompared':1999*1998//2,'candidatePairs':len(pairs),'candidatePairsSha256':sha(pb),'crossDocumentPairs':sum(rows[a]['documentIdentity']!=rows[c]['documentIdentity'] for a,c in reasons),'crossCoursePairs':sum(rows[a]['courseId']!=rows[c]['courseId'] for a,c in reasons),'featureCounts':dict(sorted(collections.Counter(f for v in reasons.values() for f in v).items())),'documentTwins':twins,'unicodeDataVersion':unicodedata.unidata_version,'pythonVersion':sys.version.split()[0],'networkAttempts':0,'protectedSelectionInputs':False}
    return pb,encode(receipt)

if __name__=='__main__':
    pairs,receipt=generate()
    if '--verify-repeat' in sys.argv:
        assert pairs==(BASE/'d3-candidate-pairs.jsonl').read_bytes(), 'PAIR_OUTPUT_DRIFT'
        assert receipt==(BASE/'d3-generation-receipt.json').read_bytes(), 'RECEIPT_OUTPUT_DRIFT'
        print(json.dumps({'repeatBytesIdentical':True,'pairsSha256':sha(pairs),'receiptSha256':sha(receipt)}))
    else:
        (BASE/'d3-candidate-pairs.jsonl').write_bytes(pairs)
        (BASE/'d3-generation-receipt.json').write_bytes(receipt)
        print(receipt.decode())
