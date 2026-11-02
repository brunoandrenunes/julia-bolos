# Projeto: Sistema Julia Ronsoni Bolos (estoque, compras, financeiro, DRE)

- Usuário: Bruno (contador, não programa). Explicar em português simples; Claude conduz as escolhas técnicas. Só o Bruno entra no sistema (a Julia usa o login dele se precisar).
- Visão de futuro (não fazer sem pedido): custos dos bolos (fichas técnicas), gerencial, agenda da Julia integrada ao Google Agenda. Manter o sistema lógico e profissional.
- **Site publicado**: https://julia-bolos.vercel.app (Vercel projeto `julia-bolos`, time `financial14`, região gru1; cada `git push` para `brunoandrenunes/julia-bolos` publica). Verificação: `/api/saude` (só diz se o banco responde).
- **Virada feita em 02/11/2026**: banco da nuvem carregado do SQLite local (cópia em `data/backups/bakery-system-virada-*.sqlite`). Desde então os lançamentos são só no site.
- Diagnóstico e plano: `AUDITORIA.md`. Uso e estrutura: `README.md`.
- Código: `D:\Dev\Julia Ronsoni Bolos` (fora do OneDrive). Next.js 16 (ler `node_modules/next/dist/docs` antes de mexer em convenções; `middleware` agora é `proxy.ts`).
- Banco: Supabase projeto `julia-bolos`, id `eknjtklvccuoonhvscyh`, sa-east-1. Tabelas no schema `app` (não exposto pela API). O site conecta como papel `bolos_app` com o pacote `pg` pelo pooler em **modo transação** (porta 6543, forçada em `lib/db.ts`). Não usar o modo sessão (limite de 15 conexões estoura na Vercel) nem o pacote `postgres` no site (trava no modo transação). Desenvolvimento local usa a cópia `app_teste` (papel `bolos_teste`, `DATABASE_URL_TESTE`); recriar com `call app_teste.recriar();`. Senha só em `.env.local` e na Vercel.
- Login: Supabase Auth, e-mail + senha + TOTP (aal2) e e-mail na lista `DONO_EMAIL`. Conferido no `proxy.ts` e em toda leitura/gravação (`lib/auth.ts`). Teste local sem login: `TESTE_LOCAL_SEM_LOGIN=1` (só vale em `npm run dev`).
- Migrações em `supabase/migrations`. Carga do sistema antigo: `node scripts/importar-sqlite.mjs <arquivo> [--substituir]` (transação única, confere contagens e somas).
- Sistema antigo (local, sql.js): `D:\Bruno\OneDrive\Bruno\Julia Ronsoni Bolos\2026\Sistema\2026-04-21-files-mentioned-by-the-user-04`. Não alterar o banco de lá; depois da virada vira só consulta.
- Dados reais nunca vão para o GitHub (`data/`, `*.sqlite`, `.env*` ignorados).
- Decisões do Bruno (02/11): itens ficam separados por embalagem comprada (creme de leite 200 g × 1 kg depende da promoção; a Julia conta por embalagem). Ovos só por unidade ("Ovo - 1Dz" arquivado). Mínimos de estoque devem vir do histórico (tela Reposição), não de chute. Tema claro é o padrão.
- Reposição (`lib/analise.ts`): consumo diário = baixas ÷ dias entre contagens (contagens a ≤7 dias viram uma; janela 210 dias); mínimo = consumo × 7 dias + z·σ·7; alvo = mínimo + consumo × ciclo (padrão 14 dias). Salvos em `items.low_stock_threshold`, `target_stock`, `reorder_cycle_days`.
- Regras de negócio: baixas de estoque são contagens físicas (1–2 por mês), não consumo diário. Compras pela aba Compras geram entradas de estoque e lançamentos financeiros vinculados. Jan–mar/2026 só como resumo mensal (`period_snapshots`).
- Antes de mexer em dados: backup (botão "Baixar backup completo" ou export), e comparar quantidades antes/depois.
