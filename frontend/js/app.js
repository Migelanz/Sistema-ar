// --- 1. BASE DE DATOS DINÁMICA ---
// Aquí guardaremos los datos que lleguen del servidor
let dbPersonal = {
    helpdesk: [],
    corporativo: [],
    tiendas: [],
    jefes: []
};

// Función maestra para descargar el personal desde SQLite
async function cargarPersonalDB() {
    try {
        const respuesta = await fetch('/api/personal');
        const datos = await respuesta.json();
        
        // Limpiamos los arreglos
        dbPersonal = { helpdesk: [], corporativo: [], tiendas: [], jefes: [] };
        
        // Clasificamos a cada técnico en su pestaña correspondiente
        datos.forEach(tec => {
            if (dbPersonal[tec.area]) {
                dbPersonal[tec.area].push(tec);
            }
        });
        
        // Si el panel ya está abierto, refrescamos la vista
        renderPods();
    } catch (error) {
        console.error("❌ Error al cargar personal del servidor:", error);
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

async function sincronizarConGrafana() {
    const scannerText = document.querySelector('#scanner-ui p');
    try {
        const respuesta = await fetch('/api/kpis');
        const datos = await respuesta.json();
        kpiDataVivos = datos;
        
        if (scannerText) {
            scannerText.innerHTML = `
                <span style="color: #00ffcc; font-size: 16px; font-weight: bold;">✅ Conexión con GLPI Exitosa</span><br>
                <span style="font-size: 12px; opacity: 0.8; line-height: 1.6;">
                   Tickets Mes: ${datos.solicitudes} | SLA: ${datos.sla}%
                </span><br>
                <span style="font-size: 11px; color: #94a3b8;">Escanea el Patrón para ver el holograma...</span>
            `;
        }
        
        const overlay = document.getElementById('ui-overlay');
        if (overlay && overlay.style.display === 'flex') {
            renderKPIs(); animarNumeros();
        }
    } catch (error) {
        if (scannerText) scannerText.innerHTML = `<span style="color: #ef4444;">Buscando Servidor Proxy...</span>`;
    }
}

// Al cargar la página, traemos los KPIs y a los Técnicos
window.addEventListener('load', () => {
    cargarPersonalDB();
    setTimeout(sincronizarConGrafana, 1000);
});
// Mantenemos los datos frescos cada 30 segundos
setInterval(() => {
    sincronizarConGrafana();
    cargarPersonalDB();
}, 30000);


// --- 4. SISTEMA DE NAVEGACIÓN Y TABS ---
let currentAreaId = 'helpdesk'; // Área por defecto
let currentGroup = [];
let tiendasPage = 0;

window.switchTab = function(areaId) {
    triggerHaptic('tap'); 
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    event.currentTarget.classList.add('active');
    
    currentAreaId = areaId;
    tiendasPage = 0;
    
    renderPods();
};

function renderPods() {
    const container = document.getElementById('pods-container');
    if (!container) return;
    container.innerHTML = ''; 
    
    // Obtenemos los técnicos dinámicos del área seleccionada
    currentGroup = dbPersonal[currentAreaId] || [];
    let itemsToRender = currentGroup;
    
    // Carrusel especial solo para tiendas (si hay muchos)
    if (currentAreaId === 'tiendas' && currentGroup.length > 4) {
        itemsToRender = currentGroup.slice(tiendasPage * 4, (tiendasPage + 1) * 4);
    }
    
    if (itemsToRender.length === 0) {
        container.innerHTML = `<p style="width: 100%; text-align: center; color: #94a3b8; font-size: 11px; grid-column: span 2; margin-top: 20px;">No hay personal asignado a esta área.</p>`;
        return;
    }

    const podsHTML = itemsToRender.map((tech, index) => {
        const delay = index * 0.05;
        // tech.name y tech.puesto vienen directos de SQLite
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
    
    if (tech) {
        abrirModalTecnico(tech);
    }
};

// Rotación del carrusel de tiendas
setInterval(() => {
    if (currentAreaId === 'tiendas' && currentGroup.length > 4) {
        tiendasPage = (tiendasPage + 1) % Math.ceil(currentGroup.length / 4);
        renderPods();
    }
}, 4500);


// --- 5. RENDERIZADO DE MÉTRICAS ---
function renderKPIs() {
    const kpiSection = document.querySelector('.kpi-section');
    if (!kpiSection) return;
    
    kpiSection.innerHTML = `
        <div class="kpi-card kpi-azure">
            <div class="kpi-header"><span class="kpi-label">Solicitudes</span><span class="kpi-icon">📋</span></div>
            <div class="kpi-value count-up" data-target="${kpiDataVivos.solicitudes}">0</div>
            <div class="kpi-sub">Recibidos este mes</div>
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
            <div class="kpi-sub">Encuestas de servicio</div>
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
                
                // Forzamos el render inicial con el área de Helpdesk
                currentAreaId = 'helpdesk';
                renderPods(); 
                renderKPIs(); animarNumeros();
            }
        });
    }
});