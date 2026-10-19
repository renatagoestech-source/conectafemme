const $ = (selector) => document.querySelector(selector);
const app = $('#app');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .catch((error) => console.error('Falha ao registrar o service worker:', error));
  });
}

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
});

async function installPWA() {
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) {
    alert('O ConectaFemme já está instalado neste dispositivo.');
    return;
  }

  if (!deferredInstallPrompt) {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    alert(isIOS
      ? 'No Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”.'
      : 'Abra o menu do navegador e escolha “Instalar app” ou “Adicionar à tela inicial”.');
    return;
  }

  const installPrompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  await installPrompt.prompt();
  await installPrompt.userChoice;
}

function pushPublicKeyToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function refreshPushButton() {
  const button = $('#push-toggle');
  if (!button || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  navigator.serviceWorker.ready
    .then((registration) => registration.pushManager.getSubscription())
    .then((subscription) => {
      if (button.isConnected) button.textContent = subscription ? 'Desativar notificações' : 'Ativar notificações';
    })
    .catch(() => {});
}

async function togglePushNotifications() {
  if (!U || !['client', 'provider'].includes(U.role)) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    alert('Este navegador não oferece suporte a notificações push.');
    return;
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isInstalled = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !isInstalled) {
    alert('No iPhone, primeiro adicione o ConectaFemme à Tela de Início pelo Safari. Depois, abra o app instalado e ative as notificações.');
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  if (current) {
    await pushApi('unsubscribe', { endpoint: current.endpoint }, true);
    await current.unsubscribe();
    alert('Notificações desativadas neste dispositivo.');
    refreshPushButton();
    return;
  }

  if (Notification.permission === 'denied') {
    alert('As notificações estão bloqueadas nas configurações do navegador. Libere a permissão do ConectaFemme e tente novamente.');
    return;
  }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') {
    alert('Sem permissão, o navegador não pode mostrar notificações.');
    return;
  }

  const vapid = await pushApi('public_key', null, true);
  if (!vapid.publicKey) throw new Error('Não foi possível preparar as notificações.');
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: pushPublicKeyToBytes(vapid.publicKey),
  });
  try {
    await pushApi('subscribe', { subscription: subscription.toJSON() }, true);
  } catch (error) {
    await subscription.unsubscribe();
    throw error;
  }
  alert('Notificações ativadas. Você receberá avisos sobre pedidos, confirmações e cancelamentos de agendamentos.');
  refreshPushButton();
}

let U = JSON.parse(localStorage.u || 'null');
let T = localStorage.t || '';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const specialtyList = (record) => {
  const saved = Array.isArray(record?.specialties) ? record.specialties : [];
  const values = saved.length ? saved : [record?.category];
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))].slice(0, 2);
};
const specialtyTags = (record) => specialtyList(record).map((value) => `<span class="tag">${esc(value)}</span>`).join(' ');
const specialtyOptions = (categories, selected = '', placeholder = 'Selecione uma especialidade') =>
  `<option value="">${esc(placeholder)}</option>${categories.map((category) => `<option value="${esc(category)}" ${category === selected ? 'selected' : ''}>${esc(category)}</option>`).join('')}`;
function bindSecondarySpecialty(primarySelector, secondarySelector, categories, selected = '') {
  const primary = $(primarySelector), secondary = $(secondarySelector);
  if (!primary || !secondary) return;
  const update = (preferred = secondary.value) => {
    const hasPrimary = Boolean(primary.value);
    const available = hasPrimary ? categories.filter((category) => category !== primary.value) : [];
    secondary.disabled = !hasPrimary;
    secondary.innerHTML = specialtyOptions(available, available.includes(preferred) ? preferred : '', hasPrimary ? 'Não tenho outra especialidade' : 'Selecione primeiro a principal');
  };
  primary.addEventListener('change', () => update(secondary.value));
  update(selected);
}
const brl = (value) => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const wa = (number, message) => `https://wa.me/55${String(number).replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
const imgs = (value) => { try { return Array.isArray(value) ? value : JSON.parse(value || '[]'); } catch { return []; } };
const bg = (url) => url ? `style="background-image:url('${esc(url)}')"` : '';
const fd = (date) => date ? date.split('-').reverse().join('/') : '';
const DAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const ratingSummary = (average, count) => count ? `<span class="rating-summary" title="${count} avaliação${count === 1 ? '' : 'ões'}">★ ${Number(average).toFixed(1)} <small>(${count})</small></span>` : '<span class="muted rating-summary">Sem avaliações</span>';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const BRAZIL_STATES = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
function todayInBrazil() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${date.year}-${date.month}-${date.day}`;
}

function publicProfileUrl(id) {
  return `${location.origin}${location.pathname}#/p/${encodeURIComponent(id)}`;
}

async function api(action, body, query = '', quiet = false) {
  const response = await fetch(`${window.SUPABASE_URL}/functions/v1/conectaelas-api-enhanced?a=${action}${query}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Token': T, apikey: window.SUPABASE_PUBLISHABLE_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({ error: 'Resposta inválida' }));
  if (!response.ok) {
    if (response.status === 401 && T) logout(true);
    if (!quiet) alert(data.error || 'Erro');
    throw data;
  }
  return data;
}

async function pushApi(action, body = null, quiet = true) {
  const response = await fetch(`${window.SUPABASE_URL}/functions/v1/conectaelas-push?a=${action}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Token': T, apikey: window.SUPABASE_PUBLISHABLE_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({ error: 'Resposta inválida' }));
  if (!response.ok) {
    if (response.status === 401 && T) logout(true);
    if (!quiet) alert(data.error || 'Não foi possível processar a notificação.');
    throw data;
  }
  return data;
}

function logout(silent = false) {
  localStorage.removeItem('u');
  localStorage.removeItem('t');
  U = null;
  T = '';
  if (!silent) location.hash = '#/';
  nav();
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('ce-theme', next);
  nav();
}

function nav() {
  $('#nav').innerHTML = `<a href="#/">Início</a>` + (U
    ? `<a href="#/${U.role === 'admin' ? 'admin' : 'painel'}">${U.role === 'admin' ? 'Admin' : U.role === 'provider' ? 'Meu painel' : 'Meus agendamentos'}</a>${['client', 'provider'].includes(U.role) ? '<button class="btn sm push-toggle" id="push-toggle" type="button">Ativar notificações</button>' : ''}<button onclick="logout()">Sair</button>`
    : `<a href="#/login">Entrar</a><a class="btn sm signup-link" href="#/cadastro">Cadastrar</a>`) +
    `<button class="btn sm install-app" id="install-app" type="button">Instalar app</button><button class="theme-toggle" id="theme-toggle" type="button" aria-label="Alternar tema" title="Alternar tema"><span aria-hidden="true">${document.documentElement.dataset.theme === 'dark' ? '☀' : '☾'}</span></button>`;
  $('#theme-toggle').onclick = toggleTheme;
  $('#install-app').onclick = installPWA;
  if (U && ['client', 'provider'].includes(U.role)) {
    $('#push-toggle').onclick = () => togglePushNotifications().catch((error) => {
      console.error('Falha ao configurar notificações:', error);
      alert(error?.error || 'Não foi possível configurar as notificações. Tente novamente.');
    });
    refreshPushButton();
  }
}

function route() {
  nav();
  const parts = location.hash.slice(2).split('/');
  ({ '': home, p: () => provider(parts[1]), login, cadastro, painel, admin }[parts[0]] || home)();
  scrollTo(0, 0);
}
addEventListener('hashchange', route);

async function home() {
  let categories;
  try {
    categories = await api('cats', null, '', true);
  } catch (error) {
    app.innerHTML = `<div class="box"><h2>Estamos preparando o ConectaFemme</h2><p class="muted">A busca e os agendamentos ficarão disponíveis quando o banco de dados for configurado.</p><p class="muted">${esc(error?.error || 'Serviço temporariamente indisponível.')}</p></div>`;
    return;
  }
  const visualCategories = [
    ['Unhas', '✧'], ['Cabelos', '⌁'], ['Maquiagem', '✦'], ['Cílios', '◌'], ['Sobrancelhas', '⌒'], ['Estética', '✿']
  ];
  app.innerHTML = `<section class="hero search-hero"><div class="search-copy"><span class="eyebrow">DESCUBRA PROFISSIONAIS</span><h1>Sua beleza começa com a escolha certa.</h1><p>Encontre profissionais de confiança, veja seus serviços e escolha quem combina com você.</p></div>
    <div class="bar" role="search" aria-label="Filtros para encontrar profissionais"><label class="sr-only" for="q">Buscar serviço ou profissional</label><input id="q" placeholder="Buscar serviço ou profissional...">
      <select id="cat"><option value="">Todas as categorias</option>${categories.map((category) => `<option>${esc(category)}</option>`).join('')}</select>
      <select id="state" aria-label="Estado"><option value="">Todos os estados</option>${BRAZIL_STATES.map((state) => `<option>${state}</option>`).join('')}</select>
      <input id="city" placeholder="Cidade" aria-label="Cidade">
      <input id="max-price" class="price-filter" type="number" min="0" step="0.01" placeholder="Preço máximo (R$)" aria-label="Preço máximo">
      <select id="sort" aria-label="Ordenar profissionais"><option value="price_asc">Menor preço primeiro</option><option value="price_desc">Maior preço primeiro</option><option value="recent">Mais recentes</option></select>
      <button class="btn search-btn" id="go">Buscar profissionais</button></div></section>
    <section class="category-section" aria-labelledby="category-title"><div class="section-intro"><span class="eyebrow">ENCONTRE SEU ESTILO</span><h2 id="category-title">Escolha uma categoria</h2><p>Inspire-se e encontre alguém especial para cuidar de você.</p></div><div class="category-list">${visualCategories.map(([label, icon]) => `<button class="category-chip" type="button" data-category="${esc(label)}"><span class="category-icon" aria-hidden="true">${icon}</span><span>${esc(label)}</span></button>`).join('')}</div></section>
    <p class="muted" id="results-count" aria-live="polite"></p><div class="grid" id="list"></div>`;

  const load = async () => {
    const query = `&q=${encodeURIComponent($('#q').value)}&cat=${encodeURIComponent($('#cat').value)}&state=${encodeURIComponent($('#state').value)}&city=${encodeURIComponent($('#city').value)}&max_price=${encodeURIComponent($('#max-price').value)}&sort=${encodeURIComponent($('#sort').value)}`;
    const providers = await api('providers', null, query);
    $('#results-count').textContent = `${providers.length} profissional${providers.length === 1 ? '' : 'is'} encontrado${providers.length === 1 ? '' : 's'}`;
    $('#list').innerHTML = providers.length ? providers.map((professional) => { const cover = professional.cover_image || professional.logo || 'assets/conectafemme-logo.png'; return `<a class="card" href="#/p/${professional.id}">
      <div class="img" ${bg(cover)}><div class="logo" ${bg(professional.logo || cover)}></div></div>
      <div class="info"><b>${esc(professional.name)}</b> ${professional.is_demo ? '<span class="tag demo-tag">DEMO</span>' : ''}${professional.is_founder ? '<span class="founder-badge compact">✦ Fundador</span>' : ''}<br>${specialtyTags(professional)}<div class="muted">${esc([professional.city, professional.state].filter(Boolean).join(' · '))}</div>${ratingSummary(professional.rating_avg, professional.review_count)}
      ${professional.min_price != null ? `<div>a partir de <span class="price">${brl(professional.min_price)}</span></div>` : '<div class="muted">Consulte os serviços</div>'}<span class="card-link btn sm">Ver perfil <span aria-hidden="true">→</span></span></div></a>`; }).join('') : '<p class="muted">Nenhum profissional encontrado. Tente ampliar o preço máximo ou alterar a categoria.</p>';
  };
  $('#go').onclick = load;
  $('#q').onkeydown = (event) => event.key === 'Enter' && load();
  $('#max-price').onkeydown = (event) => event.key === 'Enter' && load();
  $('#cat').onchange = load;
  $('#state').onchange = load;
  $('#city').onkeydown = (event) => event.key === 'Enter' && load();
  $('#sort').onchange = load;
  document.querySelectorAll('[data-category]').forEach((button) => button.onclick = () => {
    const requested = button.dataset.category;
    const exact = categories.find((category) => category.toLowerCase() === requested.toLowerCase());
    if (exact) { $('#cat').value = exact; $('#q').value = ''; } else { $('#cat').value = ''; $('#q').value = requested; }
    load();
  });
  load();
}

async function provider(id) {
  const professional = await api('provider', null, `&id=${encodeURIComponent(id)}`);
  let selectedService = null;
  let selectedSlot = null;
  const availableSlots = professional.slots.filter((slot) => !slot.booked && slot.available !== false);
  const days = [...new Set(availableSlots.map((slot) => slot.day))];
  const calendarMarkup = `<section class="box booking-calendar"><div class="booking-calendar-header"><span class="booking-kicker">AGENDA</span><h3>${professional.is_demo ? 'Agenda de exemplo' : 'Agendar atendimento'}</h3><p class="booking-intro">${professional.is_demo ? 'Escolha um dia para conferir os horários ilustrativos.' : 'Escolha um dia para consultar os horários livres.'}</p></div>
    ${professional.is_demo ? '<p class="demo-note">Horários ilustrativos. Perfis demonstrativos não aceitam agendamentos.</p>' : ''}
    <div class="booking-date-control"><label for="day">Dia disponível</label><select id="day" ${days.length ? '' : 'disabled'}><option value="">${days.length ? 'Selecione um dia' : 'Nenhum horário disponível'}</option>${days.map((day) => `<option value="${esc(day)}">${fd(day)}</option>`).join('')}</select></div>
    <div class="booking-time-panel"><h4 class="booking-time-heading">Horários disponíveis</h4><div class="booking-time-grid" id="hrs" aria-live="polite"><p class="booking-calendar-empty">${days.length ? 'Selecione um dia para ver os horários disponíveis.' : 'Nenhum horário disponível no momento.'}</p></div></div>
    ${professional.is_demo ? '' : '<p id="sel" class="booking-selection-summary">Escolha um serviço acima.</p><button class="btn booking-confirm" id="bk" type="button" disabled>Confirmar agendamento</button>'}</section>`;
  const instagram = professional.instagram_url
    ? `<a class="btn out sm" href="${esc(professional.instagram_url)}" target="_blank" rel="noopener noreferrer">Instagram</a>`
    : '';
  app.innerHTML = `<div class="profile-head"><div class="profile-identity-images"><div class="lg" ${bg(professional.logo || 'assets/conectafemme-logo.png')} role="img" aria-label="Logo de ${esc(professional.name)}"></div><div class="profile-cover" ${bg(professional.cover_image || professional.logo || 'assets/conectafemme-logo.png')} role="img" aria-label="Imagem de apresentação de ${esc(professional.name)}"></div></div><div class="profile-copy"><h2 style="margin:0">${esc(professional.name)}</h2>${specialtyTags(professional)} ${professional.is_demo ? '<span class="tag demo-tag">Perfil demonstrativo</span>' : ''} ${professional.is_founder ? '<span class="founder-badge compact">✦ Profissional Fundador</span>' : ''} <span class="muted">${esc([professional.city, professional.state].filter(Boolean).join(' · '))}</span><div class="profile-rating">${ratingSummary(professional.rating_avg, professional.review_count)}</div><p>${esc(professional.bio || '')}</p>
    ${professional.is_demo ? '<p class="muted">Este perfil fictício é apenas para demonstração; o contato não está ativo.</p>' : `<div class="profile-actions"><a class="btn wa sm" target="_blank" rel="noopener noreferrer" href="${wa(professional.whatsapp, `Olá ${professional.name}! Vi seu perfil no ConectaFemme.`)}">WhatsApp</a>${instagram}</div>`}</div></div>
    <h3>Serviços</h3><div class="row service-gallery">${professional.services.map((service) => {
      const images = imgs(service.images);
      return `<div class="box">${images[0] ? `<img class="main-img" id="m${service.id}" src="${esc(images[0])}" alt="Foto do serviço ${esc(service.title)}">` : '<div class="main-img service-placeholder" aria-label="Imagem ilustrativa">ConectaFemme</div>'}
        <div class="thumbs">${images.map((image) => `<img src="${esc(image)}" alt="Foto de ${esc(service.title)}" onclick="document.getElementById('m${service.id}').src=this.src">`).join('')}</div><h4>${esc(service.title)}</h4><p class="muted">${esc(service.descr)}</p><div class="price">${brl(service.price)}</div>
        ${professional.is_demo ? '<span class="tag demo-tag">Serviço de exemplo</span>' : `<button class="btn sm" data-s="${service.id}">Escolher</button>`}</div>`;
    }).join('') || '<p class="muted">Sem serviços ainda.</p>'}</div>
    ${professional.reviews?.length ? `<details class="box reviews-box"><summary class="reviews-summary"><span><strong>Avaliações de clientes</strong><small>Ver comentários deixados</small></span>${ratingSummary(professional.rating_avg, professional.review_count)}</summary><div class="review-list">${professional.reviews.slice(0, 6).map((review) => `<article class="review-item"><div><strong>${esc(review.client_name || 'Cliente')}</strong><span class="review-stars">${'★'.repeat(Number(review.rating))}${'☆'.repeat(5 - Number(review.rating))}</span></div><p>${esc(review.comment || 'Atendimento avaliado pela cliente.')}</p></article>`).join('')}</div></details>` : ''}
    ${calendarMarkup}`;
  const syncBookingButton = () => {
    const button = $('#bk');
    if (button) button.disabled = !selectedService || !selectedSlot;
  };
  $('#day').onchange = (event) => {
    selectedSlot = null;
    const day = event.target.value;
    if (!day) {
      $('#hrs').innerHTML = `<p class="booking-calendar-empty">${days.length ? 'Selecione um dia para ver os horários disponíveis.' : 'Nenhum horário disponível no momento.'}</p>`;
      syncBookingButton();
      return;
    }
    const slotsForDay = availableSlots.filter((slot) => slot.day === day);
    if (!slotsForDay.length) {
      $('#hrs').innerHTML = '<p class="booking-calendar-empty">Não há horários livres nesta data.</p>';
      syncBookingButton();
      return;
    }
    if (professional.is_demo) {
      $('#hrs').innerHTML = slotsForDay.map((slot) => `<span class="booking-time-chip is-demo">${esc(slot.hour)}</span>`).join('');
      return;
    }
    $('#hrs').innerHTML = slotsForDay.map((slot) => `<button class="booking-time-chip" type="button" data-i="${esc(slot.id)}">${esc(slot.hour)}</button>`).join('');
    document.querySelectorAll('#hrs [data-i]').forEach((button) => button.onclick = () => {
      selectedSlot = button.dataset.i;
      document.querySelectorAll('#hrs .booking-time-chip').forEach((item) => item.classList.remove('on'));
      button.classList.add('on');
      syncBookingButton();
    });
    syncBookingButton();
  };
  if (!professional.is_demo) {
    document.querySelectorAll('[data-s]').forEach((button) => button.onclick = () => {
      selectedService = button.dataset.s;
      document.querySelectorAll('[data-s]').forEach((item) => item.classList.remove('service-selected'));
      button.classList.add('service-selected');
      $('#sel').textContent = `Serviço selecionado: ${button.parentNode.querySelector('h4').textContent}`;
      syncBookingButton();
    });
    $('#bk').onclick = async () => {
      if (!U || U.role !== 'client') { alert('Entre como cliente para agendar.'); location.hash = '#/login'; return; }
      if (!selectedService || !selectedSlot) { alert('Escolha serviço, dia e horário.'); return; }
      await api('book', { slot_id: selectedSlot, service_id: selectedService });
      await pushApi('notify_booking', { slot_id: selectedSlot, service_id: selectedService }, true).catch((error) => console.warn('Não foi possível enviar o aviso de agendamento:', error));
      alert('Agendado! Combine os detalhes pelo WhatsApp.');
      location.hash = '#/painel';
    };
  }
}

function authForm(register) {
  let categoriesReady = Promise.resolve([]);
  app.innerHTML = `<div class="box auth"><h2>${register ? 'Criar conta' : 'Entrar'}</h2>
    ${register ? `<label>Sou</label><select id="role"><option value="client">Cliente</option><option value="provider">Profissional / Estabelecimento</option></select><label>Nome</label><input id="name"><label>WhatsApp (com DDD)</label><input id="wa"><div id="client-location" class="client-location-fields"><h3>Localidade (opcional)</h3><p class="muted">Cidade e estado ajudam nas métricas agregadas da comunidade e não aparecem no seu perfil público.</p><div class="provider-location-grid"><label>Estado<select id="client-state"><option value="">Selecione</option>${BRAZIL_STATES.map((state) => `<option>${state}</option>`).join('')}</select></label><label>Cidade<input id="client-city" maxlength="80" autocomplete="address-level2"></label></div></div><div id="pf" hidden><div class="specialty-grid"><label>Especialidade principal<select id="cat1" required></select></label><label>Segunda especialidade (opcional)<select id="cat2"></select></label><small class="muted specialty-hint">Escolha até duas especialidades oferecidas pelo seu estabelecimento.</small></div><div class="provider-location-grid"><label>Estado<select id="state"><option value="">Selecione</option>${BRAZIL_STATES.map((state) => `<option>${state}</option>`).join('')}</select></label><label>Cidade<input id="city" autocomplete="address-level2"></label></div></div>` : ''}
    <label>E-mail</label><input id="email" type="email"><label>Senha</label><input id="pw" type="password"><br><br><button class="btn" id="ok" style="width:100%">${register ? 'Cadastrar' : 'Entrar'}</button>
    <p class="muted">${register ? 'Já tem conta? <a href="#/login">Entrar</a>' : 'Novo aqui? <a href="#/cadastro">Cadastre-se</a>'}</p></div>`;
  if (register) {
    categoriesReady = api('cats').then((categories) => {
      $('#cat1').innerHTML = specialtyOptions(categories);
      bindSecondarySpecialty('#cat1', '#cat2', categories);
      return categories;
    }).catch((error) => {
      console.error('Não foi possível carregar as especialidades:', error);
      return [];
    });
    $('#role').onchange = (event) => {
      const isProvider = event.target.value === 'provider';
      $('#pf').hidden = !isProvider;
      $('#client-location').hidden = isProvider;
    };
  }
  $('#ok').onclick = async () => {
    const body = { email: $('#email').value, password: $('#pw').value };
    if (register) {
      const role = $('#role').value;
      Object.assign(body, { role, name: $('#name').value, whatsapp: $('#wa').value });
      if (role === 'provider') {
        await categoriesReady;
        const primary = $('#cat1').value;
        if (!primary) return alert('Selecione uma especialidade principal.');
        const specialties = [primary, $('#cat2').value].filter(Boolean);
        Object.assign(body, { category: specialties[0] || '', specialties, state: $('#state').value, city: $('#city').value });
      } else {
        const state = $('#client-state').value;
        const city = $('#client-city').value.trim();
        if (city && !state) return alert('Selecione o estado para informar a cidade.');
        Object.assign(body, { state, city });
      }
    }
    const result = await api(register ? 'register' : 'login', body);
    T = result.token; U = result.user;
    localStorage.t = T; localStorage.u = JSON.stringify(U);
    location.hash = U.role === 'admin' ? '#/admin' : '#/painel';
  };
}
const login = () => authForm(false);
const cadastro = () => authForm(true);

const statusLabel = (status) => ({ pendente: 'Pendente', confirmado: 'Confirmado', concluido: 'OK', cancelado: 'Cancelado' }[status] || status);
function bookTable(bookings) {
  return `<table><tr><th>Data</th><th>Serviço</th><th>${U.role === 'client' ? 'Profissional' : 'Cliente'}</th><th>Status</th><th></th></tr>${bookings.map((booking) => `<tr><td>${fd(booking.day)} ${booking.hour}</td><td>${esc(booking.title)}<br>${brl(booking.price)}</td><td>${esc(booking.other_name || 'Cliente')}</td><td><span class="status-pill status-${esc(booking.status)}">${statusLabel(booking.status)}</span></td><td>${booking.other_whatsapp ? `<a class="btn wa sm" target="_blank" rel="noopener noreferrer" href="${wa(booking.other_whatsapp, `Olá! Sobre o agendamento de ${booking.title} em ${fd(booking.day)} às ${booking.hour}.`)}">WhatsApp</a>` : ''}${U.role === 'client' && booking.can_review ? ` <button class="btn sm" onclick="rateBooking(${booking.id})">Avaliar</button>` : ''}${U.role === 'provider' && booking.status === 'pendente' ? ` <button class="btn sm" onclick="st(${booking.id},'confirmado')">Confirmar</button>` : ''}${booking.status !== 'cancelado' && booking.status !== 'concluido' ? ` <button class="btn red sm" onclick="st(${booking.id},'cancelado')">Cancelar</button>` : ''}</td></tr>`).join('')}</table>`;
}
window.rateBooking = async (id) => {
  const rating = Number(prompt('De 1 a 5, qual nota você dá para o atendimento?'));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return alert('Informe uma nota inteira de 1 a 5.');
  const comment = prompt('Quer deixar um comentário? (opcional)') || '';
  await api('review_add', { booking_id: id, rating, comment });
  alert('Avaliação publicada. Obrigado por compartilhar sua experiência!');
  painel();
};
window.st = async (id, status) => {
  await api('booking_status', { id, status });
  if (['confirmado', 'cancelado'].includes(status))
    await pushApi('notify_status', { id, status }, true).catch((error) => console.warn('Não foi possível enviar o aviso de alteração:', error));
  painel();
};

function legacyScheduleTimes(settings) {
  if (Array.isArray(settings.times)) return [...new Set(settings.times.map(String).filter((time) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)))].sort();
  const toMinutes = (time) => {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(time || ''))) return null;
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };
  const start = toMinutes(settings.start), end = toMinutes(settings.end), duration = Number(settings.duration || 30);
  const breakStart = toMinutes(settings.break_start), breakEnd = toMinutes(settings.break_end);
  if (start === null || end === null || start >= end || !Number.isInteger(duration) || duration < 15 || duration > 240) return [];
  const times = [];
  for (let minute = start; minute + duration <= end; minute += duration) {
    if (breakStart !== null && breakEnd !== null && minute < breakEnd && minute + duration > breakStart) continue;
    times.push(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
  }
  return times;
}

function timeEntriesMarkup(times, inputClass, removeClass) {
  return times.map((time) => `<div class="availability-time"><input class="${inputClass}" type="time" value="${esc(time)}" aria-label="Horário disponível"><button class="btn out sm ${removeClass}" type="button" title="Remover horário" aria-label="Remover horário"><span aria-hidden="true">×</span></button></div>`).join('');
}

function weeklyScheduleEditor(schedule = {}) {
  return DAYS.map((day, index) => {
    const settings = schedule[String(index)] || {};
    const times = legacyScheduleTimes(settings);
    return `<section class="week-row ${settings.active ? '' : 'is-inactive'}" data-day="${index}">
      <label class="week-day"><input class="week-active" type="checkbox" ${settings.active ? 'checked' : ''}> <span>${day}</span></label>
      <div class="week-hours"><div class="availability-times week-times">${timeEntriesMarkup(times, 'week-time', 'remove-week-time')}</div>
      <button class="btn out sm add-week-time" type="button">+ Adicionar horário</button></div></section>`;
  }).join('');
}

function futureAvailabilityMarkup(slots) {
  const upcoming = slots.filter((slot) => slot.available || slot.booked)
    .sort((a, b) => `${a.day} ${a.hour}`.localeCompare(`${b.day} ${b.hour}`));
  if (!upcoming.length) return '';
  const byDay = new Map();
  upcoming.forEach((slot) => {
    if (!byDay.has(slot.day)) byDay.set(slot.day, []);
    byDay.get(slot.day).push(slot);
  });
  const days = [...byDay.entries()].map(([day, daySlots]) => `<details class="availability-day"><summary><span>${fd(day)}</span><small>${daySlots.length} ${daySlots.length === 1 ? 'horário' : 'horários'}</small></summary><div class="availability-day-slots">${daySlots.map((slot) => `<span class="availability-slot ${slot.booked ? 'is-booked' : ''}"><b>${esc(slot.hour)}</b>${slot.booked ? '<small>Reservado</small>' : `<button class="availability-remove" type="button" title="Remover ${esc(slot.hour)} de ${fd(day)}" aria-label="Remover horário ${esc(slot.hour)} de ${fd(day)}" onclick="del('slot_del',${slot.id})"><span aria-hidden="true">×</span></button>`}</span>`).join('')}</div></details>`).join('');
  return `<details class="box availability-manager no-print"><summary><span class="availability-manager-copy"><strong>Gerenciar horários futuros</strong><small>Consulte ou remova horários ainda não reservados.</small></span><span class="availability-manager-count">${upcoming.length}</span></summary><div class="availability-days">${days}</div></details>`;
}

function addAvailabilityTime(container, inputClass, removeClass, value = '') {
  const item = document.createElement('div');
  item.className = 'availability-time';
  const input = document.createElement('input');
  input.type = 'time';
  input.className = inputClass;
  input.value = value;
  input.setAttribute('aria-label', 'Horário disponível');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = `btn out sm ${removeClass}`;
  remove.innerHTML = '<span aria-hidden="true">×</span>';
  remove.title = 'Remover horário';
  remove.setAttribute('aria-label', 'Remover horário');
  remove.addEventListener('click', () => item.remove());
  item.append(input, remove);
  container.append(item);
}

function dateAfter(day, offset) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function appointmentRange(view, anchor) {
  if (view === 'month') {
    const start = `${anchor.slice(0, 7)}-01`;
    const year = Number(anchor.slice(0, 4)), month = Number(anchor.slice(5, 7));
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { start, end: dateAfter(start, lastDay - 1) };
  }
  if (view === 'week') {
    const date = new Date(`${anchor}T12:00:00Z`);
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    const start = dateAfter(anchor, -mondayOffset);
    return { start, end: dateAfter(start, 6) };
  }
  return { start: anchor, end: anchor };
}

function agendaReportMarkup(bookings, view, anchor) {
  const range = appointmentRange(view, anchor);
  const labels = { day: 'Dia', week: 'Semana', month: 'Mês' };
  const rows = bookings.filter((booking) => booking.day >= range.start && booking.day <= range.end)
    .sort((a, b) => `${a.day} ${a.hour}`.localeCompare(`${b.day} ${b.hour}`));
  const printRows = rows.map((booking) => `<tr><td>${fd(booking.day)} ${esc(booking.hour)}</td><td>${esc(booking.title || 'Atendimento')}</td><td>${esc(booking.other_name || 'Cliente')}</td><td>${esc(booking.other_whatsapp || '—')}</td><td>${statusLabel(booking.status)}</td><td>${brl(booking.price)}</td></tr>`).join('');
  return `<div class="box no-print"><h3>Agenda de atendimentos</h3><p class="muted">Escolha o período para consultar e imprimir seus atendimentos.</p><div class="agenda-filters"><label>Visualizar por<select id="agenda-view">${Object.entries(labels).map(([value, label]) => `<option value="${value}" ${view === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Data de referência<input id="agenda-date" type="date" value="${esc(anchor)}"></label><button class="btn" id="agenda-apply" type="button">Aplicar período</button><button class="btn out" id="agenda-print" type="button">Imprimir atendimentos</button></div></div>
    <section class="box print-report"><div class="report-heading"><div><span class="eyebrow">CONECTAFEMME · AGENDA</span><h3>Atendimentos — ${labels[view].toLocaleLowerCase('pt-BR')}</h3><p>${fd(range.start)}${range.end !== range.start ? ` a ${fd(range.end)}` : ''}</p></div><strong>${rows.length} ${rows.length === 1 ? 'atendimento' : 'atendimentos'}</strong></div>
    ${rows.length ? `<table><thead><tr><th>Data e hora</th><th>Serviço</th><th>Cliente</th><th>WhatsApp</th><th>Status</th><th>Valor</th></tr></thead><tbody>${printRows}</tbody></table>` : '<p class="muted">Nenhum atendimento neste período.</p>'}</section>`;
}

const PAYMENT_METHODS = { pix: 'Pix', dinheiro: 'Dinheiro', credito: 'Cartão de crédito', debito: 'Cartão de débito', transferencia: 'Transferência', outro: 'Outro' };

function financeReportMarkup(payments, from, to) {
  const rows = payments.filter((payment) => payment.paid_on >= from && payment.paid_on <= to)
    .sort((a, b) => `${b.paid_on} ${b.created || ''}`.localeCompare(`${a.paid_on} ${a.created || ''}`));
  const total = rows.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return `<section class="box print-report"><div class="report-heading"><div><span class="eyebrow">CONECTAFEMME · FINANCEIRO</span><h3>Relatório de recebimentos</h3><p>${from ? fd(from) : '—'} a ${to ? fd(to) : '—'}</p></div><div class="report-total"><small>Total recebido</small><strong>${brl(total)}</strong><small>${rows.length} ${rows.length === 1 ? 'lançamento' : 'lançamentos'}</small></div></div>
    ${rows.length ? `<table><thead><tr><th>Data</th><th>Cliente</th><th>Descrição</th><th>Forma</th><th>Valor</th></tr></thead><tbody>${rows.map((payment) => `<tr><td>${fd(payment.paid_on)}</td><td>${esc(payment.client_name || '—')}</td><td>${esc(payment.description || '—')}</td><td>${PAYMENT_METHODS[payment.payment_method] || 'Outro'}</td><td>${brl(payment.amount)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhum recebimento no período selecionado.</p>'}</section>`;
}

function financeMarkup() {
  const today = todayInBrazil();
  const monthStart = `${today.slice(0, 7)}-01`;
  return `<div class="box no-print"><h3>Registrar recebimento</h3><p class="muted">Lançamentos privados para seu controle interno: somente você, como profissional, pode consultá-los; clientes não veem esses dados. Esta tela não processa pagamentos.</p>
    <div class="finance-entry-grid"><label>Data<input id="payment-date" type="date" max="${today}" value="${today}" required></label><label>Valor recebido (R$)<input id="payment-amount" type="number" min="0.01" step="0.01" required></label><label>Forma de pagamento<select id="payment-method" required>${Object.entries(PAYMENT_METHODS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label>Cliente (opcional)<input id="payment-client" maxlength="120"></label><label>Descrição (opcional)<input id="payment-description" maxlength="200" placeholder="Serviço ou referência interna"></label></div><br><button class="btn" id="payment-save" type="button">Registrar recebimento</button></div>
    <div class="box no-print"><h3>Gerar relatório</h3><div class="finance-filters"><label>De<input id="finance-from" type="date" value="${monthStart}"></label><label>Até<input id="finance-to" type="date" value="${today}"></label><button class="btn" id="finance-filter" type="button">Atualizar relatório</button><button class="btn out" id="finance-print" type="button">Imprimir relatório</button></div></div><div id="finance-report"></div>`;
}

async function compressForUpload(file) {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Use uma imagem JPG, PNG ou WebP.');
  if (file.size > 15_000_000) throw new Error('Escolha uma imagem com até 15 MB antes da otimização.');
  let dataUrl;
  if (file.size <= 2_500_000) {
    dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      reader.readAsDataURL(file);
    });
  } else {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    dataUrl = canvas.toDataURL('image/webp', 0.82);
  }
  if (dataUrl.length > 4_200_000) throw new Error('A imagem continua muito grande após a compressão. Escolha outra imagem.');
  return dataUrl;
}

async function uploadSelected(file, kind) {
  return api('image_upload', { kind, data_url: await compressForUpload(file) });
}

async function copyPublicLink(id) {
  const link = publicProfileUrl(id);
  try {
    await navigator.clipboard.writeText(link);
    alert('Link público copiado. Você já pode enviar para suas clientes.');
  } catch {
    prompt('Copie o link público do seu perfil:', link);
  }
}
window.copyPublicLink = copyPublicLink;

function buildManualBookingForm(services, slots) {
  const available = slots.filter((slot) => slot.available && !slot.booked);
  return `<div class="box"><h3>Registrar agendamento combinado por fora do site</h3><p class="muted">Use quando a cliente entrar em contato por WhatsApp, telefone ou pessoalmente. O horário ficará reservado na agenda.</p>
    <div class="manual-booking-grid"><label>Serviço<select id="manual-service"><option value="">Escolha um serviço</option>${services.map((service) => `<option value="${service.id}">${esc(service.title)} · ${brl(service.price)}</option>`).join('')}</select></label>
      <label>Horário disponível<select id="manual-slot"><option value="">Escolha dia e horário</option>${available.map((slot) => `<option value="${slot.id}">${fd(slot.day)} · ${esc(slot.hour)}</option>`).join('')}</select></label>
      <label>Nome da cliente<input id="manual-name" maxlength="120" autocomplete="name"></label><label>WhatsApp da cliente<input id="manual-whatsapp" inputmode="tel" maxlength="30" placeholder="DDD + número" autocomplete="tel"></label></div>
    <br><button class="btn" id="manual-save" ${!available.length || !services.length ? 'disabled' : ''}>Salvar agendamento</button>${!available.length ? '<p class="muted">Não há horários livres. Configure o expediente na aba Expediente.</p>' : ''}</div>`;
}

async function painel(tab = 'ag') {
  if (!U) return location.hash = '#/login';
  if (U.role === 'admin') return location.hash = '#/admin';
  const bookings = await api('bookings');
  if (U.role === 'client') {
    const location = await api('client_location');
    const hasLocation = Boolean(location.city || location.state);
    app.innerHTML = `<h2>Meus agendamentos</h2><details class="box client-location-card" ${hasLocation ? '' : 'open'}><summary><strong>Minha localidade</strong><span class="muted">${hasLocation ? 'Atualize cidade e estado' : 'Opcional · ajuda nas métricas da comunidade'}</span></summary><p class="muted">A localidade é usada apenas em métricas agregadas do painel administrativo e não aparece no perfil público.</p><div class="provider-location-grid"><label>Estado<select id="client-location-state"><option value="">Selecione</option>${BRAZIL_STATES.map((state) => `<option value="${state}" ${state === location.state ? 'selected' : ''}>${state}</option>`).join('')}</select></label><label>Cidade<input id="client-location-city" maxlength="80" value="${esc(location.city || '')}" autocomplete="address-level2"></label></div><br><button class="btn" id="client-location-save" type="button">Salvar localidade</button></details><div class="box">${bookings.length ? bookTable(bookings) : '<p class="muted">Nenhum agendamento.</p>'}</div>`;
    $('#client-location-save').onclick = async () => {
      const state = $('#client-location-state').value;
      const city = $('#client-location-city').value.trim();
      if (city && !state) return alert('Selecione o estado para informar a cidade.');
      await api('client_location', { state, city });
      alert('Localidade salva. Obrigada por ajudar a acompanhar onde nossa comunidade está crescendo.');
      painel('ag');
    };
    return;
  }

  const [categories, me, publicProfile, slots, payments] = await Promise.all([
    api('cats'), api('my_profile'), api('provider', null, `&id=${U.id}`), api('my_slots'),
    tab === 'financeiro' ? api('payments') : Promise.resolve([]),
  ]);
  const services = publicProfile.services || [];
  const profileLink = publicProfileUrl(U.id);
  const selectedSpecialties = specialtyList(me);
  const tabs = {
    ag: `${buildManualBookingForm(services, slots)}<div class="box">${bookings.length ? bookTable(bookings) : '<p class="muted">Sem agendamentos ainda.</p>'}</div>`,
    perfil: `<div class="box"><h3>Seu perfil público</h3><p class="muted">Envie este link às suas clientes para elas verem seus serviços e agendarem.</p><div class="share-link-row"><input id="public-link" readonly value="${esc(profileLink)}"><button class="btn" id="copy-link" type="button">Copiar link público</button></div>
      <label>Nome do estabelecimento</label><input id="n" value="${esc(me.name)}"><label>WhatsApp</label><input id="w" value="${esc(me.whatsapp)}"><div class="specialty-grid"><label>Especialidade principal<select id="c1" required>${specialtyOptions(categories, selectedSpecialties[0] || me.category || '')}</select></label><label>Segunda especialidade (opcional)<select id="c2"></select></label><small class="muted specialty-hint">Escolha até duas especialidades oferecidas pelo seu estabelecimento.</small></div><div class="provider-location-grid"><label>Estado<select id="profile-state"><option value="">Selecione</option>${BRAZIL_STATES.map((state) => `<option ${state === me.state ? 'selected' : ''}>${state}</option>`).join('')}</select></label><label>Cidade<input id="ci" value="${esc(me.city)}" autocomplete="address-level2"></label></div>
      <label>Instagram</label><input id="instagram" type="url" placeholder="https://www.instagram.com/seuperfil" value="${esc(me.instagram_url || '')}">
      <div class="profile-image-settings"><div class="profile-image-field"><label for="logo-file">Logo do profissional (imagem redonda)</label><input id="logo-file" type="file" accept="image/jpeg,image/png,image/webp"><small class="muted">Esta é a marca que aparece no círculo do perfil.</small><div class="profile-image-preview is-round" ${bg(me.logo || 'assets/conectafemme-logo.png')} role="img" aria-label="Prévia da logo"></div></div>
      <div class="profile-image-field"><label for="cover-file">Foto de apresentação (quadrada)</label><input id="cover-file" type="file" accept="image/jpeg,image/png,image/webp"><small class="muted">Opcional. Se não enviar outra imagem, a logo será usada. Fotos de serviços ficam apenas na aba Serviços.</small><div id="cover-preview" class="profile-image-preview is-square" ${bg(me.cover_image || me.logo || 'assets/conectafemme-logo.png')} role="img" aria-label="Prévia da imagem quadrada"></div><p id="cover-state" class="profile-image-state">${me.cover_image ? 'Imagem quadrada atual.' : 'A logo será usada na imagem quadrada.'}</p><button class="btn out sm" id="cover-use-logo" type="button">Usar a logo no quadrado</button></div></div>
      <label>Sobre você</label><textarea id="b" rows="4">${esc(me.bio)}</textarea><br><br><button class="btn" id="sp">Salvar perfil</button></div>`,
    serv: `<div class="box" id="service-editor"><h3 id="service-form-heading">Adicionar serviço</h3><input id="service-edit-id" type="hidden"><label for="t">Título</label><input id="t" maxlength="160"><label for="d">Descrição</label><textarea id="d" rows="3"></textarea><label for="pr">Valor (R$)</label><input id="pr" type="number" min="0" step="0.01" required><label for="service-files">Fotos do serviço</label><input id="service-files" type="file" accept="image/jpeg,image/png,image/webp" multiple><small id="service-image-help" class="muted">Escolha até 4 imagens do dispositivo; imagens grandes são otimizadas antes do envio.</small><br><br><button class="btn" id="ss">Publicar serviço</button> <button class="btn out" id="cancel-service-edit" type="button" hidden>Cancelar edição</button></div>${services.map((service) => `<div class="box service-management-card"><div><b>${esc(service.title)}</b> — ${brl(service.price)}</div><div class="profile-actions"><button class="btn out sm" type="button" onclick="editService(${service.id})">Editar</button><button class="btn red sm" type="button" onclick="del('service_del',${service.id})">Excluir</button></div></div>`).join('')}`,
    expediente: `<div class="box"><h3>Expediente semanal</h3><p class="muted">Selecione os dias e inclua horários. Você pode editá-los quando quiser.</p><div class="week-schedule">${weeklyScheduleEditor(me.weekly_schedule || {})}</div><br><button class="btn" id="save-weekly">Salvar expediente</button></div>
      <div class="box"><h3>Horários extras para uma data</h3><p class="muted">Adicione disponibilidades avulsas sem alterar seu expediente semanal.</p><div class="manual-booking-grid"><label>Data<input id="extra-day" type="date" min="${todayInBrazil()}"></label><div><label>Horários disponíveis</label><div id="extra-times" class="availability-times"></div><button class="btn out sm" id="extra-time-add" type="button">Adicionar horário</button></div></div><br><button class="btn" id="add-extra">Salvar horários extras</button></div>
      ${futureAvailabilityMarkup(slots)}`,
    agenda: agendaReportMarkup(bookings, window._agendaSelection?.view || 'day', window._agendaSelection?.date || todayInBrazil()),
    financeiro: financeMarkup(),
  };
  app.innerHTML = `<h2>Painel do profissional</h2><div class="tabs no-print">${[['ag','Agendamentos'],['perfil','Perfil público'],['serv','Serviços'],['expediente','Expediente'],['agenda','Agenda'],['financeiro','Financeiro']].map(([key, label]) => `<button class="${key === tab ? 'on' : ''}" onclick="painel('${key}')">${label}</button>`).join('')}</div>${tabs[tab] || tabs.ag}`;
  const on = (selector, handler) => { if ($(selector)) $(selector).onclick = handler; };

  if (tab === 'expediente') {
    document.querySelectorAll('.add-week-time').forEach((button) => button.addEventListener('click', () => addAvailabilityTime(button.closest('.week-hours').querySelector('.week-times'), 'week-time', 'remove-week-time')));
    document.querySelectorAll('.week-row').forEach((row) => {
      const checkbox = row.querySelector('.week-active');
      const updateState = () => {
        row.classList.toggle('is-inactive', !checkbox.checked);
        row.querySelectorAll('.week-time, .remove-week-time, .add-week-time').forEach((control) => { control.disabled = !checkbox.checked; });
      };
      checkbox.addEventListener('change', updateState);
      updateState();
    });
    const extraTimes = $('#extra-times');
    if (extraTimes) addAvailabilityTime(extraTimes, 'extra-time', 'remove-extra-time');
    on('#extra-time-add', () => addAvailabilityTime(extraTimes, 'extra-time', 'remove-extra-time'));
    document.querySelectorAll('.remove-week-time').forEach((button) => button.addEventListener('click', () => button.closest('.availability-time').remove()));
  }

  if (tab === 'serv') {
    window._providerServices = services;
    on('#cancel-service-edit', () => window.cancelServiceEdit());
  }

  if (tab === 'agenda') {
    on('#agenda-apply', () => {
      const date = $('#agenda-date').value;
      if (!date) return alert('Escolha uma data para consultar a agenda.');
      window._agendaSelection = { view: $('#agenda-view').value, date };
      painel('agenda');
    });
    on('#agenda-print', () => window.print());
  }

  if (tab === 'financeiro') {
    const drawReport = () => {
      const from = $('#finance-from').value;
      const to = $('#finance-to').value;
      if (!from || !to || from > to) return alert('Confira as datas do relatório.');
      $('#finance-report').innerHTML = financeReportMarkup(payments, from, to);
    };
    drawReport();
    on('#finance-filter', drawReport);
    on('#finance-print', () => window.print());
    on('#payment-save', async () => {
      const amount = Number($('#payment-amount').value);
      const paidOn = $('#payment-date').value;
      if (!paidOn || !Number.isFinite(amount) || amount <= 0) return alert('Informe uma data e um valor recebido válido.');
      await api('payment_add', { paid_on: paidOn, amount, payment_method: $('#payment-method').value, client_name: $('#payment-client').value, description: $('#payment-description').value });
      alert('Recebimento registrado.');
      painel('financeiro');
    });
  }

  let useLogoAsCover = false;
  if (tab === 'perfil') {
    bindSecondarySpecialty('#c1', '#c2', categories, selectedSpecialties[1] || '');
    $('#cover-file').addEventListener('change', () => {
      useLogoAsCover = false;
      $('#cover-state').textContent = $('#cover-file').files[0] ? 'A nova imagem será usada no quadrado ao salvar.' : 'A imagem atual será mantida.';
    });
  }
  on('#cover-use-logo', () => {
    useLogoAsCover = true;
    $('#cover-file').value = '';
    $('#cover-state').textContent = 'A logo será usada no quadrado ao salvar.';
  });
  on('#copy-link', () => copyPublicLink(U.id));
  on('#sp', async () => {
    const primary = $('#c1').value;
    if (!primary) return alert('Selecione uma especialidade principal.');
    const specialties = [primary, $('#c2').value].filter(Boolean);
    const selectedFile = $('#logo-file').files[0];
    const selectedCoverFile = $('#cover-file').files[0];
    let logo = me.logo || '';
    let coverImage = me.cover_image || '';
    if (selectedFile) logo = (await uploadSelected(selectedFile, 'profile')).url;
    if (selectedCoverFile) coverImage = (await uploadSelected(selectedCoverFile, 'profile')).url;
    else if (useLogoAsCover) coverImage = '';
    await api('profile_save', { name: $('#n').value, whatsapp: $('#w').value, category: specialties[0], specialties, state: $('#profile-state').value, city: $('#ci').value, logo, cover_image: coverImage, bio: $('#b').value, instagram_url: $('#instagram').value });
    alert('Perfil atualizado!');
    painel('perfil');
  });
  on('#ss', async () => {
    const files = [...$('#service-files').files];
    if (files.length > 4) return alert('Escolha no máximo 4 imagens por serviço.');
    const images = [];
    for (const file of files) images.push((await uploadSelected(file, 'service')).url);
    const editId = $('#service-edit-id').value;
    await api('service_save', { id: editId || undefined, title: $('#t').value, descr: $('#d').value, price: $('#pr').value, images });
    alert(editId ? 'Serviço atualizado.' : 'Serviço publicado.');
    painel('serv');
  });
  on('#save-weekly', async () => {
    const schedule = {};
    document.querySelectorAll('.week-row').forEach((row) => {
      schedule[row.dataset.day] = {
        active: row.querySelector('.week-active').checked,
        times: [...row.querySelectorAll('.week-time')].map((input) => input.value).filter(Boolean),
      };
    });
    await api('schedule_save', { schedule });
    alert('Expediente salvo e horários recorrentes atualizados para os próximos 60 dias.');
    painel('expediente');
  });
  on('#add-extra', async () => {
    const day = $('#extra-day').value;
    const hours = [...document.querySelectorAll('.extra-time')].map((input) => input.value).filter(Boolean);
    if (!day || !hours.length) return alert('Escolha uma data e informe pelo menos um horário.');
    await api('slot_add', { day, hours });
    alert('Horários extras adicionados à agenda.');
    painel('expediente');
  });
  on('#manual-save', async () => {
    await api('manual_book', { slot_id: $('#manual-slot').value, service_id: $('#manual-service').value, name: $('#manual-name').value, whatsapp: $('#manual-whatsapp').value });
    alert('Agendamento registrado e horário reservado.');
    painel('ag');
  });
  window._tab = tab;
}
window.painel = painel;
window.del = async (action, id) => { await api(action, { id }); painel(window._tab); };
window.editService = (id) => {
  const service = (window._providerServices || []).find((item) => Number(item.id) === Number(id));
  if (!service) return alert('Não foi possível localizar este serviço. Atualize a tela e tente novamente.');
  $('#service-edit-id').value = service.id;
  $('#t').value = service.title || '';
  $('#d').value = service.descr || '';
  $('#pr').value = service.price ?? '';
  $('#service-files').value = '';
  $('#service-form-heading').textContent = 'Editar serviço';
  $('#service-image-help').textContent = 'Se não escolher novas fotos, as imagens atuais serão mantidas.';
  $('#ss').textContent = 'Salvar alterações';
  $('#cancel-service-edit').hidden = false;
  $('#service-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.cancelServiceEdit = () => {
  $('#service-edit-id').value = '';
  $('#t').value = '';
  $('#d').value = '';
  $('#pr').value = '';
  $('#service-files').value = '';
  $('#service-form-heading').textContent = 'Adicionar serviço';
  $('#service-image-help').textContent = 'Escolha até 4 imagens do dispositivo; imagens grandes são otimizadas antes do envio.';
  $('#ss').textContent = 'Publicar serviço';
  $('#cancel-service-edit').hidden = true;
};

function adminDashboardMarkup(users, clients, professionals) {
  const format = (value) => new Intl.NumberFormat('pt-BR').format(value);
  const clean = (value) => String(value ?? '').trim();
  const realUsers = users.filter((user) => !user.is_demo);
  const realClients = clients.filter((user) => !user.is_demo);
  const realProfessionals = professionals.filter((user) => !user.is_demo);
  const localities = new Set(realUsers.filter((user) => clean(user.city) || clean(user.state)).map((user) => `${clean(user.city).toLocaleLowerCase('pt-BR')}|${clean(user.state).toUpperCase()}`)).size;
  const clientsWithoutLocation = realClients.filter((user) => !clean(user.city) && !clean(user.state)).length;
  const states = [...new Set(realUsers.map((user) => clean(user.state).toUpperCase()).filter(Boolean))].sort();
  return `<section class="admin-dashboard">
    <div class="dashboard-intro"><div><span class="dashboard-kicker">VISÃO GERAL</span><h3>Comunidade ConectaFemme</h3><p class="muted">Acompanhe o crescimento e a distribuição das pessoas cadastradas.</p></div><span class="dashboard-live"><i></i> Dados atualizados agora</span></div>
    <div class="dashboard-kpis">
      <article class="dashboard-kpi dashboard-kpi-total"><span class="dashboard-kpi-label">Contas reais na plataforma</span><strong>${format(realClients.length + realProfessionals.length)}</strong><small>Perfis DEMO ficam de fora</small></article>
      <article class="dashboard-kpi dashboard-kpi-clients"><span class="dashboard-kpi-label">Clientes</span><strong>${format(realClients.length)}</strong><small>Contas reais de clientes</small></article>
      <article class="dashboard-kpi dashboard-kpi-providers"><span class="dashboard-kpi-label">Profissionais</span><strong>${format(realProfessionals.length)}</strong><small>Perfis profissionais reais</small></article>
      <article class="dashboard-kpi dashboard-kpi-locations"><span class="dashboard-kpi-label">Localidades mapeadas</span><strong>${format(localities)}</strong><small>Cidade e UF cadastradas</small></article>
    </div>
    <div class="dashboard-main-grid">
      <section class="box dashboard-location-panel">
        <div class="dashboard-panel-heading"><div><span class="dashboard-kicker">DISTRIBUIÇÃO GEOGRÁFICA</span><h3 id="dashboard-location-title">Usuários por estado</h3><p id="dashboard-location-subtitle" class="muted">Selecione um estado para detalhar as cidades.</p></div><button class="btn out sm" id="dashboard-clear-state" type="button" hidden>Ver todos os estados</button></div>
        <div class="dashboard-filters"><label>Tipo de perfil<select id="dashboard-role"><option value="all">Todos os perfis</option><option value="client">Clientes</option><option value="provider">Profissionais</option></select></label><label>Estado<select id="dashboard-state"><option value="all">Todos os estados</option><option value="__unreported__">Estado não informado</option>${states.map((state) => `<option value="${esc(state)}">${esc(state)}</option>`).join('')}</select></label></div>
        <div class="dashboard-legend" id="dashboard-legend"><span><i class="legend-client"></i>Clientes</span><span><i class="legend-provider"></i>Profissionais</span></div>
        <div class="geo-chart-list" id="dashboard-chart" aria-live="polite"></div>
      </section>
      <aside class="box dashboard-insights"><span class="dashboard-kicker">LEITURA RÁPIDA</span><h3>Sobre as localidades</h3>
        <div class="dashboard-insight-row"><strong>${format(states.length)}</strong><span>estados com cadastro</span></div>
        <div class="dashboard-insight-row"><strong>${format(users.filter((user) => !clean(user.city) && !clean(user.state)).length)}</strong><span>usuários sem localidade informada</span></div>
        ${clientsWithoutLocation ? `<div class="dashboard-data-note"><strong>${format(clientsWithoutLocation)} ${clientsWithoutLocation === 1 ? 'cliente sem localidade' : 'clientes sem localidade'}</strong><p>Clientes podem informar ou atualizar cidade e UF no painel de agendamentos. O dado é opcional e não aparece publicamente.</p></div>` : '<div class="dashboard-data-note is-complete"><strong>Localidades dos clientes registradas</strong><p>Os clientes cadastrados já têm localidade para compor as métricas.</p></div>'}
        <p class="dashboard-source">A distribuição usa cidade e UF cadastradas; perfis DEMO são excluídos dos indicadores e podem ser removidos na lista administrativa.</p>
      </aside>
    </div>
  </section>`;
}

function bindAdminDashboard(users) {
  const roleSelect = $('#dashboard-role');
  const stateSelect = $('#dashboard-state');
  const chart = $('#dashboard-chart');
  const clearState = $('#dashboard-clear-state');
  if (!roleSelect || !stateSelect || !chart) return;
  const clean = (value) => String(value ?? '').trim();
  const render = () => {
    const role = roleSelect.value;
    const selectedState = stateSelect.value;
    let population = users.filter((user) => !user.is_demo && ['client', 'provider'].includes(user.role));
    if (role !== 'all') population = population.filter((user) => user.role === role);
    if (selectedState !== 'all') population = population.filter((user) => {
      const state = clean(user.state).toUpperCase();
      return selectedState === '__unreported__' ? !state : state === selectedState;
    });
    const groups = new Map();
    for (const user of population) {
      const state = clean(user.state).toUpperCase();
      const city = clean(user.city);
      const key = selectedState === 'all' ? (state || '__unreported__') : (city.toLocaleLowerCase('pt-BR') || '__no_city__');
      const label = selectedState === 'all' ? (state || 'Estado não informado') : (city || 'Cidade não informada');
      if (!groups.has(key)) groups.set(key, { key, label, clients: 0, providers: 0 });
      groups.get(key)[user.role === 'client' ? 'clients' : 'providers']++;
    }
    let rows = [...groups.values()].sort((a, b) => (b.clients + b.providers) - (a.clients + a.providers) || a.label.localeCompare(b.label, 'pt-BR'));
    if (selectedState !== 'all' && rows.length > 8) {
      const rest = rows.slice(8).reduce((total, row) => ({ clients: total.clients + row.clients, providers: total.providers + row.providers }), { clients: 0, providers: 0 });
      rows = [...rows.slice(0, 8), { key: '__other__', label: 'Outras cidades', ...rest }];
    }
    const max = Math.max(1, ...rows.map((row) => row.clients + row.providers));
    const detailLabel = selectedState === '__unreported__' ? 'sem estado informado' : selectedState;
    $('#dashboard-location-title').textContent = selectedState === 'all' ? 'Usuários por estado' : `Cidades · ${detailLabel}`;
    $('#dashboard-location-subtitle').textContent = selectedState === 'all' ? 'Clique em uma barra para detalhar as cidades do estado.' : 'Distribuição de clientes e profissionais nesta localidade.';
    $('#dashboard-legend').hidden = role !== 'all';
    if (clearState) clearState.hidden = selectedState === 'all';
    if (!rows.length) {
      chart.innerHTML = '<div class="dashboard-empty">Nenhum cadastro encontrado para estes filtros.</div>';
      return;
    }
    chart.innerHTML = rows.map((row) => {
      const total = row.clients + row.providers;
      const displayed = role === 'client' ? row.clients : role === 'provider' ? row.providers : total;
      const clientWidth = role === 'provider' ? 0 : row.clients / max * 100;
      const providerWidth = role === 'client' ? 0 : row.providers / max * 100;
      const tag = selectedState === 'all' ? 'button' : 'div';
      const attrs = selectedState === 'all' ? `type="button" data-state="${esc(row.key)}"` : '';
      return `<${tag} class="geo-bar-row" ${attrs}><span class="geo-row-heading"><strong>${esc(row.label)}</strong><span>${formatAdminNumber(displayed)} ${displayed === 1 ? 'usuário' : 'usuários'}</span></span><span class="geo-bar-track"><i class="geo-bar-client" style="width:${clientWidth}%"></i><i class="geo-bar-provider" style="width:${providerWidth}%"></i></span></${tag}>`;
    }).join('');
    chart.querySelectorAll('[data-state]').forEach((button) => button.addEventListener('click', () => {
      stateSelect.value = button.dataset.state;
      render();
    }));
  };
  roleSelect.addEventListener('change', render);
  stateSelect.addEventListener('change', render);
  if (clearState) clearState.addEventListener('click', () => { stateSelect.value = 'all'; render(); });
  render();
}

function formatAdminNumber(value) { return new Intl.NumberFormat('pt-BR').format(value); }

async function admin(tab = 'd') {
  if (!U || U.role !== 'admin') return location.hash = '#/login';
  const [users, categories, bookings] = await Promise.all([api('admin_users'), api('cats'), api('admin_bookings')]);
  const professionals = users.filter((user) => user.role === 'provider');
  const clients = users.filter((user) => user.role === 'client');
  const userTable = (people, title, empty) => `<div class="box admin-user-group"><div class="admin-group-heading"><h3>${title}</h3><span class="admin-count">${people.length} cadastro${people.length === 1 ? '' : 's'}</span></div>${people.length ? `<table><tr><th>Nome</th><th>Especialidade</th><th>Localização</th><th>E-mail</th><th>WhatsApp</th><th></th></tr>${people.map((user) => `<tr><td>${esc(user.name)} ${user.is_demo ? '<span class="tag demo-tag">DEMO</span>' : ''}</td><td>${user.role === 'provider' ? esc(specialtyList(user).join(' · ') || 'Sem categoria') : '—'}</td><td>${esc([user.city, user.state].filter(Boolean).join(' · ') || '—')}</td><td>${esc(user.email)}</td><td>${esc(user.whatsapp)}</td><td><button class="btn red sm" onclick="adel(${user.id})">Excluir</button></td></tr>`).join('')}</table>` : `<p class="muted">${empty}</p>`}</div>`;
  const content = {
    d: adminDashboardMarkup(users, clients, professionals),
    p: userTable(professionals, 'Profissionais', 'Nenhum profissional cadastrado. Os perfis DEMO ficam nesta aba para exclusão posterior.'),
    c: userTable(clients, 'Clientes', 'Nenhum cliente cadastrado.'),
    k: `<div class="box"><div class="bar"><input id="nc" placeholder="Nova categoria"><button class="btn" id="ac">Adicionar</button></div><br>${categories.map((category) => `<span class="tag">${esc(category)} <a href="#" onclick="acd('${esc(category)}');return false">✕</a></span> `).join('')}</div>`,
    b: `<div class="box"><table><tr><th>Data</th><th>Serviço</th><th>Cliente</th><th>Profissional</th><th>Status</th></tr>${bookings.map((booking) => `<tr><td>${fd(booking.day)} ${esc(booking.hour)}</td><td>${esc(booking.title)}</td><td>${esc(booking.client || 'Agendamento manual')}</td><td>${esc(booking.provider)}</td><td><span class="status-pill status-${esc(booking.status)}">${statusLabel(booking.status)}</span></td></tr>`).join('')}</table></div>`,
    s: `<div class="box security-box"><h3>Alterar senha administrativa</h3><p class="muted">Use esta área para trocar a senha do acesso administrativo. A senha atual é necessária e a nova senha deve ter pelo menos 8 caracteres.</p><label>Senha atual</label><input id="admin-current-password" type="password" autocomplete="current-password"><label>Nova senha</label><input id="admin-new-password" type="password" minlength="8" autocomplete="new-password"><label>Confirmar nova senha</label><input id="admin-confirm-password" type="password" minlength="8" autocomplete="new-password"><br><br><button class="btn" id="change-admin-password" type="button">Salvar nova senha</button></div>`,
  };
  app.innerHTML = `<section class="admin-heading"><div class="admin-heading-copy"><span class="eyebrow">PAINEL DE CONTROLE</span><h2>Administração</h2><p class="muted">Acompanhe a comunidade e a operação do ConectaFemme.</p></div></section><div class="tabs admin-tabs">${[['d','Dashboard'],['p','Profissionais'],['c','Clientes'],['k','Categorias'],['b','Agendamentos'],['s','Segurança']].map(([key,label]) => `<button class="${key === tab ? 'on' : ''}" onclick="admin('${key}')">${label}</button>`).join('')}</div>${content[tab] || content.d}`;
  window._at = tab;
  if (tab === 'd') bindAdminDashboard(users);
  if ($('#ac')) $('#ac').onclick = async () => { await api('admin_cat_add', { name: $('#nc').value }); admin('k'); };
  if ($('#change-admin-password')) $('#change-admin-password').onclick = async () => {
    const current_password = $('#admin-current-password').value;
    const new_password = $('#admin-new-password').value;
    const confirm_password = $('#admin-confirm-password').value;
    if (new_password.length < 8) return alert('A nova senha precisa ter pelo menos 8 caracteres.');
    if (new_password !== confirm_password) return alert('A confirmação da nova senha não confere.');
    await api('admin_password_change', { current_password, new_password, confirm_password });
    alert('Senha administrativa alterada com sucesso.');
    admin('s');
  };
}
window.admin = admin;
window.adel = async (id) => { if (confirm('Excluir esta conta e seus dados?')) { await api('admin_user_del', { id }); admin(window._at === 'c' ? 'c' : 'p'); } };
window.acd = async (name) => { await api('admin_cat_del', { name }); admin('k'); };
route();
