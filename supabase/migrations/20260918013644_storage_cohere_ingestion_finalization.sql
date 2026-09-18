-- Resume and finalization surfaces for the Storage/Cohere ingestion sequence:
--
--   persist processing DB state
--   -> upload/verify the original file in private Storage
--   -> Cohere document embeddings
--   -> atomic DB finalization
--   -> ready
--
-- Retrieval only ever sees status = 'ready', so the ready transition has to
-- happen inside the single finalization transaction, after every embedding of
-- the document has been persisted. Both surfaces run as the caller
-- (SECURITY INVOKER) and stay executable by service_role only.
--
-- The original file hash is deliberately not recorded here: the ingestion plan
-- is derived after textual transformation and does not own the original bytes,
-- so raw file identity belongs to the Storage upload step, where those bytes
-- are still available.
--
-- Physical Storage keys must stay inside the Supabase-safe ASCII contract that
-- the application path builder produces, because Storage rejects any
-- non-ASCII key with InvalidKey. The logical values are untouched: the
-- original filename stays exact in knowledge_documents.original_filename and
-- the canonical identity stays in knowledge_sources.slug.

alter table public.knowledge_documents
  add constraint knowledge_documents_storage_path_key_check check (
    storage_path is null
    or storage_path ~ '^sources/[A-Za-z0-9._-]+/[0-9a-f]{64}/[A-Za-z0-9._-]+$'
  );

create or replace function public.get_knowledge_ingestion_resume_state(
  document_id uuid
)
returns table (
  document jsonb,
  chunks jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_document_id uuid;
  v_document jsonb;
  v_chunks jsonb;
begin
  v_document_id := document_id;

  if v_document_id is null then
    raise exception 'Document id is required.';
  end if;

  select pg_catalog.jsonb_build_object(
    'document_id', documents.id,
    'source_id', documents.source_id,
    'status', documents.status,
    'sha256', documents.sha256,
    'storage_bucket', documents.storage_bucket,
    'storage_path', documents.storage_path,
    'original_filename', documents.original_filename,
    'mime_type', documents.mime_type,
    'version_label', documents.version_label,
    'metadata', documents.metadata
  )
  into v_document
  from public.knowledge_documents as documents
  where documents.id = v_document_id;

  if v_document is null then
    raise exception 'Knowledge document % does not exist.', v_document_id;
  end if;

  -- Chunk order is fixed by chunk_index and the stored vector is never
  -- returned; callers only learn whether an embedding is present.
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'chunk_index', chunk_rows.chunk_index,
        'content', chunk_rows.content,
        'content_sha256', chunk_rows.content_sha256,
        'heading_path', pg_catalog.to_jsonb(chunk_rows.heading_path),
        'locator', chunk_rows.locator,
        'embedding_model', chunk_rows.embedding_model,
        'token_count', chunk_rows.token_count,
        'has_embedding', chunk_rows.embedding is not null
      )
      order by chunk_rows.chunk_index
    ),
    '[]'::jsonb
  )
  into v_chunks
  from public.knowledge_chunks as chunk_rows
  where chunk_rows.document_id = v_document_id;

  return query
  select v_document, v_chunks;
end;
$$;

comment on function public.get_knowledge_ingestion_resume_state(uuid) is
  'Reads the authoritative persisted ingestion state of one document with its chunks in chunk_index order, without exposing stored embeddings and without mutating state.';

create or replace function public.finalize_knowledge_document_embeddings(
  document_id uuid,
  embedding_model text,
  embeddings jsonb
)
returns table (
  result_status text,
  finalized_document_id uuid,
  chunk_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected_model constant text := 'cohere/embed-v4.0@1024';
  v_document_id uuid;
  v_status text;
  v_chunk_count integer;
  v_payload_count integer;
  v_invalid_count integer;
  v_missing_indexes integer[];
  v_unexpected_indexes integer[];
  v_updated_chunk_count integer;
  v_incomplete_chunk_count integer;
begin
  v_document_id := document_id;

  if v_document_id is null then
    raise exception 'Document id is required.';
  end if;

  if embedding_model is distinct from v_expected_model then
    raise exception 'Embedding model must be %.', v_expected_model;
  end if;

  -- The document row is the serialization point for concurrent finalization.
  select documents.status
  into v_status
  from public.knowledge_documents as documents
  where documents.id = v_document_id
  for update;

  if not found then
    raise exception 'Knowledge document % does not exist.', v_document_id;
  end if;

  if v_status not in ('processing', 'ready') then
    raise exception
      'Knowledge document % cannot be finalized from status %.',
      v_document_id,
      v_status;
  end if;

  if pg_catalog.jsonb_typeof(embeddings) is distinct from 'array' then
    raise exception 'Embeddings must be a JSON array.';
  end if;

  v_payload_count := pg_catalog.jsonb_array_length(embeddings);

  select pg_catalog.count(*)::integer
  into v_chunk_count
  from public.knowledge_chunks as chunk_rows
  where chunk_rows.document_id = v_document_id;

  if v_chunk_count = 0 then
    raise exception
      'Knowledge document % has no chunks to finalize.',
      v_document_id;
  end if;

  if v_payload_count <> v_chunk_count then
    raise exception
      'Embedding payload must contain exactly % chunks, received %.',
      v_chunk_count,
      v_payload_count;
  end if;

  -- Structural validation. Every step only relies on the steps before it, so
  -- no cast, array access, or vector conversion is attempted on a value that
  -- has not already been checked.
  select pg_catalog.count(*)::integer
  into v_invalid_count
  from pg_catalog.jsonb_array_elements(embeddings) as items(value)
  where pg_catalog.jsonb_typeof(items.value) is distinct from 'object';

  if v_invalid_count > 0 then
    raise exception 'Every embedding payload item must be a JSON object.';
  end if;

  select pg_catalog.count(*)::integer
  into v_invalid_count
  from pg_catalog.jsonb_array_elements(embeddings) as items(value)
  where pg_catalog.jsonb_typeof(items.value -> 'chunk_index')
      is distinct from 'number'
    or case
      when (items.value ->> 'chunk_index') ~ '^(0|[1-9][0-9]*)$'
        then (items.value ->> 'chunk_index')::numeric > 2147483647
      else true
    end;

  if v_invalid_count > 0 then
    raise exception
      'Every embedding payload item must carry a non-negative integer chunk_index.';
  end if;

  select pg_catalog.count(*)::integer
  into v_invalid_count
  from pg_catalog.jsonb_array_elements(embeddings) as items(value)
  where pg_catalog.jsonb_typeof(items.value -> 'content_sha256')
      is distinct from 'string'
    or (items.value ->> 'content_sha256') !~ '^[0-9a-f]{64}$';

  if v_invalid_count > 0 then
    raise exception
      'Every embedding payload item must carry a lowercase SHA-256 content_sha256.';
  end if;

  select pg_catalog.count(*)::integer
  into v_invalid_count
  from (
    select items.value ->> 'chunk_index' as repeated_index
    from pg_catalog.jsonb_array_elements(embeddings) as items(value)
    group by items.value ->> 'chunk_index'
    having pg_catalog.count(*) > 1
  ) as repeated;

  if v_invalid_count > 0 then
    raise exception 'Embedding payload must not repeat a chunk_index.';
  end if;

  select pg_catalog.count(*)::integer
  into v_invalid_count
  from pg_catalog.jsonb_array_elements(embeddings) as items(value)
  where pg_catalog.jsonb_typeof(items.value -> 'embedding')
      is distinct from 'array';

  if v_invalid_count > 0 then
    raise exception
      'Every embedding payload item must carry a JSON array embedding.';
  end if;

  select pg_catalog.count(*)::integer
  into v_invalid_count
  from pg_catalog.jsonb_array_elements(embeddings) as items(value)
  where pg_catalog.jsonb_array_length(items.value -> 'embedding') <> 1024;

  if v_invalid_count > 0 then
    raise exception
      'Every embedding must contain exactly 1024 values; payloads are never truncated or padded.';
  end if;

  select pg_catalog.count(*)::integer
  into v_invalid_count
  from pg_catalog.jsonb_array_elements(embeddings) as items(value),
    pg_catalog.jsonb_array_elements(
      items.value -> 'embedding'
    ) as dimensions(value)
  where pg_catalog.jsonb_typeof(dimensions.value) is distinct from 'number';

  if v_invalid_count > 0 then
    raise exception 'Every embedding value must be a JSON number.';
  end if;

  -- Exact set equality between the payload and the persisted chunks. A chunk
  -- whose identity cannot be matched, including one persisted without a
  -- content_sha256, fails closed instead of being embedded on trust.
  select
    pg_catalog.count(*)::integer,
    pg_catalog.array_agg(chunk_rows.chunk_index order by chunk_rows.chunk_index)
  into v_invalid_count, v_missing_indexes
  from public.knowledge_chunks as chunk_rows
  where chunk_rows.document_id = v_document_id
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(embeddings) as items(value)
      where (items.value ->> 'chunk_index')::integer = chunk_rows.chunk_index
        and items.value ->> 'content_sha256' = chunk_rows.content_sha256
    );

  if v_invalid_count > 0 then
    raise exception
      'Embedding payload is missing persisted document chunks %.',
      v_missing_indexes;
  end if;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.array_agg(
      (items.value ->> 'chunk_index')::integer
      order by (items.value ->> 'chunk_index')::integer
    )
  into v_invalid_count, v_unexpected_indexes
  from pg_catalog.jsonb_array_elements(embeddings) as items(value)
  where not exists (
    select 1
    from public.knowledge_chunks as chunk_rows
    where chunk_rows.document_id = v_document_id
      and chunk_rows.chunk_index = (items.value ->> 'chunk_index')::integer
      and chunk_rows.content_sha256 = items.value ->> 'content_sha256'
  );

  if v_invalid_count > 0 then
    raise exception
      'Embedding payload does not match persisted document % chunks %.',
      v_document_id,
      v_unexpected_indexes;
  end if;

  if v_status = 'processing' then
    -- One statement persists every embedding of the document; the transaction
    -- either stores all of them or none of them. Conversion to vector(1024)
    -- rejects malformed, non-numeric, and non-finite values as well.
    with payload as (
      select
        (items.value ->> 'chunk_index')::integer as chunk_index,
        items.value -> 'embedding' as embedding
      from pg_catalog.jsonb_array_elements(embeddings) as items(value)
    )
    update public.knowledge_chunks as chunk_rows
    set embedding = (payload.embedding)::text::extensions.vector(1024)
    from payload
    where chunk_rows.document_id = v_document_id
      and chunk_rows.chunk_index = payload.chunk_index;

    get diagnostics v_updated_chunk_count = row_count;

    if v_updated_chunk_count <> v_chunk_count then
      raise exception
        'Finalization persisted % of % document chunks.',
        v_updated_chunk_count,
        v_chunk_count;
    end if;

    select pg_catalog.count(*)::integer
    into v_incomplete_chunk_count
    from public.knowledge_chunks as chunk_rows
    where chunk_rows.document_id = v_document_id
      and (
        chunk_rows.embedding is null
        or chunk_rows.embedding_model is distinct from v_expected_model
      );

    if v_incomplete_chunk_count > 0 then
      raise exception
        'Document % still has chunks without a % embedding.',
        v_document_id,
        v_expected_model;
    end if;

    -- Retrieval becomes possible only here, once every embedding is stored.
    -- token_count stays null: this contract does not synthesize token counts.
    update public.knowledge_documents as documents
    set
      status = 'ready',
      ingested_at = pg_catalog.now()
    where documents.id = v_document_id;

    return query
    select 'finalized'::text, v_document_id, v_chunk_count;
    return;
  end if;

  -- Already ready: the caller may have lost the previous success response, so
  -- the persisted embeddings are validated for identity and completeness and
  -- then left untouched. Floating-point vectors are never compared.
  select pg_catalog.count(*)::integer
  into v_incomplete_chunk_count
  from public.knowledge_chunks as chunk_rows
  where chunk_rows.document_id = v_document_id
    and (
      chunk_rows.embedding is null
      or chunk_rows.embedding_model is distinct from v_expected_model
    );

  if v_incomplete_chunk_count > 0 then
    raise exception
      'Ready document % has chunks without a % embedding.',
      v_document_id,
      v_expected_model;
  end if;

  return query
  select 'already_ready'::text, v_document_id, v_chunk_count;
end;
$$;

comment on function public.finalize_knowledge_document_embeddings(
  uuid,
  text,
  jsonb
) is
  'Atomically persists the complete Cohere embedding set of one processing document and only then marks it ready; a ready document returns already_ready after identity and completeness validation without rewriting embeddings.';

revoke execute on function public.get_knowledge_ingestion_resume_state(uuid)
  from public, anon, authenticated;

grant execute on function public.get_knowledge_ingestion_resume_state(uuid)
  to service_role;

revoke execute on function public.finalize_knowledge_document_embeddings(
  uuid,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.finalize_knowledge_document_embeddings(
  uuid,
  text,
  jsonb
) to service_role;
