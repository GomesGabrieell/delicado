import { endpoint } from './config.js';

const token = location.hash.slice(1);
const el = (id) => document.getElementById(id);
const put = (id, value) => { el(id).textContent = value ?? ''; };
const date = (value) => new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
}).format(new Date(value));
let proposal;

async function request(action, details = {}) {
  const response = await fetch(endpoint, {
    method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action, ...details }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || 'Não foi possível acessar a proposta.');
    error.status = response.status;
    throw error;
  }
  return action === 'pdf' ? response.blob() : response.json();
}

function showResponse(result) {
  el('actions').hidden = true;
  el('revision').hidden = true;
  put('response', result.decision === 'approved'
    ? 'Aprovação registrada em ' + date(result.respondedAt) + '. A empresa foi avisada e dará continuidade ao atendimento.'
    : result.decision === 'negotiate' ? 'Seu interesse em negociar foi registrado. Você também pode conversar pelo WhatsApp.'
      : 'Agradecemos pelo seu retorno e pela oportunidade de apresentar nossa proposta.'
        + (result.wantsRevision ? ' Seu pedido de uma nova proposta foi registrado.' : ''));
  el('whatsapp').hidden = result.decision !== 'negotiate';
}

async function load() {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Use o link completo enviado pela empresa.');
  if (!endpoint) throw new Error('O acesso às propostas ainda precisa ser configurado.');
  proposal = await request('read');
  const c = proposal.content;
  if (/^#[a-f0-9]{6}$/i.test(c.accent)) document.documentElement.style.setProperty('--accent', c.accent);
  for (const key of ['company','title','customer','decoration','payment']) put(key, c[key]);
  put('code', c.code + ' · Versão ' + proposal.version);
  put('event', [c.eventDate?.split('-').reverse().join('/'), c.location].filter(Boolean).join(' · '));
  const digits = c.total.padStart(3, '0');
  put('total', 'R$ ' + digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + digits.slice(-2));
  put('expiry', 'Válida até ' + date(proposal.expiresAt) + ' (horário de Brasília)');
  el('whatsapp').href = 'https://wa.me/' + c.whatsapp + '?text='
    + encodeURIComponent('Olá! Gostaria de negociar a proposta ' + c.code + '.');
  el('references').hidden = !proposal.images.length;
  proposal.images.forEach((url, index) => {
    const image = document.createElement('img');
    image.src = url;
    image.alt = 'Referência de decoração ' + (index + 1);
    el('images').append(image);
  });
  if (proposal.decision) showResponse(proposal);
  el('notice').hidden = true;
  el('proposal').hidden = false;
}

el('decline').onclick = () => {
  el('actions').hidden = true;
  el('revision').hidden = false;
  el('revision').querySelector('button').focus();
};
el('cancel').onclick = () => {
  el('revision').hidden = true;
  el('actions').hidden = false;
  el('decline').focus();
};
const decisions = [...document.querySelectorAll('[data-choice]')];
for (const button of decisions) button.onclick = async () => {
  decisions.forEach((item) => { item.disabled = true; });
  put('response', 'Registrando resposta…');
  try {
    const decision = button.dataset.choice;
    showResponse(await request('respond', {
      decision, wantsRevision: decision === 'declined' ? button.dataset.revision === 'yes' : null,
    }));
  } catch (error) {
    put('response', error.message);
    if (error.status === 409 || error.status === 404) {
      el('actions').hidden = true;
      el('revision').hidden = true;
    }
  } finally {
    decisions.forEach((item) => { item.disabled = false; });
  }
};
el('pdf').onclick = async () => {
  el('pdf').disabled = true;
  try {
    const url = URL.createObjectURL(await request('pdf'));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'proposta-' + proposal.content.code + '.pdf';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    put('response', error.message);
  } finally {
    el('pdf').disabled = false;
  }
};
load().catch((error) => put('notice', error.message));
