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

window.addEventListener('load', () => {
    cargarPersonalDB();
    setTimeout(sincronizarConGrafana, 1000);
});
setInterval(() => {
    sincronizarConGrafana();
    cargarPersonalDB();
}, 30000);

// --- 4. SISTEMA DE NAVEGACIÓN Y TABS ---
let currentAreaId = 'helpdesk'; 
let currentGroup = [];
let tiendasPage = 0;

window.switchTab = function(areaId) {
    triggerHaptic('tap'); 
    
    // CORRECCIÓN DEL CLICK: Iluminar botón activo sin fallar
    const botones = document.querySelectorAll('.bottom-nav .nav-btn');
    botones.forEach(btn => btn.classList.remove('active'));
    botones.forEach(btn => {
        if(btn.getAttribute('onclick').includes(areaId)) btn.classList.add('active');
    });
    
    currentAreaId = areaId;
    tiendasPage = 0;
    
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
    
    // NUEVO: Ocultar personal si es la pestaña de Líderes
    if (currentAreaId === 'jefes') {
        container.innerHTML = `
            <div style="text-align: center; margin-top: 25px; color: white; grid-column: span 2;">
                <h2 style="color: #00ffcc; font-size: 1.2rem; margin-bottom: 5px;">📊 Vista Consolidada</h2>
                <p style="opacity: 0.8; font-size: 0.8rem; padding: 0 10px;">Mostrando KPIs globales de las áreas.</p>
            </div>
        `;
        return;
    }

    currentGroup = dbPersonal[currentAreaId] || [];
    let itemsToRender = currentGroup;
    
    if (currentAreaId === 'tiendas' && currentGroup.length > 4) {
        itemsToRender = currentGroup.slice(tiendasPage * 4, (tiendasPage + 1) * 4);
    }
    
    if (itemsToRender.length === 0) {
        container.innerHTML = `<p style="width: 100%; text-align: center; color: #94a3b8; font-size: 11px; grid-column: span 2; margin-top: 20px;">No hay personal asignado a esta área.</p>`;
        return;
    }

    const podsHTML = itemsToRender.map((tech, index) => {
        const delay = index * 0.05;
        const nombreCorto = tech.name.split(' ')[0] + ' ' + (tech.name.split(' ')[1] || '');
        const puestoCorto = tech.puesto.split(' ')[0] + ' ' + (tech.puesto.split(' ')[1] || '');
        
        return `
            <div class="pod-item" style="animation-delay: ${delay}s" onclick="abrirPodPorIndex(${index})">
                <div class="pod-glass" style="background-image: url('${tech.img}')"></div>
                <div class="pod-info">
                    <h4>${nombreCorto}</h4>
                    <p>${puestoCorto}</p>
                </div>
            </div>
        `;
    }).join('');
    container.innerHTML = podsHTML;
}

window.abrirPodPorIndex = function(index) {
    triggerHaptic('tap'); 
    let tech = currentGroup[index];
    if (currentAreaId === 'tiendas' && currentGroup.length > 4) {
        tech = currentGroup[tiendasPage * 4 + index];
    }
    if (tech) abrirModalTecnico(tech);
};

setInterval(() => {
    if (currentAreaId === 'tiendas' && currentGroup.length > 4) {
        tiendasPage = (tiendasPage + 1) % Math.ceil(currentGroup.length / 4);
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
            if (overlayLayer.style.display !== 'flex') {
                triggerHaptic('success'); 
                scannerUI.style.display = 'none';
                overlayLayer.style.display = 'flex';
                
                currentAreaId = 'helpdesk';
                renderPods(); 
                renderKPIs(); animarNumeros();
            }
        });
    }
});