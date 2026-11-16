begin;

create function public.create_quote_from_calculator(
  p_company uuid,p_title text,p_lines jsonb,p_snapshot jsonb default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare quote_id uuid;
declare quote_version timestamptz;
begin
  insert into public.quotes(company_id,title)
  values(p_company,btrim(p_title))
  returning id,updated_at into quote_id,quote_version;

  perform public.save_quote_composition(p_company,quote_id,quote_version,p_lines,p_snapshot);
  return quote_id;
end;
$$;

revoke all on function public.create_quote_from_calculator(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_quote_from_calculator(uuid,text,jsonb,jsonb) to authenticated;
commit;
