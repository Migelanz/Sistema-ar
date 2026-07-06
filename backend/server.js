const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');

const app = express();

// Detrás de Cloudflare / reverse proxy: confiar en 1 salto para obtener la IP real
app.set('trust proxy', 1);

// --- 0. VALIDACIÓN DE VARIABLES DE ENTORNO (fail-fast) ---
const {
    GRAFANA_TOKEN,
    SECRET_KEY,
    ADMIN_USER,
    ADMIN_PASS,        // texto plano (compatibilidad); se recomienda ADMIN_PASS_HASH
    ADMIN_PASS_HASH    // hash bcrypt (preferido)
} = process.env;

const requeridas = { GRAFANA_TOKEN, SECRET_KEY, ADMIN_USER };
const faltantes = Object.entries(requeridas).filter(([, v]) => !v).map(([k]) => k);
if (!ADMIN_PASS && !ADMIN_PASS_HASH) faltantes.push('ADMIN_PASS (o ADMIN_PASS_HASH)');
if (faltantes.length > 0) {
    console.error(`❌ Faltan variables de entorno obligatorias: ${faltantes.join(', ')}`);
    process.exit(1);
}

// --- 1. CONFIGURACIÓN ---
const PORT = process.env.PORT || 3001;
const GRAFANA_URL = process.env.GRAFANA_URL || 'http://192.168.106.218:3000';
const MYSQL_UID = process.env.MYSQL_UID || 'fez96jtiy7kzka';
const KPI_TTL_MS = parseInt(process.env.KPI_TTL_MS || '45000', 10); // caché de KPIs

const GRUPOS_GLPI = { helpdesk: '1', corporativo: '2', tiendas: '3', jefes: '1,2,3' };

// --- 2. MIDDLEWARE GLOBAL ---
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());                       // gzip: respuestas más ligeras
app.use(express.json({ limit: '1mb' }));

// Logging de accesos (omite el health-check para no ensuciar los logs)
morgan.token('real-ip', (req) => req.ip);
app.use(morgan(':real-ip :method :url :status :response-time ms', {
    skip: (req) => req.url === '/health'
}));

// Límite global de peticiones por IP (anti-abuso / anti-DoS básico)
app.use('/api/', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones, intenta más tarde.' }
}));

const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath, { maxAge: '1h', etag: true }));

// --- 3. BASE DE DATOS SQLITE (modo WAL para lecturas concurrentes) ---
const DB_PATH = path.join(__dirname, 'personal.sqlite');
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) { console.error('❌ Error al abrir SQLite:', err.message); process.exit(1); }
    console.log(`✅ Base de datos conectada (${DB_PATH})`);
});
db.serialize(() => {
    db.run('PRAGMA journal_mode = WAL');   // permite muchas lecturas simultáneas
    db.run('PRAGMA busy_timeout = 5000');  // espera en vez de fallar si está ocupada
    db.run('PRAGMA synchronous = NORMAL');
    db.run(`CREATE TABLE IF NOT EXISTS tecnicos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, area TEXT NOT NULL, puesto TEXT,
        ext TEXT, mail TEXT, img TEXT
    )`);
});

// --- 4. CARGA DE ARCHIVOS (MULTER) ---
const UPLOAD_DIR = path.join(__dirname, '../frontend', 'img', 'uploads');
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '.jpg';
        cb(null, `tec_${Date.now()}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
        cb(ok ? null : new Error('Solo se permiten imágenes JPG, PNG o WEBP'), ok);
    }
});

// --- 5. AUTENTICACIÓN ---
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 5,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera 15 minutos.' }
});

const verificarToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(403).json({ error: 'Acceso denegado. No hay token.' });
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(403).json({ error: 'Formato de token inválido.' });
    jwt.verify(token, SECRET_KEY, (err) => {
        if (err) return res.status(401).json({ error: 'Token inválido o expirado.' });
        next();
    });
};

async function passwordValida(password) {
    if (ADMIN_PASS_HASH) return bcrypt.compare(password, ADMIN_PASS_HASH);
    return password === ADMIN_PASS; // compatibilidad; migra a ADMIN_PASS_HASH
}

app.post('/api/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    if (username === ADMIN_USER && password && await passwordValida(password)) {
        const token = jwt.sign({ user: username }, SECRET_KEY, { expiresIn: '2h' });
        return res.json({ token });
    }
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
});

// --- 6. HEALTHCHECK (para Docker / Uptime Kuma / monitoreo) ---
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), ts: Date.now() });
});

// --- 7. PERSONAL (consultas parametrizadas: sin inyección SQL) ---
app.get('/api/personal', (req, res) => {
    db.all('SELECT * FROM tecnicos', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/personal', verificarToken, upload.single('foto'), (req, res) => {
    const { name, area, puesto, ext, mail } = req.body;
    if (!name || !area) return res.status(400).json({ error: 'El nombre y el área son obligatorios.' });
    if (!GRUPOS_GLPI[area]) return res.status(400).json({ error: 'Área inválida.' });
    const imgRuta = req.file ? `img/uploads/${req.file.filename}` : 'img/default.png';
    db.run('INSERT INTO tecnicos (name, area, puesto, ext, mail, img) VALUES (?, ?, ?, ?, ?, ?)',
        [name, area, puesto, ext, mail, imgRuta],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: 'Alta exitosa' });
        });
});

app.put('/api/personal/:id', verificarToken, upload.single('foto'), (req, res) => {
    const { name, area, puesto, ext, mail } = req.body;
    const { id } = req.params;
    if (area && !GRUPOS_GLPI[area]) return res.status(400).json({ error: 'Área inválida.' });
    if (req.file) {
        db.run('UPDATE tecnicos SET name=?, area=?, puesto=?, ext=?, mail=?, img=? WHERE id=?',
            [name, area, puesto, ext, mail, `img/uploads/${req.file.filename}`, id],
            (err) => err ? res.status(500).json({ error: err.message }) : res.json({ message: 'Actualización exitosa con foto' }));
    } else {
        db.run('UPDATE tecnicos SET name=?, area=?, puesto=?, ext=?, mail=? WHERE id=?',
            [name, area, puesto, ext, mail, id],
            (err) => err ? res.status(500).json({ error: err.message }) : res.json({ message: 'Actualización exitosa sin foto' }));
    }
});

app.delete('/api/personal/:id', verificarToken, (req, res) => {
    db.run('DELETE FROM tecnicos WHERE id = ?', [req.params.id],
        (err) => err ? res.status(500).json({ error: err.message }) : res.json({ message: 'Baja exitosa' }));
});

// --- 8. KPIs con CACHÉ + DEDUP DE PETICIONES (clave para alta carga) ---
// El caché evita golpear Grafana/MySQL en cada visita; el dedup hace que
// múltiples usuarios simultáneos compartan UNA sola consulta a Grafana.
const kpiCache = new Map();     // clave -> { data, expires }
const kpiEnVuelo = new Map();   // clave -> Promise (consulta en curso)

function construirQueries(area, tiempo) {
    let sqlTimeCond, sqlSatTimeCond;
    if (tiempo === 'mes_actual') {
        sqlTimeCond = "DATE_FORMAT(t.date, '%Y-%m') = DATE_FORMAT(CURRENT_DATE, '%Y-%m')";
        sqlSatTimeCond = "DATE_FORMAT(ts.date_answered, '%Y-%m') = DATE_FORMAT(CURRENT_DATE, '%Y-%m')";
    } else if (tiempo === 'mes_pasado') {
        sqlTimeCond = "DATE_FORMAT(t.date, '%Y-%m') = DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 1 MONTH), '%Y-%m')";
        sqlSatTimeCond = "DATE_FORMAT(ts.date_answered, '%Y-%m') = DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL 1 MONTH), '%Y-%m')";
    } else {
        sqlTimeCond = "DATE_FORMAT(t.date, '%Y') = DATE_FORMAT(CURRENT_DATE, '%Y')";
        sqlSatTimeCond = "DATE_FORMAT(ts.date_answered, '%Y') = DATE_FORMAT(CURRENT_DATE, '%Y')";
    }
    const g = `lg.groups_id IN (${GRUPOS_GLPI[area]})`;
    return [
        { refId: 'totales', datasource: { uid: MYSQL_UID, type: 'mysql' }, rawSql: `SELECT COUNT(DISTINCT t.id) AS value FROM glpi_tickets t JOIN (SELECT gt.tickets_id, gt.groups_id FROM glpi_groups_tickets gt JOIN (SELECT tickets_id, MAX(id) AS max_id FROM glpi_groups_tickets WHERE type = 2 GROUP BY tickets_id) m ON m.tickets_id = gt.tickets_id AND m.max_id = gt.id WHERE gt.type = 2) lg ON lg.tickets_id = t.id LEFT JOIN glpi_itilcategories ic ON ic.id = t.itilcategories_id WHERE t.is_deleted = 0 AND ${sqlTimeCond} AND ${g} AND (ic.name IS NULL OR ic.name NOT IN ('Apertura','Cierre','Recorrido wifi tienda'))`, format: 'table' },
        { refId: 'cerrados', datasource: { uid: MYSQL_UID, type: 'mysql' }, rawSql: `SELECT COUNT(DISTINCT t.id) AS value FROM glpi_tickets t JOIN (SELECT gt.tickets_id, gt.groups_id FROM glpi_groups_tickets gt JOIN (SELECT tickets_id, MAX(id) AS max_id FROM glpi_groups_tickets WHERE type = 2 GROUP BY tickets_id) m ON m.tickets_id = gt.tickets_id AND m.max_id = gt.id WHERE gt.type = 2) lg ON lg.tickets_id = t.id LEFT JOIN glpi_itilcategories ic ON ic.id = t.itilcategories_id WHERE t.is_deleted = 0 AND t.status = 6 AND ${sqlTimeCond} AND ${g} AND (ic.name IS NULL OR ic.name NOT IN ('Apertura','Cierre','Recorrido wifi tienda'))`, format: 'table' },
        { refId: 'sla', datasource: { uid: MYSQL_UID, type: 'mysql' }, rawSql: `SELECT ROUND(100 * SUM(CASE WHEN (t.solvedate IS NOT NULL OR t.closedate IS NOT NULL) AND TIMESTAMPDIFF(HOUR, t.date, COALESCE(t.solvedate, t.closedate)) <= 24 AND t.status IN (5, 6) THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT t.id), 0), 2) AS value FROM glpi_tickets t JOIN (SELECT gt.tickets_id, gt.groups_id FROM glpi_groups_tickets gt JOIN (SELECT tickets_id, MAX(id) AS max_id FROM glpi_groups_tickets WHERE type = 2 GROUP BY tickets_id) m ON m.tickets_id = gt.tickets_id AND m.max_id = gt.id WHERE gt.type = 2) lg ON lg.tickets_id = t.id LEFT JOIN glpi_itilcategories ic ON ic.id = t.itilcategories_id WHERE t.is_deleted = 0 AND ${sqlTimeCond} AND ${g} AND (ic.name IS NULL OR ic.name NOT IN ('Apertura','Cierre','Recorrido wifi tienda'))`, format: 'table' },
        { refId: 'satisfaccion', datasource: { uid: MYSQL_UID, type: 'mysql' }, rawSql: `SELECT ROUND(AVG(ts.satisfaction), 1) AS value FROM glpi_ticketsatisfactions ts JOIN glpi_tickets t ON t.id = ts.tickets_id WHERE t.is_deleted = 0 AND ts.satisfaction IS NOT NULL AND ${sqlSatTimeCond}`, format: 'table' }
    ];
}

async function consultarGrafana(area, tiempo) {
    const resp = await axios.post(
        `${GRAFANA_URL}/api/ds/query`,
        { queries: construirQueries(area, tiempo), from: 'now-30d', to: 'now' },
        { headers: { Authorization: `Bearer ${GRAFANA_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    const r = resp.data.results;
    const valor = (refId, def) => (r[refId]?.frames?.[0]?.data?.values?.[0]?.[0] ?? def).toString();
    return {
        solicitudes: valor('totales', 0),
        incidencias: valor('cerrados', 0),
        sla: valor('sla', 100),
        satisfaccion: valor('satisfaccion', 5.0)
    };
}

app.get('/api/kpis', async (req, res) => {
    const area = req.query.area || 'helpdesk';
    const tiempo = req.query.tiempo || 'mes_actual';
    if (!GRUPOS_GLPI[area]) return res.status(400).json({ error: 'Área inválida' });
    const clave = `${area}:${tiempo}`;

    // 1) Servir desde caché si sigue fresca
    const hit = kpiCache.get(clave);
    if (hit && hit.expires > Date.now()) {
        res.set('X-Cache', 'HIT');
        return res.json(hit.data);
    }

    // 2) Si ya hay una consulta idéntica en curso, esperarla (dedup)
    try {
        let promesa = kpiEnVuelo.get(clave);
        if (!promesa) {
            promesa = consultarGrafana(area, tiempo).finally(() => kpiEnVuelo.delete(clave));
            kpiEnVuelo.set(clave, promesa);
        }
        const data = await promesa;
        kpiCache.set(clave, { data, expires: Date.now() + KPI_TTL_MS });
        res.set('X-Cache', 'MISS');
        res.json(data);
    } catch (error) {
        console.error('❌ Error API Grafana:', error.message);
        // Degradación elegante: si hay caché vieja, servirla; si no, ceros
        if (hit) { res.set('X-Cache', 'STALE'); return res.json(hit.data); }
        res.json({ solicitudes: '0', incidencias: '0', sla: '0', satisfaccion: '0' });
    }
});

// --- 9. MANEJADOR DE ERRORES (incluye Multer) ---
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'La imagen supera 2 MB.' });
        return res.status(400).json({ error: `Error de carga: ${err.message}` });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
});

// --- 10. ARRANQUE Y CIERRE ORDENADO ---
const server = app.listen(PORT, () => console.log(`[+] BACKEND ONLINE EN PUERTO: ${PORT}`));

function apagar(signal) {
    console.log(`\n${signal} recibido, cerrando…`);
    server.close(() => db.close(() => { console.log('🔌 Cerrado limpio.'); process.exit(0); }));
    setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGINT', () => apagar('SIGINT'));
process.on('SIGTERM', () => apagar('SIGTERM'));
