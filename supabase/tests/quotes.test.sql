begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(25);

insert into auth.users(id,email) values
 ('11000000-0000-0000-0000-000000000041','admin-quotes@example.test'),
 ('11000000-0000-0000-0000-000000000042','member-quotes@example.test'),
 ('11000000-0000-0000-0000-000000000043','other-quotes@example.test');
insert into public.companies(id,name) values
 ('22000000-0000-0000-0000-000000000041','Empresa A'),
 ('22000000-0000-0000-0000-000000000042','Empresa B');
insert into public.company_members(company_id,user_id,role,status) values
 ('22000000-0000-0000-0000-000000000041','11000000-0000-0000-0000-000000000041','owner','active'),
 ('22000000-0000-0000-0000-000000000041','11000000-0000-0000-0000-000000000042','member','active'),
 ('22000000-0000-0000-0000-000000000042','11000000-0000-0000-0000-000000000043','owner','active');
insert into public.quote_clients(id,company_id,name) values
 ('33000000-0000-0000-0000-000000000041','22000000-0000-0000-0000-000000000041','Cliente A'),
 ('33000000-0000-0000-0000-000000000042','22000000-0000-0000-0000-000000000042','Cliente B');
insert into public.catalog_items(id,company_id,kind,name,brand,size,balloon_type,package_quantity,package_price)
 values('44000000-0000-0000-0000-000000000041','22000000-0000-0000-0000-000000000041','balloon','Balão','Marca','10','Látex',10,10);

set local role authenticated;
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000042';
select lives_ok($$insert into public.quotes(company_id,client_id,title,event_date,location)
 values('22000000-0000-0000-0000-000000000041','33000000-0000-0000-0000-000000000041','Evento','2027-01-10','Salão')$$,
 'Funcionário cria rascunho');
select matches((select code from public.quotes), '^DB-[0-9]{4}-000001$', 'Código inicial por empresa e ano');
select throws_ok($$update public.quotes set client_id = '33000000-0000-0000-0000-000000000042'$$,
 '23503', null, 'Cliente de outra empresa é rejeitado');
select throws_ok($$update public.quotes set status = 'ready'$$, '42501', null, 'Funcionário não muda estado restrito');
select lives_ok($$select public.save_quote_composition(company_id,id,updated_at,
 '[{"id":"44000000-0000-0000-0000-000000000041","quantity":"2"}]') from public.quotes$$, 'Funcionário salva composição');
select throws_ok($$select public.save_quote_composition(company_id,id,updated_at,'[]','{}') from public.quotes$$,
 '42501', null, 'Funcionário não registra valores');

set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000041';
select lives_ok($$select public.save_quote_composition(company_id,id,updated_at,
 '[{"id":"44000000-0000-0000-0000-000000000041","quantity":"2"}]',
 '{"catalogCost":"200","markup":"0","expenses":"0","transport":"0","labor":"0","totalCost":"200","gross":"250","discount":"0","sale":"250","profit":"50","margin":"2000","expenseNames":[],"inputs":{"lines":[{"kind":"balloon","quantity":"2","packageSize":"10","packagePrice":"1000","whole":false}],"expenses":[],"transport":{"kind":"pickup"},"labor":"0","profitPercent":"2500","discount":{"kind":"fixed","value":"0"}}}') from public.quotes$$,
 'Administrador registra cálculo');
select is((select count(*) from public.quote_history where action = 'edited'),0::bigint,
 'Salvar a composição ou o cálculo não duplica eventos de edição');
select throws_ok($$select public.save_quote_composition(q.company_id,q.id,q.updated_at,
 '[{"id":"44000000-0000-0000-0000-000000000041","quantity":"2"}]',
 jsonb_set(f.snapshot,'{inputs,profitPercent}','"5000"')) from public.quotes q
 join public.quote_financials f on f.quote_id = q.id$$,
 '23514', null, 'Servidor rejeita parâmetros incompatíveis com os totais');
select throws_ok($$select public.save_quote_composition(company_id,id,'2000-01-01',
 '[{"id":"44000000-0000-0000-0000-000000000041","quantity":"2"}]') from public.quotes$$,
 '40001', null, 'Edição concorrente rejeitada');
update public.catalog_items set package_price = 99;
select is((select snapshot->>'totalCost' from public.quote_financials),'200','Alteração do catálogo preserva custo registrado');
select lives_ok($$insert into storage.objects(bucket_id,name)
 select 'quote-inspiration',company_id::text || '/' || id::text || '/55000000-0000-0000-0000-000000000041.jpg'
 from public.quotes$$,'Upload autorizado no rascunho da empresa');
select lives_ok($$select public.attach_quote_image(company_id,id,company_id::text || '/' || id::text ||
 '/55000000-0000-0000-0000-000000000041.jpg') from public.quotes$$,'Imagem anexada ao rascunho');
select lives_ok($$select public.attach_quote_image(company_id,id,company_id::text || '/' || id::text ||
 '/55000000-0000-0000-0000-000000000041.jpg') from public.quotes$$,'Repetir anexação é seguro');
select is((select count(*) from public.quote_history where action = 'image'),1::bigint,
 'Uma imagem gera um único evento mesmo com nova tentativa');
select lives_ok($$update public.quotes set status = 'ready'$$,'Orçamento completo fica pronto para revisão');
select throws_ok($$update public.quotes set title = 'Mudança'$$,'23514',null,'Orçamento pronto exige reabertura');
select lives_ok($$select public.duplicate_quote(company_id,id) from public.quotes$$,'Administrador duplica orçamento');
select is((select max(right(code,6)) from public.quotes where status = 'draft'),'000002','Duplicação recebe novo código');
select is((select count(*) from public.quote_financials where snapshot->>'sale' = '250'),2::bigint,'Cópia preserva valores');
select is((select count(*) from public.quote_history where action = 'duplicated'),1::bigint,'Histórico registra duplicação');
select is((select count(*) from public.quote_images),2::bigint,'Cópia mantém referências das imagens');

set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000042';
select is((select count(*) from public.quote_financials),0::bigint,'Funcionário não lê valores registrados');
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000043';
select is((select count(*) from public.quotes),0::bigint,'Outra empresa não acessa orçamentos');
select is((select count(*) from storage.objects where bucket_id = 'quote-inspiration'),0::bigint,'Outra empresa não acessa imagens');
select * from finish();
rollback;
