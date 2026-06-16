// --- 1. BASE DE DATOS DINÁMICA ---
let dbPersonal = { helpdesk: [], corporativo: [], tiendas: [], jefes: [] };

async function cargarPersonalDB() {
    try {
        const respuesta = await fetch('/api/personal');
        const datos = await respuesta.json();
        dbPersonal = { helpdesk: [], corporativo: [], tiendas: [], jefes: [] };
        datos.forEach(tec => { if (dbPersonal[tec.area]) dbPersonal[tec.area].push(tec); });
        renderPods();
    } catch (error) {
        console.error("❌ Error al cargar personal:", error);
    }
}

// --- 2. MOTOR HÁPTICO ---
function triggerHaptic(type) {
    if (!navigator.vibrate) return;
    if (type === 'tap') navigator.vibrate(25);
    if (type === 'success') navigator.vibrate([40, 60]);
}

// --- 3. DATOS EN VIVO (GLPI / GRAFANA) ---
let kpiDataVivos = { solicitudes: "0", incidencias: "0", sla: "0", satisfaccion: "0" };
let currentTiempo = 'mes_actual';
let currentAreaId = 'helpdesk';
let currentGroup = [];

async function sincronizarConGrafana() {
    try {
        const url = `/api/kpis?area=${currentAreaId}&tiempo=${currentTiempo}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();
        kpiDataVivos = datos;
        const overlay = document.getElementById('ui-overlay');
        if (overlay && overlay.style.display === 'flex') { renderKPIs(); animarNumeros(); }
        marcarActualizado(true);
    } catch (error) {
        marcarActualizado(false);
    }
}

// --- FUNCIÓN DE AGRADO: indicador "en vivo" + hora de actualización ---
function marcarActualizado(ok) {
    const el = document.getElementById('last-updated');
    const dot = document.querySelector('.live-dot');
    if (el) {
        if (ok) {
            const a = new Date();
            const hh = String(a.getHours()).padStart(2, '0');
            const mm = String(a.getMinutes()).padStart(2, '0');
            const ss = String(a.getSeconds()).padStart(2, '0');
            el.textContent = `Actualizado a las ${hh}:${mm}:${ss}`;
            el.classList.remove('offline');
        } else {
            el.textContent = 'Reintentando conexión con el servidor…';
            el.classList.add('offline');
        }
    }
    if (dot) dot.classList.toggle('off', !ok);
}

// --- ENTRADA AL DASHBOARD ---
function entrarDashboard() {
    const overlay = document.getElementById('ui-overlay');
    const scanner = document.getElementById('scanner-ui');
    if (!overlay || overlay.style.display === 'flex') return;
    triggerHaptic('success');
    if (scanner) scanner.style.display = 'none';
    overlay.style.display = 'flex';
    currentAreaId = 'helpdesk';
    renderPods();
    renderKPIs();
    animarNumeros();
}

// --- CÁMARA: permiso solicitado con gesto del usuario (confiable, sin error de fondo) ---
let camStream = null;
window.iniciarExperiencia = async function() {
    const status = document.getElementById('intro-status');
    const btn = document.querySelector('.btn-iniciar');
    triggerHaptic('tap');
    if (status) { status.textContent = 'Solicitando acceso a la cámara…'; status.classList.remove('error'); }
    if (btn) btn.disabled = true;

    try {
        camStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } }, audio: false
        });
        const video = document.getElementById('cam-feed');
        if (video) { video.srcObject = camStream; try { await video.play(); } catch (e) {} }
        await pedirOrientacion();
        entrarDashboard();
    } catch (err) {
        if (btn) btn.disabled = false;
        let msg = 'No se pudo abrir la cámara en este dispositivo.';
        const name = err && err.name ? err.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
            msg = '📷 Permiso de cámara denegado. Toca el candado de la barra de direcciones → Cámara → Permitir, y vuelve a intentar.';
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
            msg = 'No se detectó una cámara disponible.';
        } else if (location.protocol !== 'https:') {
            msg = 'La cámara solo funciona por HTTPS. Abre el sitio con https://';
        }
        if (status) { status.innerHTML = msg; status.classList.add('error'); }
        mostrarBotonSinCamara();
    }
};

// Nunca dejar al usuario atascado: opción de entrar sin cámara
function mostrarBotonSinCamara() {
    if (document.getElementById('btn-sin-camara')) return;
    const cont = document.querySelector('.intro-card');
    if (!cont) return;
    const b = document.createElement('button');
    b.id = 'btn-sin-camara';
    b.className = 'btn-iniciar btn-secondary';
    b.textContent = 'Ver panel sin cámara';
    b.onclick = () => { initParallax(); entrarDashboard(); };
    cont.appendChild(b);
}

// iOS exige permiso explícito para el giroscopio (parallax)
async function pedirOrientacion() {
    try {
        if (typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            await DeviceOrientationEvent.requestPermission();
        }
    } catch (e) { /* el usuario puede negarlo; el panel funciona igual */ }
    initParallax();
}

// --- FUNCIÓN DE AGRADO: saludo según la hora ---
function saludarPorHora() {
    const el = document.getElementById('intro-greet');
    if (!el) return;
    const h = new Date().getHours();
    const saludo = h < 12 ? 'Buenos días' : (h < 19 ? 'Buenas tardes' : 'Buenas noches');
    el.textContent = `${saludo} 👋`;
}

// --- FUNCIÓN DE AGRADO: refrescar manual ---
window.refrescarDatos = function() {
    triggerHaptic('tap');
    const btn = document.getElementById('btn-refresh');
    if (btn) { btn.classList.add('spin'); setTimeout(() => btn.classList.remove('spin'), 700); }
    sincronizarConGrafana();
    cargarPersonalDB();
};

window.addEventListener('load', () => {
    saludarPorHora();
    cargarPersonalDB();
    setTimeout(sincronizarConGrafana, 800);
});

setInterval(() => {
    sincronizarConGrafana();
    cargarPersonalDB();
}, 30000);

// --- 4. NAVEGACIÓN Y TABS ---
window.switchTab = function(areaId) {
    triggerHaptic('tap');
    const botones = document.querySelectorAll('.bottom-nav .nav-btn');
    botones.forEach(btn => btn.classList.remove('active'));
    botones.forEach(btn => { if (btn.getAttribute('onclick').includes(areaId)) btn.classList.add('active'); });

    currentAreaId = areaId;
    renderPods();
    sincronizarConGrafana();
    fadeIn(document.getElementById('pods-container'));
    fadeIn(document.querySelector('.kpi-section'));
};

window.switchTiempo = function(tiempo) {
    triggerHaptic('tap');
    currentTiempo = tiempo;
    ['mes_actual', 'mes_pasado', 'ano'].forEach(t => {
        const b = document.getElementById('btn-tiempo-' + t);
        if (b) b.classList.toggle('active', t === tiempo);
    });
    sincronizarConGrafana();
    fadeIn(document.querySelector('.kpi-section'));
};

// Transición suave de contenido (función de agrado)
function fadeIn(el) {
    if (!el) return;
    el.style.opacity = '0';
    requestAnimationFrame(() => {
        el.style.transition = 'opacity 0.28s ease';
        el.style.opacity = '1';
    });
}

function renderPods() {
    const container = document.getElementById('pods-container');
    if (!container) return;

    currentGroup = dbPersonal[currentAreaId] || [];
    const esLideres = currentAreaId === 'jefes';

    let html = '';
    if (esLideres) {
        html += `
            <div class="pods-heading">
                <h2>👑 Líderes de Área</h2>
                <p>KPIs consolidados de todas las áreas</p>
            </div>`;
    }

    if (currentGroup.length === 0) {
        container.innerHTML = html + `<p class="pods-empty">No hay personal asignado a esta área.</p>`;
        return;
    }

    // Se muestran TODOS; el panel hace scroll vertical si no caben.
    html += currentGroup.map((tech, index) => {
        const delay = Math.min(index, 8) * 0.05;
        const partesN = (tech.name || '').split(' ');
        const nombreCorto = (partesN[0] || '') + ' ' + (partesN[1] || '');
        const puesto = tech.puesto || '';
        return `
            <div class="pod-item" style="animation-delay: ${delay}s" onclick="abrirPodPorIndex(${index})">
                <div class="pod-glass" style="background-image: url('${tech.img}')"></div>
                <div class="pod-info">
                    <h4>${nombreCorto}</h4>
                    <p>${puesto}</p>
                </div>
            </div>`;
    }).join('');

    container.innerHTML = html;
}

window.abrirPodPorIndex = function(index) {
    triggerHaptic('tap');
    const tech = currentGroup[index];
    if (tech) abrirModalTecnico(tech);
};

// --- 5. RENDERIZADO DE MÉTRICAS ---
function renderKPIs() {
    const kpiSection = document.querySelector('.kpi-section');
    if (!kpiSection) return;
    kpiSection.innerHTML = `
        <div class="kpi-card kpi-azure">
            <div class="kpi-header"><span class="kpi-label">Solicitudes</span><span class="kpi-icon">📋</span></div>
            <div class="kpi-value count-up" data-target="${kpiDataVivos.solicitudes}">0</div>
            <div class="kpi-sub">Total de tickets</div>
        </div>
        <div class="kpi-card kpi-emerald">
            <div class="kpi-header"><span class="kpi-label">Cerrados</span><span class="kpi-icon">🛠️</span></div>
            <div class="kpi-value count-up" data-target="${kpiDataVivos.incidencias}">0</div>
            <div class="kpi-sub">Total resueltos</div>
        </div>
        <div class="kpi-card kpi-amber">
            <div class="kpi-header"><span class="kpi-label">SLA</span><span class="kpi-icon">⏱️</span></div>
            <div class="kpi-value count-up" data-target="${kpiDataVivos.sla}" data-suffix="%">0%</div>
            <div class="kpi-sub">Eficacia &lt; 24h</div>
        </div>
        <div class="kpi-card kpi-purple">
            <div class="kpi-header"><span class="kpi-label">Calificación</span><span class="kpi-icon">🌟</span></div>
            <div class="kpi-value count-up" data-target="${kpiDataVivos.satisfaccion}" data-suffix="/5" data-decimal="true">0/5</div>
            <div class="kpi-sub">Encuestas</div>
        </div>
    `;
}

function animarNumeros() {
    document.querySelectorAll('.count-up').forEach(el => {
        const target = parseFloat(el.getAttribute('data-target')) || 0;
        const suffix = el.getAttribute('data-suffix') || '';
        const isDecimal = el.getAttribute('data-decimal') === 'true';
        const totalFrames = 30; let frame = 0;
        const counter = setInterval(() => {
            frame++; const current = target * (frame / totalFrames);
            el.textContent = (isDecimal ? current.toFixed(1) : Math.floor(current).toLocaleString('en-US')) + suffix;
            if (frame >= totalFrames) {
                clearInterval(counter);
                el.textContent = (isDecimal ? target.toFixed(1) : target.toLocaleString('en-US')) + suffix;
            }
        }, 30);
    });
}

// --- 6. PARALLAX Y MODALES ---
let parallaxOn = false;
function initParallax() {
    if (parallaxOn) return;
    parallaxOn = true;
    const ui = document.getElementById('spatial-ui');
    const overlay = document.getElementById('ui-overlay');
    window.addEventListener('deviceorientation', (event) => {
        if (!ui || !overlay || overlay.style.display !== 'flex') return;
        if (event.beta == null || event.gamma == null) return;
        const tiltX = Math.max(-12, Math.min(12, event.beta - 45)) * 0.3;
        const tiltY = Math.max(-12, Math.min(12, event.gamma)) * 0.3;
        ui.style.transform = `rotateX(${-tiltX}deg) rotateY(${tiltY}deg)`;
    });
}

window.abrirModalTecnico = function(tech) {
    const modal = document.getElementById('tech-modal');
    document.getElementById('tech-modal-overlay').style.display = 'block';
    document.getElementById('modal-img').style.backgroundImage = `url('${tech.img}')`;
    document.getElementById('modal-name').textContent = tech.name;
    document.getElementById('modal-puesto').textContent = tech.puesto;
    document.getElementById('modal-ext').textContent = `Ext: ${tech.ext || '—'}`;
    document.getElementById('modal-mail').textContent = tech.mail || '—';
    setTimeout(() => modal.classList.add('show'), 10);
};

window.cerrarModalTecnico = function() {
    document.getElementById('tech-modal').classList.remove('show');
    setTimeout(() => document.getElementById('tech-modal-overlay').style.display = 'none', 300);
};
