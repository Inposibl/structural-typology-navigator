"""Real product-capture adapters (B-6) — implemented, NOT executed in CORR2.

Adapters receive ONLY ExecutionRequest objects (no oracle expectations) and
return RawCapture (values only, no provenance). Provenance is assigned by the
runner from the registry entry for the adapter's registered physical
operation.
"""
