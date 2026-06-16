// --- 1. BASE DE DATOS DINÁMICA ---
let dbPersonal = {
    helpdesk: [], corporativo: [], tiendas: [], jefes: []
};

async function cargarPersonalDB() {
    try {
        const respuesta = await fetch('/api/personal');
        const datos = await respuesta.json();
        dbPersonal = { helpdesk: [], corporativo: [], tiendas: [], jefes: [] };
        datos.forEach(tec => {
            if (dbPersonal[tec.area]) dbPersonal[tec.area].push(tec);
        });
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

// --- 3. CONSUMO DE DATOS EN VIVO (GLPI/GRAFANA) ---
let kpiDataVivos = { solicitudes: "0", incidencias: "0", sla: "0", satisfaccion: "0" };
let currentTiempo = 'mes_actual'; // NUEVO: Filtro de tiempo por defecto

async function sincronizarConGrafana() {
    const scannerText = document.querySelector('#scanner-ui p');
    try {
        // NUEVO: Enviamos el área y tiempo al servidor
        const url = `/api/kpis?area=${currentAreaId}&tiempo=${currentTiempo}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();
        kpiDataVivos = datos;
        
        if (scannerText) {
            scannerText.innerHTML = `
                <span style="color: #00ffcc; font-size: 16px; font-weight: bold;">✅ Conexión Exitosa</span>
            `;
        }
        
        const overlay = document.getElementById('ui-overlay');
        if (overlay && overlay.style.display === 'flex') {
            renderKPIs(); animarNumeros();
        }
    } catch (error) {
        if (scannerText) scannerText.innerHTML = `<span style="color: #ef4444;">Buscando Servidor...</span>`;
    }
}

// --- ENTRADA AL DASHBOARD (reutilizable: marcador o automatica) ---
function entrarDashboard() {
    const overlay = document.getElementById('ui-overlay');
    const scanner = document.getElementById('scanner-ui');
    if (!overlay || overlay.style.display === 'flex') return; // ya esta abierto
    triggerHaptic('success');
    if (scanner) scanner.style.display = 'none';
    overlay.style.display = 'flex';
    currentAreaId = 'helpdesk';
    renderPods();
    renderKPIs();
    animarNumeros();
}

window.addEventListener('load', () => {
    cargarPersonalDB();
    setTimeout(sincronizarConGrafana, 1000);

    // AUTO-ARRANQUE AR: en cuanto la camara este lista, mostramos el dashboard
    // flotando sobre el video en vivo, sin necesidad de escanear el marcador.
    const scene = document.querySelector('a-scene');
    if (scene) {
        scene.addEventListener('arjs-video-loaded', () => setTimeout(entrarDashboard, 600));
        scene.addEventListener('loaded', () => setTimeout(entrarDashboard, 2500));
    }
    // Respaldo final por si los eventos de AR no disparan en algun navegador
    setTimeout(entrarDashboard, 4000);
});
setInterval(() => {
    sincronizarConGrafana();
    cargarPersonalDB();
}, 30000);

// --- 4. SISTEMA DE NAVEGACIÓN Y TABS ---
const PODS_POR_PAGINA = 4;
let currentAreaId = 'helpdesk';
let currentGroup = [];
let currentPage = 0;

window.switchTab = function(areaId) {
    triggerHaptic('tap'); 
    
    // CORRECCIÓN DEL CLICK: Iluminar botón activo sin fallar
    const botones = document.querySelectorAll('.bottom-nav .nav-btn');
    botones.forEach(btn => btn.classList.remove('active'));
    botones.forEach(btn => {
        if(btn.getAttribute('onclick').includes(areaId)) btn.classList.add('active');
    });
    
    currentAreaId = areaId;
    currentPage = 0;
    
    renderPods();
    sincronizarConGrafana(); // Actualizamos KPIs al cambiar de área
};

// NUEVO: CONTROL DE TIEMPO
window.switchTiempo = function(tiempo) {
    triggerHaptic('tap');
    currentTiempo = tiempo;
    
    document.getElementById('btn-tiempo-mes_actual').classList.remove('active');
    document.getElementById('btn-tiempo-mes_pasado').classList.remove('active');
    document.getElementById('btn-tiempo-ano').classList.remove('active');
    
    document.getElementById('btn-tiempo-' + tiempo).classList.add('active');
    
    sincronizarConGrafana(); // Actualizamos KPIs al cambiar tiempo
};

function renderPods() {
    const container = document.getElementById('pods-container');
    if (!container) return;
    container.innerHTML = '';

    currentGroup = dbPersonal[currentAreaId] || [];

    // Encabezado especial para Líderes (los KPIs de arriba ya son consolidados)
    const esLideres = currentAreaId === 'jefes';
    let html = '';
    if (esLideres) {
        html += `
            <div class="pods-heading">
                <h2>👑 Líderes de Área</h2>
                <p>KPIs consolidados de todas las áreas</p>
            </div>`;
    }

    // Estado vacío
    if (currentGroup.length === 0) {
        container.innerHTML = html + `<p class="pods-empty">No hay personal asignado a esta área.</p>`;
        return;
    }

    // Paginación genérica: cualquier área con más de 4 rota sus tarjetas
    const totalPaginas = Math.ceil(currentGroup.length / PODS_POR_PAGINA);
    if (currentPage >= totalPaginas) currentPage = 0;
    const itemsToRender = totalPaginas > 1
        ? currentGroup.slice(currentPage * PODS_POR_PAGINA, (currentPage + 1) * PODS_POR_PAGINA)
        : currentGroup;

    html += itemsToRender.map((tech, index) => {
        const delay = index * 0.05;
        const partesN = (tech.name || '').split(' ');
        const nombreCorto = (partesN[0] || '') + ' ' + (partesN[1] || '');
        const partesP = (tech.puesto || '').split(' ');
        const puestoCorto = (partesP[0] || '') + ' ' + (partesP[1] || '');
        return `
            <div class="pod-item" style="animation-delay: ${delay}s" onclick="abrirPodPorIndex(${index})">
                <div class="pod-glass" style="background-image: url('${tech.img}')"></div>
                <div class="pod-info">
                    <h4>${nombreCorto}</h4>
                    <p>${puestoCorto}</p>
                </div>
            </div>`;
    }).join('');

    // Puntos de paginación
    if (totalPaginas > 1) {
        let dots = '';
        for (let p = 0; p < totalPaginas; p++) dots += `<i class="${p === currentPage ? 'on' : ''}"></i>`;
        html += `<div class="pods-dots">${dots}</div>`;
    }

    container.innerHTML = html;
}

window.abrirPodPorIndex = function(index) {
    triggerHaptic('tap');
    const totalPaginas = Math.ceil(currentGroup.length / PODS_POR_PAGINA);
    const tech = totalPaginas > 1
        ? currentGroup[currentPage * PODS_POR_PAGINA + index]
        : currentGroup[index];
    if (tech) abrirModalTecnico(tech);
};

setInterval(() => {
    const totalPaginas = Math.ceil(currentGroup.length / PODS_POR_PAGINA);
    if (totalPaginas > 1) {
        currentPage = (currentPage + 1) % totalPaginas;
        renderPods();
    }
}, 4500);

// --- 5. RENDERIZADO DE MÉTRICAS (Tus estilos originales) ---
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
            <div class="kpi-sub">Eficacia < 24h</div>
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
        const target = parseFloat(el.getAttribute('data-target'));
        const suffix = el.getAttribute('data-suffix') || '';
        const isDecimal = el.getAttribute('data-decimal') === 'true';
        const totalFrames = 30; let frame = 0;
        
        const counter = setInterval(() => {
            frame++; const current = target * (frame / totalFrames);
            el.textContent = (isDecimal ? current.toFixed(1) : Math.floor(current).toLocaleString('en-US')) + suffix;
            if (frame >= totalFrames) { clearInterval(counter); el.textContent = (isDecimal ? target.toFixed(1) : target.toLocaleString('en-US')) + suffix; }
        }, 30);
    });
}

// --- 6. PARALLAX Y MODALES ---
function initParallax() {
    const ui = document.getElementById('spatial-ui');
    const overlay = document.getElementById('ui-overlay');
    window.addEventListener('deviceorientation', (event) => {
        if (overlay.style.display === 'flex') {
            const tiltX = Math.max(-12, Math.min(12, event.beta - 45)) * 0.3;
            const tiltY = Math.max(-12, Math.min(12, event.gamma)) * 0.3;
            ui.style.transform = `rotateX(${-tiltX}deg) rotateY(${tiltY}deg)`;
        }
    });
}

window.abrirModalTecnico = function(tech) {
    const modal = document.getElementById('tech-modal');
    document.getElementById('tech-modal-overlay').style.display = 'block';
    document.getElementById('modal-img').style.backgroundImage = `url('${tech.img}')`;
    document.getElementById('modal-name').textContent = tech.name;
    document.getElementById('modal-puesto').textContent = tech.puesto;
    document.getElementById('modal-ext').textContent = `Ext: ${tech.ext}`;
    document.getElementById('modal-mail').textContent = tech.mail;
    setTimeout(() => modal.classList.add('show'), 10);
};

window.cerrarModalTecnico = function() {
    document.getElementById('tech-modal').classList.remove('show');
    setTimeout(() => document.getElementById('tech-modal-overlay').style.display = 'none', 300);
};

// --- 7. REGISTRO ARJS MOTOR ---
AFRAME.registerComponent('activar-dashboard', {
    init: function () {
        let overlayLayer = document.getElementById('ui-overlay');
        let scannerUI = document.getElementById('scanner-ui');
        initParallax();
        
        this.el.addEventListener('markerFound', () => {
            entrarDashboard(); // mismo flujo que la entrada automatica
        });
    }
});