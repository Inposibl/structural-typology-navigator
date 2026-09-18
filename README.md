# structural-typology-navigator
Standalone AI Navigator for Structural Typology Academy — user guidance, course routing, knowledge-based answers, and next-step recommendations.

## Локальный dry-run ingestion

Локальный конвейер принимает только Markdown (`.md`) и обычный текст (`.txt`), нормализует документ и создаёт детерминированный JSON-план без обращения к Supabase или внешним API. Реальные материалы Академии пока не загружаются. Результаты записываются в игнорируемую Git папку `.ingestion-plans/`.

```bash
npm run ingest:plan -- tests/fixtures/synthetic-academy-sample.md \
  --source-slug synthetic-sample \
  --source-title "Синтетический материал" \
  --source-kind article \
  --language ru
```

Обязательные метаданные можно передать флагами или JSON-файлом через `--metadata-file`. Настройки разбиения доступны через `--target-characters`, `--hard-maximum-characters` и `--overlap-characters`.

## Серверный контур Supabase ingestion

После этого этапа конвейер имеет следующую форму:

```text
исходный файл
  -> локальный адаптер
  -> нормализованный документ
  -> детерминированный IngestionPlan
  -> атомарный Supabase persistence RPC (реализован и проверен в локальном Supabase)
  -> статус документа processing
  -> будущая генерация Cohere embeddings
  -> будущий статус ready
```

Реальные материалы Академии не загружались. Миграция и RPC проверены только на синтетических данных в локальном Supabase; live-проект не затрагивался. Перед первым использованием в live-среде миграцию необходимо применить отдельно в рамках разрешённого развёртывания.

Серверный клиент ожидает `SUPABASE_URL` и современный секретный ключ `SUPABASE_SECRET_KEY` в формате `sb_secret_...`. Секрет передаётся Supabase только в заголовке `apikey`, без `Authorization: Bearer`, поскольку современный ключ не является JWT. Секрет предназначен только для серверного окружения и не должен иметь префикс `NEXT_PUBLIC_` или попадать в клиентские модули.

Документный ingestion не объявляет метаданные источника и не перезаписывает существующие `knowledge_sources.metadata`. Для существующего `slug` заголовок, язык и тип источника должны совпадать точно. Отсутствующий автор сохраняет существующее значение; пустой автор может быть дополнен, а конфликт двух непустых авторов завершается ошибкой.

Документы создаются только со статусом `processing`: embeddings и token counts на этом этапе остаются `NULL`. Retrieval RPC выбирает только документы со статусом `ready`, поэтому незавершённый ingestion не может попасть в RAG-ответы.
