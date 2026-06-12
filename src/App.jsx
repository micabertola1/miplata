// @ts-nocheck
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { auth, googleProvider, db } from './firebase.js';
import {
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  arrayUnion,
  arrayRemove,
  writeBatch,
} from 'firebase/firestore';

/* ── Data ── */
const CATS = {
  gasto: [
    {
      n: 'Alimentación',
      i: '🍽️',
      s: [
        'Supermercado',
        'Restaurantes',
        'Delivery',
        'Café',
        'Kiosco',
        'Salida amigos',
        'Salida pareja',
        'Otros',
      ],
    },
    {
      n: 'Vivienda',
      i: '🏠',
      s: [
        'Alquiler',
        'Expensas',
        'Servicios',
        'Internet',
        'Mantenimiento',
        'Otros',
      ],
    },
    {
      n: 'Transporte',
      i: '🚗',
      s: [
        'Combustible',
        'Transporte público',
        'Uber/Cabify',
        'Patente',
        'Seguro',
        'Otros',
      ],
    },
    {
      n: 'Bienestar',
      i: '🧘',
      s: ['Gimnasio', 'Salud', 'Farmacia', 'Educación', 'Otros'],
    },
    {
      n: 'Entretenimiento',
      i: '🎉',
      s: ['Salidas', 'Streaming', 'Hobbies', 'Vacaciones', 'Otros'],
    },
    {
      n: 'Compras',
      i: '🛍️',
      s: ['Ropa', 'Electrónica', 'Hogar', 'Mascotas', 'Otros'],
    },
    {
      n: 'Obligaciones',
      i: '📋',
      s: ['Monotributo', 'IIBB', 'Seguros', 'Cuotas', 'Deudas', 'Otros'],
    },
  ],
  ingreso: [
    {
      n: 'Trabajo',
      i: '💼',
      s: ['Clientes', 'Sueldo', 'Consultoría', 'Proyectos', 'Otros'],
    },
    {
      n: 'Inversiones',
      i: '📈',
      s: ['Rendimientos', 'Dividendos', 'Cripto', 'Otros'],
    },
    { n: 'Otros', i: '💰', s: ['Ventas', 'Reembolsos', 'Regalos', 'Otros'] },
  ],
  ahorro: [
    {
      n: 'Dólares',
      i: '💵',
      s: ['Compra USD', 'Caja de ahorro USD', 'Efectivo USD', 'Otros'],
    },
    {
      n: 'Inversiones',
      i: '📈',
      s: ['Plazo fijo', 'Acciones', 'Cripto', 'Fondos', 'Bonos', 'Otros'],
    },
    {
      n: 'Reserva',
      i: '🏦',
      s: ['Fondo emergencia', 'Meta', 'Caja de ahorro', 'Otros'],
    },
  ],
};

// Combina las categorías fijas con las personalizadas del usuario
function getCats(type, customCats) {
  const base = (CATS[type] || []).map((c) => ({ ...c, s: [...c.s] }));
  const custom = (customCats && customCats[type]) || [];
  custom.forEach((cc) => {
    if (!cc || !cc.n) return;
    const ex = base.find((c) => c.n === cc.n);
    if (ex) {
      (cc.s || []).forEach((sub) => {
        if (sub && !ex.s.includes(sub)) ex.s.push(sub);
      });
    } else {
      base.push({ n: cc.n, i: cc.i || '🏷️', s: [...(cc.s || [])], custom: true });
    }
  });
  return base;
}

const MO = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];
const MOF = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function mk(d) {
  // Si es texto AAAA-MM-DD, tomar el mes directo (evita corrimiento por zona horaria)
  if (typeof d === 'string') {
    const m = d.match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;
  }
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
}
function fmt(a, c) {
  const s = Math.abs(a).toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return c === 'USD' ? `US$ ${s}` : `$ ${s}`;
}
function fmtS(a, c) {
  const p = c === 'USD' ? 'US$ ' : '$ ';
  const v = Math.abs(a);
  if (v >= 1e6) return p + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return p + (v / 1e3).toFixed(0) + 'k';
  return fmt(a, c);
}
function td() {
  return new Date().toISOString().slice(0, 10);
}

// Cargos de un mes: las compras en cuotas se reparten (una cuota por mes)
function chargesForMonth(txs, monthKey) {
  const [my, mm] = monthKey.split('-').map(Number);
  const out = [];
  for (const t of txs) {
    const n = t.pay === 'credito' && t.cuotas > 1 ? t.cuotas : 1;
    if (n > 1) {
      const [sy, sm] = mk(t.date).split('-').map(Number);
      const idx = (my - sy) * 12 + (mm - sm);
      if (idx >= 0 && idx < n) {
        out.push({
          ...t,
          amt: Math.round((t.amt / n) * 100) / 100,
          cuotaInfo: `${idx + 1}/${n}`,
        });
      }
    } else if (mk(t.date) === monthKey) {
      out.push(t);
    }
  }
  return out;
}

/* ── CSV import helpers ── */
const COL_ALIASES = {
  tipo: ['tipo', 'type', 'movimiento'],
  fecha: ['fecha', 'date', 'dia', 'día', 'fecha operacion', 'fecha operación'],
  monto: ['monto', 'importe', 'amount', 'valor', 'total', 'precio'],
  categoria: ['categoria', 'categoría', 'rubro', 'category'],
  subcategoria: ['subcategoria', 'subcategoría', 'subrubro'],
  concepto: ['concepto', 'titulo', 'título', 'nombre'],
  descripcion: [
    'descripcion', 'descripción', 'detalle', 'nota',
    'observacion', 'observación', 'desc',
  ],
  moneda: ['moneda', 'currency', 'divisa'],
  medio_pago: [
    'medio_pago', 'medio de pago', 'método de pago', 'metodo de pago',
    'pago', 'metodo', 'método', 'forma de pago', 'medio',
  ],
  member: [
    'quién pagó', 'quien pago', 'quien_pago', 'miembro', 'pagado por',
    'a quién ingresó', 'a quien ingreso', 'quién', 'quien', 'persona',
  ],
};

// Equivalencias de categorías de otras apps → categorías de miplata
const CAT_MAP = {
  movilidad: 'Transporte',
  transporte: 'Transporte',
  recreación: 'Entretenimiento',
  recreacion: 'Entretenimiento',
  ocio: 'Entretenimiento',
  entretenimiento: 'Entretenimiento',
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseAmount(s) {
  if (s == null) return NaN;
  let v = String(s).replace(/[^\d.,-]/g, '');
  if (!v) return NaN;
  if (v.includes('.') && v.includes(',')) {
    // El último separador es el decimal
    if (v.lastIndexOf(',') > v.lastIndexOf('.'))
      v = v.replace(/\./g, '').replace(',', '.');
    else v = v.replace(/,/g, '');
  } else if (v.includes(',')) {
    v = v.replace(',', '.');
  } else if ((v.match(/\./g) || []).length > 1) {
    v = v.replace(/\./g, '');
  }
  const n = parseFloat(v);
  return isNaN(n) ? NaN : Math.round(Math.abs(n) * 100) / 100;
}

function parseDateStr(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m;
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)))
    return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
    let y = m[3];
    if (y.length === 2) y = '20' + y;
    const day = +m[1], mon = +m[2];
    if (day > 31 || mon > 12) return null;
    return `${y}-${pad2(mon)}-${pad2(day)}`;
  }
  return null;
}

function parseCSV(text) {
  const clean = String(text).replace(/^﻿/, '');
  const lines = clean.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { headers: [], rows: [] };
  const head = lines[0];
  const delim =
    (head.split(';').length || 0) > (head.split(',').length || 0) ? ';' : ',';
  const parseLine = (line) => {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };
  const headers = parseLine(head).map((h) => h.toLowerCase().trim());
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function mapParsedRows(headers, rows) {
  if (!headers || !headers.length)
    throw new Error('El archivo está vacío o no tiene filas de datos.');
  const norm = headers.map((h) => String(h == null ? '' : h).toLowerCase().trim());
  const idx = {};
  for (const [field, aliases] of Object.entries(COL_ALIASES))
    idx[field] = norm.findIndex((h) => aliases.includes(h));
  if (idx.fecha === -1 || idx.monto === -1)
    throw new Error(
      'Faltan columnas obligatorias. Necesito al menos "fecha" y "monto" en los encabezados.'
    );
  const valid = [], invalid = [];
  rows.forEach((cols, i) => {
    const rowNum = i + 2;
    const get = (f) =>
      idx[f] >= 0 && cols[idx[f]] != null ? String(cols[idx[f]]).trim() : '';
    const amt = parseAmount(get('monto'));
    const date = parseDateStr(get('fecha'));
    if (!amt || amt <= 0) {
      invalid.push({ rowNum, reason: 'monto inválido o vacío' });
      return;
    }
    if (!date) {
      invalid.push({ rowNum, reason: 'fecha inválida (usá AAAA-MM-DD o DD/MM/AAAA)' });
      return;
    }
    const rawType = get('tipo').toLowerCase();
    const type = rawType.startsWith('ing')
      ? 'ingreso'
      : rawType.startsWith('aho')
      ? 'ahorro'
      : 'gasto';
    const rawCat = get('categoria');
    const cat =
      CAT_MAP[rawCat.toLowerCase()] ||
      rawCat ||
      (type === 'gasto' ? 'Compras' : 'Otros');
    const desc = [get('concepto'), get('descripcion')]
      .filter(Boolean)
      .join(' — ');
    const tx = {
      type,
      cat,
      sub: get('subcategoria'),
      amt,
      desc,
      date,
      cur: get('moneda').toUpperCase() === 'USD' ? 'USD' : 'ARS',
      recurring: false,
    };
    const who = get('member');
    if (who) tx.member = who;
    if (type === 'gasto') {
      const p = get('medio_pago').toLowerCase();
      tx.pay = p.includes('cred')
        ? 'credito'
        : p.includes('transf')
        ? 'transferencia'
        : p.includes('efe')
        ? 'efectivo'
        : 'debito';
    }
    valid.push(tx);
  });
  return { valid, invalid };
}

function mapImportRows(text) {
  const { headers, rows } = parseCSV(text);
  return mapParsedRows(headers, rows);
}

/* ── Palette ── */
const P = {
  bg: '#F8F6F3',
  cd: '#FFFFFF',
  c2: '#F2EFEA',
  bd: '#E8E3DB',
  tx: '#2A2621',
  sb: '#9A9389',
  ac: '#3D6B9B',
  al: '#5A8BBF',
  ab: 'rgba(61,107,155,0.07)',
  gn: '#3E8A6E',
  gb: 'rgba(62,138,110,0.07)',
  rd: '#C05650',
  rb: 'rgba(192,86,80,0.07)',
  am: '#B58A1B',
  amb: 'rgba(181,138,27,0.07)',
  pu: '#7B6BA5',
  pb: 'rgba(123,107,165,0.07)',
};
const pal = [
  '#3D6B9B',
  '#3E8A6E',
  '#C05650',
  '#B58A1B',
  '#7B6BA5',
  '#5A9E8F',
  '#C47B5A',
];

/* ── Shared UI ── */
function Box({ children, style }) {
  return (
    <div
      style={{
        background: P.cd,
        border: `1px solid ${P.bd}`,
        borderRadius: 18,
        padding: 18,
        boxShadow: '0 1px 4px rgba(42,38,33,0.05)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Toasts (reemplazan a alert) ──
function notify(message, type = 'info') {
  window.dispatchEvent(
    new CustomEvent('app-toast', { detail: { message, type } })
  );
}
function Toaster() {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);
  useEffect(() => {
    const handler = (e) => {
      const id = ++counter.current;
      setToasts((ts) => [...ts, { id, ...e.detail }]);
      setTimeout(
        () => setToasts((ts) => ts.filter((t) => t.id !== id)),
        3500
      );
    };
    window.addEventListener('app-toast', handler);
    return () => window.removeEventListener('app-toast', handler);
  }, []);
  if (!toasts.length) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 84,
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        zIndex: 500,
        pointerEvents: 'none',
        padding: '0 16px',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background:
              t.type === 'error'
                ? P.rd
                : t.type === 'success'
                ? P.gn
                : P.tx,
            color: '#fff',
            padding: '11px 18px',
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            maxWidth: 420,
            textAlign: 'center',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
function Lbl({ children }) {
  return (
    <div
      style={{
        fontSize: 10,
        color: P.sb,
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: 0.7,
        marginBottom: 5,
      }}
    >
      {children}
    </div>
  );
}
function Bar({ pct, color, h }) {
  return (
    <div style={{ height: h || 5, borderRadius: h || 5, background: P.c2 }}>
      <div
        style={{
          height: '100%',
          borderRadius: h || 5,
          background: color,
          width: `${Math.min(100, Math.max(0, pct))}%`,
          transition: 'width 0.4s',
        }}
      />
    </div>
  );
}

// Paleta para gráficos de categorías
const CHART_COLORS = [
  '#E15B4C', '#3A7BD5', '#1F9D57', '#E0A22E', '#7A5AF0',
  '#1FA6A0', '#D6608A', '#C98A2B', '#5B8DEF', '#9A8C6A',
];

// Dona SVG (segments: [{value, color}])
function Donut({ segments, size = 130, stroke = 16 }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - stroke / 2 - 1;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={P.c2} strokeWidth={stroke} />
      {segments.map((s, i) => {
        const len = (s.value / total) * c;
        const seg = (
          <circle
            key={i}
            cx={cx}
            cy={cx}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${cx} ${cx})`}
            strokeLinecap="butt"
          />
        );
        offset += len;
        return seg;
      })}
    </svg>
  );
}
function Nil({ t, icon, action, onAction, sub }) {
  return (
    <div
      style={{
        color: P.sb,
        fontSize: 13,
        textAlign: 'center',
        padding: '28px 16px',
      }}
    >
      {icon && <div style={{ fontSize: 30, marginBottom: 8 }}>{icon}</div>}
      <div style={{ fontWeight: 600, color: P.tx, fontSize: 14 }}>{t}</div>
      {sub && (
        <div style={{ marginTop: 4, fontSize: 12, color: P.sb }}>{sub}</div>
      )}
      {action && onAction && (
        <button
          onClick={onAction}
          style={{
            marginTop: 14,
            background: P.ac,
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {action}
        </button>
      )}
    </div>
  );
}
function NavB({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: P.cd,
        border: `1px solid ${P.bd}`,
        color: P.tx,
        width: 32,
        height: 32,
        borderRadius: 10,
        cursor: 'pointer',
        fontSize: 15,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}

/* ══════════════════════════════════════════
   APP
   ══════════════════════════════════════════ */
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error('Login error:', e);
      notify('No pudimos iniciar sesión. Probá de nuevo.', 'error');
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  if (loading)
    return (
      <div
        style={{
          background: P.bg,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'Poppins',sans-serif",
        }}
      >
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: `linear-gradient(135deg,${P.ac},${P.gn})`,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: 20,
              marginBottom: 12,
            }}
          >
            ₿
          </div>
          <div style={{ color: P.sb, fontSize: 14 }}>Cargando...</div>
        </div>
      </div>
    );

  return (
    <>
      {!user ? (
        <LoginScreen onLogin={login} />
      ) : (
        <MainApp user={user} onLogout={logout} />
      )}
      <Toaster />
    </>
  );
}

/* ══════════════════════════════════════════
   LOGIN
   ══════════════════════════════════════════ */
function LoginScreen({ onLogin }) {
  const mob = window.innerWidth < 680;
  return (
    <div
      style={{
        background: P.bg,
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Poppins',sans-serif",
        padding: 20,
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <div
        style={{
          background: P.cd,
          borderRadius: 24,
          padding: mob ? '36px 24px' : '44px 36px',
          width: '100%',
          maxWidth: 380,
          boxShadow: '0 12px 40px rgba(42,38,33,0.1)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: `linear-gradient(135deg,${P.ac},${P.gn})`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: 24,
            marginBottom: 16,
          }}
        >
          ₿
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>
          miplata
        </h1>
        <p
          style={{
            fontSize: 14,
            color: P.sb,
            marginBottom: 32,
            lineHeight: 1.5,
          }}
        >
          Controlá tus finanzas personales y compartidas, simple y claro.
        </p>
        <button
          onClick={onLogin}
          style={{
            width: '100%',
            background: P.cd,
            border: `1px solid ${P.bd}`,
            color: P.tx,
            padding: '14px 20px',
            borderRadius: 14,
            fontSize: 15,
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            transition: 'box-shadow 0.2s',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
          Continuar con Google
        </button>
        <p style={{ fontSize: 11, color: P.sb, marginTop: 20 }}>
          Tus datos se guardan en la nube. Accedé desde cualquier dispositivo.
        </p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   MAIN APP (authenticated)
   ══════════════════════════════════════════ */
function MainApp({ user, onLogout }) {
  // ── State ──
  const [tx, setTx] = useState([]);
  const [goals, setGoals] = useState([]);
  const [settings, setSettings] = useState({
    budgets: {},
    savPct: 20,
    efund: { expenses: {}, saved: 0 },
  });
  const [myGroups, setMyGroups] = useState([]); // [{id, name, members}]
  const [groupTx, setGroupTx] = useState({}); // {groupId: [tx]}
  const [dataLoaded, setDataLoaded] = useState(false);

  const [tab, setTab] = useState('insights');
  const [modal, setModal] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [month, setMonth] = useState(mk(new Date()));
  const [cur, setCur] = useState('ARS');
  const [fabOpen, setFabOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCats, setShowCats] = useState(false);
  const [showExchange, setShowExchange] = useState(false);
  const [viewScope, setViewScope] = useState('personal');
  const [mob, setMob] = useState(window.innerWidth < 680);
  const [joinCode, setJoinCode] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    const h = () => setMob(window.innerWidth < 680);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [menuOpen]);

  const menuRow = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    padding: '10px 12px',
    borderRadius: 10,
    cursor: 'pointer',
    fontSize: 14,
    color: P.tx,
    fontFamily: 'inherit',
  };
  const miniBtn = (active) => ({
    background: active ? P.ac + '18' : P.c2,
    border: `1px solid ${active ? P.ac : P.bd}`,
    color: active ? P.ac : P.sb,
    padding: '4px 10px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 500,
    fontFamily: 'inherit',
  });

  // ── Load personal data from Firestore ──
  useEffect(() => {
    if (!user) return;
    const unsubs = [];

    // Settings
    unsubs.push(
      onSnapshot(doc(db, 'users', user.uid), (snap) => {
        if (snap.exists()) setSettings((s) => ({ ...s, ...snap.data() }));
      })
    );

    // Transactions
    unsubs.push(
      onSnapshot(collection(db, 'users', user.uid, 'transactions'), (snap) => {
        setTx(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      })
    );

    // Goals
    unsubs.push(
      onSnapshot(collection(db, 'users', user.uid, 'goals'), (snap) => {
        setGoals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      })
    );

    // Groups where I'm a member
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'groups'),
          where('memberIds', 'array-contains', user.uid)
        ),
        (snap) => {
          const grps = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setMyGroups(grps);
          // Listen to each group's transactions
          grps.forEach((g) => {
            unsubs.push(
              onSnapshot(
                collection(db, 'groups', g.id, 'transactions'),
                (snap) => {
                  setGroupTx((prev) => ({
                    ...prev,
                    [g.id]: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
                  }));
                }
              )
            );
          });
        }
      )
    );

    setDataLoaded(true);
    return () => unsubs.forEach((u) => u());
  }, [user]);

  // ── Save settings to Firestore ──
  const saveSettings = useCallback(
    async (newSettings) => {
      const merged = { ...settings, ...newSettings };
      setSettings(merged);
      await setDoc(
        doc(db, 'users', user.uid),
        {
          budgets: merged.budgets,
          savPct: merged.savPct,
          defScope: merged.defScope,
          efund: merged.efund,
          customCats: merged.customCats || {},
          favorites: merged.favorites || [],
          savings: merged.savings || [],
          name: user.displayName,
          email: user.email,
        },
        { merge: true }
      );
    },
    [user, settings]
  );

  // ── Transaction CRUD ──
  const addTx = async (t) => {
    try {
      if (t.scope === 'grupo' && t.groupId) {
        await addDoc(collection(db, 'groups', t.groupId, 'transactions'), {
          ...t,
          createdBy: user.uid,
          createdByName: user.displayName,
          createdAt: new Date().toISOString(),
        });
      } else {
        await addDoc(collection(db, 'users', user.uid, 'transactions'), {
          ...t,
          createdAt: new Date().toISOString(),
        });
      }
      setModal(null);
      setFabOpen(false);
      notify('Movimiento guardado', 'success');
    } catch (e) {
      console.error('addTx error:', e);
      notify('No pudimos guardar el movimiento. Probá de nuevo.', 'error');
    }
  };

  // Registrar la instancia de un pago recurrente en el mes visto
  const registerRecurring = async (template) => {
    const day = String(template.date || '').slice(8, 10) || '01';
    const newDate = `${month}-${day}`;
    const { id, createdAt, imported, ...rest } = template;
    await addTx({ ...rest, date: newDate });
  };

  // Ubicaciones posibles del documento, ordenadas por probabilidad.
  // Tolera datos viejos inconsistentes (scope/groupId pegados).
  const txRefs = (t) => {
    const personalRef = doc(db, 'users', user.uid, 'transactions', t.id);
    const groupRef = t.groupId
      ? doc(db, 'groups', t.groupId, 'transactions', t.id)
      : null;
    const order =
      t.scope === 'grupo' && groupRef
        ? [groupRef, personalRef]
        : [personalRef, groupRef];
    return order.filter(Boolean);
  };

  // Marcar un gasto programado como pagado (pasa a contar en el presupuesto)
  const markPaid = async (t) => {
    for (const ref of txRefs(t)) {
      try {
        await updateDoc(ref, { pending: false });
        notify('Pago registrado ✓', 'success');
        return;
      } catch (e) {
        if (e?.code !== 'not-found') {
          console.error('markPaid error:', e);
          notify('No pudimos registrar el pago. Probá de nuevo.', 'error');
          return;
        }
      }
    }
  };

  const updateTxFn = async (t) => {
    // ¿Cambió de espacio? (personal <-> grupo, o grupo A <-> grupo B)
    const orig = editItem || {};
    const origGroup = orig.scope === 'grupo' ? orig.groupId || null : null;
    const newGroup = t.scope === 'grupo' ? t.groupId || null : null;
    if (origGroup !== newGroup) {
      // Mudar entre colecciones: crear en el nuevo lugar y SOLO si funcionó, borrar el viejo
      try {
        const oldRef = origGroup
          ? doc(db, 'groups', origGroup, 'transactions', orig.id)
          : doc(db, 'users', user.uid, 'transactions', orig.id);
        const { id, createdAt, imported, ...rest } = t;
        const isGroup = rest.scope === 'grupo' && rest.groupId;
        const col = isGroup
          ? collection(db, 'groups', rest.groupId, 'transactions')
          : collection(db, 'users', user.uid, 'transactions');
        const extra = isGroup
          ? {
              createdBy: user.uid,
              createdByName: user.displayName,
              createdAt: new Date().toISOString(),
            }
          : { createdAt: new Date().toISOString() };
        await addDoc(col, { ...rest, ...extra });
        await deleteDoc(oldRef);
        setModal(null);
        setEditItem(null);
        notify('Movimiento movido', 'success');
        return;
      } catch (e) {
        console.error('moveTx error:', e);
        notify('No pudimos mover el movimiento. Probá de nuevo.', 'error');
        return;
      }
    }
    let lastErr;
    for (const ref of txRefs(t)) {
      try {
        await updateDoc(ref, t);
        setModal(null);
        setEditItem(null);
        notify('Cambios guardados', 'success');
        return;
      } catch (e) {
        lastErr = e;
        if (e?.code !== 'not-found') break;
      }
    }
    console.error('updateTx error:', lastErr, t);
    notify('No pudimos actualizar el movimiento. Probá de nuevo.', 'error');
  };

  const delTxFn = async (t) => {
    let lastErr;
    for (const ref of txRefs(t)) {
      try {
        await deleteDoc(ref);
        setModal(null);
        setEditItem(null);
        notify('Movimiento borrado', 'success');
        return;
      } catch (e) {
        lastErr = e;
        if (e?.code !== 'not-found') break;
      }
    }
    console.error('delTx error:', lastErr);
    notify('No pudimos borrar el movimiento. Probá de nuevo.', 'error');
  };

  // ── Bulk import → a Personal o a un Grupo ──
  const importTx = async (rows, dest) => {
    const isGroup = dest && dest !== 'personal';
    const col = isGroup
      ? collection(db, 'groups', dest, 'transactions')
      : collection(db, 'users', user.uid, 'transactions');
    const extra = isGroup
      ? {
          scope: 'grupo',
          groupId: dest,
          createdBy: user.uid,
          createdByName: user.displayName || user.email,
        }
      : { scope: 'personal' };
    const stamp = new Date().toISOString();
    let batch = writeBatch(db);
    let n = 0;
    for (const t of rows) {
      batch.set(doc(col), { ...t, ...extra, imported: true, createdAt: stamp });
      n++;
      if (n % 450 === 0) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }
    if (n % 450 !== 0) await batch.commit();
    return rows.length;
  };

  // ── Vaciar mes: borra todos los movimientos del mes + espacio activos ──
  const clearMonth = async () => {
    const items = activeTx.filter((t) => mk(t.date) === month);
    const scopeName =
      viewScope === 'personal'
        ? 'Personal'
        : myGroups.find((g) => g.id === viewScope)?.name || 'Grupo';
    if (!items.length) {
      notify(`No hay movimientos en ${MOF[mi - 1]} ${yi} (${scopeName}).`, 'info');
      return;
    }
    if (
      !window.confirm(
        `¿Borrar ${items.length} movimiento(s) de ${MOF[mi - 1]} ${yi} en "${scopeName}"?\n\nEsta acción NO se puede deshacer.`
      )
    )
      return;
    try {
      let batch = writeBatch(db);
      let n = 0;
      for (const t of items) {
        const ref =
          viewScope === 'personal'
            ? doc(db, 'users', user.uid, 'transactions', t.id)
            : doc(db, 'groups', viewScope, 'transactions', t.id);
        batch.delete(ref);
        n++;
        if (n % 450 === 0) {
          await batch.commit();
          batch = writeBatch(db);
        }
      }
      if (n % 450 !== 0) await batch.commit();
      notify(`Listo, borramos ${items.length} movimiento(s).`, 'success');
    } catch (e) {
      console.error('clearMonth error:', e);
      notify('No pudimos vaciar el mes. Probá de nuevo.', 'error');
    }
  };

  // ── Goals CRUD ──
  const addGoalFn = async (g) => {
    await addDoc(collection(db, 'users', user.uid, 'goals'), g);
  };
  const updateGoalFn = async (id, amt) => {
    const g = goals.find((x) => x.id === id);
    if (g)
      await updateDoc(doc(db, 'users', user.uid, 'goals', id), {
        saved: Math.max(0, (g.saved || 0) + amt),
      });
  };
  const delGoalFn = async (id) => {
    await deleteDoc(doc(db, 'users', user.uid, 'goals', id));
  };

  // ── Groups ──
  const createGroup = async (name) => {
    const ref = await addDoc(collection(db, 'groups'), {
      name,
      memberIds: [user.uid],
      memberNames: [user.displayName || user.email],
      createdBy: user.uid,
    });
    setViewScope(ref.id);
    return ref.id;
  };

  const joinGroup = async (groupId) => {
    try {
      const ref = doc(db, 'groups', groupId.trim());
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        notify('No encontramos ese grupo. Revisá el código.', 'error');
        return;
      }
      await updateDoc(ref, {
        memberIds: arrayUnion(user.uid),
        memberNames: arrayUnion(user.displayName || user.email),
      });
      notify(`Te uniste al grupo "${snap.data().name}".`, 'success');
    } catch {
      notify('No pudimos unirte al grupo. Probá de nuevo.', 'error');
    }
  };

  // ── Computed ──
  const allGroupTx = useMemo(() => {
    const all = [];
    Object.entries(groupTx).forEach(([gid, txs]) => {
      txs.forEach((t) => all.push({ ...t, groupId: gid }));
    });
    return all;
  }, [groupTx]);

  const activeTx = useMemo(() => {
    if (viewScope === 'personal') return tx;
    const grp = myGroups.find((g) => g.id === viewScope);
    if (grp)
      return (groupTx[grp.id] || []).map((t) => ({ ...t, groupId: grp.id }));
    return [];
  }, [viewScope, tx, myGroups, groupTx]);

  const mtx = chargesForMonth(activeTx, month).filter((t) => t.cur === cur);
  // Los gastos PROGRAMADOS (pendientes de pago) no cuentan hasta marcarse pagados
  const paid = (t) => !t.pending;
  const totIn = mtx
    .filter((t) => t.type === 'ingreso' && paid(t))
    .reduce((s, t) => s + t.amt, 0);
  const totOut = mtx
    .filter((t) => t.type === 'gasto' && paid(t))
    .reduce((s, t) => s + t.amt, 0);
  const totSav = mtx
    .filter((t) => t.type === 'ahorro' && paid(t))
    .reduce((s, t) => s + t.amt, 0);
  const bal = totIn - totOut - totSav;
  const byCat = useMemo(() => {
    const m = {};
    mtx
      .filter((t) => t.type === 'gasto' && !t.pending)
      .forEach((t) => {
        m[t.cat] = (m[t.cat] || 0) + t.amt;
      });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [mtx]);
  // Saldo arrastrado de meses anteriores (lo que sobró: ingresos - gastos - ahorros)
  const carry = useMemo(() => {
    if (!month) return 0;
    const keys = new Set(
      activeTx.map((t) => mk(t.date)).filter((k) => k && k < month)
    );
    let s = 0;
    keys.forEach((k) => {
      chargesForMonth(activeTx, k)
        .filter((t) => t.cur === cur && !t.pending)
        .forEach((t) => {
          if (t.type === 'ingreso') s += t.amt;
          else if (t.type === 'gasto' || t.type === 'ahorro') s -= t.amt;
        });
    });
    return Math.round(s);
  }, [activeTx, month, cur]);

  // Gastos programados pendientes de pago (cualquier mes, scope/moneda actual)
  const pendingTx = activeTx
    .filter((t) => t.pending && t.cur === cur)
    .sort((a, b) => (String(a.date) > String(b.date) ? 1 : -1));

  const prevM = () => {
    const [y, m] = month.split('-').map(Number);
    setMonth(
      m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
    );
  };
  const nextM = () => {
    const [y, m] = month.split('-').map(Number);
    setMonth(
      m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    );
  };
  const [yi, mi] = month.split('-').map(Number);

  // Aplicar el espacio predeterminado al cargar (una sola vez)
  const defaultApplied = useRef(false);
  useEffect(() => {
    if (defaultApplied.current) return;
    const d = settings.defScope;
    if (!d) return;
    if (d === 'personal') {
      setViewScope('personal');
      defaultApplied.current = true;
    } else if (myGroups.some((g) => g.id === d)) {
      setViewScope(d);
      defaultApplied.current = true;
    }
  }, [settings.defScope, myGroups]);

  const openEdit = (t) => {
    setEditItem(t);
    setModal('edit');
  };
  const openAdd = (type) => {
    setEditItem({ type });
    setModal('add');
    setFabOpen(false);
  };
  // Abrir el formulario PRE-CARGADO como nuevo (sin id, fecha hoy)
  const openPrefill = (data) => {
    if (!data) return;
    const { id, createdAt, imported, date, serieId, recurring, ...rest } = data;
    setEditItem({ ...rest });
    setModal('add');
    setFabOpen(false);
  };
  const lastTx = useMemo(
    () =>
      [...activeTx].sort((a, b) =>
        String(b.date) !== String(a.date)
          ? String(b.date) > String(a.date)
            ? 1
            : -1
          : String(b.createdAt || '') > String(a.createdAt || '')
          ? 1
          : -1
      )[0],
    [activeTx]
  );
  const favorites = settings.favorites || [];
  const saveFavorite = (fav) =>
    saveSettings({ favorites: [...favorites, fav] });
  const removeFavorite = (idx) =>
    saveSettings({ favorites: favorites.filter((_, i) => i !== idx) });

  return (
    <div
      style={{
        background: P.bg,
        minHeight: '100vh',
        color: P.tx,
        fontFamily: "'Poppins',system-ui,sans-serif",
        paddingBottom: 76,
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap"
        rel="stylesheet"
      />

      {/* Header */}
      <header
        style={{
          background: P.cd,
          borderBottom: `1px solid ${P.bd}`,
          padding: mob ? '10px 14px' : '10px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 90,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 9,
              background: `linear-gradient(135deg,${P.ac},${P.gn})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            ₿
          </div>
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: -0.5 }}>
            miplata
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              display: 'flex',
              background: P.c2,
              borderRadius: 8,
              border: `1px solid ${P.bd}`,
              overflow: 'hidden',
            }}
          >
            {['ARS', 'USD'].map((c) => (
              <button
                key={c}
                onClick={() => setCur(c)}
                style={{
                  background: cur === c ? P.ac : 'transparent',
                  color: cur === c ? '#fff' : P.sb,
                  border: 'none',
                  padding: '4px 10px',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {c}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowCats(true)}
            title="Personalizar categorías"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: P.c2,
              border: `1px solid ${P.bd}`,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            🏷️
          </button>
          {user.photoURL && (
            <img
              src={user.photoURL}
              alt=""
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                cursor: 'pointer',
                border: `2px solid ${menuOpen ? P.ac : 'transparent'}`,
              }}
              onClick={() => setMenuOpen((o) => !o)}
              title="Mi cuenta"
            />
          )}
          {!user.photoURL && (
            <button
              onClick={() => setMenuOpen((o) => !o)}
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: P.ab,
                border: `2px solid ${menuOpen ? P.ac : P.bd}`,
                fontSize: 11,
                fontWeight: 700,
                color: P.ac,
                cursor: 'pointer',
              }}
              title="Mi cuenta"
            >
              {user.displayName?.[0] || 'U'}
            </button>
          )}
        </div>
      </header>

      {/* Scope bar: solo el espacio actual */}
      <div
        style={{
          background: P.cd,
          borderBottom: `1px solid ${P.bd}`,
          padding: mob ? '8px 14px' : '8px 24px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            maxWidth: 800,
            margin: '0 auto',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: viewScope === 'personal' ? P.ab : P.pu + '18',
              border: `1px solid ${viewScope === 'personal' ? P.ac : P.pu}`,
              color: viewScope === 'personal' ? P.ac : P.pu,
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              maxWidth: '70%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {viewScope === 'personal'
              ? '👤 Personal'
              : '👥 ' +
                (myGroups.find((g) => g.id === viewScope)?.name || 'Grupo')}
            {settings.defScope === viewScope && ' ⭐'}
          </span>
          <button
            onClick={() => setMenuOpen(true)}
            style={{
              background: 'transparent',
              border: `1px solid ${P.bd}`,
              color: P.sb,
              padding: '6px 12px',
              borderRadius: 999,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            Cambiar ▾
          </button>
        </div>
      </div>

      {/* Menú de cuenta + espacios */}
      {menuOpen && (
        <>
          <div
            onClick={() => {
              setMenuOpen(false);
              setShowCode(false);
            }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.25)',
              zIndex: 100,
            }}
          />
          <div
            style={{
              position: 'fixed',
              top: 56,
              right: mob ? 10 : 24,
              left: mob ? 10 : 'auto',
              width: mob ? 'auto' : 320,
              maxHeight: 'calc(100vh - 72px)',
              overflowY: 'auto',
              background: P.cd,
              border: `1px solid ${P.bd}`,
              borderRadius: 16,
              boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
              zIndex: 101,
              padding: 6,
            }}
          >
            {/* Cuenta */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
              }}
            >
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt=""
                  style={{ width: 40, height: 40, borderRadius: '50%' }}
                />
              ) : (
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: P.ab,
                    color: P.ac,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {user.displayName?.[0] || 'U'}
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    color: P.tx,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {user.displayName || 'Mi cuenta'}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: P.sb,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {user.email}
                </div>
              </div>
            </div>

            <div style={{ height: 1, background: P.bd, margin: '4px 8px' }} />

            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: P.sb,
                letterSpacing: 0.5,
                padding: '8px 12px 4px',
              }}
            >
              MIS ESPACIOS
            </div>

            {/* Personal */}
            <button
              onClick={() => {
                setViewScope('personal');
                setMenuOpen(false);
                setShowCode(false);
              }}
              style={{
                ...menuRow,
                background: viewScope === 'personal' ? P.ab : 'transparent',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                👤 Personal {settings.defScope === 'personal' && '⭐'}
              </span>
              {viewScope === 'personal' && (
                <span style={{ color: P.ac }}>✓</span>
              )}
            </button>

            {myGroups.map((g) => (
              <div key={g.id}>
                <button
                  onClick={() => {
                    setViewScope(g.id);
                    setMenuOpen(false);
                    setShowCode(false);
                  }}
                  style={{
                    ...menuRow,
                    background: viewScope === g.id ? P.pu + '14' : 'transparent',
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      👥 {g.name}
                    </span>
                    {settings.defScope === g.id && '⭐'}
                  </span>
                  {viewScope === g.id && (
                    <span style={{ color: P.pu }}>✓</span>
                  )}
                </button>
                {viewScope === g.id && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 6,
                      padding: '2px 12px 8px 34px',
                    }}
                  >
                    <button
                      onClick={() => saveSettings({ defScope: g.id })}
                      style={miniBtn(settings.defScope === g.id)}
                    >
                      {settings.defScope === g.id
                        ? '⭐ Predeterminado'
                        : '☆ Predeterminar'}
                    </button>
                    <button
                      onClick={() => setShowCode((s) => !s)}
                      style={miniBtn(false)}
                    >
                      🔑 {showCode ? 'Ocultar código' : 'Ver código'}
                    </button>
                    {showCode && (
                      <code
                        onClick={() => {
                          navigator.clipboard?.writeText(g.id);
                          notify('Código copiado.', 'success');
                        }}
                        title="Tocá para copiar"
                        style={{
                          background: P.c2,
                          padding: '4px 8px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          color: P.tx,
                          cursor: 'pointer',
                          wordBreak: 'break-all',
                        }}
                      >
                        {g.id} 📋
                      </code>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Acciones de grupo */}
            <button
              onClick={async () => {
                const name = prompt('Nombre del grupo:');
                setMenuOpen(false);
                if (name?.trim()) await createGroup(name.trim());
              }}
              style={menuRow}
            >
              ➕ Crear grupo
            </button>
            <button
              onClick={() => {
                const c = prompt('Pegá el código del grupo para unirte:');
                setMenuOpen(false);
                if (c?.trim()) joinGroup(c.trim());
              }}
              style={menuRow}
            >
              🔑 Unirme con un código
            </button>

            <div style={{ height: 1, background: P.bd, margin: '4px 8px' }} />

            <button
              onClick={() => {
                setShowCats(true);
                setMenuOpen(false);
              }}
              style={menuRow}
            >
              🏷️ Categorías
            </button>

            <div style={{ height: 1, background: P.bd, margin: '4px 8px' }} />

            <button
              onClick={onLogout}
              style={{ ...menuRow, color: P.rd, fontWeight: 600 }}
            >
              🚪 Cerrar sesión
            </button>
          </div>
        </>
      )}

      {/* Content */}
      <main
        style={{
          maxWidth: 800,
          margin: '0 auto',
          padding: mob ? '12px 10px' : '20px 20px',
        }}
      >
        {(tab === 'home' || tab === 'insights') && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: mob ? 12 : 18,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <NavB onClick={prevM}>‹</NavB>
              <span style={{ fontWeight: 600, fontSize: mob ? 14 : 17 }}>
                {MOF[mi - 1]} {yi}
              </span>
              <NavB onClick={nextM}>›</NavB>
            </div>
            <button
              onClick={clearMonth}
              title="Borrar todos los movimientos de este mes"
              style={{
                background: 'transparent',
                border: `1px solid ${P.bd}`,
                color: P.sb,
                borderRadius: 8,
                padding: mob ? '5px 9px' : '6px 11px',
                fontSize: mob ? 11 : 12,
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              🗑️ Vaciar mes
            </button>
          </div>
        )}
        {tab === 'home' && (
          <HomeTab
            mob={mob}
            cur={cur}
            totIn={totIn}
            totOut={totOut}
            totSav={totSav}
            bal={bal}
            byCat={byCat}
            mtx={mtx}
            carry={carry}
            budgets={settings.budgets || {}}
            onEdit={openEdit}
            customCats={settings.customCats}
            isGroup={viewScope !== 'personal'}
            activeTx={activeTx}
            month={month}
            onRegister={registerRecurring}
            favorites={favorites}
            onUseFav={openPrefill}
            onRemoveFav={removeFavorite}
            pendingTx={pendingTx}
            onMarkPaid={markPaid}
            onAdd={openAdd}
          />
        )}
        {tab === 'movs' && (
          <TxListTab
            mob={mob}
            cur={cur}
            activeTx={activeTx}
            onEdit={openEdit}
            customCats={settings.customCats}
            onAdd={openAdd}
          />
        )}
        {tab === 'insights' && (
          <InsightsTab
            mob={mob}
            cur={cur}
            activeTx={activeTx}
            month={month}
            byCat={byCat}
            totIn={totIn}
            totOut={totOut}
            totSav={totSav}
            carry={carry}
            isGroup={viewScope !== 'personal'}
            mtx={mtx}
            budgets={settings.budgets || {}}
            saveBudgets={(b) => saveSettings({ budgets: b })}
            onAdd={openAdd}
          />
        )}
        {tab === 'goals' && (
          <GoalsTab
            mob={mob}
            cur={cur}
            goals={goals}
            addGoal={addGoalFn}
            updGoal={updateGoalFn}
            delGoal={delGoalFn}
            totIn={totIn}
            totOut={totOut}
            savPct={settings.savPct || 20}
            setSavPct={(p) => saveSettings({ savPct: p })}
            efund={settings.efund || { expenses: {}, saved: 0 }}
            setEfund={(ef) => saveSettings({ efund: ef })}
            savings={settings.savings || []}
            setSavings={(s) => saveSettings({ savings: s })}
            usdHeld={[...tx].reduce(
              (s, t) =>
                s +
                (t.usd > 0 ? t.usd : 0) -
                (t.type === 'gasto' && t.cur === 'USD' ? t.amt : 0),
              0
            )}
            usdBuys={tx
              .filter((t) => t.usd > 0)
              .sort((a, b) => (b.date || '').localeCompare(a.date || ''))}
            delTx={delTxFn}
          />
        )}
      </main>

      {/* FAB */}
      <div
        style={{
          position: 'fixed',
          bottom: mob ? 72 : 80,
          right: mob ? 14 : 22,
          zIndex: 110,
        }}
      >
        {fabOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: 56,
              right: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {[
              { t: 'gasto', ic: '📉', l: 'Gasto', c: P.rd },
              { t: 'ingreso', ic: '📈', l: 'Ingreso', c: P.gn },
            ].map((b) => (
              <button
                key={b.t}
                onClick={() => openAdd(b.t)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: P.cd,
                  border: `1px solid ${P.bd}`,
                  borderRadius: 12,
                  padding: '9px 14px',
                  cursor: 'pointer',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                  fontSize: 13,
                  fontWeight: 500,
                  color: P.tx,
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    background: b.c + '12',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                  }}
                >
                  {b.ic}
                </span>
                {b.l}
              </button>
            ))}
            {lastTx && (
              <button
                onClick={() => openPrefill(lastTx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: P.cd,
                  border: `1px solid ${P.bd}`,
                  borderRadius: 12,
                  padding: '9px 14px',
                  cursor: 'pointer',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                  fontSize: 13,
                  fontWeight: 500,
                  color: P.tx,
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    background: P.ac + '12',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                  }}
                >
                  ↩️
                </span>
                Repetir último
              </button>
            )}
            <button
              onClick={() => {
                setFabOpen(false);
                setShowExchange(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: P.cd,
                border: `1px solid ${P.bd}`,
                borderRadius: 12,
                padding: '9px 14px',
                cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                fontSize: 13,
                fontWeight: 500,
                color: P.tx,
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  background: P.ac + '12',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                }}
              >
                💱
              </span>
              Comprar dólares
            </button>
            <button
              onClick={() => {
                setFabOpen(false);
                setShowImport(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: P.cd,
                border: `1px solid ${P.bd}`,
                borderRadius: 12,
                padding: '9px 14px',
                cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                fontSize: 13,
                fontWeight: 500,
                color: P.tx,
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  background: P.ac + '12',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                }}
              >
                📥
              </span>
              Importar datos
            </button>
          </div>
        )}
        <button
          onClick={() => setFabOpen(!fabOpen)}
          style={{
            width: 50,
            height: 50,
            borderRadius: 15,
            background: `linear-gradient(135deg,${P.ac},${P.al})`,
            border: 'none',
            color: '#fff',
            fontSize: 24,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 6px 20px ${P.ac}40`,
            transform: fabOpen ? 'rotate(45deg)' : 'none',
            transition: 'transform 0.2s',
          }}
        >
          +
        </button>
      </div>
      {fabOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100 }}
          onClick={() => setFabOpen(false)}
        />
      )}

      {/* Bottom nav */}
      <nav
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: P.cd,
          borderTop: `1px solid ${P.bd}`,
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center',
          height: 56,
          zIndex: 100,
        }}
      >
        {[
          { id: 'home', l: 'Inicio', e: '🏠' },
          { id: 'movs', l: 'Movim.', e: '📋' },
          { id: 'insights', l: 'Análisis', e: '📊' },
          { id: 'goals', l: 'Metas', e: '🎯' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: tab === t.id ? P.ac : P.sb,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              cursor: 'pointer',
              padding: '4px 16px',
              fontSize: 10,
              fontWeight: tab === t.id ? 600 : 400,
            }}
          >
            <span style={{ fontSize: 18 }}>{t.e}</span>
            {t.l}
          </button>
        ))}
      </nav>

      {/* Modal */}
      {modal && (
        <TxModal
          mode={modal}
          initial={editItem}
          cur={cur}
          onSave={modal === 'edit' ? updateTxFn : addTx}
          onDelete={modal === 'edit' ? () => delTxFn(editItem) : null}
          onClose={() => {
            setModal(null);
            setEditItem(null);
          }}
          mob={mob}
          defScope={settings.defScope}
          setDefScope={(s) => saveSettings({ defScope: s })}
          myGroups={myGroups}
          viewScope={viewScope}
          customCats={settings.customCats}
          userName={user.displayName || user.email}
          onSaveFav={saveFavorite}
          knownCards={[
            ...new Set(
              [...tx, ...allGroupTx].map((t) => t.card).filter(Boolean)
            ),
          ]}
          knownMembers={[
            ...new Set(allGroupTx.map((t) => t.member).filter(Boolean)),
          ]}
        />
      )}

      {showImport && (
        <ImportModal
          mob={mob}
          onImport={importTx}
          groups={myGroups}
          defaultDest={viewScope}
          onClose={() => setShowImport(false)}
        />
      )}

      {showCats && (
        <CategoryManager
          mob={mob}
          customCats={settings.customCats || {}}
          onSave={(cc) => saveSettings({ customCats: cc })}
          onClose={() => setShowCats(false)}
        />
      )}

      {showExchange && (
        <ExchangeModal
          mob={mob}
          onSave={(t) => {
            addTx(t);
            setShowExchange(false);
          }}
          onClose={() => setShowExchange(false)}
        />
      )}
    </div>
  );
}

/* ── COMPRAR DÓLARES (cambio de moneda) ── */
function ExchangeModal({ mob, onSave, onClose }) {
  const [usd, setUsd] = useState('');
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(td());
  const [source, setSource] = useState('cuenta'); // cuenta | ahorro
  const usdN = Number(String(usd).replace(',', '.'));
  const rateN = Number(String(rate).replace(',', '.'));
  const pesos = usdN > 0 && rateN > 0 ? Math.round(usdN * rateN) : 0;

  const iS = {
    background: P.c2,
    border: `1px solid ${P.bd}`,
    color: P.tx,
    padding: '12px 14px',
    borderRadius: 12,
    fontSize: 16,
    width: '100%',
    boxSizing: 'border-box',
  };

  const save = () => {
    if (!usdN || usdN <= 0 || !rateN || rateN <= 0) {
      notify('Completá los dólares y la cotización.', 'error');
      return;
    }
    onSave({
      // Si sale de la cuenta del mes -> ahorro (resta del balance).
      // Si sale de un ahorro/fondo que ya tenía -> cambio (no toca el mes).
      type: source === 'ahorro' ? 'cambio' : 'ahorro',
      cat: 'Dólares',
      sub: 'Compra USD',
      amt: pesos,
      usd: usdN,
      rate: rateN,
      desc: `Compré US$ ${usdN} a $${rateN}`,
      date,
      cur: 'ARS',
      scope: 'personal',
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(42,38,33,0.25)',
        display: 'flex',
        alignItems: mob ? 'flex-end' : 'center',
        justifyContent: 'center',
        zIndex: 200,
        backdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: P.cd,
          borderRadius: mob ? '22px 22px 0 0' : 22,
          padding: mob ? '18px 16px 28px' : 26,
          width: '100%',
          maxWidth: mob ? '100%' : 420,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
          💱 Comprar dólares
        </div>
        <p style={{ fontSize: 12, color: P.sb, margin: '4px 0 16px' }}>
          Se registra como ahorro: resta de tus pesos y suma a tus dólares. No
          cuenta como gasto.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Lbl>Dólares (US$)</Lbl>
            <input
              type="number"
              placeholder="0"
              value={usd}
              onChange={(e) => setUsd(e.target.value)}
              autoFocus
              style={iS}
            />
          </div>
          <div>
            <Lbl>Cotización ($ por dólar)</Lbl>
            <input
              type="number"
              placeholder="0"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              style={iS}
            />
          </div>
          <div
            style={{
              background: P.bg,
              borderRadius: 12,
              padding: '12px 14px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 10, color: P.sb }}>TE SALE</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: P.ac }}>
              {fmt(pesos, 'ARS')}
            </div>
          </div>
          <div>
            <Lbl>¿De dónde sale la plata?</Lbl>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                ['cuenta', 'De mi cuenta'],
                ['ahorro', 'De un ahorro/fondo'],
              ].map(([id, l]) => (
                <button
                  key={id}
                  onClick={() => setSource(id)}
                  style={{
                    flex: 1,
                    background: source === id ? P.ac : P.c2,
                    color: source === id ? '#fff' : P.tx,
                    border: `1px solid ${source === id ? P.ac : P.bd}`,
                    borderRadius: 10,
                    padding: '9px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: P.sb, marginTop: 5 }}>
              {source === 'cuenta'
                ? 'Resta de tus pesos del mes (cuenta como ahorro).'
                : 'No toca el balance del mes (solo mueve tu ahorro a dólares).'}
            </div>
          </div>
          <div>
            <Lbl>Fecha</Lbl>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={iS}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              background: P.c2,
              border: `1px solid ${P.bd}`,
              color: P.tx,
              padding: '12px',
              borderRadius: 14,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={save}
            style={{
              flex: 2,
              background: P.ac,
              border: 'none',
              color: '#fff',
              padding: '12px',
              borderRadius: 14,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Guardar compra
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── PERSONALIZADOR DE CATEGORÍAS ── */
function CategoryManager({ mob, customCats, onSave, onClose }) {
  const [type, setType] = useState('gasto');
  const [draft, setDraft] = useState(() =>
    JSON.parse(JSON.stringify(customCats || {}))
  );
  const [newCat, setNewCat] = useState('');
  const [newEmoji, setNewEmoji] = useState('🏷️');
  const [subInputs, setSubInputs] = useState({});

  const cats = getCats(type, draft);
  const isCustomCat = (name) => (draft[type] || []).some((c) => c.n === name);
  const customSubsOf = (name) => {
    const c = (draft[type] || []).find((x) => x.n === name);
    return new Set(c ? c.s : []);
  };

  const addCategory = () => {
    const n = newCat.trim();
    if (!n) return;
    if (cats.some((c) => c.n.toLowerCase() === n.toLowerCase())) {
      notify('Ya tenés una categoría con ese nombre.', 'error');
      return;
    }
    const d = { ...draft };
    d[type] = [...(d[type] || []), { n, i: newEmoji || '🏷️', s: [] }];
    setDraft(d);
    setNewCat('');
    setNewEmoji('🏷️');
  };

  const delCategory = (name) => {
    if (!window.confirm(`¿Borrar la categoría "${name}"?`)) return;
    const d = { ...draft };
    d[type] = (d[type] || []).filter((c) => c.n !== name);
    setDraft(d);
  };

  const addSub = (catName) => {
    const val = (subInputs[catName] || '').trim();
    if (!val) return;
    const d = { ...draft };
    const arr = d[type] ? d[type].map((c) => ({ ...c, s: [...c.s] })) : [];
    let cat = arr.find((c) => c.n === catName);
    if (!cat) {
      cat = { n: catName, i: '🏷️', s: [] };
      arr.push(cat);
    }
    if (!cat.s.includes(val)) cat.s.push(val);
    d[type] = arr;
    setDraft(d);
    setSubInputs({ ...subInputs, [catName]: '' });
  };

  const delSub = (catName, sub) => {
    const d = { ...draft };
    d[type] = (d[type] || []).map((c) =>
      c.n === catName ? { ...c, s: c.s.filter((x) => x !== sub) } : c
    );
    setDraft(d);
  };

  const inp = {
    background: P.c2,
    border: `1px solid ${P.bd}`,
    color: P.tx,
    padding: '8px 10px',
    borderRadius: 9,
    fontSize: 13,
    boxSizing: 'border-box',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(42,38,33,0.25)',
        display: 'flex',
        alignItems: mob ? 'flex-end' : 'center',
        justifyContent: 'center',
        zIndex: 200,
        backdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: P.cd,
          borderRadius: mob ? '22px 22px 0 0' : 22,
          padding: mob ? '18px 16px 28px' : 26,
          width: '100%',
          maxWidth: mob ? '100%' : 500,
          maxHeight: mob ? '92vh' : '88vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 17, fontWeight: 700 }}>🏷️ Categorías</span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 18,
              cursor: 'pointer',
              color: P.sb,
            }}
          >
            ✕
          </button>
        </div>

        {/* Tipo */}
        <div
          style={{
            display: 'flex',
            background: P.c2,
            borderRadius: 12,
            padding: 3,
            marginBottom: 14,
            border: `1px solid ${P.bd}`,
          }}
        >
          {[
            ['gasto', '📉 Gasto', P.rd],
            ['ingreso', '📈 Ingreso', P.gn],
            ['ahorro', '🏦 Ahorro', P.ac],
          ].map(([id, l, color]) => (
            <button
              key={id}
              onClick={() => setType(id)}
              style={{
                flex: 1,
                background: type === id ? color : 'transparent',
                border: 'none',
                color: type === id ? '#fff' : P.sb,
                padding: '8px',
                borderRadius: 10,
                cursor: 'pointer',
                fontSize: mob ? 12 : 13,
                fontWeight: 600,
              }}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Nueva categoría */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <input
            value={newEmoji}
            onChange={(e) => setNewEmoji(e.target.value)}
            maxLength={2}
            style={{ ...inp, width: 48, textAlign: 'center' }}
          />
          <input
            placeholder="Nueva categoría…"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
            style={{ ...inp, flex: 1 }}
          />
          <button
            onClick={addCategory}
            style={{
              background: P.ac,
              color: '#fff',
              border: 'none',
              borderRadius: 9,
              padding: '0 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Agregar
          </button>
        </div>

        {/* Lista de categorías */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cats.map((c) => (
            <div
              key={c.n}
              style={{
                border: `1px solid ${P.bd}`,
                borderRadius: 12,
                padding: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  {c.i} {c.n}
                  {isCustomCat(c.n) && !CATS[type].some((b) => b.n === c.n) && (
                    <span style={{ fontSize: 10, color: P.sb }}> · tuya</span>
                  )}
                </span>
                {isCustomCat(c.n) && !CATS[type].some((b) => b.n === c.n) && (
                  <button
                    onClick={() => delCategory(c.n)}
                    title="Borrar categoría"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    🗑️
                  </button>
                )}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 5,
                  marginBottom: 8,
                }}
              >
                {c.s.map((sub) => {
                  const removable = customSubsOf(c.n).has(sub);
                  return (
                    <span
                      key={sub}
                      style={{
                        background: P.c2,
                        border: `1px solid ${P.bd}`,
                        borderRadius: 8,
                        padding: '3px 8px',
                        fontSize: 11,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      {sub}
                      {removable && (
                        <span
                          onClick={() => delSub(c.n, sub)}
                          style={{ cursor: 'pointer', color: P.rd }}
                        >
                          ✕
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  placeholder="Nueva subcategoría…"
                  value={subInputs[c.n] || ''}
                  onChange={(e) =>
                    setSubInputs({ ...subInputs, [c.n]: e.target.value })
                  }
                  onKeyDown={(e) => e.key === 'Enter' && addSub(c.n)}
                  style={{ ...inp, flex: 1, fontSize: 12, padding: '6px 9px' }}
                />
                <button
                  onClick={() => addSub(c.n)}
                  style={{
                    background: P.c2,
                    border: `1px solid ${P.bd}`,
                    color: P.tx,
                    borderRadius: 9,
                    padding: '0 12px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              background: P.c2,
              border: `1px solid ${P.bd}`,
              color: P.tx,
              padding: '12px',
              borderRadius: 14,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            style={{
              flex: 2,
              background: P.ac,
              border: 'none',
              color: '#fff',
              padding: '12px',
              borderRadius: 14,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Guardar cambios
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── IMPORT MODAL ── */
function ImportModal({ mob, onImport, onClose, groups = [], defaultDest }) {
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [fileName, setFileName] = useState('');
  const [dest, setDest] = useState(defaultDest || 'personal');

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setParsed(null);
    const isExcel = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    reader.onerror = () => setError('No se pudo abrir el archivo.');
    if (isExcel) {
      reader.onload = async () => {
        try {
          const XLSX = await import('xlsx');
          const wb = XLSX.read(reader.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const aoa = XLSX.utils.sheet_to_json(ws, {
            header: 1,
            raw: false,
            defval: '',
          });
          const headers = (aoa[0] || []).map((h) => String(h));
          const rows = aoa
            .slice(1)
            .filter((r) => r.some((c) => String(c).trim() !== ''));
          const res = mapParsedRows(headers, rows);
          if (!res.valid.length && !res.invalid.length)
            setError('No se encontraron filas de datos en el Excel.');
          else setParsed(res);
        } catch (err) {
          setError(err.message || 'No se pudo leer el Excel.');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => {
        try {
          const res = mapImportRows(reader.result);
          if (!res.valid.length && !res.invalid.length)
            setError('No se encontraron filas de datos en el archivo.');
          else setParsed(res);
        } catch (err) {
          setError(err.message || 'No se pudo leer el archivo.');
        }
      };
      reader.readAsText(file, 'UTF-8');
    }
  };

  const confirm = async () => {
    if (!parsed || !parsed.valid.length) return;
    setBusy(true);
    try {
      const n = await onImport(parsed.valid, dest);
      setDone(n);
    } catch (err) {
      setError('Error al importar: ' + (err && (err.code || err.message)));
    }
    setBusy(false);
  };

  const box = {
    background: P.cd,
    borderRadius: mob ? '22px 22px 0 0' : 22,
    padding: mob ? '18px 16px 28px' : 26,
    width: '100%',
    maxWidth: mob ? '100%' : 480,
    maxHeight: mob ? '92vh' : '88vh',
    overflowY: 'auto',
  };
  const btn = (bg, color) => ({
    flex: 1,
    background: bg,
    border: bg === P.c2 ? `1px solid ${P.bd}` : 'none',
    color,
    padding: '12px',
    borderRadius: 14,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(42,38,33,0.25)',
        display: 'flex',
        alignItems: mob ? 'flex-end' : 'center',
        justifyContent: 'center',
        zIndex: 200,
        backdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
    >
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
          📥 Importar movimientos
        </div>

        {done !== null ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 600, margin: '10px 0' }}>
              {done} movimiento{done === 1 ? '' : 's'} importado
              {done === 1 ? '' : 's'}
            </div>
            <button onClick={onClose} style={btn(P.ac, '#fff')}>
              Listo
            </button>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 12, color: P.sb, margin: '6px 0 14px' }}>
              Subí un archivo <b>Excel (.xlsx)</b> o <b>CSV</b> con columnas{' '}
              <b>fecha</b> y <b>monto</b> (más tipo, categoría, descripción,
              moneda y medio de pago si tenés).
            </p>

            <label
              style={{
                display: 'block',
                border: `1.5px dashed ${P.bd}`,
                borderRadius: 12,
                padding: '18px',
                textAlign: 'center',
                cursor: 'pointer',
                background: P.c2,
                fontSize: 13,
                color: P.tx,
                marginBottom: 14,
              }}
            >
              {fileName ? `📄 ${fileName}` : '📂 Elegí un archivo Excel o CSV'}
              <input
                type="file"
                accept=".csv,.txt,.xlsx,.xls,text/csv"
                onChange={handleFile}
                style={{ display: 'none' }}
              />
            </label>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: P.sb, marginBottom: 6 }}>
                Importar a:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[{ id: 'personal', name: '👤 Personal' }].concat(
                  groups.map((g) => ({ id: g.id, name: '👥 ' + g.name }))
                ).map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setDest(d.id)}
                    style={{
                      background: dest === d.id ? P.ac : P.c2,
                      color: dest === d.id ? '#fff' : P.tx,
                      border: `1px solid ${dest === d.id ? P.ac : P.bd}`,
                      borderRadius: 10,
                      padding: '7px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div
                style={{
                  background: P.rd + '14',
                  color: P.rd,
                  borderRadius: 10,
                  padding: '10px 12px',
                  fontSize: 12,
                  marginBottom: 12,
                }}
              >
                ⚠️ {error}
              </div>
            )}

            {parsed && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  <b style={{ color: P.gn }}>{parsed.valid.length}</b> listos
                  para importar
                  {parsed.invalid.length > 0 && (
                    <>
                      {' · '}
                      <b style={{ color: P.rd }}>{parsed.invalid.length}</b> con
                      error
                    </>
                  )}
                </div>

                {parsed.valid.slice(0, 6).map((t, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 12,
                      padding: '5px 0',
                      borderBottom: `1px solid ${P.bd}`,
                      color: P.tx,
                    }}
                  >
                    <span>
                      {t.type === 'gasto' ? '📉' : '📈'} {t.date} · {t.cat}
                    </span>
                    <span style={{ fontWeight: 600 }}>
                      {fmt(t.amt, t.cur)}
                    </span>
                  </div>
                ))}
                {parsed.valid.length > 6 && (
                  <div style={{ fontSize: 11, color: P.sb, paddingTop: 6 }}>
                    …y {parsed.valid.length - 6} más
                  </div>
                )}

                {parsed.invalid.length > 0 && (
                  <div style={{ fontSize: 11, color: P.sb, marginTop: 10 }}>
                    Filas omitidas:{' '}
                    {parsed.invalid
                      .slice(0, 5)
                      .map((r) => `#${r.rowNum} (${r.reason})`)
                      .join(', ')}
                    {parsed.invalid.length > 5 ? '…' : ''}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={btn(P.c2, P.tx)}>
                Cancelar
              </button>
              <button
                onClick={confirm}
                disabled={busy || !parsed || !parsed.valid.length}
                style={{
                  ...btn(P.ac, '#fff'),
                  opacity: busy || !parsed || !parsed.valid.length ? 0.5 : 1,
                  cursor:
                    busy || !parsed || !parsed.valid.length
                      ? 'default'
                      : 'pointer',
                }}
              >
                {busy
                  ? 'Importando…'
                  : parsed
                  ? `Importar ${parsed.valid.length}`
                  : 'Importar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── LISTA DE MOVIMIENTOS + FILTROS ── */
function TxListTab({ mob, cur, activeTx, onEdit, customCats, onAdd }) {
  const [filter, setFilter] = useState('todos');
  const [quick, setQuick] = useState('todo');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const activeCount =
    (filter !== 'todos' ? 1 : 0) +
    (quick !== 'todo' ? 1 : 0) +
    (from ? 1 : 0) +
    (to ? 1 : 0) +
    (search.trim() ? 1 : 0) +
    (min ? 1 : 0) +
    (max ? 1 : 0);

  const reset = () => {
    setFilter('todos');
    setQuick('todo');
    setFrom('');
    setTo('');
    setSearch('');
    setMin('');
    setMax('');
  };

  const p2 = (n) => String(n).padStart(2, '0');
  const quickBounds = () => {
    const now = new Date();
    const y = now.getFullYear();
    const mo = now.getMonth();
    const ymd = (d) =>
      `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    if (quick === 'este-mes')
      return [`${y}-${p2(mo + 1)}-01`, `${y}-${p2(mo + 1)}-31`];
    if (quick === 'mes-anterior') {
      const d = new Date(y, mo - 1, 1);
      return [
        `${d.getFullYear()}-${p2(d.getMonth() + 1)}-01`,
        `${d.getFullYear()}-${p2(d.getMonth() + 1)}-31`,
      ];
    }
    if (quick === '30-dias') {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return [ymd(d), ymd(now)];
    }
    if (quick === 'este-anio') return [`${y}-01-01`, `${y}-12-31`];
    return [null, null];
  };

  const [qlo, qhi] = quickBounds();
  const lo = from || qlo;
  const hi = to || qhi;
  const s = search.trim().toLowerCase();

  const items = activeTx
    .filter((t) => t.cur === cur)
    .filter((t) => filter === 'todos' || t.type === filter)
    .filter((t) => !lo || String(t.date) >= lo)
    .filter((t) => !hi || String(t.date) <= hi)
    .filter(
      (t) =>
        !s ||
        `${t.desc || ''} ${t.cat || ''} ${t.sub || ''}`
          .toLowerCase()
          .includes(s)
    )
    .filter((t) => !min || t.amt >= Number(min))
    .filter((t) => !max || t.amt <= Number(max))
    .sort((a, b) => (String(a.date) < String(b.date) ? 1 : -1));

  const groups = {};
  items.forEach((t) => {
    const m = mk(t.date);
    if (!groups[m]) groups[m] = [];
    groups[m].push(t);
  });
  const months = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));

  const pill = (id, l, val, set) => (
    <button
      key={id}
      onClick={() => set(id)}
      style={{
        background: val === id ? P.ac : P.c2,
        color: val === id ? '#fff' : P.tx,
        border: `1px solid ${val === id ? P.ac : P.bd}`,
        borderRadius: 10,
        padding: '7px 11px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {l}
    </button>
  );

  const inp = {
    background: P.c2,
    border: `1px solid ${P.bd}`,
    color: P.tx,
    padding: '9px 11px',
    borderRadius: 10,
    fontSize: 13,
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button
        onClick={() => setShowFilters((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: activeCount > 0 ? P.ac + '14' : P.cd,
          border: `1px solid ${activeCount > 0 ? P.ac : P.bd}`,
          color: activeCount > 0 ? P.ac : P.tx,
          borderRadius: 12,
          padding: '11px 14px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <span>
          🔎 Filtros
          {activeCount > 0 ? ` (${activeCount})` : ''}
        </span>
        <span style={{ fontSize: 11, color: P.sb }}>
          {showFilters ? '▲ ocultar' : '▼ mostrar'}
        </span>
      </button>
      {showFilters && (
      <Box>
        {activeCount > 0 && (
          <div style={{ textAlign: 'right', marginTop: -4, marginBottom: 6 }}>
            <button
              onClick={reset}
              style={{
                background: 'transparent',
                border: 'none',
                color: P.sb,
                fontSize: 11,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              ↺ Limpiar
            </button>
          </div>
        )}
        {/* Tipo */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {pill('todos', 'Todos', filter, setFilter)}
          {pill('ingreso', '📈 Ingresos', filter, setFilter)}
          {pill('gasto', '📉 Gastos', filter, setFilter)}
          {pill('ahorro', '🏦 Ahorro', filter, setFilter)}
        </div>
        {/* Fecha rápida */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            marginBottom: 8,
          }}
        >
          {[
            ['todo', 'Todo'],
            ['este-mes', 'Este mes'],
            ['mes-anterior', 'Mes anterior'],
            ['30-dias', 'Últ. 30 días'],
            ['este-anio', 'Este año'],
          ].map(([id, l]) =>
            pill(id, l, quick, (v) => {
              setQuick(v);
              setFrom('');
              setTo('');
            })
          )}
        </div>
        {/* Buscar */}
        <input
          placeholder="🔍 Buscar concepto, categoría…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inp, marginBottom: 8 }}
        />
        {/* Monto */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            type="number"
            placeholder="Monto mín."
            value={min}
            onChange={(e) => setMin(e.target.value)}
            style={inp}
          />
          <input
            type="number"
            placeholder="Monto máx."
            value={max}
            onChange={(e) => setMax(e.target.value)}
            style={inp}
          />
        </div>
        {/* Rango de fechas */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setQuick('todo');
            }}
            style={inp}
          />
          <span style={{ color: P.sb, fontSize: 12 }}>→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setQuick('todo');
            }}
            style={inp}
          />
        </div>
        <button
          onClick={reset}
          style={{
            marginTop: 10,
            background: 'transparent',
            border: 'none',
            color: P.sb,
            fontSize: 12,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ↺ Restablecer filtros
        </button>
      </Box>
      )}

      <div style={{ fontSize: 11, color: P.sb, textAlign: 'center' }}>
        {items.length} movimiento{items.length === 1 ? '' : 's'} · tocá cualquiera
        para editar
      </div>
      {months.length === 0 ? (
        <Nil
          icon="🔍"
          t="No hay movimientos para mostrar"
          sub="Probá ajustar los filtros, o cargá uno nuevo."
          action="➕ Agregar movimiento"
          onAction={() => onAdd && onAdd('gasto')}
        />
      ) : (
        months.map((m) => {
          const list = groups[m];
          const inSum = list
            .filter((t) => t.type === 'ingreso')
            .reduce((s, t) => s + t.amt, 0);
          const outSum = list
            .filter((t) => t.type === 'gasto')
            .reduce((s, t) => s + t.amt, 0);
          const savSum = list
            .filter((t) => t.type === 'ahorro')
            .reduce((s, t) => s + t.amt, 0);
          return (
            <Box key={m}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {MOF[+m.slice(5) - 1]} {m.slice(0, 4)}
                </span>
                <span style={{ fontSize: 11 }}>
                  {inSum > 0 && (
                    <span style={{ color: P.gn }}>+{fmtS(inSum, cur)} </span>
                  )}
                  {outSum > 0 && (
                    <span style={{ color: P.rd }}>-{fmtS(outSum, cur)} </span>
                  )}
                  {savSum > 0 && (
                    <span style={{ color: P.ac }}>→{fmtS(savSum, cur)}</span>
                  )}
                </span>
              </div>
              {list.map((t) => (
                <TxRow
                  key={t.id}
                  t={t}
                  cur={cur}
                  mob={mob}
                  onClick={() => onEdit(t)}
                  customCats={customCats}
                />
              ))}
            </Box>
          );
        })
      )}
    </div>
  );
}

/* ── HOME ── */
function HomeTab({
  mob,
  cur,
  totIn,
  totOut,
  totSav,
  bal,
  byCat,
  mtx,
  carry = 0,
  budgets,
  onEdit,
  customCats,
  isGroup,
  activeTx = [],
  month,
  onRegister,
  favorites = [],
  onUseFav,
  onRemoveFav,
  pendingTx = [],
  onMarkPaid,
  onAdd,
}) {
  const maxC = byCat.length ? byCat[0][1] : 1;
  const [hoverMonth, setHoverMonth] = useState(null);
  const todayStr = (() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  // Proyección "te queda este mes" (solo si estás viendo el mes actual)
  const isCurrentMonth = month === todayStr.slice(0, 7);
  const daysInMonth = new Date(
    Number((month || todayStr).slice(0, 4)),
    Number((month || todayStr).slice(5, 7)),
    0
  ).getDate();
  const daysLeft = isCurrentMonth
    ? daysInMonth - Number(todayStr.slice(8, 10)) + 1
    : 0;
  const perDay = daysLeft > 0 && bal > 0 ? bal / daysLeft : 0;
  const hasBudgets = Object.keys(budgets || {}).length > 0;

  const [expandedCat, setExpandedCat] = useState(null);

  // Serie mensual (6 meses terminando en el mes visto)
  const months6 = (() => {
    const [y, m] = month.split('-').map(Number);
    const arr = [];
    for (let i = 5; i >= 0; i--) {
      let yy = y;
      let mm = m - i;
      while (mm <= 0) {
        mm += 12;
        yy -= 1;
      }
      arr.push(`${yy}-${String(mm).padStart(2, '0')}`);
    }
    return arr;
  })();
  const monthly = months6.map((mkey) => {
    const items = chargesForMonth(activeTx, mkey).filter(
      (t) => t.cur === cur && !t.pending
    );
    return {
      key: mkey,
      label: MOF[Number(mkey.slice(5, 7)) - 1].slice(0, 3),
      cur: mkey === month,
      in: items
        .filter((t) => t.type === 'ingreso')
        .reduce((s, t) => s + t.amt, 0),
      out: items
        .filter((t) => t.type === 'gasto')
        .reduce((s, t) => s + t.amt, 0),
      sav: items
        .filter((t) => t.type === 'ahorro')
        .reduce((s, t) => s + t.amt, 0),
    };
  });
  const maxMonthly = Math.max(
    1,
    ...monthly.map((m) => Math.max(m.in, m.out, m.sav))
  );

  // Segmentos de categoría (gastos del mes)
  const catSegments = byCat.map(([cat, amt], i) => ({
    cat,
    value: amt,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));
  const totCat = catSegments.reduce((s, x) => s + x.value, 0) || 1;
  const subsOf = (cat) => {
    const m = {};
    mtx
      .filter((t) => t.type === 'gasto' && !t.pending && t.cat === cat)
      .forEach((t) => {
        const k = t.sub || 'Sin subcategoría';
        m[k] = (m[k] || 0) + t.amt;
      });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };

  // Presupuestos (gastado vs límite)
  const budgetRows = Object.entries(budgets || {})
    .map(([cat, pct]) => {
      const spent = (byCat.find(([c]) => c === cat) || [null, 0])[1];
      const lim = totIn * (pct / 100);
      return { cat, spent, lim, pct: lim > 0 ? (spent / lim) * 100 : 0 };
    })
    .filter((r) => r.lim > 0)
    .sort((a, b) => b.pct - a.pct);

  // Tarjetas: cuánto pagás de cada una este mes (suma de cuotas/consumos)
  const byCard = {};
  mtx
    .filter((t) => t.pay === 'credito' && (t.card || t.cardNet) && !t.pending)
    .forEach((t) => {
      const key = [t.cardNet, t.card].filter(Boolean).join(' · ') || 'Tarjeta';
      if (!byCard[key]) byCard[key] = { total: 0, due: null };
      byCard[key].total += t.amt;
      if (t.cardDue) byCard[key].due = t.cardDue;
    });
  const cardRows = Object.entries(byCard).sort(
    (a, b) => b[1].total - a[1].total
  );
  // Próximo vencimiento a partir de un día del mes
  const dueInfo = (day) => {
    if (!day) return null;
    const now = new Date();
    let m = now.getMonth();
    let y = now.getFullYear();
    if (day < now.getDate()) m += 1;
    const dd = new Date(y, m, day);
    const days = Math.round((dd - now) / 86400000);
    return { day, days };
  };

  // Dólares: comprados (cambios) − gastados (gastos en USD) = lo que tenés
  const usdBuys = activeTx.filter((t) => t.usd > 0);
  const usdBought = usdBuys.reduce((s, t) => s + t.usd, 0);
  const usdInvested = usdBuys.reduce((s, t) => s + (t.amt || 0), 0);
  const usdSpent = activeTx
    .filter((t) => t.type === 'gasto' && t.cur === 'USD')
    .reduce((s, t) => s + t.amt, 0);
  const usdHeld = usdBought - usdSpent;
  const usdAvgRate = usdBought > 0 ? usdInvested / usdBought : 0;
  // Pagos recurrentes: una "plantilla" por serie (el movimiento más reciente)
  const recSeries = {};
  activeTx.forEach((t) => {
    if (t.recurring && t.serieId) {
      const prev = recSeries[t.serieId];
      if (!prev || String(t.date) > String(prev.date)) recSeries[t.serieId] = t;
    }
  });
  const recList = Object.values(recSeries).sort((a, b) =>
    (a.desc || a.cat) > (b.desc || b.cat) ? 1 : -1
  );
  const doneThisMonth = (serieId) =>
    activeTx.some((t) => t.serieId === serieId && mk(t.date) === month);
  const freqLabel = {
    mensual: 'mensual',
    semanal: 'semanal',
    quincenal: 'quincenal',
    anual: 'anual',
  };
  // Resumen por persona (solo grupo)
  const byMember = {};
  if (isGroup) {
    mtx.forEach((t) => {
      const who = t.member || t.createdByName || '—';
      if (!byMember[who]) byMember[who] = { ingreso: 0, gasto: 0, ahorro: 0 };
      byMember[who][t.type] = (byMember[who][t.type] || 0) + t.amt;
    });
  }
  const memberRows = Object.entries(byMember).sort(
    (a, b) => b[1].gasto + b[1].ingreso - (a[1].gasto + a[1].ingreso)
  );
  const alerts = [];
  byCat.forEach(([cat, amt]) => {
    const p = budgets[cat];
    if (p) {
      const lim = totIn * (p / 100);
      if (amt >= lim * 0.8)
        alerts.push({ cat, amt, lim, pct: p, over: amt >= lim });
    }
  });

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: mob ? 10 : 14 }}
    >
      {favorites.length > 0 && (
        <Box>
          <Lbl>⭐ Favoritos · carga rápida</Lbl>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {favorites.map((f, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: P.c2,
                  border: `1px solid ${P.bd}`,
                  borderRadius: 10,
                  overflow: 'hidden',
                }}
              >
                <button
                  onClick={() => onUseFav(f)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: P.tx,
                    padding: '7px 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {f.type === 'ingreso'
                    ? '📈'
                    : f.type === 'ahorro'
                    ? '🏦'
                    : '📉'}{' '}
                  {f.desc || f.sub || f.cat}
                  {f.amt ? ` · ${fmtS(f.amt, f.cur)}` : ''}
                </button>
                <span
                  onClick={() => onRemoveFav(i)}
                  title="Quitar favorito"
                  style={{
                    cursor: 'pointer',
                    color: P.sb,
                    padding: '7px 8px',
                    fontSize: 11,
                    borderLeft: `1px solid ${P.bd}`,
                  }}
                >
                  ✕
                </span>
              </div>
            ))}
          </div>
        </Box>
      )}
      {pendingTx.length > 0 && (
        <Box>
          <Lbl>📅 Por pagar (programados)</Lbl>
          {pendingTx.map((t) => {
            const overdue = String(t.date) <= todayStr;
            return (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: `1px solid ${P.bd}`,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.desc || t.sub || t.cat}
                  </div>
                  <div
                    style={{ fontSize: 10, color: overdue ? P.rd : P.sb }}
                  >
                    {fmtS(t.amt, t.cur)} · {overdue ? 'venció' : 'vence'}{' '}
                    {new Date(
                      String(t.date).slice(0, 10) + 'T00:00:00'
                    ).toLocaleDateString('es-AR', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </div>
                </div>
                <button
                  onClick={() => onMarkPaid(t)}
                  style={{
                    background: P.gn,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 9,
                    padding: '6px 11px',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  ✓ Pagado
                </button>
              </div>
            );
          })}
        </Box>
      )}
      {alerts.map((a) => (
        <div
          key={a.cat}
          style={{
            background: a.over ? P.rb : P.amb,
            border: `1px solid ${a.over ? P.rd : P.am}18`,
            borderRadius: 12,
            padding: '8px 12px',
            fontSize: 11,
          }}
        >
          {a.over ? '🚨' : '⚠️'} <b>{a.cat}</b> ({a.pct}%):{' '}
          {a.over
            ? `superaste ${fmt(a.lim, cur)}`
            : `al ${Math.round((a.amt / a.lim) * 100)}%`}
        </div>
      ))}
      {/* ── HÉROE: balance del mes (order:-1 = primero) ── */}
      <Box
        style={{
          background: `linear-gradient(135deg,${P.ac}0E,${P.gn}0A)`,
          padding: mob ? 18 : 22,
          order: -1,
        }}
      >
        <Lbl>Balance de {MOF[Number(month.slice(5, 7)) - 1]}</Lbl>
        <div
          style={{
            fontSize: mob ? 34 : 42,
            fontWeight: 700,
            color: bal >= 0 ? P.gn : P.rd,
            lineHeight: 1.05,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fmt(bal, cur)}
        </div>
        <div style={{ fontSize: 12, color: P.sb, marginTop: 3 }}>
          {bal >= 0
            ? 'Disponible este mes'
            : 'Este mes gastaste más de lo que ingresó'}
        </div>
        {carry !== 0 && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: P.tx,
              background: P.cd,
              borderRadius: 10,
              padding: '7px 10px',
            }}
          >
            👜 Venías con{' '}
            <b style={{ color: carry >= 0 ? P.gn : P.rd }}>
              {fmtS(carry, cur)}
            </b>{' '}
            de meses anteriores · disponible total{' '}
            <b style={{ color: bal + carry >= 0 ? P.gn : P.rd }}>
              {fmtS(bal + carry, cur)}
            </b>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 14,
            borderTop: `1px solid ${P.bd}`,
            paddingTop: 12,
          }}
        >
          {[
            ['Ingresos', totIn, P.gn],
            ['Gastos', totOut, P.rd],
            ['Ahorro', totSav, P.ac],
          ].map(([l, v, c]) => (
            <div key={l} style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10,
                  color: P.sb,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  fontWeight: 600,
                }}
              >
                {l}
              </div>
              <div
                style={{
                  fontSize: mob ? 16 : 19,
                  fontWeight: 700,
                  color: c,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {fmtS(v, cur)}
              </div>
            </div>
          ))}
        </div>

        {isCurrentMonth && bal > 0 && daysLeft > 0 && (
          <div
            style={{
              marginTop: 12,
              background: P.cd,
              borderRadius: 12,
              padding: '10px 12px',
              fontSize: 12,
              color: P.tx,
            }}
          >
            🔔 Te quedan <b>{fmtS(bal, cur)}</b> para {daysLeft} día
            {daysLeft === 1 ? '' : 's'} · ~{fmtS(perDay, cur)}/día
          </div>
        )}

        {hasBudgets && (
          <div style={{ marginTop: 12 }}>
            <Bar
              pct={totIn > 0 ? (totOut / totIn) * 100 : 0}
              color={totOut / totIn > 0.8 ? P.rd : P.ac}
            />
            <div style={{ fontSize: 11, color: P.sb, marginTop: 5 }}>
              Gastaste el {totIn > 0 ? Math.round((totOut / totIn) * 100) : 0}%
              de lo que ingresó
            </div>
          </div>
        )}
      </Box>
      {recList.length > 0 && (
        <Box>
          <Lbl>🔁 Pagos recurrentes</Lbl>
          {recList.map((t) => {
            const done = doneThisMonth(t.serieId);
            return (
              <div
                key={t.serieId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: `1px solid ${P.bd}`,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.desc || t.sub || t.cat}
                  </div>
                  <div style={{ fontSize: 10, color: P.sb }}>
                    {fmtS(t.amt, t.cur)} · {freqLabel[t.freq] || 'mensual'}
                  </div>
                </div>
                {done ? (
                  <span
                    style={{
                      fontSize: 11,
                      color: P.gn,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    ✓ cargado
                  </span>
                ) : (
                  <button
                    onClick={() => onRegister(t)}
                    style={{
                      background: P.ac,
                      color: '#fff',
                      border: 'none',
                      borderRadius: 9,
                      padding: '6px 11px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    Registrar
                  </button>
                )}
              </div>
            );
          })}
        </Box>
      )}
      {/* Ingresos vs Gastos vs Ahorro por mes */}
      <Box>
        <Lbl>Ingresos · Gastos · Ahorro (6 meses)</Lbl>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 6,
            height: 110,
            marginTop: 8,
          }}
        >
          {monthly.map((m) => {
            const active = hoverMonth === m.key;
            return (
              <div
                key={m.key}
                onMouseEnter={() => setHoverMonth(m.key)}
                onMouseLeave={() => setHoverMonth(null)}
                onClick={() => setHoverMonth(active ? null : m.key)}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  position: 'relative',
                  cursor: 'pointer',
                }}
              >
                {active && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 100,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: P.tx,
                      color: '#fff',
                      borderRadius: 8,
                      padding: '6px 9px',
                      fontSize: 10,
                      lineHeight: 1.5,
                      whiteSpace: 'nowrap',
                      zIndex: 20,
                      boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
                      pointerEvents: 'none',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>
                      {m.label}
                    </div>
                    <div>
                      <span style={{ color: '#8FD3B6' }}>■</span> Ingresos{' '}
                      {fmt(m.in, cur)}
                    </div>
                    <div>
                      <span style={{ color: '#E79A95' }}>■</span> Gastos{' '}
                      {fmt(m.out, cur)}
                    </div>
                    <div>
                      <span style={{ color: '#9FBCDC' }}>■</span> Ahorro{' '}
                      {fmt(m.sav, cur)}
                    </div>
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 3,
                    height: 90,
                    opacity: hoverMonth && !active ? 0.45 : 1,
                    transition: 'opacity 0.12s',
                  }}
                >
                  <div
                    style={{
                      width: 9,
                      height: `${Math.max(2, (m.in / maxMonthly) * 100)}%`,
                      background: P.gn,
                      borderRadius: '3px 3px 0 0',
                    }}
                  />
                  <div
                    style={{
                      width: 9,
                      height: `${Math.max(2, (m.out / maxMonthly) * 100)}%`,
                      background: P.rd,
                      borderRadius: '3px 3px 0 0',
                    }}
                  />
                  <div
                    style={{
                      width: 9,
                      height: `${Math.max(2, (m.sav / maxMonthly) * 100)}%`,
                      background: P.ac,
                      borderRadius: '3px 3px 0 0',
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 9,
                    color: m.cur ? P.ac : P.sb,
                    fontWeight: m.cur ? 700 : 500,
                  }}
                >
                  {m.label}
                </span>
              </div>
            );
          })}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 14,
            justifyContent: 'center',
            marginTop: 8,
            fontSize: 10,
            color: P.sb,
          }}
        >
          <span>
            <span style={{ color: P.gn }}>■</span> Ingresos
          </span>
          <span>
            <span style={{ color: P.rd }}>■</span> Gastos
          </span>
          <span>
            <span style={{ color: P.ac }}>■</span> Ahorro
          </span>
        </div>
      </Box>

      {/* Gastos por categoría (dona + subcategorías) */}
      <Box>
        <Lbl>Gastos por categoría</Lbl>
        {byCat.length === 0 ? (
          <Nil
            icon="📭"
            t="Sin gastos este mes"
            sub="Cuando cargues gastos, vas a ver acá la dona por categoría."
            action="➕ Agregar gasto"
            onAction={() => onAdd && onAdd('gasto')}
          />
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                marginBottom: 6,
              }}
            >
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <Donut segments={catSegments} size={mob ? 110 : 130} />
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span style={{ fontSize: 9, color: P.sb }}>Total</span>
                  <span
                    style={{ fontSize: 13, fontWeight: 700, color: P.rd }}
                  >
                    {fmtS(totCat, cur)}
                  </span>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {catSegments.slice(0, 5).map((s) => (
                  <div
                    key={s.cat}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      padding: '2px 0',
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: s.color,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.cat}
                    </span>
                    <span style={{ color: P.sb }}>
                      {Math.round((s.value / totCat) * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {catSegments.map((s) => {
              const cd = getCats('gasto', customCats).find(
                (c) => c.n === s.cat
              );
              const open = expandedCat === s.cat;
              return (
                <div key={s.cat} style={{ borderTop: `1px solid ${P.bd}` }}>
                  <div
                    onClick={() => setExpandedCat(open ? null : s.cat)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 0',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 500 }}>
                      <span style={{ color: s.color }}>●</span> {cd?.i} {s.cat}
                    </span>
                    <span
                      style={{ fontSize: 12, fontWeight: 600, color: P.rd }}
                    >
                      {fmtS(s.value, cur)}{' '}
                      <span style={{ color: P.sb, fontSize: 10 }}>
                        {open ? '▲' : '▼'}
                      </span>
                    </span>
                  </div>
                  {open && (
                    <div style={{ paddingBottom: 8 }}>
                      {subsOf(s.cat).map(([sub, amt]) => (
                        <div
                          key={sub}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 11,
                            color: P.sb,
                            padding: '3px 0 3px 16px',
                          }}
                        >
                          <span>{sub}</span>
                          <span>{fmtS(amt, cur)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </Box>

      {/* Gastos vs Presupuesto */}
      {budgetRows.length > 0 && (
        <Box>
          <Lbl>Gastos vs Presupuesto</Lbl>
          {budgetRows.map((r) => {
            const cd = getCats('gasto', customCats).find((c) => c.n === r.cat);
            const over = r.pct >= 100;
            const near = r.pct >= 80;
            const col = over ? P.rd : near ? P.am : P.gn;
            return (
              <div key={r.cat} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    marginBottom: 3,
                  }}
                >
                  <span style={{ fontWeight: 500 }}>
                    {cd?.i} {r.cat}
                  </span>
                  <span style={{ color: col, fontWeight: 600 }}>
                    {fmtS(r.spent, cur)} / {fmtS(r.lim, cur)}
                  </span>
                </div>
                <Bar pct={Math.min(r.pct, 100)} color={col} />
              </div>
            );
          })}
        </Box>
      )}
      {cardRows.length > 0 && (
        <Box>
          <Lbl>💳 Tarjetas · a pagar este mes</Lbl>
          {cardRows.map(([name, info]) => {
            const d = dueInfo(info.due);
            return (
              <div
                key={name}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '7px 0',
                  borderBottom: `1px solid ${P.bd}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    💳 {name}
                  </div>
                  {d && (
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: d.days <= 3 ? P.rd : P.sb,
                        marginTop: 1,
                      }}
                    >
                      📅 vence el {d.day}
                      {d.days === 0
                        ? ' · ¡hoy!'
                        : d.days === 1
                        ? ' · mañana'
                        : ` · en ${d.days} días`}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: P.rd }}>
                  {fmtS(info.total, cur)}
                </span>
              </div>
            );
          })}
          <div style={{ fontSize: 10, color: P.sb, marginTop: 6 }}>
            Suma de consumos y cuotas del mes. No cargues aparte el pago del
            resumen (sería duplicar).
          </div>
        </Box>
      )}
      {usdBought > 0 && (
        <Box>
          <Lbl>💵 Dólares que tenés</Lbl>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: P.ac }}>
                US$ {usdHeld.toLocaleString('es-AR')}
              </div>
              <div style={{ fontSize: 11, color: P.sb, marginTop: 2 }}>
                compraste US$ {usdBought.toLocaleString('es-AR')}
                {usdSpent > 0
                  ? ` · gastaste US$ ${usdSpent.toLocaleString('es-AR')}`
                  : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: P.sb }}>COTIZ. PROMEDIO</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: P.tx }}>
                ${Math.round(usdAvgRate).toLocaleString('es-AR')}
              </div>
            </div>
          </div>
        </Box>
      )}
      {isGroup && memberRows.length > 0 && (
        <Box>
          <Lbl>Por persona (este mes)</Lbl>
          {memberRows.map(([name, v]) => (
            <div
              key={name}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '7px 0',
                borderBottom: `1px solid ${P.bd}`,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>👤 {name}</span>
              <span style={{ fontSize: 11 }}>
                {v.ingreso > 0 && (
                  <span style={{ color: P.gn }}>+{fmtS(v.ingreso, cur)} </span>
                )}
                {v.gasto > 0 && (
                  <span style={{ color: P.rd }}>-{fmtS(v.gasto, cur)} </span>
                )}
                {v.ahorro > 0 && (
                  <span style={{ color: P.ac }}>→{fmtS(v.ahorro, cur)}</span>
                )}
              </span>
            </div>
          ))}
        </Box>
      )}
      <Box>
        <Lbl>Últimos movimientos</Lbl>
        {mtx.length === 0 ? (
          <Nil
            icon="✨"
            t="Todavía no cargaste movimientos"
            sub="Empezá registrando tu primer gasto o ingreso."
            action="➕ Agregar movimiento"
            onAction={() => onAdd && onAdd('gasto')}
          />
        ) : (
          [...mtx]
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 6)
            .map((t) => (
              <TxRow
                key={t.id}
                t={t}
                cur={cur}
                mob={mob}
                onClick={() => onEdit(t)}
                customCats={customCats}
              />
            ))
        )}
      </Box>
    </div>
  );
}

function TxRow({ t, cur, mob, onClick, customCats }) {
  const cd = getCats(t.type, customCats).find((c) => c.n === t.cat);
  const isIn = t.type === 'ingreso';
  const isSav = t.type === 'ahorro';
  const isCambio = t.type === 'cambio';
  const rowColor = isIn ? P.gn : isSav || isCambio ? P.ac : P.rd;
  const rowBg = isIn ? P.gb : isSav || isCambio ? P.ac + '1A' : P.rb;
  const rowSign = isIn ? '+' : isCambio ? '💱 ' : isSav ? '→ ' : '−';
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: mob ? '9px 4px' : '10px 8px',
        borderRadius: 12,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: mob ? 8 : 10,
          minWidth: 0,
          flex: 1,
        }}
      >
        <div
          style={{
            width: mob ? 34 : 38,
            height: mob ? 34 : 38,
            borderRadius: 11,
            background: rowBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: mob ? 14 : 16,
            flexShrink: 0,
          }}
        >
          {cd?.i || '📌'}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: mob ? 12 : 13,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t.recurring && (
              <span title="Pago recurrente" style={{ color: P.ac }}>
                🔁{' '}
              </span>
            )}
            {t.pending && (
              <span title="Programado · pendiente de pago" style={{ color: P.am }}>
                📅{' '}
              </span>
            )}
            {(t.cuotaInfo || t.cuotas > 1) && (
              <span
                title="Compra en cuotas"
                style={{
                  fontSize: 9,
                  color: P.sb,
                  background: P.c2,
                  borderRadius: 4,
                  padding: '1px 4px',
                  marginRight: 3,
                }}
              >
                💳 {t.cuotaInfo || `${t.cuotas} cuotas`}
              </span>
            )}
            {t.desc || t.sub || t.cat}
          </div>
          <div style={{ fontSize: 10, color: P.sb }}>
            {t.cat}
            {t.member || t.createdByName
              ? ` · ${t.member || t.createdByName}`
              : ''}{' '}
            ·{' '}
            {new Date(String(t.date).slice(0, 10) + 'T00:00:00').toLocaleDateString('es-AR', {
              day: 'numeric',
              month: 'short',
            })}
          </div>
        </div>
      </div>
      <span
        style={{
          fontSize: mob ? 12 : 14,
          fontWeight: 600,
          color: rowColor,
          flexShrink: 0,
        }}
      >
        {rowSign}
        {mob ? fmtS(t.amt, cur) : fmt(t.amt, cur)}
      </span>
    </div>
  );
}

/* ── INSIGHTS ── */
function useCountUp(target, ms = 650) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf,
      start = null;
    const from = 0;
    const step = (t) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function InsightsTab({
  mob,
  cur,
  activeTx,
  month,
  byCat,
  totIn,
  totOut,
  totSav = 0,
  carry = 0,
  isGroup = false,
  mtx,
  budgets,
  saveBudgets,
  onAdd,
}) {
  const total = byCat.reduce((s, [, a]) => s + a, 0);
  // Por persona (solo grupo)
  const byMember = {};
  if (isGroup) {
    mtx
      .filter((t) => !t.pending && t.cur === cur)
      .forEach((t) => {
        const who = t.member || t.createdByName || '—';
        if (!byMember[who])
          byMember[who] = { ingreso: 0, gasto: 0, ahorro: 0 };
        if (byMember[who][t.type] != null)
          byMember[who][t.type] += t.amt;
      });
  }
  const memberRows = Object.entries(byMember).sort(
    (a, b) => b[1].gasto + b[1].ingreso - (a[1].gasto + a[1].ingreso)
  );
  const pctOf = (v, tot) => (tot > 0 ? Math.round((v / tot) * 100) : 0);
  const [bCat, setBCat] = useState('');
  const [bPct, setBPct] = useState('');
  const [anim, setAnim] = useState(false);
  useEffect(() => {
    setAnim(false);
    const t = setTimeout(() => setAnim(true), 40);
    return () => clearTimeout(t);
  }, [month, cur]);
  const cIn = useCountUp(totIn);
  const cOut = useCountUp(totOut);
  const cSav = useCountUp(totSav);
  const cBal = totIn - totOut - totSav;
  const trend = useMemo(() => {
    const ms = [];
    let [y, m] = month.split('-').map(Number);
    for (let i = 5; i >= 0; i--) {
      let my = m - i,
        yy = y;
      while (my <= 0) {
        my += 12;
        yy--;
      }
      const k = `${yy}-${String(my).padStart(2, '0')}`;
      const t2 = activeTx.filter((t) => mk(t.date) === k && t.cur === cur);
      ms.push({
        l: MO[my - 1],
        inc: t2
          .filter((t) => t.type === 'ingreso')
          .reduce((s, t) => s + t.amt, 0),
        exp: t2
          .filter((t) => t.type === 'gasto')
          .reduce((s, t) => s + t.amt, 0),
      });
    }
    return ms;
  }, [activeTx, month, cur]);
  const maxT = Math.max(...trend.map((t) => Math.max(t.inc, t.exp)), 1);

  const cards = [
    { l: 'Ingresos', v: cIn, c: P.gn, bg: P.gb, e: '📈' },
    { l: 'Gastos', v: cOut, c: P.rd, bg: P.rb, e: '📉' },
    { l: 'Ahorro', v: cSav, c: P.ac, bg: P.ab, e: '🏦' },
  ];

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: mob ? 10 : 14 }}
    >
      {/* Resumen del mes */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: mob ? 6 : 10,
        }}
      >
        {cards.map((c) => (
          <div
            key={c.l}
            style={{
              background: c.bg,
              border: `1px solid ${c.c}33`,
              borderRadius: 14,
              padding: mob ? '10px 8px' : '12px 14px',
            }}
          >
            <div style={{ fontSize: mob ? 10 : 11, color: P.sb }}>
              {c.e} {c.l}
            </div>
            <div
              style={{
                fontSize: mob ? 14 : 18,
                fontWeight: 700,
                color: c.c,
                marginTop: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {fmtS(Math.round(c.v), cur)}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          textAlign: 'center',
          fontSize: 12,
          color: P.sb,
          marginTop: -4,
        }}
      >
        Balance del mes:{' '}
        <b style={{ color: cBal >= 0 ? P.gn : P.rd }}>{fmtS(cBal, cur)}</b>
        {carry !== 0 && (
          <span>
            {' · '}venías con{' '}
            <b style={{ color: carry >= 0 ? P.gn : P.rd }}>
              {fmtS(carry, cur)}
            </b>{' '}
            → disponible{' '}
            <b style={{ color: cBal + carry >= 0 ? P.gn : P.rd }}>
              {fmtS(cBal + carry, cur)}
            </b>
          </span>
        )}
      </div>

      {cBal + carry > 0 && (
        <Box
          style={{
            background: `linear-gradient(135deg,${P.gn}12,${P.ac}0A)`,
            border: `1px solid ${P.gn}22`,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, color: P.tx }}>
            💰 Te quedan {fmtS(cBal + carry, cur)} para gastar o ahorrar
          </div>
          <div style={{ fontSize: 12, color: P.sb, marginTop: 2 }}>
            ¿Qué vas a hacer con ellos? 👀
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={() => onAdd && onAdd('ahorro')}
              style={{
                flex: 1,
                background: P.ac,
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                padding: '10px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🏦 Ahorrar una parte
            </button>
            <button
              onClick={() => onAdd && onAdd('gasto')}
              style={{
                flex: 1,
                background: 'transparent',
                color: P.tx,
                border: `1px solid ${P.bd}`,
                borderRadius: 12,
                padding: '10px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              📉 Registrar un gasto
            </button>
          </div>
        </Box>
      )}

      {isGroup && memberRows.length > 0 && (
        <Box>
          <Lbl>👥 Por persona (este mes)</Lbl>
          {memberRows.map(([name, v]) => (
            <div
              key={name}
              style={{
                padding: '8px 0',
                borderBottom: `1px solid ${P.bd}`,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 5,
                }}
              >
                <span>👤 {name}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  flexWrap: 'wrap',
                  fontSize: 11,
                }}
              >
                {[
                  ['Ingresó', v.ingreso, totIn, P.gn, 'del total del grupo'],
                  ['Gastó', v.gasto, v.ingreso, P.rd, 'de lo que ingresó'],
                  ['Ahorró', v.ahorro, v.ingreso, P.ac, 'de lo que ingresó'],
                ].map(([lbl, val, base, col, suf]) => (
                  <div
                    key={lbl}
                    style={{
                      flex: 1,
                      minWidth: 90,
                      background: P.c2,
                      borderRadius: 8,
                      padding: '6px 8px',
                    }}
                  >
                    <div style={{ color: P.sb, fontSize: 10 }}>{lbl}</div>
                    <div style={{ fontWeight: 700, color: col }}>
                      {fmtS(val, cur)}
                    </div>
                    <div style={{ color: P.sb, fontSize: 10 }}>
                      {base > 0 ? `${pctOf(val, base)}% ${suf}` : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 10, color: P.sb, marginTop: 6 }}>
            "Ingresó" = % que aportó al total del grupo. "Gastó" y "Ahorró" = %
            sobre lo que ingresó esa persona.
          </div>
        </Box>
      )}

      <Box>
        <Lbl>Tendencia 6 meses</Lbl>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: mob ? 4 : 10,
            height: 120,
            marginTop: 8,
          }}
        >
          {trend.map((t, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 2,
                  alignItems: 'flex-end',
                  height: 100,
                  width: '100%',
                }}
              >
                <div
                  title={`Ingresos ${fmt(t.inc, cur)}`}
                  style={{
                    flex: 1,
                    background: P.gn,
                    borderRadius: '3px 3px 0 0',
                    height: anim ? `${Math.max(3, (t.inc / maxT) * 100)}%` : '3%',
                    opacity: i === trend.length - 1 ? 1 : 0.7,
                    transition: 'height 0.6s cubic-bezier(.22,1,.36,1)',
                  }}
                />
                <div
                  title={`Gastos ${fmt(t.exp, cur)}`}
                  style={{
                    flex: 1,
                    background: P.rd,
                    borderRadius: '3px 3px 0 0',
                    height: anim ? `${Math.max(3, (t.exp / maxT) * 100)}%` : '3%',
                    opacity: i === trend.length - 1 ? 1 : 0.7,
                    transition: 'height 0.6s cubic-bezier(.22,1,.36,1)',
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 9,
                  color: i === trend.length - 1 ? P.ac : P.sb,
                  fontWeight: i === trend.length - 1 ? 700 : 500,
                }}
              >
                {t.l}
              </span>
            </div>
          ))}
        </div>
      </Box>
      <Box>
        <Lbl>Distribución</Lbl>
        {byCat.length === 0 ? (
          <Nil
            icon="📊"
            t="Todavía no hay datos para analizar"
            sub="Cargá algunos gastos y acá vas a ver tus análisis."
          />
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: mob ? 'column' : 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: mob ? 12 : 24,
              marginTop: 8,
            }}
          >
            <svg
              viewBox="0 0 200 200"
              width={mob ? 120 : 140}
              height={mob ? 120 : 140}
            >
              {(() => {
                let cum = -90;
                return byCat.map(([cat, amt], i) => {
                  const p = amt / total,
                    ang = p * 360,
                    st = cum;
                  cum += ang;
                  const r = 80,
                    cx = 100,
                    cy = 100,
                    lg = ang > 180 ? 1 : 0,
                    sr = (st * Math.PI) / 180,
                    er = ((st + ang) * Math.PI) / 180;
                  return (
                    <path
                      key={cat}
                      d={`M${cx},${cy} L${cx + r * Math.cos(sr)},${
                        cy + r * Math.sin(sr)
                      } A${r},${r} 0 ${lg} 1 ${cx + r * Math.cos(er)},${
                        cy + r * Math.sin(er)
                      } Z`}
                      fill={pal[i % pal.length]}
                      opacity={0.7}
                    />
                  );
                });
              })()}
              <circle cx={100} cy={100} r={48} fill={P.cd} />
              <text
                x={100}
                y={97}
                textAnchor="middle"
                fill={P.tx}
                fontSize={13}
                fontWeight={700}
                fontFamily="'Poppins'"
              >
                {fmtS(total, cur)}
              </text>
              <text
                x={100}
                y={110}
                textAnchor="middle"
                fill={P.sb}
                fontSize={8}
              >
                total
              </text>
            </svg>
            <div>
              {byCat.map(([cat, amt], i) => (
                <div
                  key={cat}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 3,
                      background: pal[i % pal.length],
                      opacity: 0.75,
                    }}
                  />
                  <span style={{ color: P.sb, flex: 1 }}>{cat}</span>
                  <span style={{ fontWeight: 600 }}>
                    {Math.round((amt / total) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Box>
      {Object.keys(budgets).length > 0 && (
        <Box>
          <Lbl>🎯 Presupuesto vs gasto real</Lbl>
          {Object.entries(budgets).map(([cat, pct]) => {
            const budget = (totIn * pct) / 100;
            const spent = byCat.find(([c]) => c === cat)?.[1] || 0;
            const ratio = budget > 0 ? spent / budget : 0;
            const col = ratio > 1 ? P.rd : ratio >= 0.8 ? P.am : P.gn;
            return (
              <div key={cat} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    marginBottom: 3,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{cat}</span>
                  <span style={{ color: P.sb }}>
                    <b style={{ color: col }}>{fmtS(spent, cur)}</b> /{' '}
                    {fmtS(budget, cur)}
                  </span>
                </div>
                <div
                  style={{
                    height: 9,
                    background: P.c2,
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: anim
                        ? `${Math.min(100, ratio * 100)}%`
                        : '0%',
                      background: col,
                      borderRadius: 6,
                      transition: 'width 0.7s cubic-bezier(.22,1,.36,1)',
                    }}
                  />
                </div>
                <div style={{ fontSize: 10, color: col, marginTop: 2 }}>
                  {ratio > 1
                    ? `Te pasaste ${fmtS(spent - budget, cur)} 🔴`
                    : ratio >= 0.8
                    ? `Vas al ${Math.round(ratio * 100)}% ⚠️`
                    : `Usaste el ${Math.round(ratio * 100)}% ✅`}
                </div>
              </div>
            );
          })}
          <div style={{ fontSize: 10, color: P.sb, marginTop: 2 }}>
            El presupuesto se calcula como % de tus ingresos del mes.
          </div>
        </Box>
      )}
      <Box>
        <Lbl>Presupuesto por categoría (%)</Lbl>
        <div
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}
        >
          <select
            value={bCat}
            onChange={(e) => setBCat(e.target.value)}
            style={{
              flex: 1,
              minWidth: 120,
              background: P.c2,
              border: `1px solid ${P.bd}`,
              color: P.tx,
              padding: '8px',
              borderRadius: 10,
              fontSize: 12,
            }}
          >
            <option value="">Categoría...</option>
            {CATS.gasto.map((c) => (
              <option key={c.n} value={c.n}>
                {c.i} {c.n}
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder="%"
            value={bPct}
            onChange={(e) => setBPct(e.target.value)}
            style={{
              width: 55,
              background: P.c2,
              border: `1px solid ${P.bd}`,
              color: P.tx,
              padding: '8px',
              borderRadius: 10,
              fontSize: 12,
              textAlign: 'center',
            }}
          />
          <button
            onClick={() => {
              if (bCat && bPct) {
                saveBudgets({ ...budgets, [bCat]: Number(bPct) });
                setBCat('');
                setBPct('');
              }
            }}
            style={{
              background: P.ac,
              border: 'none',
              color: '#fff',
              padding: '8px 14px',
              borderRadius: 10,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            OK
          </button>
        </div>
        {Object.keys(budgets).length > 0 && (
          <div
            style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}
          >
            {Object.entries(budgets).map(([cat, pct]) => (
              <div
                key={cat}
                style={{
                  background: P.c2,
                  borderRadius: 8,
                  padding: '3px 8px',
                  fontSize: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {cat}: {pct}%
                <button
                  onClick={() => {
                    const n = { ...budgets };
                    delete n[cat];
                    saveBudgets(n);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: P.sb,
                    cursor: 'pointer',
                    fontSize: 9,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </Box>
    </div>
  );
}

/* ── GOALS ── */
function GoalsTab({
  mob,
  cur,
  goals,
  addGoal,
  updGoal,
  delGoal,
  totIn,
  totOut,
  savPct,
  setSavPct,
  efund,
  setEfund,
  savings = [],
  setSavings,
  usdHeld = 0,
  usdBuys = [],
  delTx,
}) {
  const [showUsd, setShowUsd] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [gn, setGn] = useState('');
  const [gt, setGt] = useState('');
  const [gi, setGi] = useState('🎯');
  const [addAmt, setAddAmt] = useState({});
  const [showEF, setShowEF] = useState(false);
  // Mis ahorros (saldo inicial / patrimonio)
  const [sN, setSN] = useState('');
  const [sA, setSA] = useState('');
  const [sC, setSC] = useState('ARS');
  const addSaving = () => {
    if (!sN.trim() || !Number(sA)) return;
    setSavings([
      ...savings,
      {
        id: 'sv' + sN + sA + savings.length,
        name: sN.trim(),
        amount: Number(sA),
        cur: sC,
      },
    ]);
    setSN('');
    setSA('');
  };
  const delSaving = (id) => setSavings(savings.filter((s) => s.id !== id));
  const savArs = savings
    .filter((s) => s.cur === 'ARS')
    .reduce((a, s) => a + s.amount, 0);
  const savUsd =
    savings.filter((s) => s.cur === 'USD').reduce((a, s) => a + s.amount, 0) +
    (usdHeld > 0 ? usdHeld : 0);
  const sT = totIn * (savPct / 100);
  const actual = totIn - totOut;
  const ok = actual >= sT;
  const iS = {
    background: P.c2,
    border: `1px solid ${P.bd}`,
    color: P.tx,
    padding: '10px 12px',
    borderRadius: 10,
    fontSize: 13,
  };
  const efMonthly = Object.values(efund.expenses || {}).reduce(
    (s, v) => s + Number(v || 0),
    0
  );
  const efTarget = efMonthly * 6;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: mob ? 10 : 14,
        paddingTop: 8,
      }}
    >
      <Box style={{ background: `linear-gradient(135deg,${P.ac}0E,${P.gn}0A)` }}>
        <Lbl>💰 Mis ahorros (patrimonio)</Lbl>
        <div
          style={{
            display: 'flex',
            gap: 14,
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 10, color: P.sb }}>EN PESOS</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: P.gn }}>
              {fmt(savArs, 'ARS')}
            </div>
          </div>
          {savUsd > 0 && (
            <div>
              <div style={{ fontSize: 10, color: P.sb }}>EN DÓLARES</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: P.ac }}>
                US$ {savUsd.toLocaleString('es-AR')}
              </div>
            </div>
          )}
        </div>
        {savings.map((s) => (
          <div
            key={s.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 0',
              borderTop: `1px solid ${P.bd}`,
            }}
          >
            <span style={{ fontSize: 13 }}>{s.name}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {s.cur === 'USD'
                  ? `US$ ${s.amount.toLocaleString('es-AR')}`
                  : fmt(s.amount, 'ARS')}
              </span>
              <span
                onClick={() => delSaving(s.id)}
                style={{ cursor: 'pointer', color: P.sb, fontSize: 12 }}
              >
                ✕
              </span>
            </span>
          </div>
        ))}
        {usdHeld > 0 && (
          <div style={{ borderTop: `1px solid ${P.bd}` }}>
            <div
              onClick={() => setShowUsd((v) => !v)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                fontSize: 12,
                color: P.sb,
                cursor: usdBuys.length ? 'pointer' : 'default',
              }}
            >
              <span>
                Dólares comprados en la app{' '}
                {usdBuys.length > 0 && (showUsd ? '▾' : '▸')}
              </span>
              <span>US$ {usdHeld.toLocaleString('es-AR')}</span>
            </div>
            {showUsd &&
              usdBuys.map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '5px 0 5px 12px',
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: P.sb }}>
                    {(t.date || '').slice(8, 10)}/{(t.date || '').slice(5, 7)} ·
                    US$ {Number(t.usd).toLocaleString('es-AR')}
                    {t.rate ? ` @ $${Number(t.rate).toLocaleString('es-AR')}` : ''}
                  </span>
                  <span
                    onClick={() => {
                      if (window.confirm('¿Borrar esta compra de dólares?'))
                        delTx && delTx(t);
                    }}
                    style={{ cursor: 'pointer', color: P.rd, fontSize: 13 }}
                    title="Borrar esta compra"
                  >
                    ✕
                  </span>
                </div>
              ))}
            {showUsd && usdBuys.length === 0 && (
              <div style={{ fontSize: 11, color: P.sb, padding: '4px 0 6px 12px' }}>
                No hay compras para editar.
              </div>
            )}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginTop: 10,
            flexWrap: 'wrap',
          }}
        >
          <input
            placeholder="Ej: Fondo, Plazo fijo…"
            value={sN}
            onChange={(e) => setSN(e.target.value)}
            style={{ ...iS, flex: 2, minWidth: 110 }}
          />
          <input
            type="number"
            placeholder="Monto"
            value={sA}
            onChange={(e) => setSA(e.target.value)}
            style={{ ...iS, flex: 1, minWidth: 80 }}
          />
          <div
            style={{
              display: 'flex',
              background: P.c2,
              borderRadius: 10,
              border: `1px solid ${P.bd}`,
              overflow: 'hidden',
            }}
          >
            {['ARS', 'USD'].map((c) => (
              <button
                key={c}
                onClick={() => setSC(c)}
                style={{
                  background: sC === c ? P.ac : 'transparent',
                  color: sC === c ? '#fff' : P.sb,
                  border: 'none',
                  padding: '0 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {c}
              </button>
            ))}
          </div>
          <button
            onClick={addSaving}
            style={{
              background: P.ac,
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '0 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Agregar
          </button>
        </div>
        <div style={{ fontSize: 10, color: P.sb, marginTop: 6 }}>
          Lo que ya tenías ahorrado. No cuenta como ingreso — es tu saldo
          inicial.
        </div>
      </Box>
      <Box>
        <Lbl>Ahorro automático</Lbl>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginTop: 6,
          }}
        >
          <input
            type="range"
            min={5}
            max={50}
            step={5}
            value={savPct}
            onChange={(e) => setSavPct(Number(e.target.value))}
            style={{ flex: 1, accentColor: P.ac }}
          />
          <span
            style={{
              fontSize: mob ? 22 : 28,
              fontWeight: 700,
              color: P.ac,
              minWidth: 50,
              textAlign: 'right',
            }}
          >
            {savPct}%
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 9, color: P.sb }}>Meta</div>
            <div
              style={{ fontSize: mob ? 15 : 18, fontWeight: 700, color: P.am }}
            >
              {mob ? fmtS(sT, cur) : fmt(sT, cur)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: P.sb }}>Real</div>
            <div
              style={{
                fontSize: mob ? 15 : 18,
                fontWeight: 700,
                color: ok ? P.gn : P.rd,
              }}
            >
              {mob
                ? fmtS(Math.max(0, actual), cur)
                : fmt(Math.max(0, actual), cur)}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <Bar
            pct={sT > 0 ? (Math.max(0, actual) / sT) * 100 : 0}
            color={ok ? P.gn : P.am}
            h={6}
          />
        </div>
      </Box>

      <Box style={{ borderColor: `${P.rd}20` }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span>🛡️</span>
            <Lbl>Fondo de emergencia</Lbl>
          </div>
          <button
            onClick={() => setShowEF(!showEF)}
            style={{
              background: P.rb,
              border: `1px solid ${P.rd}18`,
              color: P.rd,
              padding: '4px 10px',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 500,
            }}
          >
            {showEF ? 'Cerrar' : 'Configurar'}
          </button>
        </div>
        {showEF && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Lbl>Gastos esenciales mensuales</Lbl>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 6,
              }}
            >
              {[
                'Alquiler',
                'Alimentación',
                'Servicios',
                'Salud',
                'Transporte',
                'Deudas',
              ].map((k) => (
                <div
                  key={k}
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <span style={{ fontSize: 10, color: P.sb, minWidth: 65 }}>
                    {k}
                  </span>
                  <input
                    type="number"
                    placeholder="$"
                    value={efund.expenses?.[k] || ''}
                    onChange={(e) =>
                      setEfund({
                        ...efund,
                        expenses: { ...efund.expenses, [k]: e.target.value },
                      })
                    }
                    style={{ ...iS, flex: 1, padding: '6px 8px', fontSize: 11 }}
                  />
                </div>
              ))}
            </div>
            {efTarget > 0 && (
              <div
                style={{
                  background: P.cd,
                  borderRadius: 10,
                  padding: 12,
                  border: `1px solid ${P.bd}`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600 }}>
                    Meta: {fmt(efTarget, cur)}
                  </span>
                  <span style={{ fontSize: 11, color: P.sb }}>
                    6 × {fmt(efMonthly, cur)}
                  </span>
                </div>
                <Bar
                  pct={efTarget > 0 ? ((efund.saved || 0) / efTarget) * 100 : 0}
                  color={P.rd}
                  h={6}
                />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: 6,
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: P.gn }}>
                    Ahorrado: {fmt(efund.saved || 0, cur)}
                  </span>
                  <span style={{ color: P.sb }}>
                    {efMonthly > 0
                      ? ((efund.saved || 0) / efMonthly).toFixed(1)
                      : 0}{' '}
                    meses
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input
                    type="number"
                    placeholder="Sumar"
                    id="ef-inp"
                    style={{ ...iS, flex: 1, padding: '8px', fontSize: 12 }}
                  />
                  <button
                    onClick={() => {
                      const el = document.getElementById('ef-inp');
                      const v = Number(el?.value);
                      if (v > 0) {
                        setEfund({ ...efund, saved: (efund.saved || 0) + v });
                        el.value = '';
                      }
                    }}
                    style={{
                      background: P.rb,
                      border: `1px solid ${P.rd}20`,
                      color: P.rd,
                      padding: '8px 12px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {!showEF && efTarget > 0 && (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 4,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {fmt(efund.saved || 0, cur)}{' '}
                <span style={{ fontSize: 11, color: P.sb, fontWeight: 400 }}>
                  de {fmt(efTarget, cur)}
                </span>
              </span>
            </div>
            <Bar pct={((efund.saved || 0) / efTarget) * 100} color={P.rd} />
          </div>
        )}
      </Box>

      <Box>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
          }}
        >
          <Lbl>Metas</Lbl>
          <button
            onClick={() => setShowAdd(!showAdd)}
            style={{
              background: P.ab,
              border: `1px solid ${P.ac}18`,
              color: P.ac,
              padding: '5px 12px',
              borderRadius: 10,
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {showAdd ? 'Cancelar' : '+ Meta'}
          </button>
        </div>
        {showAdd && (
          <div
            style={{
              background: P.c2,
              borderRadius: 14,
              padding: mob ? 12 : 16,
              marginBottom: 10,
              border: `1px solid ${P.bd}`,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 4,
                marginBottom: 8,
              }}
            >
              {['🎯', '✈️', '🏠', '🚗', '💻', '🛡️', '🎓', '💍'].map((ic) => (
                <button
                  key={ic}
                  onClick={() => setGi(ic)}
                  style={{
                    background: gi === ic ? P.ac : P.cd,
                    border: `1px solid ${P.bd}`,
                    borderRadius: 8,
                    padding: '5px 9px',
                    cursor: 'pointer',
                    fontSize: 15,
                    color: gi === ic ? '#fff' : P.tx,
                  }}
                >
                  {ic}
                </button>
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: mob ? 'column' : 'row',
                gap: 6,
              }}
            >
              <input
                placeholder="Nombre"
                value={gn}
                onChange={(e) => setGn(e.target.value)}
                style={{ ...iS, flex: 1 }}
              />
              <input
                placeholder="Monto"
                type="number"
                value={gt}
                onChange={(e) => setGt(e.target.value)}
                style={{ ...iS, width: mob ? '100%' : 120 }}
              />
              <button
                onClick={() => {
                  if (gn && gt) {
                    addGoal({
                      name: gn,
                      target: Number(gt),
                      icon: gi,
                      currency: cur,
                      saved: 0,
                    });
                    setGn('');
                    setGt('');
                    setShowAdd(false);
                  }
                }}
                style={{
                  background: P.ac,
                  border: 'none',
                  color: '#fff',
                  padding: '10px 16px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Crear
              </button>
            </div>
          </div>
        )}
        {goals.length === 0 ? (
          <Nil
            icon="🎯"
            t="Todavía no tenés metas de ahorro"
            sub="Poné un nombre y un monto objetivo arriba para crear tu primera meta."
          />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: mob ? '1fr' : '1fr 1fr',
              gap: 8,
            }}
          >
            {goals.map((g) => {
              const pct = g.target > 0 ? (g.saved / g.target) * 100 : 0;
              const done = pct >= 100;
              return (
                <div
                  key={g.id}
                  style={{
                    background: P.c2,
                    borderRadius: 14,
                    padding: mob ? 12 : 16,
                    border: done ? `2px solid ${P.gn}35` : `1px solid ${P.bd}`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{g.icon}</span>
                    <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
                      {g.name}
                    </span>
                    <button
                      onClick={() => delGoal(g.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: P.sb,
                        cursor: 'pointer',
                        fontSize: 10,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 3,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: done ? P.gn : P.ac,
                      }}
                    >
                      {fmtS(g.saved || 0, g.currency || cur)}
                    </span>
                    <span style={{ fontSize: 11, color: P.sb }}>
                      de {fmtS(g.target, g.currency || cur)} · {Math.round(pct)}
                      %
                    </span>
                  </div>
                  <Bar pct={pct} color={done ? P.gn : P.ac} />
                  {!done && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                      <input
                        type="number"
                        placeholder="$"
                        value={addAmt[g.id] || ''}
                        onChange={(e) =>
                          setAddAmt({ ...addAmt, [g.id]: e.target.value })
                        }
                        style={{
                          ...iS,
                          flex: 1,
                          padding: '7px 9px',
                          fontSize: 11,
                        }}
                      />
                      <button
                        onClick={() => {
                          const a = Number(addAmt[g.id]);
                          if (a > 0) {
                            updGoal(g.id, a);
                            setAddAmt({ ...addAmt, [g.id]: '' });
                          }
                        }}
                        style={{
                          background: P.gb,
                          border: `1px solid ${P.gn}25`,
                          color: P.gn,
                          padding: '7px 10px',
                          borderRadius: 8,
                          cursor: 'pointer',
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Box>
    </div>
  );
}

/* ── TX MODAL ── */
function TxModal({
  mode,
  initial,
  cur,
  onSave,
  onDelete,
  onClose,
  mob,
  defScope,
  setDefScope,
  myGroups,
  viewScope,
  customCats,
  userName,
  onSaveFav,
  knownCards = [],
  knownMembers = [],
}) {
  const [type, setType] = useState(initial?.type || 'gasto');
  const cats = getCats(type, customCats);
  const [cat, setCat] = useState(initial?.cat || cats[0].n);
  const [sub, setSub] = useState(initial?.sub || '');
  const [amt, setAmt] = useState(initial?.amt?.toString() || '');
  const [curSel, setCurSel] = useState(initial?.cur || cur);
  const [desc, setDesc] = useState(initial?.desc || '');
  const [date, setDate] = useState(initial?.date?.slice(0, 10) || td());
  const [recurring, setRecurring] = useState(initial?.recurring || false);
  const [freq, setFreq] = useState(initial?.freq || 'mensual');
  const [programado, setProgramado] = useState(initial?.pending || false);
  const [showMore, setShowMore] = useState(mode === 'edit');
  const [pay, setPay] = useState(initial?.pay || 'debito');
  const [cuotas, setCuotas] = useState(initial?.cuotas || 1);
  const [card, setCard] = useState(initial?.card || '');
  const [cardNet, setCardNet] = useState(initial?.cardNet || '');
  const [cardDue, setCardDue] = useState(
    initial?.cardDue ? String(initial.cardDue) : ''
  );
  const isG = type === 'gasto';

  // Scope: personal or a group.
  // Al EDITAR, respetar el scope real del movimiento (no los defaults).
  const isEditing = !!initial?.id;
  const initScope = initial?.groupId
    ? initial.groupId
    : isEditing
    ? 'personal'
    : viewScope !== 'personal'
    ? viewScope
    : defScope === 'grupo' && myGroups.length > 0
    ? myGroups[0].id
    : 'personal';
  const [scope, setScope] = useState(initScope);
  const [member, setMember] = useState(initial?.member || userName || '');
  const [confirmDel, setConfirmDel] = useState(false);
  const cc = cats.find((c) => c.n === cat);
  const iS = {
    width: '100%',
    background: P.c2,
    border: `1px solid ${P.bd}`,
    color: P.tx,
    padding: '12px 14px',
    borderRadius: 12,
    fontSize: 14,
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(42,38,33,0.25)',
        display: 'flex',
        alignItems: mob ? 'flex-end' : 'center',
        justifyContent: 'center',
        zIndex: 200,
        backdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: P.cd,
          borderRadius: mob ? '22px 22px 0 0' : 22,
          padding: mob ? '18px 14px 28px' : 26,
          width: '100%',
          maxWidth: mob ? '100%' : 450,
          maxHeight: mob ? '92vh' : '88vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {mob && (
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: P.bd,
              margin: '0 auto 14px',
            }}
          />
        )}

        {/* Type */}
        <div
          style={{
            display: 'flex',
            background: P.c2,
            borderRadius: 12,
            padding: 3,
            marginBottom: 14,
            border: `1px solid ${P.bd}`,
          }}
        >
          {[
            ['ingreso', '📈 Ingreso', P.gn],
            ['gasto', '📉 Gasto', P.rd],
            ['ahorro', '🏦 Ahorro', P.ac],
          ].map(([id, l, color]) => (
            <button
              key={id}
              onClick={() => {
                setType(id);
                setCat((getCats(id, customCats)[0] || {}).n || '');
                setSub('');
              }}
              style={{
                flex: 1,
                background: type === id ? color : 'transparent',
                border: 'none',
                color: type === id ? '#fff' : P.sb,
                padding: '9px',
                borderRadius: 10,
                cursor: 'pointer',
                fontSize: mob ? 12 : 13,
                fontWeight: 600,
              }}
            >
              {l}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {showMore && (
            <>
          {/* 1. Scope */}
          <div
            style={{
              background: P.bg,
              borderRadius: 14,
              padding: mob ? 12 : 14,
              border: `1px solid ${P.bd}`,
            }}
          >
            <Lbl>Guardar en</Lbl>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 4,
                marginTop: 4,
              }}
            >
              <button
                onClick={() => setScope('personal')}
                style={{
                  background: scope === 'personal' ? P.ac : P.cd,
                  border: `1px solid ${scope === 'personal' ? P.ac : P.bd}`,
                  color: scope === 'personal' ? '#fff' : P.tx,
                  padding: '6px 14px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                👤 Personal
              </button>
              {myGroups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setScope(g.id)}
                  style={{
                    background: scope === g.id ? P.pu : P.cd,
                    border: `1px solid ${scope === g.id ? P.pu : P.bd}`,
                    color: scope === g.id ? '#fff' : P.tx,
                    padding: '6px 14px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  👥 {g.name}
                </button>
              ))}
            </div>
          </div>

          {/* 1b. Quién pagó / a quién ingresó (solo grupo) */}
          {scope !== 'personal' && (
            <div>
              <Lbl>
                {type === 'ingreso' ? '¿A quién ingresó?' : '¿Quién pagó?'}
              </Lbl>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                  marginBottom: 6,
                }}
              >
                {Array.from(
                  new Set(
                    [
                      userName,
                      ...((myGroups.find((g) => g.id === scope) || {})
                        .memberNames || []),
                      ...knownMembers,
                    ].filter(Boolean)
                  )
                ).map((nm) => (
                  <button
                    key={nm}
                    onClick={() => setMember(nm)}
                    style={{
                      background: member === nm ? P.pu : P.c2,
                      border: `1px solid ${member === nm ? P.pu : P.bd}`,
                      color: member === nm ? '#fff' : P.tx,
                      padding: '6px 12px',
                      borderRadius: 10,
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {nm}
                  </button>
                ))}
              </div>
            </div>
          )}
            </>
          )}

          {/* 2. Amount */}
          <div style={{ order: -3 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 5,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: P.sb,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: 0.7,
                }}
              >
                Monto
              </span>
              <div
                style={{
                  display: 'flex',
                  background: P.c2,
                  borderRadius: 8,
                  border: `1px solid ${P.bd}`,
                  overflow: 'hidden',
                }}
              >
                {[
                  ['ARS', '$ Pesos'],
                  ['USD', 'US$ Dólares'],
                ].map(([c, l]) => (
                  <button
                    key={c}
                    onClick={() => setCurSel(c)}
                    style={{
                      background: curSel === c ? P.ac : 'transparent',
                      color: curSel === c ? '#fff' : P.sb,
                      border: 'none',
                      padding: '5px 11px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <input
              type="number"
              placeholder="0"
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
              autoFocus
              style={{
                ...iS,
                fontSize: 24,
                fontWeight: 700,
                textAlign: 'center',
                padding: '14px',
                background: P.bg,
              }}
            />
          </div>

          {/* 3. Category */}
          <div style={{ order: -2 }}>
            <Lbl>Categoría</Lbl>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {cats.map((c) => (
                <button
                  key={c.n}
                  onClick={() => {
                    setCat(c.n);
                    setSub('');
                  }}
                  style={{
                    background: cat === c.n ? P.ac : P.c2,
                    border: `1px solid ${cat === c.n ? P.ac : P.bd}`,
                    color: cat === c.n ? '#fff' : P.tx,
                    padding: '6px 10px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  {c.i} {c.n}
                </button>
              ))}
            </div>
          </div>
          {showMore && (
            <>
          {cc && (
            <div>
              <Lbl>Subcategoría</Lbl>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {cc.s.map((s2) => (
                  <button
                    key={s2}
                    onClick={() => setSub(s2)}
                    style={{
                      background: sub === s2 ? `${P.ac}12` : P.c2,
                      border: `1px solid ${sub === s2 ? P.ac : P.bd}`,
                      color: sub === s2 ? P.ac : P.sb,
                      padding: '5px 10px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontSize: 10,
                    }}
                  >
                    {s2}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 4. Payment */}
          {isG && (
            <div>
              <Lbl>Método de pago</Lbl>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {[
                  { id: 'debito', i: '💳', l: 'Débito' },
                  { id: 'credito', i: '💳', l: 'Crédito' },
                  { id: 'transferencia', i: '🏦', l: 'Transf.' },
                  { id: 'efectivo', i: '💵', l: 'Efectivo' },
                ].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPay(p.id);
                      if (p.id !== 'credito') setCuotas(1);
                    }}
                    style={{
                      background: pay === p.id ? P.ac : P.c2,
                      border: `1px solid ${pay === p.id ? P.ac : P.bd}`,
                      color: pay === p.id ? '#fff' : P.tx,
                      padding: '6px 10px',
                      borderRadius: 10,
                      cursor: 'pointer',
                      fontSize: 11,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                    }}
                  >
                    {p.i} {p.l}
                  </button>
                ))}
              </div>
            </div>
          )}
          {isG && pay === 'credito' && (
            <div>
              <Lbl>Cuotas</Lbl>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {[1, 2, 3, 6, 12, 18].map((c) => (
                  <button
                    key={c}
                    onClick={() => setCuotas(c)}
                    style={{
                      background: cuotas === c ? P.ac : P.c2,
                      border: `1px solid ${cuotas === c ? P.ac : P.bd}`,
                      color: cuotas === c ? '#fff' : P.tx,
                      padding: '7px 12px',
                      borderRadius: 10,
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {c === 1 ? '1 pago' : `${c}x`}
                  </button>
                ))}
              </div>
              {cuotas > 1 && amt && (
                <div
                  style={{
                    marginTop: 5,
                    fontSize: 11,
                    color: P.ac,
                    background: P.ab,
                    padding: '4px 8px',
                    borderRadius: 8,
                  }}
                >
                  {cuotas} cuotas de{' '}
                  {fmt(Math.ceil(Number(amt) / cuotas), curSel)}
                </div>
              )}
            </div>
          )}

          {isG && pay === 'credito' && (
            <div>
              <Lbl>¿Con qué tarjeta?</Lbl>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {[
                  { id: 'Visa', c: '#1A1F71' },
                  { id: 'Mastercard', c: '#EB001B' },
                  { id: 'Amex', c: '#2E77BC' },
                  { id: 'Mercado Pago', c: '#00AEEF' },
                  { id: 'Naranja', c: '#FF6A00' },
                  { id: 'Otra', c: P.sb },
                ].map((n) => (
                  <button
                    key={n.id}
                    onClick={() => setCardNet(cardNet === n.id ? '' : n.id)}
                    style={{
                      background: cardNet === n.id ? n.c : P.c2,
                      border: `1px solid ${cardNet === n.id ? n.c : P.bd}`,
                      color: cardNet === n.id ? '#fff' : P.tx,
                      padding: '6px 12px',
                      borderRadius: 10,
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    💳 {n.id}
                  </button>
                ))}
              </div>
              <input
                list="known-cards"
                placeholder="Nombre de la tarjeta (ej: Galicia, BBVA negra)"
                value={card}
                onChange={(e) => setCard(e.target.value)}
                style={{ ...iS, marginTop: 6 }}
              />
              <datalist id="known-cards">
                {knownCards.filter(Boolean).map((nm) => (
                  <option key={nm} value={nm} />
                ))}
              </datalist>
              <div style={{ marginTop: 6 }}>
                <Lbl>Día de vencimiento (pago del resumen)</Lbl>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    placeholder="Día"
                    value={cardDue}
                    onChange={(e) => setCardDue(e.target.value)}
                    style={{ ...iS, width: 90 }}
                  />
                  <span style={{ fontSize: 11, color: P.sb }}>
                    {cardDue
                      ? `Vence el ${cardDue} de cada mes · te aviso en Inicio`
                      : 'Opcional — para verlo en "Tarjetas a pagar"'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 5. Date */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Lbl>Fecha</Lbl>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={iS}
              />
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
              }}
            >
              <button
                onClick={() => setRecurring(!recurring)}
                style={{
                  background: recurring ? P.ab : P.c2,
                  border: `1px solid ${recurring ? P.ac : P.bd}`,
                  color: recurring ? P.ac : P.sb,
                  padding: '11px 12px',
                  borderRadius: 12,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 500,
                }}
              >
                🔄 Recurrente
              </button>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
              }}
            >
              <button
                onClick={() => setProgramado(!programado)}
                title="No cuenta en el presupuesto hasta marcarlo pagado"
                style={{
                  background: programado ? P.am + '22' : P.c2,
                  border: `1px solid ${programado ? P.am : P.bd}`,
                  color: programado ? P.am : P.sb,
                  padding: '11px 12px',
                  borderRadius: 12,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                📅 Programado
              </button>
            </div>
          </div>
          {programado && (
            <div
              style={{
                fontSize: 11,
                color: P.sb,
                background: P.am + '14',
                borderRadius: 10,
                padding: '8px 11px',
              }}
            >
              📅 Este gasto queda <b>pendiente</b> y no baja el presupuesto
              hasta que lo marques como pagado (en la tarjeta "Por pagar" de
              Inicio).
            </div>
          )}

          {recurring && (
            <div>
              <Lbl>¿Cada cuánto se repite?</Lbl>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {[
                  ['mensual', 'Mensual'],
                  ['semanal', 'Semanal'],
                  ['quincenal', 'Quincenal'],
                  ['anual', 'Anual'],
                ].map(([id, l]) => (
                  <button
                    key={id}
                    onClick={() => setFreq(id)}
                    style={{
                      background: freq === id ? P.ac : P.c2,
                      border: `1px solid ${freq === id ? P.ac : P.bd}`,
                      color: freq === id ? '#fff' : P.tx,
                      padding: '6px 12px',
                      borderRadius: 10,
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 6. Note */}
          <div>
            <Lbl>Nota</Lbl>
            <input
              type="text"
              placeholder="Opcional"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              style={iS}
            />
          </div>
            </>
          )}

          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            style={{
              order: -1,
              alignSelf: 'flex-start',
              background: 'transparent',
              border: 'none',
              color: P.ac,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '2px 0',
            }}
          >
            {showMore
              ? '▴ Menos opciones'
              : '▾ Más opciones (espacio, fecha, medio de pago, recurrente…)'}
          </button>

          {/* Save */}
          <div style={{ display: 'flex', gap: 6, marginTop: 2, order: 10 }}>
            {mode === 'edit' && !confirmDel && (
              <button
                onClick={() => setConfirmDel(true)}
                style={{
                  background: P.rb,
                  border: `1px solid ${P.rd}20`,
                  color: P.rd,
                  padding: '12px',
                  borderRadius: 14,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                🗑️
              </button>
            )}
            {mode === 'edit' && confirmDel && (
              <button
                onClick={onDelete}
                style={{
                  background: P.rd,
                  border: 'none',
                  color: '#fff',
                  padding: '12px',
                  borderRadius: 14,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  flex: 1,
                }}
              >
                Confirmar eliminar
              </button>
            )}
            {!confirmDel && (
              <button
                onClick={onClose}
                style={{
                  background: P.c2,
                  border: `1px solid ${P.bd}`,
                  color: P.sb,
                  padding: '12px',
                  borderRadius: 14,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                  flex: 1,
                }}
              >
                Cancelar
              </button>
            )}
            {!confirmDel && (
              <button
                onClick={() => {
                  const amtNum = Number(String(amt).replace(',', '.'));
                  if (!amtNum || amtNum <= 0) {
                    notify('Ingresá un monto mayor a 0.', 'error');
                    return;
                  }
                  const isGroupScope = scope !== 'personal';
                  const txData = {
                    ...(mode === 'edit' ? initial : {}),
                    type,
                    cat,
                    sub,
                    amt: amtNum,
                    desc,
                    date,
                    cur: curSel,
                    recurring,
                    pending: programado,
                    freq: recurring ? freq : undefined,
                    serieId: recurring
                      ? initial?.serieId ||
                        'r' +
                          Date.now().toString(36) +
                          Math.random().toString(36).slice(2, 7)
                      : undefined,
                    pay: isG ? pay : undefined,
                    cuotas: isG && pay === 'credito' ? cuotas : undefined,
                    card: isG && pay === 'credito' ? card || undefined : undefined,
                    cardNet:
                      isG && pay === 'credito' ? cardNet || undefined : undefined,
                    cardDue:
                      isG && pay === 'credito' && cardDue
                        ? Number(cardDue)
                        : undefined,
                    scope: isGroupScope ? 'grupo' : 'personal',
                    groupId: isGroupScope ? scope : undefined,
                    member: isGroupScope ? member || userName : undefined,
                  };
                  onSave(txData);
                }}
                style={{
                  flex: 2,
                  background: type === 'ingreso' ? P.gn : P.rd,
                  border: 'none',
                  color: '#fff',
                  padding: '12px',
                  borderRadius: 14,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {mode === 'edit' ? 'Actualizar' : 'Guardar'}
              </button>
            )}
          </div>
          {mode !== 'edit' && onSaveFav && (
            <button
              onClick={() => {
                const amtNum = Number(String(amt).replace(',', '.'));
                onSaveFav({
                  type,
                  cat,
                  sub,
                  amt: amtNum > 0 ? amtNum : undefined,
                  desc,
                  cur: curSel,
                  pay: isG ? pay : undefined,
                });
                notify('Guardado en favoritos ⭐', 'success');
              }}
              style={{
                width: '100%',
                marginTop: 8,
                order: 11,
                background: 'transparent',
                border: 'none',
                color: P.sb,
                fontSize: 12,
                cursor: 'pointer',
                padding: 4,
              }}
            >
              ⭐ Guardar como favorito
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
