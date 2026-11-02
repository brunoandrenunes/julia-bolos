-- Parâmetros de reposição por item (não altera dados existentes).
-- low_stock_threshold continua sendo o estoque mínimo (ponto de compra).
alter table app.items add column if not exists target_stock double precision;
alter table app.items add column if not exists reorder_cycle_days integer check (reorder_cycle_days is null or reorder_cycle_days between 1 and 120);
alter table app.items add column if not exists replenishment_updated_at text;
comment on column app.items.target_stock is 'Estoque-alvo: comprar até esta quantidade quando o saldo cair abaixo do mínimo.';
comment on column app.items.reorder_cycle_days is 'Ciclo de compra desejado (dias) para este item; vazio = padrão do sistema.';
call app_teste.recriar();
