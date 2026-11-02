-- Recria app_teste como cópia fiel de app (estrutura, vínculos e dados). Rodar como postgres:
--   call app_teste.recriar();

create or replace function app_teste.array_reverse(anyarray) returns anyarray
language sql immutable set search_path = '' as
$$ select array(select $1[i] from generate_subscripts($1, 1) as s(i) order by i desc) $$;

create or replace procedure app_teste.recriar()
language plpgsql set search_path = '' as $$
declare
  t text;
  tabelas text[] := array['meta','periods','period_lock_history','period_snapshots','item_categories',
    'payment_methods','movement_types','items','inventory_opening_balances','inventory_entries',
    'inventory_usages','financial_transactions','account_transfers','suppliers','purchases','purchase_items'];
  fk record;
  col record;
begin
  foreach t in array app_teste.array_reverse(tabelas) loop
    execute format('drop table if exists app_teste.%I cascade', t);
  end loop;
  foreach t in array tabelas loop
    execute format('create table app_teste.%I (like app.%I including all)', t, t);
    execute format('insert into app_teste.%I overriding system value select * from app.%I', t, t);
  end loop;
  -- chaves estrangeiras iguais às de app
  for fk in
    select c.conrelid::regclass::text as tabela, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'app' and c.contype = 'f'
  loop
    execute format('alter table app_teste.%I add constraint %I %s',
      split_part(fk.tabela, '.', 2), fk.conname, replace(fk.def, 'app.', 'app_teste.'));
  end loop;
  -- carimbos de hora usam a função do próprio schema de teste
  for col in
    select table_name, column_name from information_schema.columns
    where table_schema = 'app_teste' and column_default like '%agora_texto%'
  loop
    execute format('alter table app_teste.%I alter column %I set default app_teste.agora_texto()', col.table_name, col.column_name);
  end loop;
  -- numeração continua de onde os dados param
  foreach t in array tabelas loop
    if t <> 'meta' then
      execute format('select setval(pg_get_serial_sequence(%L, %L), coalesce((select max(id) from app_teste.%I), 0) + 1, false)',
        'app_teste.' || t, 'id', t);
    end if;
  end loop;
  execute 'grant select, insert, update, delete on all tables in schema app_teste to bolos_teste';
  execute 'grant usage, select, update on all sequences in schema app_teste to bolos_teste';
end $$;
