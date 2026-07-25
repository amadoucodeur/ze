-- The agent may explain a correction, but a reason is not mandatory.

alter table zecontrol.event_change_requests
  alter column reason drop not null,
  drop constraint if exists event_change_requests_reason_check;

alter table zecontrol.event_change_requests
  add constraint event_change_requests_reason_check
  check (reason is null or char_length(btrim(reason)) between 1 and 500);

comment on column zecontrol.event_change_requests.reason is
  'Optional explanation sent by the requester to organisation administrators.';
