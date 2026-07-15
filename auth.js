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
    vmdb.from('vm_perfis').select('nome,is_admin,hourly_wage,avatar_url').eq('user_id',VM.user.id).maybeSingle(),
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

/* ================= SINCRONIZAÇÃO NA NUVEM =================
   Regra de resolução: last-write-wins pelo carimbo do CLIENTE (S.updatedAt).
   Documento inteiro, não campo a campo — os dados são pequenos e sempre lidos
   juntos; merge por campo daria complexidade sem ganho para uso pessoal.

   A trava que evita perder dado: o PUSH só liga depois que o PULL termina.
   Sem isso, um PC com cópia velha abriria, o usuário digitaria qualquer coisa,
   o carimbo local viraria "agora" e ele empurraria a versão velha por cima do
   que foi lançado no celular. Puxar antes de poder empurrar mata essa classe
   inteira de bug.

   Falha aberta: sem rede, o app continua 100% usável no cache local e
   sincroniza quando voltar. Nunca travar o usuário fora do que é dele. */
const VM_SYNC_DEBOUNCE = 2500;
let _vmSyncTimer = null, _vmUltimoPayload = null, _vmPushLiberado = false;

/* plan vem do gating (servidor) e updatedAt é metadado — nenhum dos dois viaja. */
const vmPayload = () => { const { plan, updatedAt, ...resto } = S; return resto; };

function vmSyncChip(estado){
  const el = document.getElementById('syncChip'); if(!el) return;
  const mapa = {
    salvando: ['⏳','Salvando…','var(--s500)'],
    ok:       ['☁️','Salvo na nuvem','var(--pos)'],
    erro:     ['⚠️','Salvo só aqui','var(--warn)'],
    local:    ['📱','Só neste aparelho','var(--s500)']
  };
  const [ic,txt,cor] = mapa[estado] || mapa.local;
  el.innerHTML = `<span>${ic}</span><span class="sync-tx">${txt}</span>`;
  el.style.color = cor;
  el.title = estado==='erro'
    ? 'Não consegui falar com a nuvem agora. Seus dados estão salvos neste aparelho e sobem sozinhos quando a conexão voltar.'
    : estado==='local' ? 'Entre na sua conta para levar seus dados para outros aparelhos.' : txt;
}

function vmNuvemAgendar(){
  if(!_vmPushLiberado || !VM.user) return;
  const j = JSON.stringify(vmPayload());
  if(j === _vmUltimoPayload) return;   // render não é mudança de dado
  _vmUltimoPayload = j;
  S.updatedAt = Date.now();
  localStorage.setItem(KEY, JSON.stringify(S));
  vmSyncChip('salvando');
  clearTimeout(_vmSyncTimer);
  _vmSyncTimer = setTimeout(vmNuvemEmpurrar, VM_SYNC_DEBOUNCE);
}
window.vmNuvemAgendar = vmNuvemAgendar;

async function vmNuvemEmpurrar(){
  if(!VM.user) return;
  try{
    const { error } = await vmdb.from('vm_dados').upsert({
      user_id: VM.user.id,
      dados: vmPayload(),
      client_ts: S.updatedAt || Date.now(),
      device: (navigator.userAgent||'').slice(0,120),
      updated_at: new Date().toISOString()
    }, { onConflict:'user_id' });
    if(error) throw error;
    vmSyncChip('ok');
  }catch(e){
    console.warn('VIZIO Money · sync ↑:', e.message);
    vmSyncChip('erro');
    _vmUltimoPayload = null;   // não perde a mudança: tenta de novo no próximo save
  }
}

/* Puxa de novo quando a janela volta ao foco.
   Cenário real que isto mata: atalho aberto no PC, lançamento feito no celular,
   você volta ao PC e digita — o carimbo do PC vira "agora" e ele empurraria a
   cópia velha por cima do celular. Puxar ANTES de você tocar em qualquer coisa
   fecha a janela onde esse estrago acontece. */
let _vmUltimoPull = 0;
async function vmNuvemPuxarSeVelho(minMs = 4000){
  if(!VM.user) return;
  if(Date.now() - _vmUltimoPull < minMs) return;   // não martela o banco
  await vmNuvemPuxar();
}

async function vmNuvemPuxar(){
  if(!VM.user){ _vmPushLiberado = false; vmSyncChip('local'); return; }
  _vmUltimoPull = Date.now();
  try{
    const { data, error } = await vmdb.from('vm_dados')
      .select('dados, client_ts').eq('user_id', VM.user.id).maybeSingle();
    if(error) throw error;

    const tsLocal  = +(S.updatedAt || 0);
    const tsNuvem  = +(data?.client_ts || 0);

    if(data && tsNuvem > tsLocal){
      /* Nuvem mais nova: adota. Mutação no lugar (não reatribuo S) para não
         quebrar as referências que o resto do app já segura. */
      const planoAtual = S.plan;
      const novo = migrate({ ...structuredClone(DEFAULTS), ...data.dados });
      Object.keys(S).forEach(k => delete S[k]);
      Object.assign(S, novo);
      S.plan = planoAtual;          // quem manda no plano é o gating
      S.updatedAt = tsNuvem;
      localStorage.setItem(KEY, JSON.stringify(S));
      _vmUltimoPayload = JSON.stringify(vmPayload());
      _vmPushLiberado = true;
      vmSyncChip('ok');
      render();
      return;
    }

    _vmPushLiberado = true;
    if(!data || tsLocal > tsNuvem){ _vmUltimoPayload = null; vmNuvemAgendar(); }
    else vmSyncChip('ok');
  }catch(e){
    console.warn('VIZIO Money · sync ↓:', e.message);
    vmSyncChip('erro');
    _vmPushLiberado = false;   // não puxei: não tenho direito de empurrar
  }
}

/* ================= AVATAR =================
   Sem foto, mostramos INICIAIS — nunca o boneco cinza. Iniciais no azul da
   marca já parecem "seu"; boneco genérico parece cadastro pela metade. */
function vmIniciais(){
  const base = (VM.perfil?.nome || S.nome || VM.user?.email || '').trim();
  if(!base) return '👤';
  if(base.includes('@')) return base[0].toUpperCase();
  const p = base.split(/\s+/).filter(Boolean);
  return ((p[0]?.[0]||'') + (p.length>1 ? p[p.length-1][0] : '')).toUpperCase() || '👤';
}
const vmFotoUrl = () => VM.perfil?.avatar_url || null;

/* Devolve o HTML de um avatar. `cls` diferencia topo x tela de conta. */
function vmAvatarHTML(cls=''){
  const url = vmFotoUrl();
  if(url) return `<img src="${esc(url)}" alt="Sua foto" loading="lazy">`;
  const ini = vmIniciais();
  return `<span class="av-ini${VM.user?' tem':''}">${esc(ini)}</span>`;
}

function vmAvatarTopo(){
  const b = document.getElementById('btnMenu'); if(!b) return;
  b.innerHTML = vmAvatarHTML();
  b.classList.toggle('on', view==='conta');
  b.title = VM.user ? 'Sua conta' : 'Entrar';
}

/* ---- Recortador: arrasta para posicionar, controle para aproximar ----
   Corte automático no centro decapita metade das fotos de celular (o rosto
   quase nunca está no centro geométrico). Deixar a pessoa enquadrar custa
   pouco código e evita a foto ruim que ela nunca mais troca. */
function vmRecortarFoto(file){
  return new Promise((resolve)=>{
    const r = document.getElementById('overlayRoot');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{
      const LADO = 264;               // área de recorte na tela
      const SAIDA = 256;              // resolução final gravada
      r.innerHTML = `<div class="overlay"><div class="sheet">
        <h2 style="margin-bottom:4px">Enquadre sua foto</h2>
        <p class="crop-dica">Arraste para posicionar · use o controle para aproximar</p>
        <div class="crop-area" id="cropArea"><canvas id="cropCv" width="${LADO}" height="${LADO}"></canvas></div>
        <input type="range" class="crop-zoom" id="cropZoom" min="1" max="4" step="0.01" value="1">
        <button class="btn" id="cropOk" style="width:100%">Usar esta foto</button>
        <button class="linklike" id="cropNao">Cancelar</button>
      </div></div>`;

      const cv = document.getElementById('cropCv'), cx = cv.getContext('2d');
      const escalaMin = Math.max(LADO/img.width, LADO/img.height);   // sempre cobre o círculo
      let z = 1, ox = 0, oy = 0;

      const limitar = ()=>{
        const e = escalaMin*z, lg = img.width*e, al = img.height*e;
        const maxX = Math.max(0,(lg-LADO)/2), maxY = Math.max(0,(al-LADO)/2);
        ox = Math.min(maxX, Math.max(-maxX, ox));
        oy = Math.min(maxY, Math.max(-maxY, oy));
      };
      const pintar = ()=>{
        limitar();
        const e = escalaMin*z, lg = img.width*e, al = img.height*e;
        cx.clearRect(0,0,LADO,LADO);
        cx.fillStyle = '#000'; cx.fillRect(0,0,LADO,LADO);
        cx.drawImage(img, (LADO-lg)/2+ox, (LADO-al)/2+oy, lg, al);
      };
      pintar();

      /* Ponteiro unificado: mouse e dedo pelo mesmo caminho. */
      const area = document.getElementById('cropArea');
      let arrastando=false, px=0, py=0;
      area.addEventListener('pointerdown', e=>{ arrastando=true; px=e.clientX; py=e.clientY; area.setPointerCapture(e.pointerId); });
      area.addEventListener('pointermove', e=>{ if(!arrastando) return;
        ox += e.clientX-px; oy += e.clientY-py; px=e.clientX; py=e.clientY; pintar(); });
      area.addEventListener('pointerup',     ()=> arrastando=false);
      area.addEventListener('pointercancel', ()=> arrastando=false);
      document.getElementById('cropZoom').addEventListener('input', e=>{ z=+e.target.value; pintar(); });

      const fechar = ()=>{ URL.revokeObjectURL(url); r.innerHTML=''; };
      document.getElementById('cropNao').onclick = ()=>{ fechar(); resolve(null); };
      document.getElementById('cropOk').onclick = ()=>{
        /* Redesenha na resolução final e exporta em webp: foto de celular tem
           4MB+; sem isto o upload demora e estoura o limite do bucket. */
        const out = document.createElement('canvas'); out.width=out.height=SAIDA;
        const ox2 = out.getContext('2d');
        const k = SAIDA/LADO, e = escalaMin*z, lg = img.width*e*k, al = img.height*e*k;
        ox2.fillStyle='#000'; ox2.fillRect(0,0,SAIDA,SAIDA);
        ox2.drawImage(img, (SAIDA-lg)/2+ox*k, (SAIDA-al)/2+oy*k, lg, al);
        out.toBlob(b=>{ fechar(); resolve(b); }, 'image/webp', 0.85);
      };
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); toast('Não consegui ler essa imagem'); resolve(null); };
    img.src = url;
  });
}

async function vmTrocarFoto(){
  if(!VM.user) return vmAccount();
  const inp = document.createElement('input');
  inp.type='file'; inp.accept='image/*';
  inp.onchange = async ()=>{
    const f = inp.files?.[0]; if(!f) return;
    if(!/^image\//.test(f.type)) return toast('Escolha uma imagem');
    if(f.size > 20*1024*1024)   return toast('Imagem muito grande (máx. 20MB)');

    const blob = await vmRecortarFoto(f);
    if(!blob) return;

    toast('Enviando foto…');
    try{
      const caminho = `${VM.user.id}/avatar.webp`;   // caminho fixo: nunca acumula lixo
      const { error } = await vmdb.storage.from('vm-avatares')
        .upload(caminho, blob, { upsert:true, contentType:'image/webp', cacheControl:'3600' });
      if(error) throw error;

      const { data } = vmdb.storage.from('vm-avatares').getPublicUrl(caminho);
      /* ?t= quebra o cache do CDN: sem isso você troca a foto e continua vendo a antiga. */
      const url = `${data.publicUrl}?t=${Date.now()}`;
      const { error: e2 } = await vmdb.from('vm_perfis').update({ avatar_url: url }).eq('user_id', VM.user.id);
      if(e2) throw e2;

      if(VM.perfil) VM.perfil.avatar_url = url; else VM.perfil = { avatar_url: url };
      vmAvatarTopo(); render();
      toast('Foto atualizada 📸');
    }catch(e){
      console.warn('VIZIO Money · avatar:', e.message);
      toast('Não consegui enviar a foto. Tente de novo.');
    }
  };
  inp.click();
}

async function vmRemoverFoto(){
  if(!VM.user || !vmFotoUrl()) return;
  try{
    await vmdb.storage.from('vm-avatares').remove([`${VM.user.id}/avatar.webp`]);
    await vmdb.from('vm_perfis').update({ avatar_url:null }).eq('user_id', VM.user.id);
    if(VM.perfil) VM.perfil.avatar_url = null;
    vmAvatarTopo(); render(); toast('Foto removida');
  }catch(e){ toast('Não consegui remover agora'); }
}

/* ================= PUXAR PARA ATUALIZAR =================
   O gesto que todo mundo já tem no dedo. Só dispara quando a página já está
   no topo e o dedo desce — senão brigaria com a rolagem normal da lista.
   No desktop, o mesmo trabalho é feito clicando no selo ☁️ da topbar. */
function vmLigarPuxarAtualizar(){
  if(!('ontouchstart' in window)) return;
  const el = document.createElement('div');
  el.className = 'vm-ptr'; el.innerHTML = '<span class="vm-ptr-ic">↻</span>';
  document.body.appendChild(el);

  const LIMITE = 70;          // px para valer como intenção, não tremida
  let y0 = null, dist = 0, ativo = false;

  addEventListener('touchstart', e=>{
    if(window.scrollY > 0 || document.querySelector('.overlay')) { y0=null; return; }
    y0 = e.touches[0].clientY; dist = 0;
  }, { passive:true });

  addEventListener('touchmove', e=>{
    if(y0===null || ativo) return;
    dist = e.touches[0].clientY - y0;
    if(dist <= 0){ el.style.transform=''; el.classList.remove('on'); return; }
    const puxada = Math.min(dist * .5, 86);
    el.style.transform = `translateX(-50%) translateY(${puxada}px) rotate(${dist*2}deg)`;
    el.classList.toggle('pronto', dist >= LIMITE);
    el.classList.add('on');
  }, { passive:true });

  addEventListener('touchend', async ()=>{
    if(y0===null || ativo) return;
    const valeu = dist >= LIMITE;
    y0 = null;
    if(!valeu){ el.style.transform=''; el.classList.remove('on','pronto'); return; }

    ativo = true;
    el.classList.add('girando');
    el.style.transform = 'translateX(-50%) translateY(58px)';
    /* Sobe o que estiver pendente ANTES de puxar — senão o pull adotaria a
       nuvem e apagaria o que você acabou de digitar aqui. */
    if(_vmSyncTimer){ clearTimeout(_vmSyncTimer); _vmSyncTimer=null; await vmNuvemEmpurrar(); }
    await vmNuvemPuxar();
    toast(VM.user ? 'Atualizado ☁️' : 'Entre na conta para sincronizar');
    el.classList.remove('on','pronto','girando');
    el.style.transform = '';
    ativo = false;
  });
}

/* Selo de sync clicável: no desktop não existe gesto de puxar, e ninguém
   deveria fechar e reabrir o app só para conferir se está atualizado. */
function vmLigarChipSync(){
  const chip = document.getElementById('syncChip'); if(!chip) return;
  chip.style.cursor = 'pointer';
  chip.onclick = async ()=>{
    if(!VM.user){ vmAccount(); return; }
    vmSyncChip('salvando');
    if(_vmSyncTimer){ clearTimeout(_vmSyncTimer); _vmSyncTimer=null; await vmNuvemEmpurrar(); }
    await vmNuvemPuxar();
    toast('Atualizado ☁️');
  };
}

/* ================= convite de cortesia =================
   Link: .../index.html?convite=CODIGO
   Quem chega sem conta vê a tela de criar conta com o convite já reconhecido —
   a promessa aparece ANTES do formulário, senão o cadastro parece só burocracia.
   O código fica guardado até o login concluir (o convite não pode morrer no
   caminho de "criar conta > confirmar e-mail > voltar").
   O resgate em si é no servidor: front nenhum decide quem é Pro. */
const VM_CONVITE_KEY = 'vm_convite_pendente';
const vmConviteDaUrl = () =>
  (new URLSearchParams(location.search).get('convite') || '').trim().toUpperCase();

function vmConvitePendente(){
  const daUrl = vmConviteDaUrl();
  if(daUrl){ try{ localStorage.setItem(VM_CONVITE_KEY, daUrl); }catch(e){} return daUrl; }
  try{ return localStorage.getItem(VM_CONVITE_KEY) || ''; }catch(e){ return ''; }
}
function vmLimparConvite(){ try{ localStorage.removeItem(VM_CONVITE_KEY); }catch(e){} }

async function vmTentarConvite(){
  const cod = vmConvitePendente();
  if(!cod) return;
  if(!VM.user){ vmAccount(); return; }           // precisa de conta: abre o acesso
  if(VM.admin){ vmLimparConvite(); return; }     // master não gasta vaga

  try{
    const { data:{ session } } = await vmdb.auth.getSession();
    const r = await fetch(`${VM_SUPABASE_URL}/functions/v1/vm-resgatar-convite`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json',
                'Authorization':`Bearer ${session?.access_token||''}`,
                'apikey': VM_SUPABASE_KEY },
      body: JSON.stringify({ codigo: cod })
    });
    const j = await r.json();
    if(j.ok){ vmLimparConvite(); await vmRefreshPlan(); toast(j.msg || 'Pro liberado 🎁'); }
    else { vmLimparConvite(); toast(j.erro || 'Convite não pôde ser usado'); }
  }catch(e){
    /* falha aberta: rede ruim não queima o convite — ele tenta de novo depois */
    console.warn('VIZIO Money · convite:', e.message);
  }finally{
    /* tira o ?convite= da barra: link compartilhado não vira histórico do convidado */
    if(vmConviteDaUrl()){
      const u = new URL(location.href); u.searchParams.delete('convite');
      history.replaceState({}, '', u.toString());
    }
  }
}

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
  vmAvatarTopo();

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

    ${vmConvitePendente() ? `
      <div class="vm-convite">🎁 <b>Convite reconhecido.</b>
        Crie sua conta e o <b>Pro</b> entra liberado como cortesia — sem cartão.</div>` : ``}

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
    <p class="budmeta" style="margin-top:8px">Com a conta, seus lançamentos ficam salvos na nuvem e te acompanham em qualquer aparelho. Ao criar, você aceita os <a href="termos.html" target="_blank" class="lk-legal">Termos</a> e a <a href="privacidade.html" target="_blank" class="lk-legal">Privacidade</a>.</p>
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

        /* Cadastro pelo vm-criar-conta, e não pelo auth.signUp: o projeto
           vizio-core tem "Signups" desligado de propósito (os outros produtos
           criam usuário por admin, e há policies permissivas que vazariam a
           carteira de clientes da INPERSON se o cadastro global fosse aberto).
           Esta rota cria só usuário do Money, sem tocar naquilo. */
        const resp = await fetch(`${VM_SUPABASE_URL}/functions/v1/vm-criar-conta`, {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'apikey': VM_SUPABASE_KEY },
          body: JSON.stringify({ nome, email, senha: pass })
        });
        const j = await resp.json().catch(()=>({}));
        if(!resp.ok || !j.ok) throw new Error(j.erro || 'Não consegui criar sua conta.');

        /* Conta nasce confirmada — entra direto, sem etapa de e-mail. */
        const { error } = await vmdb.auth.signInWithPassword({ email, password:pass });
        if(error) throw error;
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
        : m.includes('already') || m.includes('registered') ? 'Esse e-mail já tem conta. Use "Entrar".'
        : m.includes('email not confirmed') ? 'Confirme seu e-mail antes de entrar.'
        : m.includes('signups not allowed') ? 'Cadastro temporariamente indisponível. Já estamos vendo isso.'
        : m.includes('muitas tentativas') ? e.message
        : e.message || 'Não consegui completar. Tente de novo.');
    }finally{
      const g=document.getElementById('vm-go');
      if(g){ g.disabled=false; g.textContent = vmTab==='criar' ? 'Criar minha conta' : 'Entrar'; }
    }
  };
}

/* ================= TELA DE CONFIGURAÇÃO DO USUÁRIO =================
   Tela de verdade (view), não folha flutuante: ajuste de conta é lugar onde a
   pessoa PARA e lê — e onde moram ações sérias (senha, exportar, apagar conta).
   Overlay num app de dinheiro passa recado de "coisa rápida"; não é. */
window.renderConta = function renderConta(){
  const host = document.getElementById('viewConta');
  if(!host) return;

  if(!VM.user){
    host.innerHTML = `<div class="cfg-sec" style="text-align:center;padding:32px 18px">
      <div class="av-grande" style="margin:0 auto 14px"><span class="av-ini">👤</span></div>
      <h3 style="letter-spacing:0;text-transform:none;font-size:16px;color:var(--ink)">Entre na sua conta</h3>
      <p class="budmeta" style="margin:8px 0 16px">Com a conta, sua foto, seus lançamentos e seu plano te acompanham em qualquer aparelho.</p>
      <button class="btn" id="cfg-entrar" style="width:100%;max-width:280px">Entrar ou criar conta</button>
    </div>`;
    host.querySelector('#cfg-entrar').onclick = vmAccount;
    return;
  }

  const nome  = VM.perfil?.nome || S.nome || '';
  const admin = VM.admin;
  const pro   = S.plan === 'pro';
  const selo  = admin ? 'MASTER · acesso total'
              : pro   ? (VM.source==='cortesia' ? 'Pro · cortesia (isento)' : 'Pro ativo')
                      : 'Plano Free';

  host.innerHTML = `
    <!-- PERFIL -->
    <div class="cfg-sec">
      <h3>Perfil</h3>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <span class="av-wrap">
          <span class="av-grande" id="cfg-av">${vmAvatarHTML()}</span>
          <button class="av-edit" id="cfg-foto" title="Trocar foto" aria-label="Trocar foto">📷</button>
        </span>
        <div style="min-width:0">
          <div style="font-weight:800;color:var(--ink);font-size:16px">${esc(nome || 'Sem nome ainda')}</div>
          <div class="budmeta" style="word-break:break-all">${esc(VM.user.email)}</div>
          <div style="margin-top:6px"><span class="plan-chip ${admin?'plan-master':(pro?'plan-pro':'plan-free')}">${selo}</span></div>
          ${vmFotoUrl() ? `<button class="linklike" id="cfg-semfoto" style="padding:4px 0;margin-top:2px">Remover foto</button>` : ''}
        </div>
      </div>

      <div class="cfg-lin">
        <div class="cfg-lb"><b>Seu nome</b><span class="cfg-hint">Como o app te chama.</span></div>
        <div class="cfg-vl" style="flex:1;max-width:220px">
          <input id="cfg-nome" class="f-desc" style="width:100%" value="${esc(nome)}" placeholder="Seu nome">
        </div>
      </div>
      <div class="cfg-lin">
        <div class="cfg-lb"><b>Valor da sua hora</b>
          <span class="cfg-hint">A IA usa para traduzir gasto em tempo de trabalho. Em branco = estimado pela sua renda.</span></div>
        <div class="cfg-vl" style="flex:1;max-width:220px">
          <input id="cfg-hora" class="f-desc num money" inputmode="decimal" style="width:100%"
                 value="${S.hourlyWage!=null?vmMoneyFmt(S.hourlyWage):''}" placeholder="R$/hora">
        </div>
      </div>
      <div class="cfg-lin"><div class="cfg-lb"></div>
        <div class="cfg-vl"><button class="btn btn-sm" id="cfg-salvar">Salvar alterações</button></div></div>
    </div>

    <!-- ASSINATURA -->
    <div class="cfg-sec">
      <h3>Assinatura</h3>
      ${admin ? `
        <div class="cfg-lin"><div class="cfg-lb"><b>Acesso MASTER</b>
          <span class="cfg-hint">Acesso total, sem depender de assinatura. Não entra no faturamento.</span></div></div>`
      : pro && VM.source==='cortesia' ? `
        <div class="cfg-lin"><div class="cfg-lb"><b>Pro por cortesia</b>
          <span class="cfg-hint">Isento — não é assinatura paga e não há nada a cancelar.</span></div></div>`
      : pro ? `
        <div class="cfg-lin">
          <div class="cfg-lb"><b>Pro ativo · R$ 9,90/mês</b>
            <span class="cfg-hint">Cancele, troque o cartão ou baixe recibos quando quiser.</span></div>
          <div class="cfg-vl"><button class="btn btn-sm btn-ghost" id="cfg-portal">Gerenciar · cancelar</button></div>
        </div>`
      : `
        <div class="cfg-lin">
          <div class="cfg-lb"><b>Plano Free</b>
            <span class="cfg-hint">Mês atual e o próximo. O Pro abre os 12 meses, o panorama e a visão anual.</span></div>
          <div class="cfg-vl"><button class="btn btn-sm btn-money" id="cfg-assinar">Assinar · R$ 9,90</button></div>
        </div>`}
      <div class="cfg-lin">
        <div class="cfg-lb"><b>Conferir meu plano</b><span class="cfg-hint">Pagou agora e ainda aparece Free? Force a verificação.</span></div>
        <div class="cfg-vl"><button class="btn btn-sm btn-ghost" id="cfg-sync">Verificar</button></div>
      </div>
    </div>

    <!-- SEGURANÇA -->
    <div class="cfg-sec">
      <h3>Segurança</h3>
      <div class="cfg-lin">
        <div class="cfg-lb"><b>Senha</b>
          <span class="cfg-hint">Guardada criptografada — nem nós conseguimos lê-la.</span></div>
        <div class="cfg-vl"><button class="btn btn-sm btn-ghost" id="cfg-senha">Definir / trocar</button></div>
      </div>
      <div class="cfg-lin">
        <div class="cfg-lb"><b>Sair desta conta</b><span class="cfg-hint">Seus dados continuam salvos na nuvem.</span></div>
        <div class="cfg-vl"><button class="btn btn-sm btn-ghost" id="cfg-sair">Sair</button></div>
      </div>
    </div>

    <!-- DADOS -->
    <div class="cfg-sec">
      <h3>Seus dados</h3>
      <div class="cfg-lin">
        <div class="cfg-lb"><b>Sincronização</b><span class="cfg-hint" id="cfg-sync-tx">Salvos na nuvem e neste aparelho.</span></div>
        <div class="cfg-vl"><button class="btn btn-sm btn-ghost" id="cfg-agora">Sincronizar agora</button></div>
      </div>
      <div class="cfg-lin">
        <div class="cfg-lb"><b>Exportar backup</b>
          <span class="cfg-hint">Baixa tudo em JSON. Seus dados são seus — sem pedir para ninguém.</span></div>
        <div class="cfg-vl"><button class="btn btn-sm btn-ghost" id="cfg-export">Exportar</button></div>
      </div>
    </div>

    <!-- ZONA DE PERIGO -->
    <div class="cfg-sec cfg-perigo">
      <h3>Zona de perigo</h3>
      <div class="cfg-lin">
        <div class="cfg-lb"><b>Apagar minha conta</b>
          <span class="cfg-hint">Apaga sua conta, seus lançamentos e sua foto. <b>Não tem volta.</b>
          Se tiver assinatura ativa, cancele antes.</span></div>
        <div class="cfg-vl"><button class="btn-perigo" id="cfg-apagar">Apagar conta</button></div>
      </div>
    </div>

    <div class="budmeta" style="text-align:center;line-height:1.8;padding:4px 0 8px">
      <a href="manual.html" target="_blank" class="lk-legal">Manual</a> ·
      <a href="termos.html" target="_blank" class="lk-legal">Termos</a> ·
      <a href="privacidade.html" target="_blank" class="lk-legal">Privacidade</a><br>
      VIZIO Money · VIZIO FINANCE · um produto INPERSON
    </div>`;

  /* ---- ligações ---- */
  host.querySelector('#cfg-foto').onclick = vmTrocarFoto;
  host.querySelector('#cfg-semfoto')?.addEventListener('click', vmRemoverFoto);

  host.querySelector('#cfg-salvar').onclick = async ()=>{
    const n = host.querySelector('#cfg-nome').value.trim();
    S.nome = n; S.hourlyWage = vmMoneyVal(host.querySelector('#cfg-hora'));
    if(VM.perfil) VM.perfil.nome = n;
    try{ await vmdb.from('vm_perfis').update({ nome:n, hourly_wage:S.hourlyWage }).eq('user_id', VM.user.id); }
    catch(e){ /* falha aberta: o local já valeu, o sync leva depois */ }
    save(); vmAvatarTopo(); render(); toast('Perfil salvo');
  };

  host.querySelector('#cfg-senha').onclick = ()=> vmDefinirSenha(true);
  host.querySelector('#cfg-sync').onclick  = async ()=>{ toast('Verificando…'); await vmRefreshPlan(); render(); };
  host.querySelector('#cfg-agora').onclick = async ()=>{
    if(_vmSyncTimer){ clearTimeout(_vmSyncTimer); _vmSyncTimer=null; await vmNuvemEmpurrar(); }
    await vmNuvemPuxar(); toast('Sincronizado ☁️');
  };
  host.querySelector('#cfg-export').onclick = ()=> exportData();
  host.querySelector('#cfg-assinar')?.addEventListener('click', ()=>{
    window.open(vmSubscribeUrl(),'_blank','noopener'); toast('Finalize o pagamento na aba aberta');
  });
  host.querySelector('#cfg-portal')?.addEventListener('click', ()=> vmAbrirPortal(host.querySelector('#cfg-portal')));
  host.querySelector('#cfg-sair').onclick = async ()=>{
    await vmdb.auth.signOut(); await vmRefreshPlan(); view='month'; render(); toast('Você saiu');
  };
  host.querySelector('#cfg-apagar').onclick = vmApagarConta;

  vmLigarMascaras(host);
};

/* Portal do Stripe — mesma função para a tela de conta e a folha antiga. */
async function vmAbrirPortal(btn){
  const txt = btn?.textContent;
  if(btn){ btn.disabled=true; btn.textContent='Abrindo…'; }
  try{
    const { data:{ session } } = await vmdb.auth.getSession();
    const r = await fetch(`${VM_SUPABASE_URL}/functions/v1/vm-portal-cobranca`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json',
                'Authorization':`Bearer ${session?.access_token||''}`,
                'apikey': VM_SUPABASE_KEY },
      body: JSON.stringify({ return_url: location.origin + '/' })
    });
    const j = await r.json();
    if(j.url){ location.href = j.url; return; }
    toast(j.erro || 'Não consegui abrir o portal');
  }catch(e){ toast('Falha de conexão. Tente de novo.'); }
  if(btn){ btn.disabled=false; btn.textContent=txt; }
}

/* Apagar conta — direito do titular (LGPD art. 18). Confirmação por digitação:
   um "tem certeza?" é clicado no automático; escrever APAGAR exige intenção. */
async function vmApagarConta(){
  const r = document.getElementById('overlayRoot');
  r.innerHTML = `<div class="overlay"><div class="sheet">
    <h2>Apagar sua conta</h2>
    <p class="budmeta" style="margin:8px 0 4px">Isto apaga <b>de vez</b> sua conta, todos os seus lançamentos e sua foto.
    <b>Não tem como desfazer.</b></p>
    <p class="budmeta" style="margin-bottom:12px">Se tiver assinatura ativa, <b>cancele antes</b> — apagar a conta não cancela a cobrança.</p>
    <p class="budmeta" style="margin-bottom:10px">Antes de seguir, que tal <button class="linklike" id="ap-export" style="padding:0;display:inline">exportar seu backup</button>?</p>
    <div class="vm-field"><label for="ap-txt">Digite <b>APAGAR</b> para confirmar</label>
      <input id="ap-txt" placeholder="APAGAR" autocomplete="off"></div>
    <button class="btn-perigo" id="ap-ok" style="width:100%;opacity:.5" disabled>Apagar minha conta</button>
    <button class="linklike" id="ap-nao">Cancelar</button>
  </div></div>`;

  const txt = document.getElementById('ap-txt'), ok = document.getElementById('ap-ok');
  txt.oninput = ()=>{ const v = txt.value.trim().toUpperCase()==='APAGAR';
    ok.disabled = !v; ok.style.opacity = v ? '1' : '.5'; };
  document.getElementById('ap-export').onclick = ()=> exportData();
  document.getElementById('ap-nao').onclick = ()=> r.innerHTML='';
  ok.onclick = async ()=>{
    ok.disabled=true; ok.textContent='Apagando…';
    try{
      const { data:{ session } } = await vmdb.auth.getSession();
      const resp = await fetch(`${VM_SUPABASE_URL}/functions/v1/vm-apagar-conta`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json',
                  'Authorization':`Bearer ${session?.access_token||''}`,
                  'apikey': VM_SUPABASE_KEY }
      });
      const j = await resp.json();
      if(!resp.ok || !j.ok) throw new Error(j.erro||'Falhou');
      localStorage.removeItem(KEY);
      await vmdb.auth.signOut();
      r.innerHTML='';
      toast('Conta apagada. Sentiremos sua falta.');
      setTimeout(()=> location.href='landing.html', 1500);
    }catch(e){
      toast(e.message || 'Não consegui apagar agora');
      ok.disabled=false; ok.textContent='Apagar minha conta';
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
               <button class="btn btn-ghost" id="vm-portal" style="width:100%;margin-top:8px">Gerenciar assinatura · cancelar</button>
               <button class="btn btn-ghost" id="vm-sync" style="width:100%;margin-top:8px">Atualizar meu plano</button>`)
        : `<div class="price">R$ 9,90<small>/mês</small></div>
           <button class="btn btn-money" id="vm-sub" style="width:100%">Assinar o Pro</button>
           <button class="btn btn-ghost" id="vm-sync" style="width:100%;margin-top:8px">Já paguei — atualizar</button>`}

    <button class="btn btn-ghost" id="vm-pass" style="width:100%;margin-top:8px">Definir / trocar senha</button>
    <div class="budmeta" style="margin-top:12px;line-height:1.6">
      ☁️ Seus dados sobem para a nuvem e te acompanham em qualquer aparelho.<br>
      <a href="termos.html" target="_blank" class="lk-legal">Termos de Uso</a> ·
      <a href="privacidade.html" target="_blank" class="lk-legal">Privacidade</a> ·
      <a href="manual.html" target="_blank" class="lk-legal">Manual</a>
    </div>
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

  /* Portal do Stripe: cancelar, trocar cartão, baixar recibo — sem falar comigo.
     Cancelar tem que ser tão fácil quanto assinar (CDC). */
  const portal=document.getElementById('vm-portal');
  if(portal) portal.onclick=async()=>{
    portal.disabled=true; portal.textContent='Abrindo…';
    try{
      const { data:{ session } } = await vmdb.auth.getSession();
      const r = await fetch(`${VM_SUPABASE_URL}/functions/v1/vm-portal-cobranca`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json',
                  'Authorization':`Bearer ${session?.access_token||''}`,
                  'apikey': VM_SUPABASE_KEY },
        body: JSON.stringify({ return_url: location.origin + '/' })
      });
      const j = await r.json();
      if(j.url) location.href = j.url;
      else { toast(j.erro || 'Não consegui abrir o portal'); portal.disabled=false; portal.textContent='Gerenciar assinatura · cancelar'; }
    }catch(e){
      toast('Falha de conexão. Tente de novo.');
      portal.disabled=false; portal.textContent='Gerenciar assinatura · cancelar';
    }
  };
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
  /* A foto é a porta da conta: abre a TELA de ajustes, não uma folha flutuante.
     Sem login, o caminho é entrar primeiro — a tela vazia não ensina nada. */
  const btn=document.getElementById('btnMenu');
  if(btn) btn.onclick=()=>{
    if(!VM.user) return vmAccount();
    view = (view==='conta') ? 'month' : 'conta';   // toca de novo e volta
    window.scrollTo({top:0,behavior:'smooth'});
    render();
  };

  /* O link do e-mail chega como #access_token=...&type=recovery.
     Detecto pelo hash porque o evento PASSWORD_RECOVERY pode disparar ANTES
     deste script montar — e aí ele se perde e o usuário cai direto no app. */
  const hash = new URLSearchParams((location.hash||'').replace(/^#/,''));
  const ehRecovery = hash.get('type')==='recovery';

  try{ await vmCarregarSessao(); }
  catch(e){ console.warn('VIZIO Money · acesso:', e.message); }  // falha aberta
  vmChrome(); render();

  /* Puxa ANTES de liberar qualquer escrita — a trava contra sobrescrever
     a nuvem com uma cópia velha deste aparelho. */
  await vmNuvemPuxar();

  if(ehRecovery && VM.user){ vmDefinirSenha(false); }

  vmdb.auth.onAuthStateChange(async (evt)=>{
    if(evt==='SIGNED_IN' || evt==='SIGNED_OUT' || evt==='TOKEN_REFRESHED') await vmRefreshPlan();
    if(evt==='SIGNED_IN'){ await vmNuvemPuxar(); await vmTentarConvite(); }
    if(evt==='SIGNED_OUT'){ _vmPushLiberado=false; _vmUltimoPayload=null; vmSyncChip('local'); }
    if(evt==='PASSWORD_RECOVERY') vmDefinirSenha(false);
  });

  await vmTentarConvite();   // já estava logado e abriu o link

  /* Saindo: o que estiver na fila sobe AGORA — o debounce de 2,5s não pode
     custar o último lançamento. Voltando: puxa antes que você toque em nada. */
  addEventListener('visibilitychange', ()=>{
    if(document.visibilityState==='hidden'){
      if(_vmSyncTimer){ clearTimeout(_vmSyncTimer); _vmSyncTimer=null; vmNuvemEmpurrar(); }
    } else {
      vmNuvemPuxarSeVelho();
    }
  });
  addEventListener('online', ()=> vmNuvemPuxarSeVelho(0));

  vmLigarPuxarAtualizar();
  vmLigarChipSync();

  if(location.search.includes('assinar=1') && S.plan!=='pro'){
    VM.user ? window.paywall() : vmAccount();
  }
  if(location.search.includes('pago=1')){
    for(let i=0;i<5;i++){ await new Promise(r=>setTimeout(r,2000)); await vmRefreshPlan();
      if(S.plan==='pro'){ toast('Pro ativado! 🎉'); break; } }
  }
})();
