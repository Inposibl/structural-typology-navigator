
-- CANDIDATE ONLY.
-- The local apply operator must create the real migration via:
--   npx supabase migration new course_source_registry
-- and copy this reviewed body into the generated file.

create table public.academy_course_sources (
  course_id text not null,
  source_id uuid not null references public.knowledge_sources (id) on delete cascade,
  authority_relation text not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (course_id, source_id),
  constraint academy_course_sources_course_id_check check (
    course_id ~ '^[a-z0-9][a-z0-9-]{1,79}$'
  ),
  constraint academy_course_sources_authority_relation_check check (
    authority_relation in (
      'FOUNDATIONAL',
      'ELABORATION',
      'OPERATIONALIZATION',
      'PROPOSITION_SCOPED_CORRECTION',
      'EXTERNAL_RESEARCH',
      'SUPPLEMENTAL'
    )
  )
);

comment on table public.academy_course_sources is
  'Generic many-to-many binding between versioned Academy course IDs and canonical knowledge sources. Course definitions remain application/catalog authority.';

comment on column public.academy_course_sources.authority_relation is
  'Semantic relation of the source to course knowledge; it is not a global numeric priority.';

create index academy_course_sources_source_id_idx
  on public.academy_course_sources (source_id);

create trigger academy_course_sources_set_updated_at
before update on public.academy_course_sources
for each row
execute function public.set_knowledge_updated_at();

alter table public.academy_course_sources enable row level security;

revoke all privileges on table public.academy_course_sources
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.academy_course_sources
  to service_role;

create or replace function public.match_course_knowledge_chunks(
  p_course_id text,
  p_query_embedding extensions.vector(1024),
  p_match_threshold real,
  p_match_count integer
)
returns table (
  chunk_id bigint,
  document_id uuid,
  source_id uuid,
  course_id text,
  source_slug text,
  source_title text,
  source_kind text,
  authority_relation text,
  course_source_metadata jsonb,
  source_metadata jsonb,
  document_metadata jsonb,
  content text,
  content_sha256 text,
  heading_path text[],
  locator jsonb,
  chunk_metadata jsonb,
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
    documents.id as document_id,
    sources.id as source_id,
    bindings.course_id,
    sources.slug as source_slug,
    sources.title as source_title,
    sources.source_kind,
    bindings.authority_relation,
    bindings.metadata as course_source_metadata,
    sources.metadata as source_metadata,
    documents.metadata as document_metadata,
    chunks.content,
    chunks.content_sha256,
    chunks.heading_path,
    chunks.locator,
    chunks.metadata as chunk_metadata,
    (
      1 - (
        chunks.embedding operator(extensions.<=>) p_query_embedding
      )
    )::real as similarity
  from public.academy_course_sources as bindings
  join public.knowledge_sources as sources
    on sources.id = bindings.source_id
  join public.knowledge_documents as documents
    on documents.source_id = sources.id
  join public.knowledge_chunks as chunks
    on chunks.document_id = documents.id
  where bindings.course_id = p_course_id
    and bindings.is_active
    and documents.status = 'ready'
    and documents.metadata @> '{"academyCorpus": true}'::jsonb
    and documents.metadata @> '{"canonicalRagSource": true}'::jsonb
    and chunks.embedding is not null
    and (
      1 - (
        chunks.embedding operator(extensions.<=>) p_query_embedding
      )
    ) >= p_match_threshold
  order by chunks.embedding operator(extensions.<=>) p_query_embedding
  limit least(greatest(coalesce(p_match_count, 10), 1), 50);
$$;

comment on function public.match_course_knowledge_chunks(
  text,
  extensions.vector,
  real,
  integer
) is
  'Returns canonical ready Academy chunks for one actively bound course, ranked by Cohere embed-v4.0 cosine similarity with generic source authority and provenance.';

revoke execute on function public.match_course_knowledge_chunks(
  text,
  extensions.vector,
  real,
  integer
) from public, anon, authenticated;

grant execute on function public.match_course_knowledge_chunks(
  text,
  extensions.vector,
  real,
  integer
) to service_role;

insert into public.academy_course_sources (
  course_id,
  source_id,
  authority_relation,
  is_active,
  metadata
)
select
  'maslow',
  sources.id,
  case sources.slug
    when 'maslow-new-paradigm' then 'FOUNDATIONAL'
    when 'maslow-first-meet-transcript' then 'ELABORATION'
    when 'maslow-new-paradigm-presentation-2025-02-22'
      then 'OPERATIONALIZATION'
    when 'maslow-second-meet-transcript' then 'ELABORATION'
    when 'maslow-qa-2025-04-20' then 'PROPOSITION_SCOPED_CORRECTION'
  end,
  true,
  case sources.slug
    when 'maslow-new-paradigm'
      then '{"role":"foundational_author_text","scope":"COURSEWIDE"}'::jsonb
    when 'maslow-first-meet-transcript'
      then '{"role":"foundational_psychophysiology_lecture","scope":"COURSEWIDE"}'::jsonb
    when 'maslow-new-paradigm-presentation-2025-02-22'
      then '{"role":"later_operationalization","scope":"COURSEWIDE"}'::jsonb
    when 'maslow-second-meet-transcript'
      then '{"role":"lecture_explanation_and_application","scope":"COURSEWIDE"}'::jsonb
    when 'maslow-qa-2025-04-20'
      then '{"role":"explicit_clarification_and_correction","scope":"PROPOSITION_SCOPED","correctionRegistry":"Maslow_QA_CORRECTION_REGISTRY_CORR1.json"}'::jsonb
  end
from public.knowledge_sources as sources
where sources.slug in (
  'maslow-new-paradigm',
  'maslow-first-meet-transcript',
  'maslow-new-paradigm-presentation-2025-02-22',
  'maslow-second-meet-transcript',
  'maslow-qa-2025-04-20'
)
on conflict (course_id, source_id) do update
set
  authority_relation = excluded.authority_relation,
  is_active = excluded.is_active,
  metadata = excluded.metadata,
  updated_at = now();

do $$
declare
  v_binding_count integer;
begin
  select count(*)::integer
  into v_binding_count
  from public.academy_course_sources
  where course_id = 'maslow'
    and is_active;

  if v_binding_count <> 5 then
    raise exception
      'Maslow pilot requires exactly 5 active course-source bindings; found %.',
      v_binding_count;
  end if;
end;
$$;
