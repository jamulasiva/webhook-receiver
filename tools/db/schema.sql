-- raw_events: append-only sink for GitHub webhook deliveries.
-- Payloads and headers are stored verbatim so the future audit application
-- can be schema-driven from real captured samples.

create table if not exists raw_events (
  id              bigserial    primary key,
  delivery_id     text         not null unique,
  event_type      text         not null,
  payload         jsonb        not null,
  headers         jsonb        not null,
  signature_valid boolean      not null,
  received_at     timestamptz  not null default now()
);

create index if not exists raw_events_event_type_received_at_idx
  on raw_events (event_type, received_at desc);
