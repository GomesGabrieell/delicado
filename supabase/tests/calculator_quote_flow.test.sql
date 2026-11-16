begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(7);

insert into auth.users(id,email) values
 ('11000000-0000-0000-0000-000000000071','flow@example.test'),
 ('11000000-0000-0000-0000-000000000072','other-flow@example.test');
insert into public.companies(id,name) values
 ('22000000-0000-0000-0000-000000000071','Teste A'),
 ('22000000-0000-0000-0000-000000000072','Teste B');
insert into public.company_members(company_id,user_id,role,status) values
 ('22000000-0000-0000-0000-000000000071','11000000-0000-0000-0000-000000000071','member','active'),
 ('22000000-0000-0000-0000-000000000072','11000000-0000-0000-0000-000000000072','owner','active');
insert into public.catalog_items(id,company_id,kind,name,brand,size,balloon_type,package_quantity,package_price) values
 ('33000000-0000-0000-0000-000000000071','22000000-0000-0000-0000-000000000071','balloon','Balão','Marca','10','Látex',10,12);

set local role authenticated;
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000071';
select lives_ok($$select public.create_quote_from_calculator(
 '22000000-0000-0000-0000-000000000071','Composição',
 '[{"id":"33000000-0000-0000-0000-000000000071","quantity":"2"}]')$$,'Funcionário cria orçamento com item real');
select is((select items->0->>'quantity' from public.quotes),'2','Composição persistida');
select throws_ok($$select public.create_quote_from_calculator(
 '22000000-0000-0000-0000-000000000071','Inválido','[]')$$,'23514',null,'Composição inválida falha');
select is((select count(*) from public.quotes),1::bigint,'Falha não deixa orçamento vazio');
select throws_ok($$select public.create_quote_from_calculator(
 '22000000-0000-0000-0000-000000000071','Financeiro',
 '[{"id":"33000000-0000-0000-0000-000000000071","quantity":"2"}]','{}')$$,
 '42501',null,'Funcionário não registra cálculo restrito');
select throws_ok($$select public.create_quote_from_calculator(
 '22000000-0000-0000-0000-000000000072','Outra empresa','[]')$$,'42501',null,'Não cria em outra empresa');
select is((select count(*) from public.quotes),1::bigint,'Bloqueios não deixam rascunhos parciais');
select * from finish();
rollback;
