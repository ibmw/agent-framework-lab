# Local Phoenix

Start the pinned local viewer without making it an application dependency:

```shell
docker compose -f infra/phoenix/compose.yaml up -d
```

Then set `AGENT_LAB_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006/v1/traces`, run the API, and
open `http://localhost:6006`. The application emits only the sanitized common spans described in
`docs/observability.md`; it continues to work when Phoenix is stopped or export is unset.
