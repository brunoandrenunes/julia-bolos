# Sistema Julia Ronsoni Bolos

Sistema web do negócio: estoque, compras por nota, financeiro, fechamento mensal, DRE e consolidado anual.

## Como acessar

- Endereço: ver `CLAUDE.md` (site publicado na Vercel).
- Login: e-mail + senha + código do app autenticador (Google Authenticator, Microsoft Authenticator ou similar).
- No primeiro acesso, o sistema mostra um QR code para cadastrar o app autenticador.
- O sistema sai sozinho após 2 horas sem uso ou 12 horas depois do login.

## Onde ficam os dados

- Banco: Supabase, projeto `julia-bolos` (São Paulo). Tabelas no schema `app`, que não é exposto pela API pública.
- O site conecta com um usuário de banco próprio (`bolos_app`), que só lê e grava dados.
- **Backup**: em Relatórios, botão "Baixar backup completo" gera um Excel com todas as tabelas. Guardar no OneDrive, ao menos uma vez por semana e sempre antes de mudanças grandes.

## Estrutura

```text
app/(sistema)/   telas internas (Dashboard, Estoque, Compras, Movimentações, Financeiro, Relatórios)
app/login/       login com senha + autenticador
app/api/         exportação CSV e backup em Excel
lib/data.ts      cálculos (custo médio, CMV, saldos, DRE) e gravações
lib/db.ts        conexão com o banco
proxy.ts         bloqueia quem não estiver logado
supabase/migrations/  estrutura do banco
scripts/importar-sqlite.mjs  carga do banco do sistema antigo (usada na migração)
```

## Regras principais

- Entradas de estoque aumentam o estoque e afetam a conta usada no pagamento.
- Baixas de estoque (contagem física, 1 a 2 vezes por mês) calculam o CMV pelo custo médio.
- Receita, Insumos, Despesa e Retirada alimentam o resultado do período.
- Saldo disponível = Pix + Dinheiro − Cartão de Crédito.
- Compras lançadas pela aba Compras geram entradas de estoque e lançamentos financeiros vinculados; devem ser editadas pela própria compra.
- Meses fechados não aceitam inclusão, edição ou exclusão até serem reabertos.
- Janeiro a março de 2026 existem só como resumo mensal (histórico gerencial); abril em diante tem o detalhe.

## Desenvolvimento (para o Claude)

- `npm run dev` abre em `http://localhost:3100`. Configuração em `.env.local` (fora do GitHub).
- `TESTE_LOCAL_SEM_LOGIN=1` no `.env.local` dispensa o login só no modo de desenvolvimento local.
- Cada envio ao GitHub publica o site na Vercel.
