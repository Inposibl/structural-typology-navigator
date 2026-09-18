-- Register the private source-document bucket without adding object policies,
-- MIME restrictions, or an artificial file-size limit.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'academy-knowledge',
  'academy-knowledge',
  false,
  null,
  null
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = null,
  allowed_mime_types = null;

create or replace function public.persist_knowledge_ingestion_plan(
  ingestion_plan jsonb
)
returns table (
  result_status text,
  source_id uuid,
  document_id uuid,
  chunk_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source jsonb;
  v_document jsonb;
  v_chunks jsonb;
  v_chunk jsonb;
  v_source_slug text;
  v_incoming_author text;
  v_document_sha256 text;
  v_source_id uuid;
  v_existing_source_title text;
  v_existing_source_author text;
  v_existing_source_language text;
  v_existing_source_kind text;
  v_document_id uuid;
  v_existing_source_id uuid;
  v_chunk_count integer;
  v_existing_chunk_count integer;
  v_chunk_position bigint;
begin
  if pg_catalog.jsonb_typeof(ingestion_plan) is distinct from 'object' then
    raise exception 'Ingestion plan must be a JSON object.';
  end if;

  v_source := ingestion_plan -> 'source';
  v_document := ingestion_plan -> 'document';
  v_chunks := ingestion_plan -> 'chunks';

  if pg_catalog.jsonb_typeof(v_source) is distinct from 'object' then
    raise exception 'Ingestion plan source must be a JSON object.';
  end if;

  if pg_catalog.jsonb_typeof(v_document) is distinct from 'object' then
    raise exception 'Ingestion plan document must be a JSON object.';
  end if;

  if pg_catalog.jsonb_typeof(v_chunks) is distinct from 'array' then
    raise exception 'Ingestion plan chunks must be a JSON array.';
  end if;

  v_source_slug := v_source ->> 'slug';
  if pg_catalog.jsonb_typeof(v_source -> 'slug') is distinct from 'string'
    or nullif(pg_catalog.btrim(v_source_slug), '') is null then
    raise exception 'Source slug is required.';
  end if;

  if pg_catalog.jsonb_typeof(v_source -> 'title') is distinct from 'string'
    or nullif(pg_catalog.btrim(v_source ->> 'title'), '') is null then
    raise exception 'Source title is required.';
  end if;

  if pg_catalog.jsonb_typeof(v_source -> 'language') is distinct from 'string'
    or nullif(pg_catalog.btrim(v_source ->> 'language'), '') is null then
    raise exception 'Source language is required.';
  end if;

  if pg_catalog.jsonb_typeof(v_source -> 'source_kind') is distinct from 'string'
    or (v_source ->> 'source_kind') not in (
      'manuscript',
      'course',
      'presentation',
      'article',
      'lecture',
      'transcript',
      'website',
      'other'
    ) then
    raise exception 'Unsupported source kind.';
  end if;

  if v_source ? 'author'
    and pg_catalog.jsonb_typeof(v_source -> 'author') not in ('string', 'null') then
    raise exception 'Source author must be a string or null.';
  end if;

  if pg_catalog.jsonb_typeof(v_source -> 'author') = 'string'
    and nullif(pg_catalog.btrim(v_source ->> 'author'), '') is null then
    raise exception 'Source author must not be blank.';
  end if;

  v_incoming_author := case
    when pg_catalog.jsonb_typeof(v_source -> 'author') = 'string'
      then v_source ->> 'author'
    else null
  end;

  if v_source ? 'metadata' then
    raise exception 'Source metadata is not accepted by this ingestion contract.';
  end if;

  v_document_sha256 := v_document ->> 'sha256';
  if pg_catalog.jsonb_typeof(v_document -> 'sha256') is distinct from 'string'
    or v_document_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Document sha256 must be a lowercase SHA-256 value.';
  end if;

  if (v_document ->> 'status') is distinct from 'processing' then
    raise exception 'New ingestion documents must have processing status.';
  end if;

  if (v_document ->> 'storage_bucket') is distinct from 'academy-knowledge' then
    raise exception 'Document storage_bucket must be academy-knowledge.';
  end if;

  if v_document ? 'storage_path'
    and pg_catalog.jsonb_typeof(v_document -> 'storage_path') not in ('string', 'null') then
    raise exception 'Document storage_path must be a string or null.';
  end if;

  if pg_catalog.jsonb_typeof(v_document -> 'storage_path') = 'string'
    and (
      nullif(pg_catalog.btrim(v_document ->> 'storage_path'), '') is null
      or (v_document ->> 'storage_path') !~ '^sources/[^/]+/[0-9a-f]{64}/[^/]+$'
      or (v_document ->> 'storage_path') ~ '\\'
      or (v_document ->> 'storage_path') ~ '(^|/)\.\.?(/|$)'
      or pg_catalog.split_part(v_document ->> 'storage_path', '/', 3)
        <> v_document_sha256
    ) then
    raise exception 'Document storage_path is invalid.';
  end if;

  if v_document ? 'version_label'
    and pg_catalog.jsonb_typeof(v_document -> 'version_label') not in ('string', 'null') then
    raise exception 'Document version_label must be a string or null.';
  end if;

  if v_document ? 'original_filename'
    and pg_catalog.jsonb_typeof(v_document -> 'original_filename') not in ('string', 'null') then
    raise exception 'Document original_filename must be a string or null.';
  end if;

  if pg_catalog.jsonb_typeof(v_document -> 'original_filename') = 'string'
    and pg_catalog.jsonb_typeof(v_document -> 'storage_path') is distinct from 'string' then
    raise exception 'Document storage_path is required when original_filename is present.';
  end if;

  if v_document ? 'mime_type'
    and pg_catalog.jsonb_typeof(v_document -> 'mime_type') not in ('string', 'null') then
    raise exception 'Document mime_type must be a string or null.';
  end if;

  if pg_catalog.jsonb_typeof(v_document -> 'metadata') is distinct from 'object' then
    raise exception 'Document metadata must be a JSON object.';
  end if;

  v_chunk_count := pg_catalog.jsonb_array_length(v_chunks);
  if v_chunk_count = 0 then
    raise exception 'Ingestion plan must contain at least one chunk.';
  end if;

  for v_chunk, v_chunk_position in
    select chunks.value, chunks.ordinality - 1
    from pg_catalog.jsonb_array_elements(v_chunks) with ordinality as chunks(value, ordinality)
  loop
    if pg_catalog.jsonb_typeof(v_chunk) is distinct from 'object' then
      raise exception 'Every chunk must be a JSON object.';
    end if;

    if pg_catalog.jsonb_typeof(v_chunk -> 'chunk_index') is distinct from 'number'
      or (v_chunk ->> 'chunk_index') !~ '^(0|[1-9][0-9]*)$'
      or (v_chunk ->> 'chunk_index')::numeric > 2147483647 then
      raise exception 'Chunk index must be a non-negative integer.';
    end if;

    if (v_chunk ->> 'chunk_index')::numeric <> v_chunk_position then
      raise exception 'Chunk indexes must be sequential from zero in array order.';
    end if;

    if pg_catalog.jsonb_typeof(v_chunk -> 'content') is distinct from 'string'
      or (v_chunk ->> 'content') !~ '[^[:space:]]' then
      raise exception 'Chunk content must not be blank.';
    end if;

    if (v_chunk ->> 'content_sha256') is null
      or (v_chunk ->> 'content_sha256') !~ '^[0-9a-f]{64}$' then
      raise exception 'Chunk content_sha256 must be a lowercase SHA-256 value.';
    end if;

    if pg_catalog.jsonb_typeof(v_chunk -> 'heading_path') is distinct from 'array' then
      raise exception 'Chunk heading_path must be a JSON array.';
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_chunk -> 'heading_path') as headings(value)
      where pg_catalog.jsonb_typeof(headings.value) <> 'string'
    ) then
      raise exception 'Chunk heading_path may only contain strings.';
    end if;

    if pg_catalog.jsonb_typeof(v_chunk -> 'locator') is distinct from 'object' then
      raise exception 'Chunk locator must be a JSON object.';
    end if;

    if pg_catalog.jsonb_typeof(v_chunk -> 'metadata') is distinct from 'object' then
      raise exception 'Chunk metadata must be a JSON object.';
    end if;

    if v_chunk ? 'token_count'
      and pg_catalog.jsonb_typeof(v_chunk -> 'token_count') <> 'null' then
      raise exception 'Chunk token_count must be null before embedding.';
    end if;

    if v_chunk ? 'embedding'
      and pg_catalog.jsonb_typeof(v_chunk -> 'embedding') <> 'null' then
      raise exception 'Chunk embedding must be null before embedding.';
    end if;

    if (v_chunk ->> 'embedding_model') is distinct from 'cohere/embed-v4.0@1024' then
      raise exception 'Chunk embedding_model must be cohere/embed-v4.0@1024.';
    end if;
  end loop;

  -- Document ingestion can create a source, but it does not own existing
  -- source metadata or canonical identity. Existing title, language, and
  -- source_kind must match exactly. Author may only fill an existing null;
  -- absent/null preserves it, while two different non-null authors conflict.
  insert into public.knowledge_sources (
    slug,
    title,
    author,
    language,
    source_kind,
    metadata
  )
  values (
    v_source_slug,
    v_source ->> 'title',
    v_incoming_author,
    v_source ->> 'language',
    v_source ->> 'source_kind',
    '{}'::jsonb
  )
  on conflict (slug) do nothing
  returning id into v_source_id;

  if v_source_id is null then
    select
      sources.id,
      sources.title,
      sources.author,
      sources.language,
      sources.source_kind
    into
      v_source_id,
      v_existing_source_title,
      v_existing_source_author,
      v_existing_source_language,
      v_existing_source_kind
    from public.knowledge_sources as sources
    where sources.slug = v_source_slug
    for update;

    if not found then
      raise exception 'Existing knowledge source could not be resolved.';
    end if;

    if v_existing_source_title is distinct from (v_source ->> 'title') then
      raise sqlstate 'PT409'
        using
          message = 'Knowledge source identity conflict for existing slug.',
          detail = 'Source title does not match.';
    end if;

    if v_existing_source_language is distinct from (v_source ->> 'language') then
      raise sqlstate 'PT409'
        using
          message = 'Knowledge source identity conflict for existing slug.',
          detail = 'Source language does not match.';
    end if;

    if v_existing_source_kind is distinct from (v_source ->> 'source_kind') then
      raise sqlstate 'PT409'
        using
          message = 'Knowledge source identity conflict for existing slug.',
          detail = 'Source kind does not match.';
    end if;

    if v_existing_source_author is not null
      and v_incoming_author is not null
      and v_existing_source_author is distinct from v_incoming_author then
      raise sqlstate 'PT409'
        using
          message = 'Knowledge source identity conflict for existing slug.',
          detail = 'Source author does not match.';
    end if;

    if v_existing_source_author is null
      and v_incoming_author is not null then
      update public.knowledge_sources
      set author = v_incoming_author
      where id = v_source_id;
    end if;
  end if;

  -- Every ingestion request acquires locks in one order: resolve/create the
  -- source first (locking an existing row above), then lock the document SHA.
  -- A later SHA conflict raises in this transaction, so a provisional source
  -- insert or author fill is rolled back without leaving partial state.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_document_sha256, 0)
  );

  select
    documents.id,
    documents.source_id
  into
    v_document_id,
    v_existing_source_id
  from public.knowledge_documents as documents
  where documents.sha256 = v_document_sha256;

  if found then
    if v_existing_source_id <> v_source_id then
      raise sqlstate 'PT409'
        using message = 'Document SHA-256 identity conflict across sources.';
    end if;

    select pg_catalog.count(*)::integer
    into v_existing_chunk_count
    from public.knowledge_chunks as chunks
    where chunks.document_id = v_document_id;

    return query
    select
      'already_exists'::text,
      v_existing_source_id,
      v_document_id,
      v_existing_chunk_count;
    return;
  end if;

  insert into public.knowledge_documents (
    source_id,
    version_label,
    original_filename,
    mime_type,
    storage_bucket,
    storage_path,
    sha256,
    status,
    metadata
  )
  values (
    v_source_id,
    case
      when pg_catalog.jsonb_typeof(v_document -> 'version_label') = 'string'
        then v_document ->> 'version_label'
      else null
    end,
    case
      when pg_catalog.jsonb_typeof(v_document -> 'original_filename') = 'string'
        then v_document ->> 'original_filename'
      else null
    end,
    case
      when pg_catalog.jsonb_typeof(v_document -> 'mime_type') = 'string'
        then v_document ->> 'mime_type'
      else null
    end,
    'academy-knowledge',
    case
      when pg_catalog.jsonb_typeof(v_document -> 'storage_path') = 'string'
        then v_document ->> 'storage_path'
      else null
    end,
    v_document_sha256,
    'processing',
    v_document -> 'metadata'
  )
  returning id into v_document_id;

  insert into public.knowledge_chunks (
    document_id,
    chunk_index,
    content,
    heading_path,
    locator,
    content_sha256,
    token_count,
    embedding,
    embedding_model,
    metadata
  )
  select
    v_document_id,
    (chunks.value ->> 'chunk_index')::integer,
    chunks.value ->> 'content',
    array(
      select pg_catalog.jsonb_array_elements_text(chunks.value -> 'heading_path')
    ),
    chunks.value -> 'locator',
    chunks.value ->> 'content_sha256',
    null,
    null,
    'cohere/embed-v4.0@1024',
    chunks.value -> 'metadata'
  from pg_catalog.jsonb_array_elements(v_chunks) with ordinality as chunks(value, ordinality)
  order by chunks.ordinality;

  return query
  select
    'inserted'::text,
    v_source_id,
    v_document_id,
    v_chunk_count;
end;
$$;

comment on function public.persist_knowledge_ingestion_plan(jsonb) is
  'Atomically persists one validated pre-embedding ingestion plan. Existing source metadata is preserved; source identity conflicts and cross-source document hashes fail with distinct PT409 messages.';

revoke execute on function public.persist_knowledge_ingestion_plan(jsonb)
  from public, anon, authenticated;

grant execute on function public.persist_knowledge_ingestion_plan(jsonb)
  to service_role;
