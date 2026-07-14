/* ============================================================
   VIZIO Money — Conta & Assinatura (Supabase Auth + Stripe)
   Carrega DEPOIS do app: usa S, save(), render(), toast().
   O plano NUNCA é decidido aqui — vem de public.vm_assinaturas,
   que só o webhook do Stripe (service_role) consegue escrever.
   ============================================================ */
const VM_SUPABASE_URL = 'https://emyjzjadmxgbtmxnzazu.supabase.co';
const VM_SUPABASE_KEY = 'sb_publishable_PY2YDxUzGgaXRVtvCcasBA_Ml7YUBTC';
const VM_STRIPE_LINK  = 'https://buy.stripe.com/bJecN7evH1Zm57CdGTeIw01';

const vmdb = window.supabase.createClient(VM_SUPABASE_URL, VM_SUPABASE_KEY);
let vmUser = null;
let vmSource = null;   // origem do plano: 'stripe' (pago) | 'cortesia' (isento)

/* ---------- plano vindo do servidor ---------- */
async function vmRefreshPlan(){
  if(!vmUser){ S.plan='free'; save(); render(); return; }
  const { data, error } = await vmdb.from('vm_assinaturas')
    .select('plan,status,source,nota,current_period_end').eq('user_id', vmUser.id).maybeSingle();
  if(error){ console.warn('vm_assinaturas:', error.message); return; }
  const novo = (data && data.plan==='pro') ? 'pro' : 'free';
  vmSource = data?.source || null;          // 'stripe' | 'cortesia'
  if(S.plan!==novo){ S.plan=novo; save(); }
  render();
}
const vmSubscribeUrl = () => vmUser
  ? `${VM_STRIPE_LINK}?client_reference_id=${vmUser.id}&prefilled_email=${encodeURIComponent(vmUser.email||'')}`
  : VM_STRIPE_LINK;

/* ---------- overlay de conta / login ---------- */
function vmAccount(){
  const r = document.getElementById('overlayRoot');
  const logged = !!vmUser;
  r.innerHTML = `<div class="overlay" id="vmov"><div class="sheet">
    <div class="brand-lockup" style="justify-content:center;margin-bottom:14px">
      <span class="brand-mark"><img src="brand/logo.svg" width="18" height="18" alt=""></span>
      <span class="brand-word">VIZIO <b>Money</b></span>
    </div>
    ${logged ? `
      <h2>Sua conta</h2>
      <p style="margin-bottom:10px">${vmUser.email}</p>
      <div style="margin:14px 0"><span class="plan-chip ${S.plan==='pro'?'plan-pro':'plan-free'}">${
        S.plan==='pro' ? (vmSource==='cortesia' ? 'Pro · cortesia (isento)' : 'Pro ativo') : 'Plano Free'
      }</span></div>
      ${S.plan==='pro'
        ? (vmSource==='cortesia'
            ? `<p class="budmeta">Acesso <b>cortesia (isento)</b> — não é uma assinatura paga e não entra no faturamento. Você tem o ano inteiro, cartões ilimitados e a IA de Reflexão.</p>`
            : `<p class="budmeta">Obrigado por assinar. Você tem acesso ao ano inteiro, cartões ilimitados e a IA de Reflexão.</p>`)
        : `<div class="price">R$ 9,90<small>/mês</small></div>
           <button class="btn btn-money" id="vm-sub">Assinar o Pro</button>`}
      ${vmSource==='cortesia' ? '' : `<button class="btn btn-ghost" id="vm-sync" style="width:100%;margin-top:8px">Já paguei — atualizar meu plano</button>`}
      <button class="linklike" id="vm-out">Sair</button>
    ` : `
      <h2>Entrar</h2>
      <p>Enviamos um link de acesso para o seu e-mail. Sem senha para lembrar.</p>
      <input id="vm-email" type="email" inputmode="email" placeholder="seu@email.com"
        style="width:100%;padding:13px;border:1px solid var(--line2);border-radius:10px;background:var(--coal);color:var(--ink);font-size:15px">
      <button class="btn" id="vm-send" style="width:100%;margin-top:10px">Enviar link de acesso</button>
      <p class="budmeta" style="margin-top:12px">Entrar é necessário só para assinar o Pro. Seus lançamentos continuam salvos neste aparelho.</p>
    `}
    <button class="linklike" id="vm-close">Fechar</button>
  </div></div>`;

  document.getElementById('vm-close').onclick = ()=> r.innerHTML='';
  if(logged){
    const sub=document.getElementById('vm-sub');
    if(sub) sub.onclick=()=>{ window.open(vmSubscribeUrl(),'_blank','noopener'); toast('Finalize o pagamento na aba aberta'); };
    const sync=document.getElementById('vm-sync');
    if(sync) sync.onclick=async()=>{ toast('Verificando...'); await vmRefreshPlan(); vmAccount(); };
    document.getElementById('vm-out').onclick=async()=>{ await vmdb.auth.signOut(); r.innerHTML=''; toast('Você saiu'); };
  } else {
    document.getElementById('vm-send').onclick=async()=>{
      const email=document.getElementById('vm-email').value.trim();
      if(!email||!email.includes('@')) return toast('Digite um e-mail válido');
      const { error } = await vmdb.auth.signInWithOtp({ email, options:{ emailRedirectTo: window.location.href } });
      if(error) return toast('Não consegui enviar: '+error.message);
      toast('Link enviado! Confira seu e-mail ✉️');
      r.innerHTML='';
    };
  }
}

/* ---------- paywall real (substitui o simulado) ---------- */
window.paywall = function(reason){
  if(!vmUser){ vmAccount(); toast(reason||'Entre para assinar o Pro'); return; }
  const r=document.getElementById('overlayRoot');
  r.innerHTML=`<div class="overlay"><div class="sheet">
    <div class="brand-lockup" style="justify-content:center;margin-bottom:12px">
      <span class="brand-mark"><img src="brand/logo.svg" width="18" height="18" alt=""></span>
      <span class="brand-word">VIZIO <b>Money</b></span>
    </div>
    <h2>Desbloqueie tudo</h2>
    <p>${reason||'O ano inteiro, sem travas.'}</p>
    <div class="price">R$ 9,90<small>/mês</small></div>
    <div class="feat">
      <div><span class="ck">✔</span> Os 12 meses (Jan–Dez), não só o atual</div>
      <div><span class="ck">✔</span> Cartões e categorias ilimitados</div>
      <div><span class="ck">✔</span> Panorama de parcelamento & relatórios</div>
      <div><span class="ck">✔</span> IA de Reflexão + alertas e dicas</div>
    </div>
    <button class="btn" id="pw-go">Assinar o Pro</button>
    <button class="btn btn-ghost" id="pw-sync" style="width:100%;margin-top:8px">Já paguei — atualizar</button>
    <button class="linklike" id="pw-close">Agora não</button>
  </div></div>`;
  document.getElementById('pw-go').onclick=()=>{ window.open(vmSubscribeUrl(),'_blank','noopener'); toast('Finalize o pagamento na aba aberta'); };
  document.getElementById('pw-sync').onclick=async()=>{ toast('Verificando...'); await vmRefreshPlan(); r.innerHTML=''; };
  document.getElementById('pw-close').onclick=()=> r.innerHTML='';
};

/* ---------- init ---------- */
(async function vmInit(){
  const btn=document.getElementById('btnMenu');
  if(btn) btn.onclick=vmAccount;                       // substitui o handler simulado
  const { data:{ session } } = await vmdb.auth.getSession();
  vmUser = session?.user ?? null;
  await vmRefreshPlan();
  vmdb.auth.onAuthStateChange(async (_e, s)=>{
    const antes = vmUser?.id;
    vmUser = s?.user ?? null;
    if(vmUser?.id !== antes){ await vmRefreshPlan(); if(vmUser) toast('Bem-vindo, '+vmUser.email); }
  });
  // veio da landing clicando em "Assinar" -> abre o fluxo de conta/assinatura
  if(location.search.includes('assinar=1') && S.plan!=='pro'){
    vmUser ? window.paywall('Assine e desbloqueie o ano inteiro.') : vmAccount();
  }
  // volta do Stripe: confere o plano algumas vezes (webhook leva 1-2s)
  if(location.search.includes('pago=1')){
    for(let i=0;i<5;i++){ await new Promise(r=>setTimeout(r,2000)); await vmRefreshPlan(); if(S.plan==='pro'){ toast('Pro ativado! 🎉'); break; } }
  }
})();
