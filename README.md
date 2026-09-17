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
