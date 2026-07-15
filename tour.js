/* ===========================================================================
 * VIZIO Money — TOUR GUIADO  ·  v1.0
 *
 * Por que existe: a pesquisa de dores mostrou que o abandono de app financeiro
 * acontece na PRIMEIRA sessão — tela vazia, pessoa não sabe por onde começar,
 * fecha e não volta. Nenhuma tela é auto-explicativa o bastante para ensinar
 * "melhor data de compra" sozinha; isso precisa ser dito.
 *
 * Como funciona: recorta um buraco no escuro sobre o elemento REAL da tela
 * (não um desenho de tela), navega até ele e explica. Pulável sempre —
 * onboarding obrigatório é hostil e a pessoa aprende a clicar "próximo" sem ler.
 * Roda uma vez; depois vive no ❓ da topbar.
 *
 * Depende de: view, modulo, render(), activeMonth (index.html).
 * ======================================================================== */
const VM_TOUR_KEY = 'vm_tour_v1';

const TOUR = [
  {
    sel: null,
    titulo: 'Bem-vindo ao VIZIO Money',
    txt: 'Em 6 passos você vai saber usar tudo — inclusive o truque do cartão que quase ninguém conhece. Leva um minuto.',
    cta: 'Bora'
  },
  {
    sel: '#monthStrip',
    titulo: 'O ano inteiro, aqui',
    txt: 'Cada mês é um capítulo. O que você lança num mês <b>conversa com os outros</b>: parcela se espalha, fatura nasce no mês seguinte. É isso que planilha não faz.',
    view: 'month'
  },
  {
    sel: '[data-mod="movimento"]',
    titulo: 'Primeiro você se paga',
    txt: 'Em <b>Movimento</b>, <b>Entradas</b> e <b>Investir</b> ficam lado a lado — de propósito. A ordem certa é: entrou → <b>guarda uma parte</b> → gasta o resto. Guardar o que sobra quase nunca sobra.',
    view: 'month', mod: 'movimento'
  },
  {
    sel: '#cardFatura',
    titulo: 'Fatura é o passado te cobrando',
    txt: 'O que aparece aqui é o crédito do <b>mês anterior</b>, que vence agora e <b>sai da sua conta</b>. Por isso o mês que parecia tranquilo às vezes aperta: a conta chegou depois.',
    view: 'month', mod: 'cartoes'
  },
  {
    sel: '#cardUso',
    titulo: 'Uso é a fatura nascendo',
    txt: 'Tudo que você passa no crédito <b>hoje</b> cai aqui — e ainda <b>não saiu</b> da conta. É a prévia do boleto do mês que vem. Olhar isso todo dia é o que evita o susto.',
    view: 'month', mod: 'cartoes'
  },
  {
    sel: '#cardsCard, #cardFatura',
    titulo: 'O truque: a melhor data de compra',
    txt: 'Comprar <b>a partir da melhor data</b> joga a compra para o ciclo seguinte — até <b>40 dias</b> de prazo, de graça. Cadastre a data em ⚙️ e o app passa a te avisar em qual fatura cada compra vai cair.',
    view: 'month', mod: 'cartoes'
  },
  {
    sel: '#bottomNav, #sideNav',
    titulo: 'O resto do caminho',
    txt: '<b>Investir</b> mostra seu patrimônio crescendo. <b>Ano</b> mostra os 12 meses de uma vez. <b>Ajustes</b> é onde ficam cartões, categorias e tetos.<br><br>Quiser se aprofundar, o <a href="manual.html" target="_blank">manual completo</a> tem simuladores para brincar. E o <b>❓</b> aqui em cima refaz este tour quando quiser.',
    cta: 'Começar'
  }
];

let _tourI = 0, _tourAtivo = false;

const vmTourVisto = () => { try { return !!localStorage.getItem(VM_TOUR_KEY); } catch (e) { return true; } };
const vmTourMarcar = () => { try { localStorage.setItem(VM_TOUR_KEY, '1'); } catch (e) {} };

function vmTourMontar() {
  if (document.getElementById('tourMask')) return;
  const d = document.createElement('div');
  d.id = 'tourMask';
  d.innerHTML = `
    <div class="tour-buraco" id="tourBuraco"></div>
    <div class="tour-card" id="tourCard">
      <div class="tour-passo" id="tourPasso"></div>
      <h3 id="tourTit"></h3>
      <p id="tourTxt"></p>
      <div class="tour-pontos" id="tourPontos"></div>
      <div class="tour-acoes">
        <button class="linklike" id="tourPular">Pular</button>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-ghost" id="tourVoltar">Voltar</button>
          <button class="btn btn-sm" id="tourNext">Próximo</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(d);

  document.getElementById('tourPular').onclick  = vmTourFim;
  document.getElementById('tourVoltar').onclick = () => vmTourIr(_tourI - 1);
  document.getElementById('tourNext').onclick   = () => vmTourIr(_tourI + 1);
  /* Clicar fora avança: a pessoa toca na tela por instinto; não podia travar. */
  d.addEventListener('click', e => { if (e.target === d) vmTourIr(_tourI + 1); });
  addEventListener('resize', vmTourPosicionar);
  addEventListener('scroll', vmTourPosicionar, { passive: true });
}

function vmTourAlvo() {
  const p = TOUR[_tourI]; if (!p?.sel) return null;
  /* aceita lista de seletores: o alvo muda entre celular e desktop
     (barra inferior x menu lateral) — o primeiro que estiver visível vence */
  for (const s of p.sel.split(',').map(x => x.trim())) {
    const el = document.querySelector(s);
    if (el && el.offsetParent !== null && el.getBoundingClientRect().height > 0) return el;
  }
  return null;
}

function vmTourPosicionar() {
  if (!_tourAtivo) return;
  const buraco = document.getElementById('tourBuraco');
  const card   = document.getElementById('tourCard');
  if (!buraco || !card) return;

  const el = vmTourAlvo();

  if (!el) {   // passo sem alvo (abertura/fecho): card no centro, sem recorte
    buraco.style.opacity = '0';
    card.classList.add('meio');
    card.style.top = ''; card.style.left = '';
    return;
  }

  const r = el.getBoundingClientRect(), pad = 6;
  buraco.style.opacity = '1';
  buraco.style.top    = (r.top - pad) + 'px';
  buraco.style.left   = (r.left - pad) + 'px';
  buraco.style.width  = (r.width + pad * 2) + 'px';
  buraco.style.height = (r.height + pad * 2) + 'px';
  card.classList.remove('meio');

  /* O card vai onde couber: abaixo do alvo, ou acima se não houver espaço.
     Nunca por cima do alvo — esconder o que se está explicando é autogol. */
  const cr = card.getBoundingClientRect();
  const larg = Math.min(cr.width || 330, innerWidth - 24);
  const cabeAbaixo = (r.bottom + 14 + (cr.height || 190)) < innerHeight - 12;
  const top = cabeAbaixo ? r.bottom + 14 : Math.max(12, r.top - (cr.height || 190) - 14);
  let left = r.left + r.width / 2 - larg / 2;
  left = Math.max(12, Math.min(left, innerWidth - larg - 12));
  card.style.top  = top + 'px';
  card.style.left = left + 'px';
}

async function vmTourIr(i) {
  if (i < 0) return;
  if (i >= TOUR.length) return vmTourFim();
  _tourI = i;
  const p = TOUR[i];

  /* Navega ANTES de medir: o alvo pode estar num módulo que nem foi montado. */
  if (p.view) view = p.view;
  if (p.mod)  modulo = p.mod;
  if (p.view || p.mod) render();

  document.getElementById('tourPasso').textContent = `${i + 1} de ${TOUR.length}`;
  document.getElementById('tourTit').textContent = p.titulo;
  document.getElementById('tourTxt').innerHTML   = p.txt;
  document.getElementById('tourPontos').innerHTML =
    TOUR.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
  document.getElementById('tourVoltar').style.visibility = i === 0 ? 'hidden' : 'visible';
  document.getElementById('tourNext').textContent = p.cta || (i === TOUR.length - 1 ? 'Começar' : 'Próximo');

  const el = vmTourAlvo();
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await new Promise(r => setTimeout(r, 380));   // espera a rolagem assentar
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  vmTourPosicionar();
}

function vmTourFim() {
  _tourAtivo = false;
  vmTourMarcar();
  document.getElementById('tourMask')?.remove();
  modulo = 'resumo'; view = 'month'; render();
}

function vmTourComecar() {
  _tourAtivo = true; _tourI = 0;
  vmTourMontar();
  requestAnimationFrame(() => vmTourIr(0));
}
window.vmTourComecar = vmTourComecar;

/* ---- Porta de entrada ----
   Primeira visita: começa sozinho, mas só depois do app montado — tour sobre
   tela ainda em branco não ensina nada. Depois: vive no ❓ da topbar. */
addEventListener('load', () => {
  const b = document.getElementById('btnAjuda');
  if (b) b.onclick = () => { document.getElementById('overlayRoot').innerHTML = ''; vmTourComecar(); };
  if (!vmTourVisto()) setTimeout(() => { if (!document.querySelector('.overlay')) vmTourComecar(); }, 900);
});
