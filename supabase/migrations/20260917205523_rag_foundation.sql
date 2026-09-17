create extension if not exists vector with schema extensions;

create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  author text,
  language text not null default 'ru',
  source_kind text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_sources_source_kind_check check (
    source_kind in (
      'manuscript',
      'course',
      'presentation',
      'article',
      'lecture',
      'transcript',
      'website',
      'other'
    )
  )
);

comment on table public.knowledge_sources is
  'Logical Academy sources such as manuscripts, courses, lectures, articles, and websites.';

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.knowledge_sources (id) on delete cascade,
  version_label text,
  original_filename text,
  mime_type text,
  storage_bucket text,
  storage_path text,
  sha256 text,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  ingested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_documents_status_check check (
    status in ('pending', 'processing', 'ready', 'failed', 'archived')
  ),
  constraint knowledge_documents_sha256_format_check check (
    sha256 is null or sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint knowledge_documents_sha256_key unique (sha256)
);

comment on table public.knowledge_documents is
  'Concrete uploaded or versioned documents belonging to logical Academy sources.';

create table public.knowledge_chunks (
  id bigint primary key generated always as identity,
  document_id uuid not null references public.knowledge_documents (id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  heading_path text[] not null default '{}',
  locator jsonb not null default '{}'::jsonb,
  content_sha256 text,
  token_count integer,
  embedding extensions.vector(1024),
  embedding_model text not null default 'cohere/embed-v4.0@1024',
  metadata jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (
    to_tsvector('simple', content)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_chunks_chunk_index_check check (chunk_index >= 0),
  constraint knowledge_chunks_content_not_blank_check check (
    content ~ '[^[:space:]]'
  ),
  constraint knowledge_chunks_token_count_check check (
    token_count is null or token_count > 0
  ),
  constraint knowledge_chunks_content_sha256_format_check check (
    content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint knowledge_chunks_document_chunk_key unique (document_id, chunk_index)
);

comment on table public.knowledge_chunks is
  'Retrieval units derived from a specific knowledge document with exact provenance.';

comment on column public.knowledge_chunks.embedding is
  '1024-dimensional Cohere embed-v4.0 vector; stored chunks use search_document and queries use search_query.';

comment on column public.knowledge_chunks.embedding_model is
  'Embedding configuration identifier for Cohere embed-v4.0 with 1024 output dimensions.';

comment on column public.knowledge_chunks.locator is
  'Source-specific provenance such as page, slide, section, heading, or paragraph.';

create index knowledge_documents_source_id_idx
  on public.knowledge_documents (source_id);

-- The unique (document_id, chunk_index) index also supports document_id lookups
-- and cascading foreign-key deletes, so a separate document_id index is redundant.

create index knowledge_chunks_search_vector_idx
  on public.knowledge_chunks using gin (search_vector);

create index knowledge_chunks_embedding_hnsw_idx
  on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

create or replace function public.set_knowledge_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger knowledge_sources_set_updated_at
before update on public.knowledge_sources
for each row
execute function public.set_knowledge_updated_at();

create trigger knowledge_documents_set_updated_at
before update on public.knowledge_documents
for each row
execute function public.set_knowledge_updated_at();

create trigger knowledge_chunks_set_updated_at
before update on public.knowledge_chunks
for each row
execute function public.set_knowledge_updated_at();

alter table public.knowledge_sources enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;

revoke all privileges on table public.knowledge_sources from public, anon, authenticated;
revoke all privileges on table public.knowledge_documents from public, anon, authenticated;
revoke all privileges on table public.knowledge_chunks from public, anon, authenticated;
revoke all privileges on sequence public.knowledge_chunks_id_seq from public, anon, authenticated;

grant select, insert, update, delete
  on table public.knowledge_sources, public.knowledge_documents, public.knowledge_chunks
  to service_role;

grant usage, select
  on sequence public.knowledge_chunks_id_seq
  to service_role;

create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector(1024),
  match_threshold real,
  match_count integer,
  document_ids uuid[] default null
)
returns table (
  chunk_id bigint,
  document_id uuid,
  source_id uuid,
  content text,
  heading_path text[],
  locator jsonb,
  metadata jsonb,
  similarity real
)
language sql
stable
parallel safe
security invoker
set search_path = ''
as $$
  select
    chunks.id as chunk_id,
    chunks.document_id,
    documents.source_id,
    chunks.content,
    chunks.heading_path,
    chunks.locator,
    chunks.metadata,
    (1 - (chunks.embedding operator(extensions.<=>) query_embedding))::real as similarity
  from public.knowledge_chunks as chunks
  join public.knowledge_documents as documents
    on documents.id = chunks.document_id
  where chunks.embedding is not null
    and documents.status = 'ready'
    and (
      document_ids is null
      or chunks.document_id = any (document_ids)
    )
    and 1 - (chunks.embedding operator(extensions.<=>) query_embedding) >= match_threshold
  order by chunks.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(coalesce(match_count, 10), 1), 50);
$$;

comment on function public.match_knowledge_chunks(
  extensions.vector,
  real,
  integer,
  uuid[]
) is
  'Returns ready-document chunks ranked by Cohere embed-v4.0 cosine similarity with full provenance.';

revoke execute on function public.set_knowledge_updated_at() from public, anon, authenticated;
grant execute on function public.set_knowledge_updated_at() to service_role;

revoke execute on function public.match_knowledge_chunks(
  extensions.vector,
  real,
  integer,
  uuid[]
) from public, anon, authenticated;

grant execute on function public.match_knowledge_chunks(
  extensions.vector,
  real,
  integer,
  uuid[]
) to service_role;
