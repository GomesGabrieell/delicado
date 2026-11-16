begin;

create table public.proposal_branding (
  company_id uuid primary key references public.companies on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  accent text not null check (accent ~ '^#[0-9A-Fa-f]{6}$'),
  whatsapp text check (whatsapp ~ '^[1-9][0-9]{9,14}$')
);
alter table public.proposal_branding enable row level security;
revoke all on public.proposal_branding from public,anon,authenticated;
grant select,insert on public.proposal_branding to authenticated;
grant update(display_name,accent,whatsapp) on public.proposal_branding to authenticated;
create policy proposal_brand_admin on public.proposal_branding for all to authenticated
  using (private.has_company_access(company_id,'catalog.write'))
  with check (private.has_company_access(company_id,'catalog.write'));

create function public.save_proposal_brand(p_company uuid,p_name text,p_accent text,p_whatsapp text)
returns void language sql set search_path = '' as $$
  insert into public.proposal_branding(company_id,display_name,accent,whatsapp)
  values(p_company,btrim(p_name),p_accent,p_whatsapp)
  on conflict(company_id) do update set display_name = excluded.display_name,
    accent = excluded.accent, whatsapp = excluded.whatsapp;
$$;
revoke all on function public.save_proposal_brand(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.save_proposal_brand(uuid,text,text,text) to authenticated;

create table public.commercial_proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  quote_id uuid not null,
  version integer not null check (version > 0),
  issued_by uuid references auth.users on delete set null,
  token_hash bytea not null unique,
  content jsonb not null,
  image_paths text[] not null,
  sent_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  decision text check (decision in ('approved','negotiate','declined')),
  wants_revision boolean,
  responded_at timestamptz,
  notification_read_at timestamptz,
  foreign key(company_id,quote_id) references public.quotes(company_id,id) on delete cascade,
  unique(quote_id,version),
  check (expires_at > sent_at),
  check ((decision is null) = (responded_at is null)),
  check ((decision is not distinct from 'declined') = (wants_revision is not null))
);
create index proposal_company_inbox on public.commercial_proposals(company_id, responded_at desc)
  where responded_at is not null;
alter table public.commercial_proposals enable row level security;
revoke all on public.commercial_proposals from public,anon,authenticated;
grant select(id,company_id,quote_id,version,content,sent_at,expires_at,revoked_at,decision,wants_revision,
  responded_at,notification_read_at) on public.commercial_proposals to authenticated;
create policy proposal_admin_read on public.commercial_proposals for select to authenticated
  using (private.has_company_access(company_id,'catalog.write'));

create function public.issue_proposal(p_company uuid,p_quote uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.quotes;
declare brand public.proposal_branding;
declare customer text;
declare sale text;
declare token text := replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');
declare now_at timestamptz;
declare proposal_id uuid;
declare revision integer;
begin
  if not private.has_company_access(p_company,'catalog.write') then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into q from public.quotes where id = p_quote and company_id = p_company for update;
  if not found or q.status <> 'ready' then
    raise exception 'O orçamento deve estar pronto para revisão' using errcode = '23514';
  end if;
  select name into customer from public.quote_clients where id = q.client_id and company_id = p_company;
  select snapshot->>'sale' into sale from public.quote_financials where quote_id = q.id and company_id = p_company;
  select * into brand from public.proposal_branding where company_id = p_company;
  if brand.whatsapp is null then raise exception 'Configure o WhatsApp da empresa' using errcode = '23514'; end if;
  if customer is null or sale is null or sale !~ '^[0-9]{1,30}$' or btrim(q.decoration) = '' or btrim(q.payment_terms) = '' then
    raise exception 'Preencha decoração e pagamento e registre o cálculo' using errcode = '23514';
  end if;
  select coalesce(max(version),0) + 1 into revision from public.commercial_proposals where quote_id = q.id;
  now_at := clock_timestamp();
  update public.commercial_proposals set revoked_at = now_at
    where quote_id = q.id and revoked_at is null and responded_at is null;
  insert into public.commercial_proposals(company_id,quote_id,version,issued_by,token_hash,content,image_paths,sent_at,expires_at)
  values(p_company,q.id,revision,auth.uid(),sha256(convert_to(token,'UTF8')),
    jsonb_build_object('company',brand.display_name,'accent',brand.accent,'whatsapp',brand.whatsapp,
      'code',q.code,'title',q.title,'customer',customer,'eventDate',q.event_date,'location',q.location,
      'decoration',q.decoration,'payment',q.payment_terms,'total',sale),
    array(select path from public.quote_images where company_id = p_company and quote_id = q.id order by path),
    now_at,now_at + interval '48 hours') returning id into proposal_id;
  insert into public.quote_history(quote_id,company_id,action,status) values(q.id,p_company,'proposal_issued',q.status);
  return jsonb_build_object('id',proposal_id,'token',token);
end;
$$;

create function public.read_public_proposal(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('content',content,'paths',image_paths,'sentAt',sent_at,'expiresAt',expires_at,
    'version',version,'decision',decision,'wantsRevision',wants_revision,'respondedAt',responded_at)
  from public.commercial_proposals
  where p_token ~ '^[0-9a-f]{64}$' and token_hash = sha256(convert_to(p_token,'UTF8'))
    and revoked_at is null and expires_at > statement_timestamp();
$$;

create function public.respond_public_proposal(p_token text,p_decision text,p_wants_revision boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.commercial_proposals;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_decision is null
    or p_decision not in ('approved','negotiate','declined')
    or ((p_decision = 'declined') <> (p_wants_revision is not null)) then
    raise exception 'Resposta inválida' using errcode = '22023';
  end if;
  select * into p from public.commercial_proposals where token_hash = sha256(convert_to(p_token,'UTF8')) for update;
  if not found or p.revoked_at is not null or p.expires_at <= clock_timestamp() then return null; end if;
  if p.decision is null then
    update public.commercial_proposals set decision = p_decision, wants_revision = p_wants_revision,
      responded_at = clock_timestamp() where id = p.id returning * into p;
  elsif p.decision <> p_decision or p.wants_revision is distinct from p_wants_revision then
    raise exception 'Resposta já registrada' using errcode = '23505';
  end if;
  return jsonb_build_object('decision',p.decision,'wantsRevision',p.wants_revision,'respondedAt',p.responded_at);
end;
$$;

create function public.manage_proposal(p_company uuid,p_id uuid,p_action text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_company_access(p_company,'catalog.write') then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_action = 'read' then
    update public.commercial_proposals set notification_read_at = coalesce(notification_read_at,clock_timestamp())
      where id = p_id and company_id = p_company and responded_at is not null;
  elsif p_action = 'revoke' then
    update public.commercial_proposals set revoked_at = coalesce(revoked_at,clock_timestamp())
      where id = p_id and company_id = p_company;
  else raise exception 'Ação inválida' using errcode = '22023';
  end if;
  if not found then raise exception 'Proposta indisponível' using errcode = '42501'; end if;
end;
$$;

revoke all on function public.issue_proposal(uuid,uuid),public.manage_proposal(uuid,uuid,text),
  public.read_public_proposal(text),public.respond_public_proposal(text,text,boolean) from public,anon,authenticated;
grant execute on function public.issue_proposal(uuid,uuid),public.manage_proposal(uuid,uuid,text) to authenticated;
grant execute on function public.read_public_proposal(text),public.respond_public_proposal(text,text,boolean) to service_role;
commit;
