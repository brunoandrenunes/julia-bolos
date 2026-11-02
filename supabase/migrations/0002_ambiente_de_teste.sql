-- Cópia de teste do schema app, usada só no desenvolvimento local (papel bolos_teste).
-- A senha do papel é definida à parte (fora do repositório).
create schema if not exists app_teste;
revoke all on schema app_teste from public, anon, authenticated;

create or replace function app_teste.agora_texto() returns text
language sql stable set search_path = '' as
$$ select to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bolos_teste') then
    create role bolos_teste login noinherit;
  end if;
end $$;
alter role bolos_teste set search_path = app_teste;
grant usage on schema app_teste to bolos_teste;
grant execute on function app_teste.agora_texto() to bolos_teste;
