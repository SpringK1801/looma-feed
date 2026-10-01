-- Persistent in-app events, visible only to the recipient.
create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,
  title text not null,
  body text not null default '',
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notification_events_recipient_created_idx
on public.notification_events(recipient_id, created_at desc);
alter table public.notification_events enable row level security;
revoke all on public.notification_events from anon, authenticated;
grant select, delete on public.notification_events to authenticated;
grant update (read_at) on public.notification_events to authenticated;
grant all on public.notification_events to service_role;
create policy "Recipients read notifications" on public.notification_events for select to authenticated
using (recipient_id = auth.uid());
create policy "Recipients mark notifications read" on public.notification_events for update to authenticated
using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy "Recipients delete notifications" on public.notification_events for delete to authenticated
using (recipient_id = auth.uid());

create or replace function public.create_relationship_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'connections' then
    if tg_op = 'INSERT' and new.status = 'pending' then
      insert into public.notification_events(recipient_id, actor_id, type, title, data)
      values (new.addressee_id, new.requester_id, 'connection_request', 'Novo pedido de conexão', jsonb_build_object('connection_id', new.id));
    elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status = 'pending' then
      insert into public.notification_events(recipient_id, actor_id, type, title, data)
      values (new.requester_id, new.addressee_id, 'connection_accepted', 'Pedido de conexão aceite', jsonb_build_object('connection_id', new.id));
    end if;
  elsif tg_table_name = 'proposals' then
    if tg_op = 'INSERT' then
      insert into public.notification_events(recipient_id, actor_id, type, title, data)
      values (new.recipient_id, new.sender_id, 'proposal_received', 'Nova proposta recebida', jsonb_build_object('proposal_id', new.id));
    elsif tg_op = 'UPDATE' and new.status <> old.status then
      insert into public.notification_events(recipient_id, actor_id, type, title, data)
      values (new.sender_id, new.recipient_id, 'proposal_updated', 'A sua proposta foi atualizada', jsonb_build_object('proposal_id', new.id, 'status', new.status));
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.create_relationship_notification() from public;
create trigger connection_notification after insert or update of status on public.connections
for each row execute function public.create_relationship_notification();
create trigger proposal_notification after insert or update of status on public.proposals
for each row execute function public.create_relationship_notification();
notify pgrst, 'reload schema';
