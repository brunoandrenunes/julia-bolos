# Plano: fichas técnicas, pedidos, agenda e capacidade

Visão do Bruno (02/11/2026): um sistema **único e integrado**. O custo de cada produto se atualiza sozinho
com o preço das compras. Os pedidos (agenda) dizem o que vai ser produzido, quanto já foi recebido e quanto
falta receber, o que vai ser preciso comprar e se ainda cabe mais encomenda no mês.

As fichas técnicas **não baixam estoque**. A baixa continua sendo pela contagem física. As fichas servem
para o gerencial (custo e margem) e para prever compras.

## Como as peças se ligam

```
Compras ──► preço atual de cada item ──► Ficha técnica (receita) ──► custo do produto ──► margem
                                                │
Pedido (cliente, data, produtos, sinal) ────────┼──► recebimentos (financeiro) e saldo a receber
                                                ├──► necessidade de ingredientes por semana ──► Reposição
                                                └──► horas de produção por semana ──► agenda cheia?
Pedido confirmado ──► evento no Google Agenda da Julia
```

## Fases

1. **Fichas técnicas e margem por produto** — pronto em 02/11/2026 (tela Custos)
   - Conteúdo de cada embalagem (395 g, 1 kg, 30 un). Hoje 57 de 108 itens já têm esse dado; o restante
     pode ser sugerido a partir do nome.
   - Receitas com rendimento e tempo de preparo, e receitas-base (massa, recheio) reaproveitadas em outras.
   - Produtos de venda (ex.: bem-casado, bolo 20 cm) com preço de venda e margem-alvo.
   - Tela "Custos e margens": custo de hoje, margem e quais ingredientes mais pesam, com alerta quando a
     margem cair abaixo do alvo.
2. **Pedidos e recebimentos**
   - Cliente, data de entrega, produtos e quantidades, preço e situação (orçamento → confirmado → entregue).
   - Sinal e parcelas: cada recebimento entra no Financeiro já vinculado ao pedido.
   - Relatório de contas a receber por mês e agenda em calendário dentro do sistema.
3. **Google Agenda**
   - Pedido confirmado cria ou atualiza um evento numa agenda "Encomendas" da Julia, com os itens, o saldo e
     o contato. O sistema é a fonte da verdade; a agenda só mostra.
4. **Compras previstas e capacidade**
   - Pedidos × fichas = ingredientes por semana. Os perecíveis são comprados perto da data.
   - Esses números se somam à Reposição, que já usa o consumo do histórico.
   - Horas de produção por semana comparadas com as horas disponíveis da Julia, com alerta de "fechar a
     agenda" e um teste de "cabe esse pedido?" antes de aceitar.

## Decisões do Bruno (02/11/2026)

- **Custo:** sempre o último preço pago.
- **Receita:** continua por caixa. O que for adiantamento de cliente (sinal) entra numa linha própria
  ("Adiantamentos"), separada da receita de entregas, mas reconhecida quando recebida. Fazer junto com os pedidos.
- **Google Agenda:** na conta Google da Julia.
- **Login da Julia:** ela terá login próprio (e-mail + senha + autenticador). Basta criar o usuário dela no
  Supabase Auth e incluir o e-mail em `DONO_EMAIL` (aceita lista). Fazer junto com os pedidos.
- **Ordem:** primeiro o Bruno e a Julia cadastram e precificam os produtos (fase 1, pronta em 02/11/2026,
  tela Custos). Depois vêm os pedidos e a agenda.
