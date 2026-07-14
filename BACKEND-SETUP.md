# VIZIO Money — Backend (assinatura real)

Tudo que dependia de configuração já está criado. Faltam **3 passos que exigem credenciais** — só você deve manuseá-las.

## O que já está pronto

| Peça | Estado |
|---|---|
| Produto Stripe **VIZIO Money Pro** (`prod_UsmDOXB9PNpP2l`) | ✅ criado |
| Preço recorrente **R$ 9,90/mês (BRL)** | ✅ criado |
| **Payment Link** `https://buy.stripe.com/bJecN7evH1Zm57CdGTeIw01` | ✅ ativo |
| Webhook Stripe **“VIZIO Money - ativa Pro”** (`we_1Tt15cR4FRyg6dul…`) | ✅ ativo, 4 eventos |
| Tabelas `vm_perfis` + `vm_assinaturas` (Supabase `vizio-core`) | ✅ criadas com RLS |
| Edge Function `vm-stripe-webhook` | ✅ publicada |
| App com login + plano vindo do servidor (`auth.js`) | ✅ integrado |

**Segurança do plano:** `vm_assinaturas` tem *apenas* policy de `SELECT` do próprio registro.
Não existe policy de escrita → **nenhum usuário consegue se tornar Pro sozinho**. Só o
webhook (service_role) escreve.

---

## ⚠️ FALTA APENAS 1 COISA: o secret `VM_STRIPE_WEBHOOK_SECRET`

**Por que esse nome e não `STRIPE_WEBHOOK_SECRET`?**
O projeto **já tem** um `STRIPE_WEBHOOK_SECRET` em uso pela função **`stripe-webhook`** (outro produto).
Cada endpoint do Stripe tem um `whsec_` diferente — **sobrescrever aquele secret quebraria a cobrança
do outro sistema.** Por isso o VIZIO Money usa um secret exclusivo.

### Como fazer (2 minutos)

1. **Copie o segredo do webhook** — abra:
   `https://dashboard.stripe.com/acct_1TlbnXR4FRyg6dul/workbench/webhooks/we_1Tt15cR4FRyg6dulny0v7D7T`
   → painel direito, **“Segredo da assinatura”** → clique no ícone 👁 → copie (`whsec_…`).

2. **Cole no Supabase** — abra:
   `https://supabase.com/dashboard/project/emyjzjadmxgbtmxnzazu/functions/secrets`
   → em *ADD OR REPLACE SECRETS*:
   - **Name:** `VM_STRIPE_WEBHOOK_SECRET`
   - **Value:** cole o `whsec_…`
   → **Save**.

Pronto. Sem isso, a função responde *“Webhook nao configurado”* e ninguém vira Pro.

---

## Já resolvido (não precisa fazer nada)

| Item | Situação |
|---|---|
| `STRIPE_SECRET_KEY` | ✅ já existe no projeto — é da mesma conta Stripe (Inperson), reaproveitado |
| **URLs de autenticação** | ✅ adicionei `https://money.viziostudio.com.br/**` às *Redirect URLs*. O **Site URL continua `gerenciador.viziostudio.com.br`** de propósito: ele é de outro produto e trocá-lo quebraria o login de lá. O app manda o `emailRedirectTo` explícito, então funciona. |
| **SMTP (e-mail de login)** | ✅ já configurado com **Resend** (`smtp.resend.com:465`, remetente `nao-responder@viziostudio.com.br`) |

---

## Como testar (na ordem)

1. Clique no `PUBLICAR-VIZIO-MONEY.bat` (sobe tudo).
2. Abra `https://money.viziostudio.com.br` → **👤** → entre com seu e-mail → clique no link recebido.
3. Toque em **Assinar o Pro** → pague (é conta **real**: use seu cartão e cancele depois).
4. Volte ao app → **“Já paguei — atualizar meu plano”**.
5. Confira: Stripe → webhook → *Entregas de eventos* deve mostrar **200**.
   Supabase → Table Editor → `vm_assinaturas` → sua linha com `plan = 'pro'`.

Se der errado, os logs da função mostram o motivo:
Supabase → *Edge Functions* → `vm-stripe-webhook` → **Logs**.

---

## Opcional (recomendado)

- **Redirect pós-pagamento:** no Payment Link → *Depois do pagamento* → redirecionar para
  `https://money.viziostudio.com.br/?pago=1` (o app já detecta esse parâmetro e ativa o Pro sozinho).
- **Portal do cliente:** Stripe → *Billing* → Customer Portal → permite o assinante cancelar/trocar cartão sozinho.

## Limite conhecido (hoje)

Os **lançamentos financeiros continuam no aparelho** (localStorage) — só o *plano* vem do servidor.
Isso é bom para privacidade/LGPD, mas o usuário não vê os dados em outro celular.
Sincronizar os dados na nuvem é o próximo passo natural (tabelas `vm_*` por usuário com RLS).
