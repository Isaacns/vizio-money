/* ===========================================================================
 * VIZIO Money — Acesso, Conta e Gating   ·  v1.0
 * Segue o padrão já validado no Vizio Finance (gating.js do Gerenciador de
 * Financiamento): autenticar › carregar perfil › conferir assinatura.
 *
 *  MASTER (vm_perfis.is_admin) ..... acesso total, sem banner, sem assinatura.
 *  active | trialing ............... libera tudo.
 *  past_due ....................... LIBERA + faixa âmbar (carência 3 dias).
 *  canceled | incomplete | none ... Free (mês atual + próximo). Não destrói
 *                                   dados: o app continua usável, só limitado.
 *
 * Diferença consciente vs. o Financiamento: lá, sem assinatura = bloqueio.
 * Aqui o produto é B2C de R$ 9,90 e o Free É o funil — bloquear a porta
 * mataria a conversão. O "portão" do Money é o Pro, não o acesso.
 *
 * Falha aberta: erro de rede NUNCA tranca o usuário fora do que já é dele.
 * =========================================================================== */
const VM_SUPABASE_URL = 'https://emyjzjadmxgbtmxnzazu.supabase.co';
const VM_SUPABASE_KEY = 'sb_publishable_PY2YDxUzGgaXRVtvCcasBA_Ml7YUBTC';
const VM_STRIPE_LINK  = 'https://buy.stripe.com/bJecN7evH1Zm57CdGTeIw01';
const VM_PASTDUE_GRACE_DAYS = 3;

const vmdb = window.supabase.createClient(VM_SUPABASE_URL, VM_SUPABASE_KEY);

const VM = {
  user:null, perfil:null, assina:null,
  admin:false, status:'none', source:null, pastDueGrace:false, ready:false
};
window.VM = VM;

/* ================= estado ================= */
async function vmCarregarSessao(){
  const { data:{ session } } = await vmdb.auth.getSession();
  VM.user = session?.user ?? null;
  if(!VM.user){ VM.perfil=null; VM.assina=null; VM.admin=false; VM.status='none'; VM.source=null; VM.ready=true; return; }

  const [perfil, assina] = await Promise.all([
    vmdb.from('vm_perfis').select('nome,is_admin,hourly_wage').eq('user_id',VM.user.id).maybeSingle(),
    vmdb.from('vm_assinaturas').select('plan,status,source,current_period_end').eq('user_id',VM.user.id).maybeSingle()
  ]);

  VM.perfil = perfil.data || null;
  VM.assina = assina.data || null;
  VM.admin  = !!VM.perfil?.is_admin;
  VM.status = VM.assina?.status || 'none';
  VM.source = VM.assina?.source || null;

  /* past_due: carência contada do fim do período pago (igual ao Finance) */
  VM.pastDueGrace = false;
  if(VM.status === 'past_due'){
    const end = VM.assina?.current_period_end ? new Date(VM.assina.current_period_end) : null;
    const limite = end && !isNaN(end) ? end.getTime() + VM_PASTDUE_GRACE_DAYS*864e5 : Date.now()+864e5;
    VM.pastDueGrace = Date.now() < limite;
  }

  const ativo = VM.admin
    || VM.assina?.plan === 'pro' && (VM.status==='active' || VM.status==='trialing')
    || VM.pastDueGrace;

  const novo = ativo ? 'pro' : 'free';
  if(S.plan !== novo){ S.plan = novo; save(); }
  if(VM.perfil?.hourly_wage && !S.hourlyWage){ S.hourlyWage = VM.perfil.hourly_wage; save(); }
  VM.ready = true;
}

async function vmRefreshPlan(){ await vmCarregarSessao(); vmChrome(); render(); }

const vmSubscribeUrl = () => VM.user
  ? `${VM_STRIPE_LINK}?client_reference_id=${VM.user.id}&prefilled_email=${encodeURIComponent(VM.user.email||'')}`
  : VM_STRIPE_LINK;

/* ================= campo de senha com "exibir" =================
   Um só lugar define o campo de senha do produto inteiro — assim o botão de
   olho não sai do lugar (nem some) quando alguém mexer numa tela só. */
function vmCampoSenha(id, label, autocomplete, placeholder){
  return `<div class="vm-field">
    <label for="${id}">${label}</label>
    <div class="vm-pw">
      <input id="${id}" type="password" autocomplete="${autocomplete}"
             placeholder="${placeholder||''}" required>
      <button type="button" class="vm-eye" data-pw="${id}"
              aria-label="Exibir senha" aria-pressed="false" title="Exibir senha">
        ${vmIconOlho(false)}
      </button>
    </div></div>`;
}
function vmIconOlho(aberto){
  return aberto
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2"/><path d="M9.4 5.2A9.5 9.5 0 0 1 12 5c5 0 9 4.5 9 7a12 12 0 0 1-2.4 3.3M6.2 6.7C3.9 8.2 3 10.6 3 12c0 2.5 4 7 9 7 1.3 0 2.5-.3 3.6-.8"/></svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12s3.6-7 9-7 9 7 9 7-3.6 7-9 7-9-7-9-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
/* Liga todos os olhos da tela atual. Chamado depois de cada innerHTML. */
function vmLigarOlhos(raiz){
  raiz.querySelectorAll('.vm-eye').forEach(b=>{
    b.onclick = ()=>{
      const inp = document.getElementById(b.dataset.pw);
      if(!inp) return;
      const mostrar = inp.type === 'password';
      inp.type = mostrar ? 'text' : 'password';
      b.innerHTML = vmIconOlho(mostrar);
      b.setAttribute('aria-pressed', String(mostrar));
      const t = mostrar ? 'Ocultar senha' : 'Exibir senha';
      b.setAttribute('aria-label', t); b.title = t;
      /* devolve o cursor ao fim do texto: trocar o type joga o cursor pro início */
      const p = inp.value.length; inp.focus(); try{ inp.setSelectionRange(p,p); }catch(e){}
    };
  });
}

/* ================= chrome (topbar + faixa) ================= */
function vmChrome(){
  const chip = document.getElementById('planChip');
  if(chip){
    if(VM.admin){ chip.className='plan-chip plan-master'; chip.textContent='MASTER'; }
    else if(S.plan==='pro'){ chip.className='plan-chip plan-pro';
      chip.textContent = VM.source==='cortesia' ? 'Pro · cortesia' : 'Pro'; }
    else { chip.className='plan-chip plan-free'; chip.textContent='Free'; }
  }
  const btn = document.getElementById('btnMenu');
  if(btn) btn.title = VM.user ? VM.user.email : 'Entrar';

  /* faixa de pagamento pendente (carência) */
  const velha = document.getElementById('vmBanner');
  if(velha) velha.remove();
  if(VM.pastDueGrace){
    const b=document.createElement('div'); b.id='vmBanner'; b.className='vm-banner';
    b.innerHTML=`<span>Pagamento pendente — regularize para manter o Pro.</span>
      <button class="btn btn-money btn-sm" id="vm-fix">Resolver</button>`;
    document.querySelector('.topbar').insertAdjacentElement('afterend', b);
    document.getElementById('vm-fix').onclick=()=>window.open(vmSubscribeUrl(),'_blank','noopener');
  }
}

/* ================= tela de acesso (login/criar/recuperar) ================= */
let vmTab = 'entrar';
function vmAccount(){
  const r = document.getElementById('overlayRoot');
  if(VM.user) return vmMinhaConta();

  r.innerHTML = `<div class="overlay"><form class="sheet" id="vm-form" autocomplete="on">
    <!-- marca viva: anel girando + símbolo flutuando e batendo (padrão VIZIO) -->
    <div class="vm-ring"><div class="vm-core"><img src="brand/logo.svg?v=0.4" alt="VIZIO Money"></div></div>
    <div style="text-align:center;margin-bottom:6px">
      <span class="brand-word">VIZIO <b>Money</b></span>
      <span class="brand-badge" style="display:block;margin-top:3px">VIZIO Finance</span>
    </div>
    <div class="vm-tabs">
      <button type="button" class="vm-tab ${vmTab==='entrar'?'on':''}" data-t="entrar">Entrar</button>
      <button type="button" class="vm-tab ${vmTab==='criar'?'on':''}" data-t="criar">Criar conta</button>
    </div>
    <div class="vm-err" id="vm-err"></div>

    ${vmTab==='criar' ? `
      <div class="vm-field"><label for="vm-nome">Nome</label>
        <input id="vm-nome" autocomplete="name" placeholder="Como te chamamos?"></div>` : ``}

    <div class="vm-field"><label for="vm-email">E-mail</label>
      <input id="vm-email" type="email" inputmode="email" autocomplete="username" placeholder="seu@email.com" required></div>

    ${vmCampoSenha('vm-pass','Senha',
        vmTab==='criar' ? 'new-password' : 'current-password',
        vmTab==='criar' ? 'mínimo 8 caracteres' : 'sua senha')}

    <button class="btn" type="submit" id="vm-go" style="width:100%;margin-top:4px">
      ${vmTab==='criar' ? 'Criar minha conta' : 'Entrar'}</button>

    ${vmTab==='entrar' ? `<button type="button" class="linklike" id="vm-forgot">Esqueci minha senha</button>` : ``}
    <p class="budmeta" style="margin-top:8px">Entrar é preciso só para assinar e levar seus dados de aparelho. Seus lançamentos ficam salvos neste dispositivo.</p>
    <button type="button" class="linklike" id="vm-close">Fechar</button>
  </form></div>`;

  const err = m => { const e=document.getElementById('vm-err'); e.textContent=m; e.style.display=m?'block':'none'; };
  r.querySelectorAll('.vm-tab').forEach(b=>b.onclick=()=>{ vmTab=b.dataset.t; vmAccount(); });
  document.getElementById('vm-close').onclick=()=> r.innerHTML='';
  vmLigarOlhos(r);

  const forgot=document.getElementById('vm-forgot');
  if(forgot) forgot.onclick=async()=>{
    const email=document.getElementById('vm-email').value.trim();
    if(!email) return err('Digite seu e-mail primeiro.');
    const { error } = await vmdb.auth.resetPasswordForEmail(email,{ redirectTo: location.href.split('#')[0] });
    error ? err(error.message) : (toast('Enviamos o link de redefinição ✉️'), r.innerHTML='');
  };

  document.getElementById('vm-form').onsubmit = async (ev)=>{
    ev.preventDefault(); err('');
    const email=document.getElementById('vm-email').value.trim();
    const pass =document.getElementById('vm-pass').value;
    const go=document.getElementById('vm-go'); go.disabled=true; go.textContent='Aguarde…';

    try{
      if(vmTab==='criar'){
        if(pass.length<8){ err('A senha precisa de pelo menos 8 caracteres.'); return; }
        const nome=document.getElementById('vm-nome').value.trim();
        const { error } = await vmdb.auth.signUp({ email, password:pass,
          options:{ data:{ nome }, emailRedirectTo: location.href.split('#')[0] } });
        if(error) throw error;
        const { data:{ session } } = await vmdb.auth.getSession();
        if(!session){ toast('Conta criada! Confirme o e-mail para entrar ✉️'); r.innerHTML=''; return; }
        if(nome) await vmdb.from('vm_perfis').update({ nome }).eq('user_id', session.user.id);
      } else {
        const { error } = await vmdb.auth.signInWithPassword({ email, password:pass });
        if(error) throw error;
      }
      await vmRefreshPlan();
      r.innerHTML='';
      toast(VM.admin ? 'Acesso MASTER liberado' : 'Bem-vindo de volta!');
    }catch(e){
      const m=(e.message||'').toLowerCase();
      err(m.includes('invalid login') ? 'E-mail ou senha incorretos.'
        : m.includes('already registered') ? 'Esse e-mail já tem conta. Use Entrar.'
        : m.includes('email not confirmed') ? 'Confirme seu e-mail antes de entrar.'
        : e.message || 'Não consegui completar. Tente de novo.');
    }finally{
      const g=document.getElementById('vm-go');
      if(g){ g.disabled=false; g.textContent = vmTab==='criar' ? 'Criar minha conta' : 'Entrar'; }
    }
  };
}

/* ================= minha conta ================= */
function vmMinhaConta(){
  const r = document.getElementById('overlayRoot');
  const nome = VM.perfil?.nome || VM.user.email;
  const selo = VM.admin ? 'MASTER · acesso total'
    : S.plan==='pro' ? (VM.source==='cortesia' ? 'Pro · cortesia (isento)' : 'Pro ativo') : 'Plano Free';

  r.innerHTML = `<div class="overlay"><div class="sheet">
    <div class="brand-lockup" style="justify-content:center;margin-bottom:12px">
      <span class="brand-mark"><img src="brand/logo.svg?v=0.4" width="30" height="27" alt=""></span>
      <span class="brand-word">VIZIO <b>Money</b></span>
    </div>
    <h2>Sua conta</h2>
    <p style="margin-bottom:6px">${esc(nome)}<br><span class="budmeta">${esc(VM.user.email)}</span></p>
    <div style="margin:14px 0"><span class="plan-chip ${VM.admin?'plan-master':(S.plan==='pro'?'plan-pro':'plan-free')}">${selo}</span></div>

    ${VM.admin
      ? `<p class="budmeta">Você é <b>MASTER</b>: acesso total ao VIZIO Money, sem depender de assinatura. Não entra no faturamento.</p>`
      : S.plan==='pro'
        ? (VM.source==='cortesia'
            ? `<p class="budmeta">Acesso <b>cortesia (isento)</b> — não é assinatura paga e não entra no faturamento.</p>`
            : `<p class="budmeta">Assinatura ativa. Obrigado por apoiar o VIZIO Money.</p>
               <button class="btn btn-ghost" id="vm-sync" style="width:100%;margin-top:8px">Atualizar meu plano</button>`)
        : `<div class="price">R$ 9,90<small>/mês</small></div>
           <button class="btn btn-money" id="vm-sub" style="width:100%">Assinar o Pro</button>
           <button class="btn btn-ghost" id="vm-sync" style="width:100%;margin-top:8px">Já paguei — atualizar</button>`}

    <button class="btn btn-ghost" id="vm-pass" style="width:100%;margin-top:8px">Definir / trocar senha</button>
    <button class="linklike" id="vm-out">Sair</button>
    <button class="linklike" id="vm-close">Fechar</button>
  </div></div>`;

  document.getElementById('vm-close').onclick=()=> r.innerHTML='';
  /* Já logado (ex.: pelo link no celular) consegue criar a senha aqui mesmo,
     sem precisar de novo e-mail — é o caminho mais curto para destravar o PC. */
  document.getElementById('vm-pass').onclick=()=> vmDefinirSenha(true);
  const sub=document.getElementById('vm-sub');
  if(sub) sub.onclick=()=>{ window.open(vmSubscribeUrl(),'_blank','noopener'); toast('Finalize o pagamento na aba aberta'); };
  const sync=document.getElementById('vm-sync');
  if(sync) sync.onclick=async()=>{ toast('Verificando…'); await vmRefreshPlan(); vmMinhaConta(); };
  document.getElementById('vm-out').onclick=async()=>{
    await vmdb.auth.signOut(); await vmRefreshPlan(); r.innerHTML=''; toast('Você saiu');
  };
}

/* ================= definir nova senha =================
   O link do e-mail (recovery) já autentica e devolve à página. Sem esta tela,
   o usuário caía direto no app e nunca conseguia definir a senha — era o que
   acontecia. Serve também para quem tem conta antiga e nunca teve senha. */
function vmDefinirSenha(primeira){
  const r = document.getElementById('overlayRoot');
  r.innerHTML = `<div class="overlay"><form class="sheet" id="vm-pf">
    <div class="brand-lockup" style="justify-content:center;margin-bottom:10px">
      <span class="brand-mark"><img src="brand/logo.svg?v=0.4" width="30" height="27" alt=""></span>
      <span class="brand-word">VIZIO <b>Money</b></span>
    </div>
    <h2>${primeira ? 'Crie sua senha' : 'Nova senha'}</h2>
    <p>${primeira ? 'Sua conta ainda não tem senha. Defina uma para entrar pelo computador também.'
                  : 'Escolha uma senha nova para a sua conta.'}</p>
    <div class="vm-err" id="vm-perr"></div>
    ${vmCampoSenha('vm-p1','Nova senha','new-password','mínimo 8 caracteres')}
    ${vmCampoSenha('vm-p2','Repita a senha','new-password','')}
    <button class="btn" type="submit" id="vm-psave" style="width:100%">Salvar senha</button>
    <button type="button" class="linklike" id="vm-pskip">Agora não</button>
  </form></div>`;

  const err = m => { const e=document.getElementById('vm-perr'); e.textContent=m; e.style.display=m?'block':'none'; };
  vmLigarOlhos(r);
  document.getElementById('vm-pskip').onclick=()=>{ r.innerHTML=''; vmLimparHash(); };
  document.getElementById('vm-pf').onsubmit = async (ev)=>{
    ev.preventDefault(); err('');
    const p1=document.getElementById('vm-p1').value, p2=document.getElementById('vm-p2').value;
    if(p1.length<8) return err('A senha precisa de pelo menos 8 caracteres.');
    if(p1!==p2)     return err('As senhas não são iguais.');
    const b=document.getElementById('vm-psave'); b.disabled=true; b.textContent='Salvando…';
    const { error } = await vmdb.auth.updateUser({ password:p1 });
    if(error){ b.disabled=false; b.textContent='Salvar senha'; return err(error.message); }
    vmLimparHash(); r.innerHTML='';
    await vmRefreshPlan();
    toast('Senha definida! Agora você entra por e-mail e senha ✅');
  };
}
/* tira o #access_token da barra de endereço depois de usar */
function vmLimparHash(){
  if(location.hash) history.replaceState(null,'',location.pathname+location.search);
}

/* ================= paywall ================= */
window.paywall = function(reason){
  if(!VM.user){ vmAccount(); toast(reason||'Entre para assinar o Pro'); return; }
  const r=document.getElementById('overlayRoot');
  r.innerHTML=`<div class="overlay"><div class="sheet">
    <div class="brand-lockup" style="justify-content:center;margin-bottom:12px">
      <span class="brand-mark"><img src="brand/logo.svg?v=0.4" width="30" height="27" alt=""></span>
      <span class="brand-word">VIZIO <b>Money</b></span>
    </div>
    <h2>Desbloqueie o ano inteiro</h2>
    <p>${esc(reason||'No Free você lança o mês atual e o próximo.')}</p>
    <div class="price">R$ 9,90<small>/mês</small></div>
    <div class="feat">
      <div><span class="ck">✔</span> Os 12 meses (Jan–Dez)</div>
      <div><span class="ck">✔</span> Cartões e categorias ilimitados</div>
      <div><span class="ck">✔</span> Panorama de parcelamento & relatórios</div>
      <div><span class="ck">✔</span> IA de Reflexão + alertas</div>
    </div>
    <button class="btn btn-money" id="pw-go" style="width:100%">Assinar o Pro</button>
    <button class="btn btn-ghost" id="pw-sync" style="width:100%;margin-top:8px">Já paguei — atualizar</button>
    <button class="linklike" id="pw-close">Agora não</button>
  </div></div>`;
  document.getElementById('pw-go').onclick=()=>{ window.open(vmSubscribeUrl(),'_blank','noopener'); toast('Finalize o pagamento na aba aberta'); };
  document.getElementById('pw-sync').onclick=async()=>{ toast('Verificando…'); await vmRefreshPlan(); r.innerHTML=''; };
  document.getElementById('pw-close').onclick=()=> r.innerHTML='';
};

/* ================= init ================= */
(async function vmInit(){
  const btn=document.getElementById('btnMenu');
  if(btn) btn.onclick=vmAccount;

  /* O link do e-mail chega como #access_token=...&type=recovery.
     Detecto pelo hash porque o evento PASSWORD_RECOVERY pode disparar ANTES
     deste script montar — e aí ele se perde e o usuário cai direto no app. */
  const hash = new URLSearchParams((location.hash||'').replace(/^#/,''));
  const ehRecovery = hash.get('type')==='recovery';

  try{ await vmCarregarSessao(); }
  catch(e){ console.warn('VIZIO Money · acesso:', e.message); }  // falha aberta
  vmChrome(); render();

  if(ehRecovery && VM.user){ vmDefinirSenha(false); }

  vmdb.auth.onAuthStateChange(async (evt)=>{
    if(evt==='SIGNED_IN' || evt==='SIGNED_OUT' || evt==='TOKEN_REFRESHED') await vmRefreshPlan();
    if(evt==='PASSWORD_RECOVERY') vmDefinirSenha(false);
  });

  if(location.search.includes('assinar=1') && S.plan!=='pro'){
    VM.user ? window.paywall() : vmAccount();
  }
  if(location.search.includes('pago=1')){
    for(let i=0;i<5;i++){ await new Promise(r=>setTimeout(r,2000)); await vmRefreshPlan();
      if(S.plan==='pro'){ toast('Pro ativado! 🎉'); break; } }
  }
})();
