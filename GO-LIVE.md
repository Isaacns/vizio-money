# VIZIO Money — Go-Live (money.viziostudio.com.br)

Publicação em **GitHub Pages** (mesmo padrão dos produtos VIZIO). Uma vez configurado, publicar = **clicar no `PUBLICAR-VIZIO-MONEY.bat`**.

## Passo a passo (só na 1ª vez)

1. ✅ **Repositório criado:** `https://github.com/Isaacns/vizio-money` (público, sem dados pessoais).
2. ✅ **`.bat` já configurado** com o `REPO_URL` correto.
3. **Clique** no `PUBLICAR-VIZIO-MONEY.bat`. Ele envia a pasta `app/` para o GitHub.
4. No GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
5. **DNS (onde o viziostudio.com.br está registrado)** → crie um registro:
   `CNAME  money  →  Isaacns.github.io`
6. No GitHub Pages, em *Custom domain*, confirme `money.viziostudio.com.br` e marque **Enforce HTTPS**.
7. Acesse **https://money.viziostudio.com.br** — no ar. 🎉

> O hub `viziostudio.com.br` (vitrine da linha VIZIO) é publicado separadamente; este repositório serve **só o produto Money**.

## Publicações seguintes
Só clicar no `.bat` de novo. Cada clique envia a versão atual e o Pages atualiza em ~1 min.

## Alternativa (sem GitHub)
Qualquer host estático serve: suba a pasta `app/` inteira em Netlify, Vercel, Cloudflare Pages ou na hospedagem do domínio. Aponte `money.viziostudio.com.br` para lá.
