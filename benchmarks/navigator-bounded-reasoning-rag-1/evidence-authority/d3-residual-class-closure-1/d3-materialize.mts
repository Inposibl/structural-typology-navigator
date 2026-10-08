// Read-only physical passage materialization for D3 authoring. No product invocation.
import fs from 'node:fs';
import crypto from 'node:crypto';
const base = new URL('.', import.meta.url);
const repo = '/Users/entp_psyche/Desktop/InvestProjects2026/structural-typology-navigator-main-reconciliation-1';
const hash = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');
const universeBytes = fs.readFileSync(new URL('authorized-evidence-universe.jsonl', base));
if (hash(universeBytes) !== '0715ed576d0b4d514437138b190f54a4aaec5f58f6b70969cc7a88efd80f719e') throw Error('UNIVERSE_DRIFT');
const rows = universeBytes.toString('utf8').trimEnd().split('\n').map(JSON.parse);
const pinned = JSON.parse(fs.readFileSync(new URL('source-verification.json', base), 'utf8'));
for (const m of pinned.members.filter((m: any) => m.path.startsWith('src/lib/ingestion/'))) {
  if (hash(fs.readFileSync(repo + '/' + m.path)) !== m.sha256) throw Error('MODULE_DRIFT ' + m.path);
}
globalThis.fetch = async () => { throw Error('D3_NETWORK_FORBIDDEN'); };
const {adaptMarkdownDocument} = await import(repo + '/src/lib/ingestion/adapters.ts');
const {buildIngestionPlan} = await import(repo + '/src/lib/ingestion/build-ingestion-plan.ts');
const documents = new Map<string, any>();
const result = [];
for (const row of rows) {
  let content: string;
  if (row.physicalLocator.passagePath) {
    content = fs.readFileSync(row.physicalLocator.passagePath).toString('utf8');
  } else {
    const f = row.physicalLocator.canonicalPath;
    if (!documents.has(f)) {
      const receipts = JSON.parse(fs.readFileSync(row.physicalLocator.receiptPath, 'utf8')).receipts;
      const r = receipts.find((r: any) => r.canonicalFileSha256 === row.documentIdentity && r.sourceSlug === row.sourceSlug && r.courseId === row.courseId);
      if (!r) throw Error('RECEIPT_MISSING');
      const b = fs.readFileSync(f);
      if (hash(b) !== row.documentIdentity) throw Error('DOCUMENT_DRIFT');
      const doc = adaptMarkdownDocument(b.toString('utf8'), {sourceSlug:r.sourceSlug,sourceTitle:r.sourceTitle,sourceKind:r.sourceKind,language:r.language,documentMetadata:{}});
      const plan = buildIngestionPlan(doc, r.chunking);
      if (plan.normalizedContentSha256 !== r.normalizedContentSha256 || plan.chunks.length !== r.chunkCount) throw Error('PLAN_DRIFT');
      documents.set(f, plan);
    }
    content = documents.get(f).chunks[row.chunkIndex].content;
  }
  const b = Buffer.from(content, 'utf8');
  if (hash(b) !== row.passageSha256 || b.length !== row.passageUtf8Bytes) throw Error('PASSAGE_DRIFT ' + row.memberId);
  result.push({memberId:row.memberId,content});
}
process.stdout.write(JSON.stringify(result));
