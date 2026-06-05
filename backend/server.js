const express = require('express');
const app = express();
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const jwt = require('jsonwebtoken'); 

// 📊 CONFIGURACIÓN GRAFANA
const GRAFANA_URL = 'http://192.168.106.218:3000'; 
const GRAFANA_TOKEN = process.env.GRAFANA_TOKEN;
const MYSQL_UID = 'fez96jtiy7kzka'; 

// 🔐 CONFIGURACIÓN DE SEGURIDAD
const SECRET_KEY = 'upiita_ar_dashboard_secreto'; 
const ADMIN_USER = 'miguel';
const ADMIN_PASS = 'admin123'; 

// --- 1. CONFIGURACIÓN DEL SERVIDOR ---
app.use(express.json()); 
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath)); 

// --- 2. BASE DE DATOS SQLITE ---
const db = new sqlite3.Database('./personal.sqlite', (err) => {
    if (err) console.error("❌ Error al abrir SQLite:", err);
    else console.log("✅ Base de datos conectada");
});

db.run(`CREATE TABLE IF NOT EXISTS tecnicos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, area TEXT, puesto TEXT, ext TEXT, mail TEXT, img TEXT
)`);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../frontend', 'img', 'uploads');
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, 'tec_' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- 3. MIDDLEWARE DE SEGURIDAD (EL CADENERO) ---
const verificarToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(403).json({ error: 'Acceso denegado. No hay token.' });
    
    const token = authHeader.split(' ')[1]; 
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Token inválido o expirado.' });
        next(); 
    });
};

// --- 4. RUTAS DE SEGURIDAD (LOGIN) ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        const token = jwt.sign({ user: username }, SECRET_KEY, { expiresIn: '2h' });
        res.json({ token });
    } else {
        res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
});

// --- 5. RUTAS DE LA API: PERSONAL ---
app.get('/api/personal', (req, res) => {
    db.all("SELECT * FROM tecnicos", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/personal', verificarToken, upload.single('foto'), (req, res) => {
    const { name, area, puesto, ext, mail } = req.body;
    const imgRuta = req.file ? `img/uploads/${req.file.filename}` : `img/default.png`;
    db.run(`INSERT INTO tecnicos (name, area, puesto, ext, mail, img) VALUES (?, ?, ?, ?, ?, ?)`, 
        [name, area, puesto, ext, mail, imgRuta], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: "Alta exitosa" });
        });
});

app.put('/api/personal/:id', verificarToken, upload.single('foto'), (req, res) => {
    const { name, area, puesto, ext, mail } = req.body;
    const id = req.params.id;
    if (req.file) { 
        const imgRuta = `img/uploads/${req.file.filename}`;
        db.run(`UPDATE tecnicos SET name=?, area=?, puesto=?, ext=?, mail=?, img=? WHERE id=?`,
            [name, area, puesto, ext, mail, imgRuta, id], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "Actualización exitosa con foto" });
            });
    } else { 
        db.run(`UPDATE tecnicos SET name=?, area=?, puesto=?, ext=?, mail=? WHERE id=?`,
            [name, area, puesto, ext, mail, id], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "Actualización exitosa sin foto" });
            });
    }
});

app.delete('/api/personal/:id', verificarToken, (req, res) => {
    db.run("DELETE FROM tecnicos WHERE id = ?", req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Baja exitosa" });
    });
});

// --- 6. RUTAS DE LA API: KPIs GRAFANA (NUEVO: DINÁMICO) ---
app.get('/api/kpis', async (req, res) => {
    const area = req.query.area || 'helpdesk';
    const tiempo = req.query.tiempo || 'mes_actual';

    // 1. CONDICIÓN DE TIEMPO TICKETS NORMALES
    let sqlTimeCond = "";
    // CONDICIÓN ESPECIAL PARA ENCUESTAS (Ya que usan date_answered)
    let sqlSatTimeCond = "";

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

    // 2. CONDICIÓN DE GRUPOS DE GLPI
    const gruposGLPI = {
        'helpdesk': '1',       
        'corporativo': '2',    
        'tiendas': '3',        
        'jefes': '1,2,3'       
    };
    const sqlGroupCond = `lg.groups_id IN (${gruposGLPI[area] || '1,2,3'})`;

    try {
        const respuestaGrafana = await axios.post(`${GRAFANA_URL}/api/ds/query`, {
            queries: [
                { refId: 'totales', datasource: { uid: MYSQL_UID, type: 'mysql' }, rawSql: `SELECT COUNT(DISTINCT t.id) AS value FROM glpi_tickets t JOIN (SELECT gt.tickets_id, gt.groups_id FROM glpi_groups_tickets gt JOIN (SELECT tickets_id, MAX(id) AS max_id FROM glpi_groups_tickets WHERE type = 2 GROUP BY tickets_id) m ON m.tickets_id = gt.tickets_id AND m.max_id = gt.id WHERE gt.type = 2) lg ON lg.tickets_id = t.id LEFT JOIN glpi_itilcategories ic ON ic.id = t.itilcategories_id WHERE t.is_deleted = 0 AND ${sqlTimeCond} AND ${sqlGroupCond} AND (ic.name IS NULL OR ic.name NOT IN ('Apertura','Cierre','Recorrido wifi tienda'))`, format: 'table' },
                { refId: 'cerrados', datasource: { uid: MYSQL_UID, type: 'mysql' }, rawSql: `SELECT COUNT(DISTINCT t.id) AS value FROM glpi_tickets t JOIN (SELECT gt.tickets_id, gt.groups_id FROM glpi_groups_tickets gt JOIN (SELECT tickets_id, MAX(id) AS max_id FROM glpi_groups_tickets WHERE type = 2 GROUP BY tickets_id) m ON m.tickets_id = gt.tickets_id AND m.max_id = gt.id WHERE gt.type = 2) lg ON lg.tickets_id = t.id LEFT JOIN glpi_itilcategories ic ON ic.id = t.itilcategories_id WHERE t.is_deleted = 0 AND t.status = 6 AND ${sqlTimeCond} AND ${sqlGroupCond} AND (ic.name IS NULL OR ic.name NOT IN ('Apertura','Cierre','Recorrido wifi tienda'))`, format: 'table' },
                { refId: 'sla', datasource: { uid: MYSQL_UID, type: 'mysql' }, rawSql: `SELECT ROUND(100 * SUM(CASE WHEN (t.solvedate IS NOT NULL OR t.closedate IS NOT NULL) AND TIMESTAMPDIFF(HOUR, t.date, COALESCE(t.solvedate, t.closedate)) <= 24 AND t.status IN (5, 6) THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT t.id), 0), 2) AS value FROM glpi_tickets t JOIN (SELECT gt.tickets_id, gt.groups_id FROM glpi_groups_tickets gt JOIN (SELECT tickets_id, MAX(id) AS max_id FROM glpi_groups_tickets WHERE type = 2 GROUP BY tickets_id) m ON m.tickets_id = gt.tickets_id AND m.max_id = gt.id WHERE gt.type = 2) lg ON lg.tickets_id = t.id LEFT JOIN glpi_itilcategories ic ON ic.id = t.itilcategories_id WHERE t.is_deleted = 0 AND ${sqlTimeCond} AND ${sqlGroupCond} AND (ic.name IS NULL OR ic.name NOT IN ('Apertura','Cierre','Recorrido wifi tienda'))`, format: 'table' },
                { refId: 'satisfaccion', datasource: { uid: MYSQL_UID, type: 'mysql' }, rawSql: `SELECT ROUND(AVG(ts.satisfaction), 1) AS value FROM glpi_ticketsatisfactions ts JOIN glpi_tickets t ON t.id = ts.tickets_id WHERE t.is_deleted = 0 AND ts.satisfaction IS NOT NULL AND ${sqlSatTimeCond}`, format: 'table' }
            ], from: 'now-30d', to: 'now'
        }, { headers: { 'Authorization': `Bearer ${GRAFANA_TOKEN}`, 'Content-Type': 'application/json' }});

        const resultados = respuestaGrafana.data.results;
        res.json({
            solicitudes: (resultados.totales?.frames[0]?.data?.values[0]?.[0] || 0).toString(),
            incidencias: (resultados.cerrados?.frames[0]?.data?.values[0]?.[0] || 0).toString(),
            sla: (resultados.sla?.frames[0]?.data?.values[0]?.[0] || 100).toString(),
            satisfaccion: (resultados.satisfaccion?.frames[0]?.data?.values[0]?.[0] || 5.0).toString()
        });
    } catch (error) {
        console.error("❌ Error API Grafana:", error.message);
        res.json({ solicitudes: "0", incidencias: "0", sla: "0", satisfaccion: "0" });
    }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`[+] BACKEND ONLINE EN PUERTO: ${PORT}`));