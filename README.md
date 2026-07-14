# VIZIO Money — app

**Sua vida financeira, finalmente leve.** Controle financeiro pessoal Jan–Dez, PWA instalável, offline-first.
Produto VIZIO · ecossistema INPERSON.

## Como rodar (local)
Abra o `index.html` no navegador (duplo clique já funciona). Para PWA/instalável, sirva a pasta:
```
cd app
python -m http.server 8080
```
Acesse http://localhost:8080

## O que está implementado (v1)
- **12 módulos mensais** (Janeiro→Dezembro) — corrige o Jul–Dez da planilha original.
- **Engine de parcelamento**: cadastra a compra 1x, ela se propaga sozinha pelos meses com “parcela X de Y”.
- **Fatura por competência**: fatura do mês = crédito lançado no mês anterior.
- **Panorama de parcelamento**: projeção visual de quanto de parcela cai em cada mês (alerta nos meses “quentes”).
- **Orçamento por categoria em fases da lua** (○◔◑◕●) — motivo-assinatura da marca.
- **Saldo inicial mensal** herdado automaticamente do mês anterior (ajustável).
- **Cartões & gasto por cartão** (SUMIF), **investimentos** (“Pensando no futuro”).
- **Dashboard anual**: KPIs, saldo por mês, top categorias, panorama.
- **Base**: cartões, categorias e tetos de gasto configuráveis.
- **Free × Pro (R$ 9,90/mês)**: Free = mês atual + 2 cartões; Pro = tudo. Paywall simulado.
- **Backup**: exportar/importar `.json`, dados no dispositivo.

## Marca (trocável)
Toda a identidade está isolada:
- `brand.css` — tokens de cor/tipografia + wordmark.
- `brand/logo.svg` + `brand/icon-*.png` — símbolo e ícones.
Trocar a identidade = substituir esses arquivos. **Nada de marca está no `index.html`.**
> A logo atual é **provisória** (aguardando a identidade final).

## Roadmap técnico (próximas fases)
1. **Supabase**: Auth real + Postgres com **RLS** (cada usuário só vê o próprio dado) → fecha o gate LGPD. Trocar a camada de persistência (hoje `localStorage`) por chamadas Supabase.
2. **Stripe / Pix recorrente**: assinatura R$ 9,90/mês; webhook define `plan = 'pro'`.
3. **IA (add-on)**: resumo inteligente e previsão de saldo.
4. **Loja**: empacotar PWA como app (TWA/Capacitor).

## Publicação
Ver `GO-LIVE.md`. Resumo: clicar em `PUBLICAR-VIZIO-MONEY.bat` → GitHub Pages → `money.viziostudio.com.br`.
