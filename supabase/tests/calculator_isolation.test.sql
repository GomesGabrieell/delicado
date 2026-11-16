begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

insert into auth.users (id, email) values
  ('11000000-0000-0000-0000-000000000021', 'calc-admin@example.test'),
  ('11000000-0000-0000-0000-000000000022', 'calc-member@example.test'),
  ('11000000-0000-0000-0000-000000000023', 'calc-other@example.test');
insert into public.companies (id, name) values
  ('22000000-0000-0000-0000-000000000021', 'A'),
  ('22000000-0000-0000-0000-000000000022', 'B');
insert into public.company_members (company_id, user_id, role, status) values
  ('22000000-0000-0000-0000-000000000021', '11000000-0000-0000-0000-000000000021', 'admin', 'active'),
  ('22000000-0000-0000-0000-000000000021', '11000000-0000-0000-0000-000000000022', 'member', 'active'),
  ('22000000-0000-0000-0000-000000000022', '11000000-0000-0000-0000-000000000023', 'owner', 'active');
insert into public.catalog_items (id, company_id, kind, name, brand, size, balloon_type, package_quantity, package_price) values
  ('33000000-0000-0000-0000-000000000021', '22000000-0000-0000-0000-000000000021', 'balloon', 'A', 'M', '10', 'L', 10, 12.34),
  ('33000000-0000-0000-0000-000000000022', '22000000-0000-0000-0000-000000000022', 'balloon', 'B', 'M', '10', 'L', 10, 20);

set local role authenticated;
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000021';
select results_eq($$select package_price from public.catalog_financials(
  '22000000-0000-0000-0000-000000000021', array['33000000-0000-0000-0000-000000000021'::uuid])$$,
  array['12.34'], 'Admin consulta preço exato como texto decimal');
select is((select count(*) from public.catalog_financials(
  '22000000-0000-0000-0000-000000000021', array['33000000-0000-0000-0000-000000000022'::uuid])),
  0::bigint, 'Admin não obtém preço de item de outra empresa');
select lives_ok($$select public.set_calculator_default('22000000-0000-0000-0000-000000000021', 20)$$, 'Admin grava padrão');
select lives_ok($$select public.set_calculator_default('22000000-0000-0000-0000-000000000021', 30)$$, 'Admin atualiza padrão');

set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000022';
select throws_ok('select package_price from public.catalog_items', '42501', null, 'Funcionário não lê custo diretamente');
select throws_ok($$select * from public.catalog_financials(
  '22000000-0000-0000-0000-000000000021', array['33000000-0000-0000-0000-000000000021'::uuid])$$,
  '42501', null, 'Funcionário não usa RPC de custos');
select is((select count(*) from public.calculator_defaults), 0::bigint, 'Funcionário não lê lucro padrão');
select throws_ok($$select public.set_calculator_default('22000000-0000-0000-0000-000000000021', 10)$$,
  '42501', null, 'Funcionário não altera lucro padrão');
select lives_ok($$insert into public.calculator_drafts (company_id, name, lines) values
  ('22000000-0000-0000-0000-000000000021', 'Composição', '[{"id":"33000000-0000-0000-0000-000000000021","quantity":"2"}]')$$,
  'Funcionário salva sua composição');
select throws_ok($$update public.calculator_drafts set lines =
  '[{"id":"33000000-0000-0000-0000-000000000022","quantity":"2"}]'$$,
  '23514', null, 'Não aceita produto de outra empresa');
select throws_ok($$update public.calculator_drafts set lines =
  '[{"id":"33000000-0000-0000-0000-000000000021","quantity":"2","price":100}]'$$,
  '23514', null, 'Composição não recebe parâmetros financeiros');
select throws_ok($$update public.calculator_drafts set lines =
  '[{"id":"33000000-0000-0000-0000-000000000021","quantity":"2.5"}]'$$,
  '23514', null, 'Balões exigem quantidade inteira');
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000021';
select is((select count(*) from public.calculator_drafts), 1::bigint, 'Admin revisa a composição do funcionário');
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000023';
select is((select count(*) from public.calculator_drafts), 0::bigint, 'Outra empresa não lê a composição');
select * from finish();
rollback;
