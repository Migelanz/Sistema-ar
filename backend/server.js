const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();

// --- 0. VALIDACIÓN DE VARIABLES DE ENTORNO (fail-fast) ---
const {
    GRAFANA_TOKEN,
    SECRET_KEY,
    ADMIN_USER,
    ADMIN_PASS
} = process.env;

const requeridas = { GRAFANA_TOKEN, SECRET_KEY, ADMIN_USER, ADMIN_PASS };
const faltantes = Object.entries(requeridas)
    .filter(([, v]) => !v)
    .map(([k]) => k);

if (faltantes.length > 0) {
    console.error(`❌ Faltan variables de entorno obligatorias: ${faltantes.join(', ')}`);
    console.error('   Crea un archivo .env (ver .env.example) antes de iniciar.');
    process.exit(1);
}

// --- 1. CONSTANTES DE CONFIGURACIÓN ---
const PORT = process.env.PORT || 3001;
const GRAFANA_URL = process.env.GRAFANA_URL || 'http://192.168.106.218:3000';
const MYSQL_UID = process.env.MYSQL_UID || 'fez96jtiy7kzka';

// Mapa de grupos GLPI por área. Declarado UNA sola vez y a nivel de módulo
// para que esté disponible en cualquier punto (evita el ReferenceError/TDZ
// que ocurría al usarlo antes de su declaración dentro de la ruta).
const GRUPOS_GLPI = {
    helpdesk: '1',
    corporativo: '2',
    tiendas: '3',
    jefes: '1,2,3'
};

// --- 2. MIDDLEWARE GLOBAL ---
app.use(helmet({
    // El frontend AR carga A-Frame/AR.js desde CDNs externos y usa estilos
    // inline, así que desactivamos la CSP estricta para no romperlo.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(express.json());

const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

// --- 3. BASE DE DATOS SQLITE ---
// Ruta anclada a __dirname para no depender del directorio de trabajo (cwd).
const DB_PATH = path.join(__dirname, 'personal.sqlite');
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Error al abrir SQLite:', err.message);
        process.exit(1);
    }
    console.log(`✅ Base de datos conectada (${DB_PATH})`);
});

db.run(`CREATE TABLE IF NOT EXISTS tecnicos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    area TEXT NOT NULL,
    puesto TEXT,
    ext TEXT,
    mail TEXT,
    img TEXT
)`);

// --- 4. CARGA DE ARCHIVOS (MULTER) ---
const UPLOAD_DIR = path.join(__dirname, '../frontend', 'img', 'uploads');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(UPLOAD_DIR)) {
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        }
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        // Forzamos la extensión según el mimetype validado, en lugar de
        // confiar en el nombre original (que el cliente controla).
        const extPorMime = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/webp': '.webp'
        };
        const ext = extPorMime[file.mimetype] || '.jpg';
        cb(null, `tec_${Date.now()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
    fileFilter: (req, file, cb) => {
        const permitidos = ['image/jpeg', 'image/png', 'image/webp'];
        if (permitidos.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten imágenes JPG, PNG o WEBP'));
        }
    }
});

// --- 5. RATE LIMITING ---
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera 15 minutos.' }
});

// --- 6. MIDDLEWARE DE AUTENTICACIÓN ---
const verificarToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(403).json({ error: 'Acceso denegado. No hay token.' });
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(403).json({ error: 'Formato de token inválido.' });
    }
    jwt.verify(token, SECRET_KEY, (err) => {
        if (err) return res.status(401).json({ error: 'Token inválido o expirado.' });
        next();
    });
};

// --- 7. RUTAS: LOGIN ---
app.post('/api/login', loginLimiter, (req, res) => {
    const { username, password } = req.body || {};
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        const token = jwt.sign({ user: username }, SECRET_KEY, { expiresIn: '2h' });
        return res.json({ token });
    }
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
});

// --- 8. RUTAS: PERSONAL ---
app.get('/api/personal', (req, res) => {
    db.all('SELECT * FROM tecnicos', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/personal', verificarToken, upload.single('foto'), (req, res) => {
    const { name, area, puesto, ext, mail } = req.body;

    if (!name || !area) {
        return res.status(400).json({ error: 'El nombre y el área son obligatorios.' });
    }
    if (!GRUPOS_GLPI[area]) {
        return res.status(400).json({ error: 'Área inválida.' });
    }

    const imgRuta = req.file ? `img/uploads/${req.file.filename}` : 'img/default.png';
    db.run(
        'INSERT INTO tecnicos (name, area, puesto, ext, mail, img) VALUES (?, ?, ?, ?, ?, ?)',
        [name, area, puesto, ext, mail, imgRuta],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: 'Alta exitosa' });
        }
    );
});

app.put('/api/personal/:id', verificarToken, upload.single('foto'), (req, res) => {
    const { name, area, puesto, ext, mail } = req.body;
    const { id } = req.params;

    if (area && !GRUPOS_GLPI[area]) {
        return res.status(400).json({ error: 'Área inválida.' });
    }

    if (req.file) {
        const imgRuta = `img/uploads/${req.file.filename}`;
        db.run(
            'UPDATE tecnicos SET name=?, area=?, puesto=?, ext=?, mail=?, img=? WHERE id=?',
            [name, area, puesto, ext, mail, imgRuta, id],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Actualización exitosa con foto' });
            }
        );
    } else {
        db.run(
            'UPDATE tecnicos SET name=?, area=?, puesto=?, ext=?, mail=? WHERE id=?',
            [name, area, puesto, ext, mail, id],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Actualización exitosa sin foto' });
            }
        );
    }
});

app.delete('/api/personal/:id', verificarToken, (req, res) => {
    db.run('DELETE FROM tecnicos WHERE id = ?', [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Baja exitosa' });
    });
});

// --- 9. RUTAS: KPIs GRAFANA (DINÁMICO) ---
app.get('/api/kpis', async (req, res) => {
    const area = req.query.area || 'helpdesk';
    const tiempo = req.query.tiempo || 'mes_actual';

    // Validación de área (GRUPOS_GLPI ya existe a nivel de módulo).
    if (!GRUPOS_GLPI[area]) {
        return res.status(400).json({ error: 'Área inválida' });
    }

    // Condición de tiempo para tickets normales y para encuestas.
    let sqlTimeCond;
    let sqlSatTimeCond;

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

    const sqlGroupCond = `lg.groups_id IN (${GRUPOS_GLPI[area]})`;

    try {
        const respuestaGrafana = await axios.post(
            `${GRAFANA_URL}/api/ds/query`,
            {
                queries: [
                    { refId: 'totales', datasource: { uid: MYSQL_UID, type: 'mysql' }, rawSql: `SELECT COUNT(DISTINCT t.id) AS value FROM glpi_tickets t JOIN (SELECT gt.tickets_id, gt.groups_id FROM glpi_groups_tickets gt JOIN (SELECT tickets_id, MAX(id) AS max_id FROM glpi_groups_tickets WHERE type = 2 GROUP BY tickets_id) m ON m.tickets_id = gt.tickets_id AND m.max_id = gt.id WHERE gt.type = 2) lg ON lg.tickets_id = t.id LEFT JOIN glpi_itilcategories ic ON ic.id = t.itilcategories_id WHERE t.is_deleted = 0 AND ${sqlTimeCond} AND ${sqlGroupCond} AND (ic.name IS NULL OR ic.name NOT IN ('Apertura','Cierre','Recorrido wifi tienda'))`, format: 'table' },
                    { refId: 'cerrados', datasource: { uid: MYSQL_UID, type: 'mysql' }, rawSql: `SELECT COUNT(DISTINCT t.id) AS value FROM glpi_tickets t JOIN (SELECT gt.tickets_id, gt.groups_id FROM glpi_groups_tickets gt JOIN (SELECT tickets_id, MAX(id) AS max_id FROM glpi_groups_tickets WHERE type = 2 GROUP BY tickets_id) m ON m.tickets_id = gt.tickets_id AND m.max_id = gt.id WHERE gt.type = 2) lg ON lg.tickets_id = t.id LEFT JOIN glpi_itilcategories ic ON ic.id = t.itilcategories_id WHERE t.is_deleted = 0 AND t.status = 6 AND ${sqlTimeCond} AND ${sqlGroupCond} AND (ic.name IS NULL OR ic.name NOT IN ('Apertura','Cierre','Recorrido wifi tienda'))`, format: 'table' },
                    { refId: 'sla', datasource: { uid: MYSQL_UID, type: 'mysql' }, rawSql: `SELECT ROUND(100 * SUM(CASE WHEN (t.solvedate IS NOT NULL OR t.closedate IS NOT NULL) AND TIMESTAMPDIFF(HOUR, t.date, COALESCE(t.solvedate, t.closedate)) <= 24 AND t.status IN (5, 6) THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT t.id), 0), 2) AS value FROM glpi_tickets t JOIN (SELECT gt.tickets_id, gt.groups_id FROM glpi_groups_tickets gt JOIN (SELECT tickets_id, MAX(id) AS max_id FROM glpi_groups_tickets WHERE type = 2 GROUP BY tickets_id) m ON m.tickets_id = gt.tickets_id AND m.max_id = gt.id WHERE gt.type = 2) lg ON lg.tickets_id = t.id LEFT JOIN glpi_itilcategories ic ON ic.id = t.itilcategories_id WHERE t.is_deleted = 0 AND ${sqlTimeCond} AND ${sqlGroupCond} AND (ic.name IS NULL OR ic.name NOT IN ('Apertura','Cierre','Recorrido wifi tienda'))`, format: 'table' },
                    { refId: 'satisfaccion', datasource: { uid: MYSQL_UID, type: 'mysql' }, rawSql: `SELECT ROUND(AVG(ts.satisfaction), 1) AS value FROM glpi_ticketsatisfactions ts JOIN glpi_tickets t ON t.id = ts.tickets_id WHERE t.is_deleted = 0 AND ts.satisfaction IS NOT NULL AND ${sqlSatTimeCond}`, format: 'table' }
                ],
                from: 'now-30d',
                to: 'now'
            },
            {
                headers: {
                    Authorization: `Bearer ${GRAFANA_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        const r = respuestaGrafana.data.results;
        const valor = (refId, def) =>
            (r[refId]?.frames?.[0]?.data?.values?.[0]?.[0] ?? def).toString();

        res.json({
            solicitudes: valor('totales', 0),
            incidencias: valor('cerrados', 0),
            sla: valor('sla', 100),
            satisfaccion: valor('satisfaccion', 5.0)
        });
    } catch (error) {
        console.error('❌ Error API Grafana:', error.message);
        res.json({ solicitudes: '0', incidencias: '0', sla: '0', satisfaccion: '0' });
    }
});

// --- 10. MANEJADOR DE ERRORES (incluye errores de Multer) ---
// Debe ir DESPUÉS de todas las rutas para capturar lo que ellas lancen.
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'La imagen supera el límite de 2 MB.' });
        }
        return res.status(400).json({ error: `Error de carga: ${err.message}` });
    }
    if (err) {
        return res.status(400).json({ error: err.message });
    }
    next();
});

// --- 11. ARRANQUE ---
app.listen(PORT, () => console.log(`[+] BACKEND ONLINE EN PUERTO: ${PORT}`));

// Cierre ordenado de la conexión a la base de datos.
process.on('SIGINT', () => {
    db.close(() => {
        console.log('🔌 Base de datos cerrada. Saliendo.');
        process.exit(0);
    });
});
