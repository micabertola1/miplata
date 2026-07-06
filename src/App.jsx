// @ts-nocheck
import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
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
    {
      n: 'Tarjetas',
      i: '💳',
      s: ['Resumen', 'Cuotas', 'Intereses', 'Mantenimiento', 'Otros'],
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

/* ── PDF bank statement parsers ── */

async function extractPDFText(arrayBuffer) {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const byY = new Map();
    for (const item of content.items) {
      if (!item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push({ x: item.transform[4], str: item.str });
    }
    const lines = [...byY.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.str).join(' '));
    fullText += lines.join('\n') + '\n';
  }
  return fullText;
}

function detectBankPDF(text) {
  if (/banco\s*macro|\bMacro\b/i.test(text)) return 'macro';
  if (/supervielle/i.test(text)) return 'supervielle';
  if (/galicia/i.test(text)) return 'galicia';
  return null;
}

const _PDF_SKIP = /^(SU PAGO EN|DEV\.IMP\.|INTERESES\s+FINAN|IMP\s+DE\s+SELLOS|DB\s+IVA|IVA\s+RG|DB\.RG\s+\d|BONIF\.\s+CONSUMO|Tarjeta\s+\d)/i;
const _CUOTA_RE = /\s+[Cc]uota\s+(\d+)\/(\d+)/;

function guessCatPDF(desc) {
  const d = desc.toLowerCase();
  if (/netflix|spotify|disney|amazon\s*prime|apple\.com|youtube|playstation|hbo|deezer|flow/i.test(d)) return 'Entretenimiento';
  if (/pedidosya|rappi|glovo/i.test(d)) return 'Delivery';
  if (/\bcoto\b|carrefour|\bdia\b|walmart|\bvea\b|disco|jumbo|supermercado/i.test(d)) return 'Supermercado';
  if (/sushi|restaurant|nikkei|cantina|parrilla|cafeter/i.test(d)) return 'Restaurantes';
  if (/airline|lan\b|aerolin|flybondi|jetsmart|hotel|booking|airbnb/i.test(d)) return 'Viajes';
  if (/google|microsoft|adobe|dropbox|github/i.test(d)) return 'Tecnología';
  if (/farmacia|medic|clinica|salud/i.test(d)) return 'Salud';
  if (/\buber\b|cabify|remis/i.test(d)) return 'Transporte';
  return 'Compras';
}

function parseMacroPDF(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const startIdx = lines.findIndex(l => /SALDO ANTERIOR/.test(l));
  const endIdx = lines.findIndex((l, i) => i > startIdx && /SALDO ACTUAL/.test(l));
  if (startIdx === -1) return { valid: [], invalid: [{ rowNum: '—', reason: 'No se encontró la sección de movimientos' }] };
  const txLines = lines.slice(startIdx + 1, endIdx > -1 ? endIdx : undefined);
  const valid = [];
  const invalid = [];
  const dateRe = /^(\d{2})\.(\d{2})\.(\d{2})\s+(.*)/;
  for (const line of txLines) {
    const dm = line.match(dateRe);
    if (!dm) continue;
    const [, dd, mm, yy, rest] = dm;
    if (_PDF_SKIP.test(rest)) continue;
    const date = `20${yy}-${mm}-${dd}`;
    const isUSD = /\bUSD\b/i.test(rest);
    const allAmts = [...rest.matchAll(/([\d.]+,\d{2})(-?)/g)];
    if (!allAmts.length) { invalid.push({ rowNum: line.slice(0, 20), reason: 'sin monto' }); continue; }
    const lastAmt = allAmts[allAmts.length - 1];
    if (lastAmt[2] === '-') continue;
    const amt = parseAmount(lastAmt[1]);
    if (!amt || amt <= 0) continue;
    const cuotaMatch = rest.match(_CUOTA_RE);
    let desc = rest
      .replace(/^[A-Z0-9]+[K*]?\s+/, '')
      .replace(_CUOTA_RE, '')
      .replace(/\s*\bUSD\b\s*/gi, ' ')
      .replace(/\s+[\d.]+,\d{2}-?\s*$/g, '')
      .replace(/\s+[\d.]+,\d{2}-?\s*$/g, '')
      .trim();
    if (cuotaMatch) desc += ` (cuota ${cuotaMatch[1]}/${cuotaMatch[2]})`;
    valid.push({ type: 'gasto', cat: guessCatPDF(desc), sub: '', amt, desc, date, cur: isUSD ? 'USD' : 'ARS', recurring: false, pay: 'credito', imported: true });
  }
  return { valid, invalid };
}

async function parseBankPDF(arrayBuffer) {
  const text = await extractPDFText(arrayBuffer);
  const bank = detectBankPDF(text);
  if (!bank) throw new Error('No reconocí el banco. Por ahora soportamos Macro, Supervielle y Galicia.');
  if (bank === 'macro') return parseMacroPDF(text);
  throw new Error(`Soporte para ${bank} próximamente.`);
}

/* ── Palette ── */
const P_LIGHT = {
  bg: '#F5F4EF',
  cd: '#FFFFFF',
  c2: '#EFEFEA',
  bd: '#E0DDD5',
  tx: '#1A1A18',
  sb: '#7A7A72',
  ac: '#014641',
  al: '#3A7BD5',
  ab: '#E4EDEC',
  gn: '#1A7A5E',
  gb: '#E6F5F0',
  rd: '#C0392B',
  rb: '#FDECEA',
  am: '#B58A1B',
  amb: 'rgba(181,138,27,0.09)',
  pu: '#8B5CF6',
  pb: 'rgba(139,92,246,0.09)',
  bal: '#014641',
  ar: '#C9B89A',
};
const P_DARK = {
  bg: '#111C1B',
  cd: '#1A2826',
  c2: '#213330',
  bd: '#1F3330',
  tx: '#F0EFEA',
  sb: '#8AA8A6',
  ac: '#02685F',
  al: '#3A7BD5',
  ab: '#012E2B',
  gn: '#2EC4A0',
  gb: '#0A2E25',
  rd: '#E8715E',
  rb: '#2E1410',
  am: '#C9A030',
  amb: 'rgba(201,160,48,0.12)',
  pu: '#9B8EC0',
  pb: 'rgba(155,142,192,0.12)',
  bal: '#013D38',
  ar: '#8A7A65',
};
let P = { ...P_LIGHT };
const pal = [
  '#E07840',
  '#3A7BD5',
  '#1A7A5E',
  '#8B5CF6',
  '#D4678A',
  '#014641',
  '#C9B89A',
];

/* ── Shared UI ── */
function Box({ children, style }) {
  return (
    <div
      style={{
        background: P.cd,
        border: `1px solid ${P.bd}`,
        borderRadius: 22,
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
function Switch({ on, onClick, color }) {
  const c = color || P.ac;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 46,
        height: 27,
        borderRadius: 27,
        border: 'none',
        background: on ? c : P.bd,
        position: 'relative',
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        transition: 'background .18s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 22 : 3,
          width: 21,
          height: 21,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,.3)',
          transition: 'left .18s',
        }}
      />
    </button>
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
        width: 30,
        height: 30,
        borderRadius: 8,
        cursor: 'pointer',
        fontSize: 14,
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
          fontFamily: "'Plus Jakarta Sans',sans-serif",
        }}
      >
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <div style={{ textAlign: 'center' }}>
          <img
            src="/favicon.svg"
            alt="Aureo"
            style={{ width: 48, height: 48, borderRadius: 14, marginBottom: 12 }}
          />
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
        fontFamily: "'Plus Jakarta Sans',sans-serif",
        padding: 20,
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
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
        <img
          src="/favicon.svg"
          alt="Aureo"
          style={{ width: 56, height: 56, borderRadius: 16, marginBottom: 16 }}
        />
        <img
          src="/aureo-wordmark.svg"
          alt="Aureo"
          style={{ height: 30, marginBottom: 6, display: 'inline-block' }}
        />
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
          cards: merged.cards || [],
          theme: merged.theme || 'light',
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
      notify('Movimiento guardado', 'success');
    } catch (e) {
      console.error('addTx error:', e);
      notify('No pudimos guardar el movimiento. Probá de nuevo.', 'error');
    }
  };

  // Ref correcta según dónde vive la tx (grupo o personal)
  const txRefFor = (t) =>
    t.groupId
      ? doc(db, 'groups', t.groupId, 'transactions', t.id)
      : doc(db, 'users', user.uid, 'transactions', t.id);

  // Registrar la instancia de un pago recurrente en el mes visto.
  // Si ya existe una instancia de este mes (quedó pendiente al destildar),
  // solo la reactivamos en vez de crear un duplicado.
  const registerRecurring = async (template) => {
    const existing = activeTx.find(
      (t) => t.serieId === template.serieId && mk(t.date) === month
    );
    if (existing) {
      try {
        await updateDoc(txRefFor(existing), { pending: false });
      } catch (e) {
        console.error('registerRecurring (update) error:', e);
        notify('No pudimos registrar el pago. Probá de nuevo.', 'error');
      }
      return;
    }
    const day = String(template.date || '').slice(8, 10) || '01';
    const newDate = `${month}-${day}`;
    const { id, createdAt, imported, ...rest } = template;
    await addTx({ ...rest, date: newDate, pending: false });
  };

  // Quitar una serie recurrente: pone recurring=false en todas las txs de esa serieId
  const removeRecurringSerie = async (serieId) => {
    if (!serieId) return;
    const txsWithSerie = activeTx.filter((t) => t.serieId === serieId);
    if (txsWithSerie.length === 0) return;
    try {
      const batch = writeBatch(db);
      for (const t of txsWithSerie) batch.update(txRefFor(t), { recurring: false });
      await batch.commit();
      notify('Recurrente eliminado', 'success');
    } catch (e) {
      console.error('removeRecurringSerie error:', e);
      notify('No pudimos eliminar el recurrente. Probá de nuevo.', 'error');
    }
  };

  // Pausar / activar una serie recurrente sin eliminarla
  const pauseRecurringSerie = async (serieId, pause) => {
    if (!serieId) return;
    const txsWithSerie = activeTx.filter((t) => t.serieId === serieId);
    if (txsWithSerie.length === 0) return;
    try {
      const batch = writeBatch(db);
      for (const t of txsWithSerie) batch.update(txRefFor(t), { paused: pause });
      await batch.commit();
      notify(pause ? 'Recurrente pausado ⏸️' : 'Recurrente activado ▶️', 'success');
    } catch (e) {
      console.error('pauseRecurringSerie error:', e);
      notify('No pudimos pausar el recurrente. Probá de nuevo.', 'error');
    }
  };

  // Destildar: marca como pendiente la instancia de esta serie en el mes
  // visto (no borra el documento, para no perder la definición del
  // recurrente si es la única instancia que existe).
  const unregisterRecurring = async (template) => {
    if (!template?.serieId) return;
    const insts = activeTx.filter((t) => t.serieId === template.serieId && mk(t.date) === month);
    if (insts.length === 0) return;
    try {
      const batch = writeBatch(db);
      for (const t of insts) batch.update(txRefFor(t), { pending: true });
      await batch.commit();
      notify('Quitamos el pago de este mes', 'success');
    } catch (e) {
      console.error('unregisterRecurring error:', e);
      notify('No pudimos quitar el pago. Probá de nuevo.', 'error');
    }
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
    // Deduplicate: skip rows that match an existing tx by date+monto+type
    const existingKeys = new Set(
      tx.map((t) => `${t.date}|${t.amt}|${t.type}`)
    );
    const fresh = rows.filter(
      (r) => !existingKeys.has(`${r.date}|${r.amt}|${r.type}`)
    );
    const skipped = rows.length - fresh.length;
    const stamp = new Date().toISOString();
    let batch = writeBatch(db);
    let n = 0;
    for (const t of fresh) {
      batch.set(doc(col), { ...t, ...extra, imported: true, createdAt: stamp });
      n++;
      if (n % 450 === 0) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }
    if (n % 450 !== 0) await batch.commit();
    return { imported: fresh.length, skipped };
  };

  // ── Exportar transacciones a CSV ──
  const exportCSV = (onlyMonth = false) => {
    const rows = onlyMonth
      ? activeTx.filter((t) => mk(t.date) === month)
      : activeTx;
    if (!rows.length) { notify('No hay movimientos para exportar.', 'info'); return; }
    const sorted = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const headers = ['fecha','concepto','categoria','subcategoria','tipo','monto','moneda','medio_pago','quien_pago'];
    const lines = [headers.join(',')];
    sorted.forEach((t) => {
      const tipo = t.type === 'ingreso' ? 'Ingreso' : t.type === 'ahorro' ? 'Ahorro' : 'Egreso';
      const cols = [
        t.date,
        `"${(t.desc || t.sub || t.cat || '').replace(/"/g, '""')}"`,
        `"${(t.cat || '').replace(/"/g, '""')}"`,
        `"${(t.sub || '').replace(/"/g, '""')}"`,
        tipo,
        t.amt,
        t.cur || 'ARS',
        t.pay || '',
        `"${(t.member || t.createdByName || '').replace(/"/g, '""')}"`,
      ];
      lines.push(cols.join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = onlyMonth ? `miplata_${month}.csv` : `miplata_todo.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Borrar todos los importados (personal) ──
  const clearImported = async () => {
    const items = tx.filter((t) => t.imported && t.scope !== 'grupo');
    if (!items.length) {
      notify('No hay movimientos importados para borrar.', 'info');
      return;
    }
    if (!window.confirm(`¿Borrar ${items.length} movimiento(s) importados? Esta acción NO se puede deshacer.`))
      return;
    try {
      let batch = writeBatch(db);
      let n = 0;
      for (const t of items) {
        batch.delete(doc(db, 'users', user.uid, 'transactions', t.id));
        n++;
        if (n % 450 === 0) { await batch.commit(); batch = writeBatch(db); }
      }
      if (n % 450 !== 0) await batch.commit();
      notify(`${items.length} importados borrados.`, 'success');
    } catch (e) {
      notify('Error al borrar: ' + (e?.message || e), 'error');
    }
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

  // Aplicar tema antes de renderizar
  Object.assign(P, (settings.theme || 'light') === 'dark' ? P_DARK : P_LIGHT);

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
  };
  // Abrir el formulario PRE-CARGADO como nuevo (sin id, fecha hoy)
  const openPrefill = (data) => {
    if (!data) return;
    const { id, createdAt, imported, date, serieId, recurring, ...rest } = data;
    setEditItem({ ...rest });
    setModal('add');
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
        fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif",
        paddingBottom: 76,
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
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
          <img
            src={settings.theme === 'dark' ? '/isologo-neg.svg' : '/isologo.svg'}
            alt=""
            style={{ width: 28, height: 28, borderRadius: 9 }}
          />
          <img src="/aureo-wordmark.svg" alt="Aureo" style={{ height: 15 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
        {tab === 'home' && (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: mob ? 14 : 18 }}>
            <div>
              <div style={{ fontSize: mob ? 20 : 23, fontWeight: 800, color: P.tx, letterSpacing: -0.3 }}>
                Hola, {(user.displayName || user.email || 'vos').split(' ')[0]} 👋
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: P.sb, marginTop: 3 }}>Controlá tus finanzas</div>
            </div>
            <div style={{ display: 'flex', background: P.c2, borderRadius: 8, border: `1px solid ${P.bd}`, overflow: 'hidden', flexShrink: 0 }}>
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
          </div>
        )}
        {(tab === 'home' || tab === 'insights' || tab === 'movs' || tab === 'diarios') && (
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
            {tx.some((t) => t.imported && t.scope !== 'grupo') && (
              <button
                onClick={clearImported}
                title="Borrar todos los movimientos importados"
                style={{
                  background: 'transparent',
                  border: `1px solid ${P.rd}44`,
                  color: P.rd,
                  borderRadius: 8,
                  padding: mob ? '5px 9px' : '6px 11px',
                  fontSize: mob ? 11 : 12,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                ↩ Deshacer importación
              </button>
            )}
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
            onUnregister={unregisterRecurring}
            onRemoveSerie={removeRecurringSerie}
            onPauseSerie={pauseRecurringSerie}
            favorites={favorites}
            onUseFav={openPrefill}
            onRemoveFav={removeFavorite}
            pendingTx={pendingTx}
            onMarkPaid={markPaid}
            onAdd={openAdd}
            onSeeAll={() => setTab('movs')}
            onSeeCats={() => setTab('insights')}
          />
        )}
        {(tab === 'movs' || tab === 'diarios') && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {tab !== 'diarios' && (
              <button
                onClick={() => openAdd('ingreso')}
                style={{ flex: 1, background: P.gn + '18', border: `1px solid ${P.gn}40`, borderRadius: 10, padding: '9px 0', fontSize: 13, fontWeight: 700, color: P.gn, cursor: 'pointer' }}
              >
                + Ingreso
              </button>
            )}
            <button
              onClick={() => openAdd('gasto')}
              style={{ flex: 1, background: P.rd + '18', border: `1px solid ${P.rd}40`, borderRadius: 10, padding: '9px 0', fontSize: 13, fontWeight: 700, color: P.rd, cursor: 'pointer' }}
            >
              + Gasto
            </button>
          </div>
        )}
        {tab === 'movs' && (
          <MesTab
            mob={mob}
            cur={cur}
            activeTx={activeTx}
            totIn={totIn}
            month={month}
            onAdd={openAdd}
            onEdit={openEdit}
            onRegister={registerRecurring}
            onUnregister={unregisterRecurring}
            onRemoveSerie={removeRecurringSerie}
            onPauseSerie={pauseRecurringSerie}
            onExport={() => exportCSV(true)}
            onExchange={() => setShowExchange(true)}
          />
        )}
        {tab === 'diarios' && (
          <DiariosTab
            mob={mob}
            cur={cur}
            activeTx={activeTx}
            month={month}
            onAdd={openAdd}
            onEdit={openEdit}
            onExport={() => exportCSV(true)}
            customCats={settings.customCats}
          />
        )}
        {tab === 'perfil' && (
          <PerfilTab
            onExportAll={() => exportCSV(false)}
            onExportMonth={() => exportCSV(true)}
            onImport={() => setShowImport(true)}
            cards={settings.cards || []}
            onSaveCards={(c) => saveSettings({ cards: c })}
            theme={settings.theme || 'light'}
            onToggleTheme={() => saveSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
            scopeLabel={
              viewScope === 'personal'
                ? '👤 Personal'
                : '👥 ' + (myGroups.find((g) => g.id === viewScope)?.name || 'Grupo')
            }
            onOpenSpaces={() => setMenuOpen(true)}
            onOpenCats={() => setShowCats(true)}
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
            customCats={settings.customCats}
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
            usdBuys={tx
              .filter((t) => t.usd > 0)
              .sort((a, b) => (b.date || '').localeCompare(a.date || ''))}
            delTx={delTxFn}
          />
        )}
      </main>


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
          { id: 'movs', l: 'Mes', e: '📅' },
          { id: 'diarios', l: 'Diarios', e: '📝' },
          { id: 'insights', l: 'Análisis', e: '📊' },
          { id: 'goals', l: 'Metas', e: '🎯' },
          { id: 'perfil', l: 'Config', e: '⚙️' },
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
              gap: 3,
              cursor: 'pointer',
              padding: '4px 10px',
              fontSize: 10,
              fontWeight: tab === t.id ? 600 : 500,
            }}
          >
            <span style={{ fontSize: 16, width: 34, height: 26, borderRadius: 10, background: tab === t.id ? P.ab : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t.e}</span>
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
          savedCards={settings.cards || []}
          onAddCard={(name) => {
            const cs = settings.cards || [];
            if (!name || cs.some((c) => c.name === name)) return;
            saveSettings({ cards: [...cs, { id: String(Date.now()), name, cierre: '', vencimiento: '' }] });
          }}
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
            // Suma el USD comprado al ítem editable "Dólares" en Patrimonio (Metas)
            if (t.usd > 0) {
              const cur2 = settings.savings || [];
              const idx = cur2.findIndex((s) => s.cur === 'USD' && s.name === 'Dólares');
              const next =
                idx >= 0
                  ? cur2.map((s, i) => (i === idx ? { ...s, amount: s.amount + t.usd } : s))
                  : [...cur2, { id: 'sv-usd-' + Date.now(), name: 'Dólares', amount: t.usd, cur: 'USD' }];
              saveSettings({ savings: next });
            }
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
              type="text"
              inputMode="decimal"
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
              type="text"
              inputMode="decimal"
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
  const [parsing, setParsing] = useState(false);

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setParsed(null);
    const isExcel = /\.xlsx?$/i.test(file.name);
    const isPDF = /\.pdf$/i.test(file.name);
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
    } else if (isPDF) {
      reader.onload = async () => {
        setParsing(true);
        try {
          const res = await parseBankPDF(reader.result);
          if (!res.valid.length && !res.invalid.length)
            setError('No se encontraron movimientos en el PDF.');
          else setParsed(res);
        } catch (err) {
          setError(err.message || 'No se pudo leer el PDF.');
        }
        setParsing(false);
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
      const result = await onImport(parsed.valid, dest);
      setDone(result);
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
              {done.imported} movimiento{done.imported === 1 ? '' : 's'} importado{done.imported === 1 ? '' : 's'}
            </div>
            {done.skipped > 0 && (
              <div style={{ fontSize: 12, color: P.sb, marginBottom: 10 }}>
                {done.skipped} ya existían y se saltaron
              </div>
            )}
            <button onClick={onClose} style={btn(P.ac, '#fff')}>
              Listo
            </button>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 12, color: P.sb, margin: '6px 0 8px' }}>
              Subí un <b>resumen bancario PDF</b> (Macro, Supervielle, Galicia)
              o un archivo <b>Excel / CSV</b> con columnas <b>fecha</b> y <b>monto</b>.
            </p>
            <button
              onClick={() => {
                const csv = [
                  'fecha,concepto,categoria,tipo,monto',
                  '01/07/2026,Supermercado Dia,Supermercado,Egreso,15000',
                  '01/07/2026,Sueldo julio,Trabajo,Ingreso,500000',
                  '02/07/2026,Netflix,Entretenimiento,Egreso,8500',
                  '02/07/2026,Nafta,Transporte,Egreso,20000',
                ].join('\n');
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'plantilla_miplata.csv';
                a.click();
                URL.revokeObjectURL(url);
              }}
              style={{
                background: 'transparent',
                border: `1px solid ${P.bd}`,
                color: P.sb,
                borderRadius: 8,
                padding: '6px 12px',
                fontSize: 11,
                cursor: 'pointer',
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              📋 Descargar plantilla CSV
            </button>

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
              {parsing ? '⏳ Leyendo PDF…' : fileName ? `📄 ${fileName}` : '📂 PDF del banco · Excel · CSV'}
              <input
                type="file"
                accept=".csv,.txt,.xlsx,.xls,.pdf,text/csv"
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

/* ── MES ── */
function PerfilTab({ onExportAll, onExportMonth, onImport, cards, onSaveCards, theme, onToggleTheme, scopeLabel, onOpenSpaces, onOpenCats }) {
  const [showAddCard, setShowAddCard] = useState(false);
  const [newCard, setNewCard] = useState({ name: '', cierre: '', vencimiento: '' });
  const [editingId, setEditingId] = useState(null);
  const [editCard, setEditCard] = useState(null);

  const sectionStyle = { background: P.cd, border: `1px solid ${P.bd}`, borderRadius: 16, padding: '4px 14px', marginBottom: 12 };
  const sectionTitle = (label) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: P.sb, textTransform: 'uppercase', letterSpacing: 1, padding: '10px 0 4px' }}>{label}</div>
  );
  const row = (icon, label, onClick, color) => (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', background: 'transparent', border: 'none', borderBottom: `1px solid ${P.bd}`, padding: '14px 4px', cursor: 'pointer', textAlign: 'left' }}>
      <span style={{ fontSize: 20 }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 500, color: color || P.tx }}>{label}</span>
    </button>
  );

  const handleAddCard = () => {
    if (!newCard.name.trim()) return;
    onSaveCards([...(cards || []), { id: String(Date.now()), ...newCard }]);
    setNewCard({ name: '', cierre: '', vencimiento: '' });
    setShowAddCard(false);
  };

  const handleEditCard = () => {
    if (!editCard?.name?.trim()) return;
    onSaveCards((cards || []).map((c) => c.id === editingId ? { ...c, ...editCard } : c));
    setEditingId(null);
    setEditCard(null);
  };

  const startEdit = (c) => {
    setShowAddCard(false);
    setEditingId(c.id);
    setEditCard({ name: c.name, cierre: c.cierre, vencimiento: c.vencimiento });
  };

  const inputStyle = { width: '100%', background: P.c2, border: `1px solid ${P.bd}`, borderRadius: 10, padding: '9px 12px', fontSize: 13, color: P.tx, boxSizing: 'border-box', outline: 'none', marginBottom: 8 };

  return (
    <div style={{ paddingBottom: 80 }}>

      {/* Espacio y categorías */}
      <div style={sectionStyle}>
        {sectionTitle('Espacio')}
        <button onClick={onOpenSpaces} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'transparent', border: 'none', borderBottom: `1px solid ${P.bd}`, padding: '14px 4px', cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: P.tx }}>{scopeLabel}</span>
          <span style={{ fontSize: 13, color: P.ac, fontWeight: 600 }}>Cambiar ▾</span>
        </button>
        {row('🏷️', 'Categorías', onOpenCats)}
      </div>

      {/* Apariencia */}
      <div style={sectionStyle}>
        {sectionTitle('Apariencia')}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 4px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>{theme === 'dark' ? '🌙' : '☀️'}</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: P.tx }}>Modo {theme === 'dark' ? 'oscuro' : 'claro'}</span>
          </div>
          <div
            onClick={onToggleTheme}
            style={{ width: 50, height: 28, borderRadius: 14, background: theme === 'dark' ? P.ac : P.bd, cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background 0.2s' }}
          >
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: theme === 'dark' ? 25 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
          </div>
        </div>
      </div>

      {/* Tarjetas de crédito */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {sectionTitle('Tarjetas de crédito')}
          <button
            onClick={() => setShowAddCard((v) => !v)}
            style={{ background: 'transparent', border: 'none', color: P.ac, fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '4px 0' }}
          >
            {showAddCard ? 'Cancelar' : '+ Agregar'}
          </button>
        </div>

        {showAddCard && (
          <div style={{ background: P.c2, borderRadius: 12, padding: 12, marginBottom: 10 }}>
            <input
              style={inputStyle}
              placeholder="Nombre (ej: Visa Macro)"
              value={newCard.name}
              onChange={(e) => setNewCard((v) => ({ ...v, name: e.target.value }))}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...inputStyle, marginBottom: 0 }}
                type="number"
                min="1"
                max="31"
                placeholder="Día de cierre aprox. (ej: 15)"
                value={newCard.cierre}
                onChange={(e) => setNewCard((v) => ({ ...v, cierre: e.target.value }))}
              />
              <input
                style={{ ...inputStyle, marginBottom: 0 }}
                type="number"
                min="1"
                max="31"
                placeholder="Día de venc. aprox. (ej: 22)"
                value={newCard.vencimiento}
                onChange={(e) => setNewCard((v) => ({ ...v, vencimiento: e.target.value }))}
              />
            </div>
            <div style={{ fontSize: 11, color: P.sb, marginTop: 4 }}>
              Días aproximados: si tu tarjeta se mueve un poco cada mes, poné el día más cercano.
            </div>
            <button
              onClick={handleAddCard}
              style={{ marginTop: 10, width: '100%', background: P.ac, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              Agregar tarjeta
            </button>
          </div>
        )}

        {(cards || []).length === 0 && !showAddCard ? (
          <div style={{ fontSize: 12, color: P.sb, textAlign: 'center', padding: '10px 0 14px' }}>Sin tarjetas agregadas</div>
        ) : (cards || []).map((c) => (
          <div key={c.id} style={{ borderTop: `1px solid ${P.bd}` }}>
            {editingId === c.id ? (
              <div style={{ background: P.c2, borderRadius: 12, padding: 12, margin: '8px 0' }}>
                <input
                  style={inputStyle}
                  placeholder="Nombre"
                  value={editCard.name}
                  onChange={(e) => setEditCard((v) => ({ ...v, name: e.target.value }))}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    style={{ ...inputStyle, marginBottom: 0 }}
                    type="number"
                    min="1"
                    max="31"
                    placeholder="Día de cierre aprox."
                    value={editCard.cierre}
                    onChange={(e) => setEditCard((v) => ({ ...v, cierre: e.target.value }))}
                  />
                  <input
                    style={{ ...inputStyle, marginBottom: 0 }}
                    type="number"
                    min="1"
                    max="31"
                    placeholder="Día de venc. aprox."
                    value={editCard.vencimiento}
                    onChange={(e) => setEditCard((v) => ({ ...v, vencimiento: e.target.value }))}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button
                    onClick={() => { setEditingId(null); setEditCard(null); }}
                    style={{ flex: 1, background: P.bd, border: 'none', borderRadius: 10, padding: '9px 0', fontSize: 13, fontWeight: 600, color: P.tx, cursor: 'pointer' }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleEditCard}
                    style={{ flex: 2, background: P.ac, border: 'none', borderRadius: 10, padding: '9px 0', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}
                  >
                    Guardar
                  </button>
                  <button
                    onClick={() => { onSaveCards((cards || []).filter((x) => x.id !== c.id)); setEditingId(null); }}
                    style={{ flex: 1, background: P.rb, border: 'none', borderRadius: 10, padding: '9px 0', fontSize: 13, fontWeight: 600, color: P.rd, cursor: 'pointer' }}
                  >
                    Borrar
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => startEdit(c)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 4px', cursor: 'pointer' }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: P.tx }}>💳 {c.name}</div>
                  <div style={{ fontSize: 11, color: P.sb, marginTop: 2 }}>
                    Cierre: día {c.cierre || '—'} (aprox.) · Vence: día {c.vencimiento || '—'} (aprox.)
                  </div>
                </div>
                <span style={{ fontSize: 12, color: P.sb }}>✏️</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Exportar */}
      <div style={sectionStyle}>
        {sectionTitle('Exportar')}
        {row('📤', 'Exportar todo (CSV)', onExportAll)}
        {row('📅', 'Exportar mes actual (CSV)', onExportMonth)}
      </div>

      {/* Importar */}
      <div style={{ ...sectionStyle, marginBottom: 0 }}>
        {sectionTitle('Datos')}
        {row('📥', 'Importar datos', onImport)}
      </div>

    </div>
  );
}

const PAY_LABEL = { efectivo: 'Efectivo', transferencia: 'Transferencia', credito: 'Crédito' };
function catRowStyle(catName) {
  const isDark = P.bg === P_DARK.bg;
  const map = {
    'Alimentación': { c: '#E07840', bg: isDark ? 'rgba(224,120,64,.15)' : '#FFF0E8' },
    'Vivienda': { c: '#3A7BD5', bg: isDark ? 'rgba(58,123,213,.15)' : '#EAF0FF' },
    'Transporte': { c: P.gn, bg: isDark ? 'rgba(46,196,160,.12)' : '#E6F5F0' },
    'Bienestar': { c: P.gn, bg: isDark ? 'rgba(46,196,160,.08)' : '#EAF8F5' },
    'Entretenimiento': { c: '#8B5CF6', bg: isDark ? 'rgba(139,92,246,.15)' : '#F0EEFF' },
    'Compras': { c: '#D4678A', bg: isDark ? 'rgba(212,103,138,.15)' : '#FFF0F5' },
    'Obligaciones': { c: P.rd, bg: isDark ? 'rgba(232,113,94,.12)' : P.rb },
    'Tarjetas': { c: '#C9B89A', bg: isDark ? 'rgba(201,184,154,.1)' : '#FFF8E6' },
  };
  if (map[catName]) return map[catName];
  const idx = Math.abs([...(catName || '')].reduce((a, c) => a + c.charCodeAt(0), 0)) % pal.length;
  return { c: pal[idx], bg: P.c2 };
}
function relDayLabel(d) {
  const todayS = td();
  const yd = new Date();
  yd.setDate(yd.getDate() - 1);
  const yestS = yd.toISOString().slice(0, 10);
  const [, m, dd] = d.split('-').map(Number);
  const mAbbr = MO[m - 1].toUpperCase();
  if (d === todayS) return { label: `HOY · ${dd} ${mAbbr}`, rel: 'hoy' };
  if (d === yestS) return { label: `AYER · ${dd} ${mAbbr}`, rel: 'ayer' };
  return { label: `${dd} ${mAbbr}`, rel: '' };
}

function DiariosTab({ mob, cur, activeTx, month, onAdd, onEdit, onExport, customCats }) {
  const [usdRates, setUsdRates] = useState(null);
  const [filter, setFilter] = useState('todos');
  const [showSearch, setShowSearch] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => {
    fetch('https://api.bluelytics.com.ar/v2/latest')
      .then((r) => r.json())
      .then((d) => setUsdRates({ venta: Math.round(d.oficial?.value_sell) }))
      .catch(() => {});
  }, []);

  const pool = activeTx.filter(
    (t) => mk(t.date) === month && !(t.type === 'gasto' && t.recurring)
  );
  const FILTERS = [
    { id: 'todos', l: 'Todos' },
    { id: 'ingreso', l: 'Ingresos' },
    { id: 'gasto', l: 'Gastos' },
    { id: 'ahorro', l: 'Ahorro' },
  ];
  let items = filter === 'todos' ? pool : pool.filter((t) => t.type === filter);
  if (q.trim()) {
    const qq = q.trim().toLowerCase();
    items = items.filter((t) =>
      (t.desc || '').toLowerCase().includes(qq) ||
      (t.cat || '').toLowerCase().includes(qq) ||
      (t.sub || '').toLowerCase().includes(qq)
    );
  }
  items = [...items].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const toARS = (t) => (t.cur === 'USD' ? t.amt * ((usdRates?.venta) || 1200) : t.amt);
  const totalSel = items.reduce((s, t) => s + (t.type === 'gasto' ? -toARS(t) : toARS(t)), 0);
  const totalColor = filter === 'ingreso' ? P.gn : filter === 'gasto' ? P.rd : filter === 'ahorro' ? P.ac : (totalSel >= 0 ? P.gn : P.rd);

  const byDay = {};
  items.forEach((t) => {
    const d = String(t.date).slice(0, 10);
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(t);
  });
  const days = Object.keys(byDay).sort((a, b) => b.localeCompare(a));

  return (
    <div style={{ paddingBottom: 80 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 24, fontWeight: 800, color: P.tx }}>Movimientos</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowSearch((v) => !v)}
            style={{ width: 38, height: 38, borderRadius: 12, background: P.cd, border: `1px solid ${P.bd}`, color: P.tx, fontSize: 15, cursor: 'pointer' }}
          >
            🔍
          </button>
          <button onClick={onExport} style={{ width: 38, height: 38, borderRadius: 12, background: P.cd, border: `1px solid ${P.bd}`, color: P.tx, fontSize: 15, cursor: 'pointer' }}>📤</button>
          <button onClick={() => onAdd('gasto')} style={{ background: P.ac, color: '#fff', border: 'none', borderRadius: 12, padding: '0 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>+ Agregar</button>
        </div>
      </div>

      {showSearch && (
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o categoría..."
          style={{ width: '100%', background: P.cd, border: `1px solid ${P.bd}`, borderRadius: 12, padding: '10px 14px', fontSize: 13, color: P.tx, marginBottom: 12, boxSizing: 'border-box' }}
        />
      )}

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 14 }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              flexShrink: 0,
              background: filter === f.id ? P.ac : P.cd,
              color: filter === f.id ? '#fff' : P.sb,
              border: filter === f.id ? 'none' : `1px solid ${P.bd}`,
              borderRadius: 20,
              padding: '8px 16px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {f.l}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 13, color: P.sb, marginBottom: 12 }}>
        Total: <b style={{ color: totalColor, fontSize: 15 }}>{fmtS(totalSel)}</b>
      </div>

      {items.length === 0 ? (
        <Nil
          icon="✨"
          t="Sin movimientos"
          sub="Probá otro filtro o cargá uno nuevo."
          action="➕ Agregar movimiento"
          onAction={() => onAdd('gasto')}
        />
      ) : days.map((d) => {
        const dayTxs = byDay[d];
        const { label } = relDayLabel(d);
        return (
          <div key={d} style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, color: P.sb, marginBottom: 12 }}>
              {label}
            </div>
            {dayTxs.map((t) => {
              const isIn = t.type === 'ingreso';
              const isSav = t.type === 'ahorro';
              const { c: iconColor, bg: iconBg } = catRowStyle(t.cat);
              const emoji = (getCats(t.type, customCats).find((c) => c.n === t.cat) || {}).i || (isIn ? '💰' : isSav ? '🏦' : '🏷️');
              const amtColor = isIn ? P.gn : isSav ? P.ac : P.rd;
              const { rel } = relDayLabel(String(t.date).slice(0, 10));
              return (
                <div
                  key={t.id}
                  onClick={() => onEdit(t)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: P.cd,
                    border: `1px solid ${P.bd}`,
                    borderRadius: 16,
                    padding: '14px 16px',
                    marginBottom: 8,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ width: 44, height: 44, borderRadius: 14, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flexShrink: 0 }}>
                    {emoji}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: P.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.desc || t.cat}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: P.sb, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.cat}{t.sub ? ` · ${t.sub}` : ''}{t.pay ? ` · ${PAY_LABEL[t.pay] || t.pay}` : ''}{t.member ? ` · 👤 ${t.member.split(' ')[0]}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: amtColor }}>
                      {isIn ? '+' : isSav ? '' : '−'}{fmtS(t.amt, t.cur)}
                    </div>
                    {rel && <div style={{ fontSize: 11, fontWeight: 500, color: P.sb, marginTop: 2 }}>{rel}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function MesTab({
  mob, cur, activeTx, totIn, month, onAdd, onEdit, onRegister, onUnregister, onRemoveSerie, onPauseSerie, onExport, onExchange,
}) {
  const [usdRates, setUsdRates] = useState(null);
  useEffect(() => {
    fetch('https://api.bluelytics.com.ar/v2/latest')
      .then((r) => r.json())
      .then((d) => setUsdRates({ compra: Math.round(d.oficial?.value_buy), venta: Math.round(d.oficial?.value_sell) }))
      .catch(() => {});
  }, []);
  const todayStr = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  })();
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
    activeTx.some((t) => t.serieId === serieId && mk(t.date) === month && !t.pending);

  const ingresos = activeTx.filter((t) => t.type === 'ingreso' && mk(t.date) === month);

  // Suscripciones: gastos con categoría o subcategoría "suscripción/suscripciones" registrados este mes
  const isSusc = (t) => {
    const s = (v) => (v || '').toLowerCase();
    return t.susc === true || s(t.cat).includes('suscripci') || s(t.sub).includes('suscripci');
  };
  const suscripciones = activeTx.filter((t) => t.type === 'gasto' && mk(t.date) === month && t.cur === cur && isSusc(t));

  // Cuotas: gastos en cuotas (credito, cuotas > 1) distribuidos al mes actual
  const cuotasMes = chargesForMonth(
    activeTx.filter((t) => t.type === 'gasto' && t.pay === 'credito' && t.cuotas > 1 && t.cur === cur),
    month
  );

  const totalIngresos = ingresos.reduce((s, t) => s + (t.cur === 'USD' ? t.amt * ((usdRates?.venta) || 1200) : t.amt), 0);
  const totalFijos = recList.reduce((s, t) => s + (t.cur === 'USD' ? t.amt * ((usdRates?.venta) || 1200) : t.amt), 0);
  const totalSusc = suscripciones.reduce((s, t) => s + t.amt, 0);
  const totalCuotas = cuotasMes.reduce((s, t) => s + t.amt, 0);

  const todayD = Number(todayStr.slice(8, 10));
  const monthNum = Number(todayStr.slice(5, 7));

  const SectionCard = ({ icon, label, total, color, onAgregar, children }) => (
    <div style={{ background: P.cd, border: `1px solid ${P.bd}`, borderRadius: 16, padding: '14px 14px 6px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>{icon}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: P.tx }}>{label}</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color, marginTop: 2 }}>{fmtS(total)}</div>
        </div>
        <button
          onClick={onAgregar}
          style={{ background: P.ac, color: '#fff', border: 'none', borderRadius: 20, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
        >
          + Agregar
        </button>
      </div>
      {children}
      <div style={{ fontSize: 10, color: P.sb, textAlign: 'center', padding: '8px 0 4px' }}>
        Tocá para editar
      </div>
    </div>
  );

  return (
    <div style={{ paddingBottom: 80 }}>

      {/* Utilidades del mes */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={onExchange} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: P.cd, border: `1px solid ${P.bd}`, borderRadius: 10, padding: '9px 0', fontSize: 12, fontWeight: 600, color: P.tx, cursor: 'pointer' }}>
          💱 Comprar dólares
        </button>
        <button onClick={onExport} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: P.cd, border: `1px solid ${P.bd}`, borderRadius: 10, padding: '9px 0', fontSize: 12, fontWeight: 600, color: P.tx, cursor: 'pointer' }}>
          📤 Exportar mes
        </button>
      </div>

      {/* Ingresos */}
      <SectionCard icon="💰" label="Ingresos" total={totalIngresos} color={P.gn} onAgregar={() => onAdd('ingreso')}>
        {ingresos.length === 0 ? (
          <div style={{ fontSize: 12, color: P.sb, textAlign: 'center', padding: '8px 0' }}>Sin ingresos este mes</div>
        ) : ingresos.map((t) => (
          <div key={t.id} onClick={() => onEdit(t)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderTop: `1px solid ${P.bd}`, cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 18 }}>📥</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: P.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{t.desc || t.cat}</span>
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, color: P.gn, flexShrink: 0 }}>{fmtS(t.amt, t.cur)}</span>
          </div>
        ))}
      </SectionCard>

      {/* Recurrentes */}
      {recList.length > 0 && (
        <div style={{ background: P.cd, border: `1px solid ${P.bd}`, borderRadius: 16, padding: '14px 14px 6px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 16 }}>🔁</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: P.tx }}>Recurrentes</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: P.rd, marginTop: 2 }}>{fmtS(totalFijos)}</div>
            </div>
            <button onClick={() => onAdd('gasto')} style={{ background: P.ac, color: '#fff', border: 'none', borderRadius: 20, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              + Agregar
            </button>
          </div>
          {recList.map((t) => {
            const done = doneThisMonth(t.serieId);
            const due = t.dueDay || (t.date ? Number(String(t.date).slice(8, 10)) : null);
            const dueInfo = (() => {
              if (!due) return null;
              const fecha = `${due}/${monthNum}`;
              if (done) return { text: '✓ Pagado', color: P.gn, bg: P.gb };
              const diff = due - todayD;
              if (diff < 0) return { text: `⚠️ Venció ${fecha}`, color: P.rd, bg: P.rb };
              if (diff === 0) return { text: '📅 Vence hoy', color: P.rd, bg: P.rb };
              if (diff <= 3) return { text: `📅 Vence en ${diff}d · ${fecha}`, color: P.am, bg: P.am + '22' };
              return { text: `📅 Vence ${fecha}`, color: P.sb, bg: P.c2 };
            })();
            const pctIncome = totIn > 0 ? ((t.cur === 'USD' ? t.amt * ((usdRates?.venta) || 1200) : t.amt) / totIn * 100).toFixed(0) : null;
            return (
              <div key={t.serieId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: `1px solid ${P.bd}`, opacity: t.paused ? 0.5 : 1 }}>
                <button
                  onClick={() => { if (t.paused) return; done ? onUnregister(t) : onRegister(t); }}
                  title={done ? 'Tocá para destildar (quitar el pago de este mes)' : 'Marcar como pagado este mes'}
                  style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, border: `2px solid ${done ? P.gn : P.bd}`, background: done ? P.gn : 'transparent', cursor: t.paused ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700 }}
                >
                  {done ? '✓' : ''}
                </button>
                <div onClick={() => onEdit(t)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} title="Tocá para editar (monto, día, etc.)">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: done ? P.sb : P.tx, textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                      {t.paused ? '⏸ ' : ''}{t.desc || t.sub || t.cat}
                    </span>
                    {pctIncome && (
                      <span style={{ fontSize: 10, color: P.sb, background: P.bd, borderRadius: 6, padding: '1px 5px', flexShrink: 0 }}>{pctIncome}%</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: P.sb, marginTop: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 500, color: done ? P.sb : P.tx }}>{fmtS(t.amt, t.cur)}</span>
                    {!t.paused && dueInfo && <span style={{ color: dueInfo.color, fontWeight: 600, fontSize: 10, background: dueInfo.bg, borderRadius: 6, padding: '2px 7px' }}>{dueInfo.text}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button onClick={() => onPauseSerie(t.serieId, !t.paused)} style={{ background: 'transparent', color: P.sb, border: 'none', padding: '4px 6px', fontSize: 14, cursor: 'pointer' }}>
                    {t.paused ? '▶' : '⏸'}
                  </button>
                  <button onClick={() => { if (window.confirm(`¿Sacar "${t.desc || t.sub || t.cat}" de los recurrentes?`)) onRemoveSerie(t.serieId); }} style={{ background: 'transparent', color: P.sb, border: 'none', padding: '4px 6px', fontSize: 16, cursor: 'pointer' }}>×</button>
                </div>
              </div>
            );
          })}
          <div style={{ fontSize: 10, color: P.sb, textAlign: 'center', padding: '8px 0 4px' }}>Tocá para editar</div>
        </div>
      )}

      {/* Suscripciones */}
      {suscripciones.length > 0 && (
        <div style={{ background: P.cd, border: `1px solid ${P.bd}`, borderRadius: 16, padding: '14px 14px 6px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 16 }}>📲</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: P.tx }}>Suscripciones</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: P.rd, marginTop: 2 }}>{fmtS(totalSusc, cur)}</div>
            </div>
          </div>
          {suscripciones.map((t) => (
            <div key={t.id} onClick={() => onEdit(t)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderTop: `1px solid ${P.bd}`, cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 18 }}>🔁</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: P.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>{t.desc || t.sub || t.cat}</div>
                  <div style={{ fontSize: 11, color: P.sb }}>{t.cat}</div>
                </div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: P.rd, flexShrink: 0 }}>{fmtS(t.amt, t.cur)}</span>
            </div>
          ))}
          <div style={{ fontSize: 10, color: P.sb, textAlign: 'center', padding: '8px 0 4px' }}>Tocá para editar</div>
        </div>
      )}

      {/* Cuotas */}
      {cuotasMes.length > 0 && (
        <div style={{ background: P.cd, border: `1px solid ${P.bd}`, borderRadius: 16, padding: '14px 14px 6px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 16 }}>💳</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: P.tx }}>Cuotas</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: P.rd, marginTop: 2 }}>{fmtS(totalCuotas, cur)}</div>
            </div>
            <button onClick={() => onAdd('gasto')} style={{ background: P.ac, color: '#fff', border: 'none', borderRadius: 20, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              + Agregar
            </button>
          </div>
          {cuotasMes.map((t) => (
            <div key={t.id} onClick={() => onEdit(t)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderTop: `1px solid ${P.bd}`, cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 18 }}>💳</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: P.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>{t.desc || t.sub || t.cat}</div>
                  <div style={{ fontSize: 11, color: P.sb }}>Cuota {t.cuotaInfo} · {t.card || 'Tarjeta'}</div>
                </div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: P.rd, flexShrink: 0 }}>{fmtS(t.amt, cur)}</span>
            </div>
          ))}
          <div style={{ fontSize: 10, color: P.sb, textAlign: 'center', padding: '8px 0 4px' }}>Tocá para editar</div>
        </div>
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
  onUnregister,
  favorites = [],
  onUseFav,
  onRemoveFav,
  pendingTx = [],
  onMarkPaid,
  onRemoveSerie,
  onPauseSerie,
  onAdd,
  onSeeAll,
  onSeeCats,
}) {
  const maxC = byCat.length ? byCat[0][1] : 1;
  const isDark = P.bg === P_DARK.bg;
  const catColor = (name) => {
    const map = {
      'Alimentación': { c: '#E07840', bg: isDark ? 'rgba(224,120,64,.15)' : '#FFF0E8' },
      'Vivienda': { c: '#3A7BD5', bg: isDark ? 'rgba(58,123,213,.15)' : '#EAF0FF' },
      'Transporte': { c: P.gn, bg: isDark ? 'rgba(46,196,160,.12)' : '#E6F5F0' },
      'Bienestar': { c: P.gn, bg: isDark ? 'rgba(46,196,160,.08)' : '#EAF8F5' },
      'Entretenimiento': { c: '#8B5CF6', bg: isDark ? 'rgba(139,92,246,.15)' : '#F0EEFF' },
      'Compras': { c: '#D4678A', bg: isDark ? 'rgba(212,103,138,.15)' : '#FFF0F5' },
      'Obligaciones': { c: P.rd, bg: isDark ? 'rgba(232,113,94,.12)' : P.rb },
      'Tarjetas': { c: '#C9B89A', bg: isDark ? 'rgba(201,184,154,.1)' : '#FFF8E6' },
    };
    return map[name] || { c: pal[Math.abs(name?.length || 0) % pal.length], bg: P.c2 };
  };
  const catIcon = (name) => (getCats('gasto', customCats).find((c) => c.n === name) || {}).i || '🏷️';
  const [hoverMonth, setHoverMonth] = useState(null);
  const [usdRates, setUsdRates] = useState(null);
  const [showDiarios, setShowDiarios] = useState(false);
  useEffect(() => {
    fetch('https://api.bluelytics.com.ar/v2/latest')
      .then((r) => r.json())
      .then((d) => setUsdRates({ compra: Math.round(d.oficial?.value_buy), venta: Math.round(d.oficial?.value_sell) }))
      .catch(() => {});
  }, []);
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
  const [showPending, setShowPending] = useState(false);

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
    activeTx.some((t) => t.serieId === serieId && mk(t.date) === month && !t.pending);
  const freqLabel = {
    mensual: 'mensual',
    semanal: 'semanal',
    quincenal: 'quincenal',
    anual: 'anual',
  };
  // Resumen por persona (solo grupo)
  const byMember = {};
  if (isGroup) {
    mtx.filter((t) => !t.pending).forEach((t) => {
      const who = t.member || t.createdByName || '—';
      if (!byMember[who]) byMember[who] = { ingreso: 0, gasto: 0, ahorro: 0 };
      byMember[who][t.type] = (byMember[who][t.type] || 0) + t.amt;
    });
  }
  const memberRows = Object.entries(byMember).sort(
    (a, b) => b[1].gasto + b[1].ingreso - (a[1].gasto + a[1].ingreso)
  );
  // Distribución del ingreso (cómo se reparte el ingreso del mes)
  const distSegments = (() => {
    if (totIn <= 0) return [];
    const gastos = mtx.filter((t) => t.type === 'gasto' && !t.pending);
    const recAmt = gastos.filter((t) => t.recurring).reduce((s, t) => s + t.amt, 0);
    const cuotaAmt = gastos.filter((t) => !t.recurring && t.pay === 'credito').reduce((s, t) => s + t.amt, 0);
    const varAmt = gastos.filter((t) => !t.recurring && t.pay !== 'credito').reduce((s, t) => s + t.amt, 0);
    const savAmt = mtx.filter((t) => t.type === 'ahorro').reduce((s, t) => s + t.amt, 0);
    const dispAmt = Math.max(0, bal);
    return [
      { label: 'Disponible', value: dispAmt, color: P.gn },
      { label: 'Ahorro', value: savAmt, color: P.ac },
      { label: 'Recurrentes', value: recAmt, color: P.am },
      { label: 'Tarjeta', value: cuotaAmt, color: '#8B6CF6' },
      { label: 'Otros gastos', value: varAmt, color: P.rd },
    ].filter((s) => s.value > 0);
  })();

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
          background: P.bal,
          padding: mob ? 20 : 22,
          order: -1,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4 }}>
          Balance de {MOF[Number(month.slice(5, 7)) - 1]}
        </div>
        <div
          style={{
            fontSize: mob ? 34 : 46,
            fontWeight: 800,
            color: '#fff',
            lineHeight: 1.05,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fmt(bal, cur)}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 3 }}>
          {bal >= 0
            ? 'Disponible este mes'
            : 'Este mes gastaste más de lo que ingresó'}
        </div>

        {isGroup && memberRows.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
            {memberRows.map(([who, m]) => {
              const q = m.ingreso - m.gasto;
              return (
                <span key={who} style={{ fontSize: 11, color: 'rgba(255,255,255,.55)' }}>
                  {who.split(' ')[0]}: <b style={{ color: q >= 0 ? P.gn : P.rd }}>{fmtS(q, cur)}</b>
                </span>
              );
            })}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 14,
            borderTop: '1px solid rgba(255,255,255,.12)',
            paddingTop: 14,
          }}
        >
          {[
            ['Ingresos', totIn, P.gn],
            ['Gastos', totOut, P.rd],
            ['Ahorro', totSav, 'rgba(255,255,255,.9)'],
          ].map(([l, v, c], i) => (
            <Fragment key={l}>
              {i > 0 && <div style={{ width: 1, background: 'rgba(255,255,255,.12)', flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0, paddingLeft: i > 0 ? 14 : 0 }}>
              <div
                style={{
                  fontSize: 11,
                  color: 'rgba(255,255,255,.45)',
                  fontWeight: 500,
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
            </Fragment>
          ))}
        </div>

        {isCurrentMonth && bal > 0 && daysLeft > 0 && (
          <div
            style={{
              marginTop: 12,
              background: 'rgba(255,255,255,.1)',
              borderRadius: 12,
              padding: '10px 12px',
              fontSize: 12,
              color: '#fff',
            }}
          >
            🔔 Te quedan <b>{fmtS(bal, cur)}</b> para {daysLeft} día
            {daysLeft === 1 ? '' : 's'} · ~{fmtS(perDay, cur)}/día
          </div>
        )}

        {hasBudgets && (
          <div style={{ marginTop: 12 }}>
            <div style={{ height: 7, borderRadius: 4, background: 'rgba(255,255,255,.15)' }}>
              <div style={{ height: '100%', borderRadius: 4, width: `${Math.min(100, totIn > 0 ? (totOut / totIn) * 100 : 0)}%`, background: totOut / totIn > 0.8 ? P.rd : P.gn, transition: 'width .4s ease' }} />
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)', marginTop: 5 }}>
              Gastaste el {totIn > 0 ? Math.round((totOut / totIn) * 100) : 0}%
              de lo que ingresó
            </div>
          </div>
        )}

        {/* Pills de acción rápida */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {[
            { label: '+ Ingreso', type: 'ingreso' },
            { label: '− Gasto', type: 'gasto' },
            { label: '📅 Diarios', type: 'gasto' },
          ].map(({ label, type }) => (
            <button
              key={label}
              onClick={() => type ? onAdd(type) : setShowDiarios((v) => !v)}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,.12)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,.18)',
                borderRadius: 10,
                padding: '8px 4px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </Box>

      {/* Por categoría */}
      {byCat.length > 0 && (() => {
        const totCatAll = byCat.reduce((s, [, a]) => s + a, 0) || 1;
        return (
          <Box>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: P.tx }}>Por categoría</span>
              {onSeeCats && (
                <span onClick={onSeeCats} style={{ fontSize: 12, fontWeight: 600, color: P.ac, cursor: 'pointer' }}>Ver todo →</span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {byCat.slice(0, 5).map(([catName, amt]) => {
                const { c, bg } = catColor(catName);
                const pct = Math.round((amt / totCatAll) * 100);
                return (
                  <div key={catName} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 13, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                      {catIcon(catName)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: P.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{catName}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: P.tx, flexShrink: 0, marginLeft: 8 }}>{fmtS(amt, cur)}</span>
                      </div>
                      <div style={{ height: 7, borderRadius: 4, background: isDark ? 'rgba(255,255,255,.08)' : '#EDE9E2', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: c, borderRadius: 4, transition: 'width .4s ease' }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Box>
        );
      })()}

      {/* ── DIARIOS: gastos del mes agrupados por día ── */}
      {showDiarios && (() => {
        const gastosMes = activeTx
          .filter((t) => t.type !== 'ingreso' && t.type !== 'ahorro' && t.type !== 'cambio')
          .sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const byDay = {};
        gastosMes.forEach((t) => {
          const d = String(t.date).slice(0, 10);
          if (!byDay[d]) byDay[d] = [];
          byDay[d].push(t);
        });
        const days = Object.keys(byDay).sort((a, b) => b.localeCompare(a));
        const totalMes = gastosMes.reduce((s, t) => s + Number(t.amt || 0), 0);
        const diasConGasto = days.length;
        const promDia = diasConGasto > 0 ? totalMes / diasConGasto : 0;
        return (
          <Box>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <Lbl style={{ margin: 0 }}>📅 Diarios</Lbl>
              <button onClick={() => setShowDiarios(false)} style={{ background: 'none', border: 'none', color: P.sb, cursor: 'pointer', fontSize: 13 }}>✕</button>
            </div>
            <div style={{ display: 'flex', gap: 0, marginBottom: 14 }}>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: P.rd, fontVariantNumeric: 'tabular-nums' }}>{fmtS(totalMes, cur)}</div>
                <div style={{ fontSize: 10, color: P.sb, marginTop: 2 }}>Este mes</div>
              </div>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: P.tx, fontVariantNumeric: 'tabular-nums' }}>{fmtS(promDia, cur)}</div>
                <div style={{ fontSize: 10, color: P.sb, marginTop: 2 }}>Promedio / día</div>
              </div>
            </div>
            {days.length === 0 ? (
              <div style={{ textAlign: 'center', color: P.sb, fontSize: 13, padding: '12px 0' }}>Sin gastos este mes</div>
            ) : days.map((d) => {
              const dayTotal = byDay[d].reduce((s, t) => s + Number(t.amt || 0), 0);
              const fecha = new Date(d + 'T00:00:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
              return (
                <div key={d} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: P.sb, textTransform: 'capitalize' }}>{fecha}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: P.rd }}>{fmtS(dayTotal, cur)}</span>
                  </div>
                  {byDay[d].map((t) => {
                    const cd = getCats(t.type, customCats).find((c) => c.n === t.cat);
                    return (
                      <div
                        key={t.id}
                        onClick={() => onEdit(t)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          background: P.cd,
                          border: `1px solid ${P.bd}`,
                          borderRadius: 12,
                          padding: '9px 12px',
                          marginBottom: 6,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ width: 32, height: 32, borderRadius: 9, background: P.rb, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
                          {cd?.i || '📌'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.desc || t.sub || t.cat}
                          </div>
                          <div style={{ fontSize: 10, color: P.sb }}>{t.cat}</div>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: P.rd, flexShrink: 0 }}>−{fmtS(t.amt, cur)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </Box>
        );
      })()}

      {/* Distribución del ingreso */}
      {distSegments.length > 0 && (
        <Box>
          <Lbl>Distribución del ingreso</Lbl>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <Donut segments={distSegments} size={mob ? 118 : 136} stroke={18} />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1,
                }}
              >
                <span style={{ fontSize: 9, color: P.sb, textTransform: 'uppercase', letterSpacing: 0.4 }}>Ingresos</span>
                <span style={{ fontSize: mob ? 11 : 12, fontWeight: 700, color: P.gn, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtS(totIn, cur)}
                </span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {distSegments.map((s) => (
                <div
                  key={s.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '4px 0',
                    borderBottom: `1px solid ${P.bd}`,
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
                  <span style={{ flex: 1, fontSize: 11, color: P.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.label}
                  </span>
                  <span style={{ fontSize: 11, color: P.sb, fontWeight: 500 }}>
                    {Math.round((s.value / totIn) * 100)}%
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: P.tx, fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'right' }}>
                    {fmtS(s.value, cur)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Box>
      )}

      {/* Estado de Pagos */}
      {recList.length > 0 && (() => {
        const pagados = recList.filter((t) => doneThisMonth(t.serieId)).length;
        const pendientes = recList.filter((t) => !doneThisMonth(t.serieId) && !t.paused).length;
        return (
          <Box>
            <Lbl>Estado de pagos fijos</Lbl>
            <div style={{ display: 'flex', gap: 0 }}>
              {[
                { label: 'Pagados', val: pagados, color: P.gn },
                { label: 'Pendientes', val: pendientes, color: pendientes > 0 ? P.am : P.sb },
                { label: 'Total', val: recList.length, color: P.tx },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ flex: 1, textAlign: 'center', padding: '4px 0' }}>
                  <div style={{ fontSize: mob ? 26 : 30, fontWeight: 700, color }}>{val}</div>
                  <div style={{ fontSize: 11, color: P.sb, marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          </Box>
        );
      })()}

      {/* Dólar Oficial */}
      {usdRates && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: P.cd,
            border: `1px solid ${P.bd}`,
            borderRadius: 12,
            padding: '10px 14px',
          }}
        >
          <span style={{ fontSize: 18 }}>💵</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: P.tx }}>Dólar Oficial</span>
          <span style={{ fontSize: 12, color: P.sb, marginLeft: 'auto' }}>
            Compra ${usdRates.compra.toLocaleString('es-AR')} · Venta ${usdRates.venta.toLocaleString('es-AR')}
          </span>
        </div>
      )}

      {/* Gastos fijos mensuales con vencimiento — estilo Guita */}
      {recList.filter((t) => !t.freq || t.freq === 'mensual').length > 0 && (() => {
        const recMensuales = recList.filter((t) => !t.freq || t.freq === 'mensual');
        const totalFijos = recMensuales.reduce((s, t) => s + (t.cur === 'USD' ? t.amt * ((usdRates?.venta) || 1200) : t.amt), 0);
        return (
          <Box>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: P.sb, textTransform: 'uppercase', letterSpacing: 1 }}>Recurrentes</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: P.tx }}>{fmtS(totalFijos)}</div>
              </div>
              <button
                onClick={() => onAdd && onAdd('gasto')}
                style={{ background: P.ac, color: '#fff', border: 'none', borderRadius: 20, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                + Agregar
              </button>
            </div>
            {recMensuales.map((t) => {
              const done = doneThisMonth(t.serieId);
              const todayD = Number(todayStr.slice(8, 10));
              const due = t.dueDay || (t.date ? Number(String(t.date).slice(8, 10)) : null);
              const mesN = new Date().getMonth() + 1;
              const dueInfo = (() => {
                if (!due) return null;
                const fecha = `${due}/${mesN}`;
                if (done) return { text: '✓ Pagado', color: P.gn, bg: P.gb };
                const diff = due - todayD;
                if (diff < 0) return { text: `⚠️ Venció ${fecha}`, color: P.rd, bg: P.rb };
                if (diff === 0) return { text: '📅 Vence hoy', color: P.rd, bg: P.rb };
                if (diff <= 3) return { text: `📅 Vence en ${diff}d · ${fecha}`, color: P.am, bg: P.am + '22' };
                return { text: `📅 Vence ${fecha}`, color: P.sb, bg: P.c2 };
              })();
              const pctIncome = totIn > 0 ? ((t.cur === 'USD' ? t.amt * ((usdRates?.venta) || 1200) : t.amt) / totIn * 100).toFixed(0) : null;
              return (
                <div
                  key={t.serieId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 0',
                    borderBottom: `1px solid ${P.bd}`,
                    opacity: t.paused ? 0.5 : 1,
                  }}
                >
                  {/* Checkbox */}
                  <button
                    onClick={() => { if (t.paused) return; done ? onUnregister && onUnregister(t) : onRegister(t); }}
                    title={done ? 'Tocá para destildar (quitar el pago de este mes)' : 'Marcar como pagado'}
                    style={{
                      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${done ? P.gn : P.bd}`,
                      background: done ? P.gn : 'transparent',
                      cursor: t.paused ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontSize: 13, fontWeight: 700,
                    }}
                  >
                    {done ? '✓' : ''}
                  </button>

                  {/* Info */}
                  <div onClick={() => onEdit(t)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} title="Tocá para editar (monto, día, etc.)">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 13, fontWeight: 600, color: done ? P.sb : P.tx,
                        textDecoration: done ? 'line-through' : 'none',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140,
                      }}>
                        {t.paused ? '⏸ ' : ''}{t.desc || t.sub || t.cat}
                      </span>
                      {pctIncome && (
                        <span style={{ fontSize: 10, color: P.sb, background: `${P.bd}`, borderRadius: 6, padding: '1px 5px', flexShrink: 0 }}>
                          {pctIncome}% del ingreso
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: P.sb, marginTop: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontWeight: 500, color: done ? P.sb : P.tx }}>{fmtS(t.amt, t.cur)}</span>
                      {!t.paused && dueInfo && (
                        <span style={{ color: dueInfo.color, fontWeight: 600, fontSize: 10, background: dueInfo.bg, borderRadius: 6, padding: '2px 7px' }}>{dueInfo.text}</span>
                      )}
                    </div>
                  </div>

                  {/* Acciones */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => onPauseSerie(t.serieId, !t.paused)}
                      title={t.paused ? 'Activar' : 'Pausar'}
                      style={{ background: 'transparent', color: P.sb, border: 'none', padding: '4px 6px', fontSize: 14, cursor: 'pointer', lineHeight: 1 }}
                    >
                      {t.paused ? '▶' : '⏸'}
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`¿Sacar "${t.desc || t.sub || t.cat}" de los recurrentes? El historial queda guardado.`))
                          onRemoveSerie(t.serieId);
                      }}
                      title="Sacar recurrente"
                      style={{ background: 'transparent', color: P.sb, border: 'none', padding: '4px 6px', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </Box>
        );
      })()}


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
          <>
            {[...mtx]
              .sort((a, b) => new Date(b.date) - new Date(a.date))
              .slice(0, 3)
              .map((t) => (
                <TxRow
                  key={t.id}
                  t={t}
                  cur={cur}
                  mob={mob}
                  onClick={() => onEdit(t)}
                  customCats={customCats}
                />
              ))}
            <button
              onClick={() => onSeeAll && onSeeAll()}
              style={{
                width: '100%',
                marginTop: 8,
                background: 'transparent',
                border: `1px solid ${P.bd}`,
                color: P.ac,
                borderRadius: 12,
                padding: '10px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Ver todos →
            </button>
          </>
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
        padding: mob ? '10px 12px' : '11px 14px',
        borderRadius: 14,
        background: P.cd,
        border: `1px solid ${P.bd}`,
        marginBottom: 6,
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
  customCats,
}) {
  const total = byCat.reduce((s, [, a]) => s + a, 0);
  const [expandedCat, setExpandedCat] = useState(null);
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
  // Gasto por subcategoría (Categoría · Subcategoría)
  const bySub = (() => {
    const m = {};
    mtx
      .filter((t) => t.type === 'gasto' && !t.pending && t.cur === cur)
      .forEach((t) => {
        const k = `${t.cat} · ${t.sub || 'Otros'}`;
        m[k] = (m[k] || 0) + t.amt;
      });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  })();
  const subTotal = bySub.reduce((s, [, a]) => s + a, 0);
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
      {/* Hero compacto */}
      <Box style={{ background: P.bal, padding: mob ? 20 : 22 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4 }}>
          Balance de {MOF[Number(month.slice(5, 7)) - 1]}
        </div>
        <div style={{ fontSize: mob ? 34 : 46, fontWeight: 800, color: '#fff', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
          {fmtS(cBal, cur)}
        </div>
        {carry !== 0 && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 3 }}>
            venías con <b style={{ color: carry >= 0 ? P.gn : P.rd }}>{fmtS(carry, cur)}</b>
            {' · '}disponible total <b style={{ color: cBal + carry >= 0 ? P.gn : P.rd }}>{fmtS(cBal + carry, cur)}</b>
          </div>
        )}
        {isGroup && memberRows.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
            {memberRows.map(([who, m]) => {
              const q = m.ingreso - m.gasto;
              return (
                <span key={who} style={{ fontSize: 11, color: 'rgba(255,255,255,.55)' }}>
                  {who.split(' ')[0]}: <b style={{ color: q >= 0 ? P.gn : P.rd }}>{fmtS(q, cur)}</b>
                </span>
              );
            })}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, borderTop: '1px solid rgba(255,255,255,.12)', paddingTop: 14 }}>
          {[['Ingresos', cIn, P.gn], ['Gastos', cOut, P.rd], ['Ahorro', cSav, 'rgba(255,255,255,.9)']].map(([l, v, c], i) => (
            <Fragment key={l}>
              {i > 0 && <div style={{ width: 1, background: 'rgba(255,255,255,.12)', flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0, paddingLeft: i > 0 ? 14 : 0 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', fontWeight: 500 }}>{l}</div>
                <div style={{ fontSize: mob ? 15 : 18, fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {fmtS(Math.round(v), cur)}
                </div>
              </div>
            </Fragment>
          ))}
        </div>
      </Box>

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
        <Lbl>Gastos por categoría</Lbl>
        {byCat.length === 0 ? (
          <Nil
            icon="📊"
            t="Todavía no hay datos para analizar"
            sub="Cargá algunos gastos y acá vas a ver tus análisis."
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
                  <span style={{ fontSize: 13, fontWeight: 700, color: P.rd }}>
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
              const cd = getCats('gasto', customCats).find((c) => c.n === s.cat);
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
                    <span style={{ fontSize: 12, fontWeight: 600, color: P.rd }}>
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
  const [editSavId, setEditSavId] = useState(null);
  const [editAmt, setEditAmt] = useState('');
  const startEditSaving = (s) => {
    setEditSavId(s.id);
    setEditAmt(String(s.amount));
  };
  const saveEditSaving = () => {
    const n = Number(String(editAmt).replace(',', '.'));
    if (n > 0) {
      setSavings(savings.map((s) => (s.id === editSavId ? { ...s, amount: n } : s)));
    }
    setEditSavId(null);
    setEditAmt('');
  };
  const savArs = savings
    .filter((s) => s.cur === 'ARS')
    .reduce((a, s) => a + s.amount, 0);
  const savUsd = savings.filter((s) => s.cur === 'USD').reduce((a, s) => a + s.amount, 0);
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
              gap: 8,
            }}
          >
            <span style={{ fontSize: 13, flexShrink: 0 }}>{s.name}</span>
            {editSavId === s.id ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 12, color: P.sb }}>{s.cur === 'USD' ? 'US$' : '$'}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={editAmt}
                  onChange={(e) => setEditAmt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveEditSaving()}
                  style={{ width: 100, background: P.c2, border: `1px solid ${P.ac}`, borderRadius: 8, padding: '5px 8px', fontSize: 13, fontWeight: 600, color: P.tx }}
                />
                <span onClick={saveEditSaving} style={{ cursor: 'pointer', color: P.gn, fontSize: 14, fontWeight: 700 }}>✓</span>
                <span onClick={() => { setEditSavId(null); setEditAmt(''); }} style={{ cursor: 'pointer', color: P.sb, fontSize: 12 }}>✕</span>
              </span>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span onClick={() => startEditSaving(s)} style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer' }} title="Tocá para editar el monto">
                  {s.cur === 'USD'
                    ? `US$ ${s.amount.toLocaleString('es-AR')}`
                    : fmt(s.amount, 'ARS')}
                  {' '}✏️
                </span>
                <span
                  onClick={() => delSaving(s.id)}
                  style={{ cursor: 'pointer', color: P.sb, fontSize: 12 }}
                >
                  ✕
                </span>
              </span>
            )}
          </div>
        ))}
        {usdBuys.length > 0 && (
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
                cursor: 'pointer',
              }}
            >
              <span>Historial de compras en la app {showUsd ? '▾' : '▸'}</span>
              <span>solo referencia</span>
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
                  background: sC === c ? P.gb : 'transparent',
                  color: sC === c ? P.gn : P.sb,
                  border: 'none',
                  padding: '0 10px',
                  fontSize: 11,
                  fontWeight: 700,
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
              background: P.gb,
              color: P.gn,
              border: `1px solid ${P.gn}25`,
              borderRadius: 10,
              padding: '0 16px',
              fontSize: 13,
              fontWeight: 700,
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 24, fontWeight: 800, color: P.tx }}>Metas</span>
        <button
          onClick={() => setShowAdd(!showAdd)}
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            background: P.gb,
            border: `1px solid ${P.gn}25`,
            color: P.gn,
            cursor: 'pointer',
            fontSize: 18,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {showAdd ? '✕' : '+'}
        </button>
      </div>
      <Box>
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
                  background: P.gb,
                  border: `1px solid ${P.gn}25`,
                  color: P.gn,
                  padding: '10px 16px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {goals.map((g, i) => {
              const pct = g.target > 0 ? (g.saved / g.target) * 100 : 0;
              const done = pct >= 100;
              const isDark = P.bg === P_DARK.bg;
              const iconColor = pal[i % pal.length];
              const pctColor = done ? P.gn : pct >= 50 ? P.ac : P.am;
              const remaining = Math.max(0, g.target - (g.saved || 0));
              return (
                <div
                  key={g.id}
                  style={{
                    background: P.cd,
                    border: `1px solid ${P.bd}`,
                    borderRadius: 20,
                    padding: '18px 20px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 14, background: `${iconColor}1c`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flexShrink: 0 }}>
                      {g.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: P.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: P.sb, marginTop: 1 }}>
                        Meta: {fmtS(g.target, g.currency || cur)}
                      </div>
                    </div>
                    <span style={{ fontSize: 18, fontWeight: 800, color: pctColor, flexShrink: 0 }}>{Math.round(pct)}%</span>
                    <button
                      onClick={() => delGoal(g.id)}
                      style={{ background: 'transparent', border: 'none', color: P.sb, cursor: 'pointer', fontSize: 12, flexShrink: 0, padding: 2 }}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: isDark ? 'rgba(255,255,255,.07)' : '#EDE9E2', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', borderRadius: 4, background: pctColor, transition: 'width .4s ease' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: P.gn }}>{fmtS(g.saved || 0, g.currency || cur)} guardados</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: done ? P.gn : P.sb }}>
                      {done ? '¡Completado! 🎉' : `faltan ${fmtS(remaining, g.currency || cur)}`}
                    </span>
                  </div>
                  {!done && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
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
                          padding: '8px 10px',
                          fontSize: 12,
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
                          padding: '8px 12px',
                          borderRadius: 10,
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        + Agregar
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
  savedCards = [],
  onAddCard,
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
  const [dueDay, setDueDay] = useState(initial?.dueDay ? String(initial.dueDay) : '');
  const [programado, setProgramado] = useState(initial?.pending || false);
  const [showMore, setShowMore] = useState(initial?.type === 'gasto');
  const [pay, setPay] = useState(initial?.pay || 'efectivo');
  const [cuotas, setCuotas] = useState(initial?.cuotas || 1);
  const [card, setCard] = useState(initial?.card || '');
  const [cardNet, setCardNet] = useState(initial?.cardNet || '');
  const [cardDue, setCardDue] = useState(
    initial?.cardDue ? String(initial.cardDue) : ''
  );
  const [susc, setSusc] = useState(initial?.susc || false);
  const [addingCard, setAddingCard] = useState(false);
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
  const dateInputRef = useRef(null);
  const iS = {
    width: '100%',
    background: P.c2,
    border: `1px solid ${P.bd}`,
    color: P.tx,
    padding: '12px 14px',
    borderRadius: 12,
    fontSize: 14,
  };
  const dateLabel = (() => {
    const [y, m, d] = date.split('-').map(Number);
    if (!y) return date;
    const monAbbr = MO[m - 1];
    return date === td() ? `Hoy, ${d} ${monAbbr}` : `${d} ${monAbbr} ${y}`;
  })();
  const amountHint = type === 'ingreso' ? '¿Cuánto ingresó?' : type === 'ahorro' ? '¿Cuánto ahorraste?' : '¿Cuánto gastaste?';
  const quickFieldStyle = { background: P.cd, border: `1px solid ${P.bd}`, borderRadius: 14, padding: '12px 14px' };

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
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: 16 }}>
          <button
            onClick={onClose}
            style={{ position: 'absolute', left: 0, width: 36, height: 36, borderRadius: 10, background: P.cd, border: `1px solid ${P.bd}`, color: P.sb, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ✕
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: P.tx }}>
            {mode === 'edit' ? 'Editar movimiento' : 'Nuevo movimiento'}
          </span>
        </div>

        {/* Type */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
          {[
            ['gasto', 'Gasto', P.rd, P.rb],
            ['ingreso', 'Ingreso', P.gn, P.gb],
            ['ahorro', 'Ahorro', P.ac, P.ab],
          ].map(([id, l, color, bg]) => (
            <button
              key={id}
              onClick={() => {
                setType(id);
                setCat((getCats(id, customCats)[0] || {}).n || '');
                setSub('');
              }}
              style={{
                background: type === id ? bg : P.cd,
                border: `1.5px solid ${type === id ? color : P.bd}`,
                color: type === id ? color : P.sb,
                padding: '10px 8px',
                borderRadius: 14,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {l}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Moneda */}
          <div style={{ display: 'flex', background: P.c2, borderRadius: 10, padding: 3, border: `1px solid ${P.bd}`, alignSelf: 'center' }}>
            {[['ARS', '$ ARS'], ['USD', 'US$ USD']].map(([c, l]) => (
              <button key={c} onClick={() => setCurSel(c)} style={{ background: curSel === c ? P.ac : 'transparent', color: curSel === c ? '#fff' : P.sb, border: 'none', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'background .15s' }}>{l}</button>
            ))}
          </div>

          {/* Monto */}
          <div style={{ borderBottom: `1px solid ${P.bd}`, padding: '0 0 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: P.sb, marginBottom: 8 }}>{amountHint}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <span style={{ fontSize: 40, fontWeight: 800, color: P.tx }}>{curSel === 'USD' ? 'US$' : '$'}</span>
              <input
                type="number"
                placeholder="0"
                value={amt}
                onChange={(e) => setAmt(e.target.value)}
                autoFocus
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: P.tx,
                  fontSize: 52,
                  fontWeight: 800,
                  textAlign: 'left',
                  width: '100%',
                  maxWidth: 200,
                  outline: 'none',
                  padding: 0,
                  minWidth: 0,
                  caretColor: P.bg === P_DARK.bg ? P.gn : P.ac,
                }}
              />
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: P.sb, marginTop: 8 }}>Tocá para escribir el monto</div>
          </div>

          {/* Categoría */}
          <div>
            <Lbl>Categoría</Lbl>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {cats.map((c) => {
                const { c: iconColor, bg: iconBg } = catRowStyle(c.n);
                const selected = cat === c.n;
                return (
                  <button
                    key={c.n}
                    onClick={() => { setCat(c.n); setSub(''); }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <div style={{ width: 48, height: 48, borderRadius: 15, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, boxShadow: selected ? `0 0 0 2px ${iconColor}` : 'none' }}>
                      {c.i}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 500, color: P.tx, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                      {c.n}
                    </span>
                  </button>
                );
              })}
            </div>
            {cc && cc.s && cc.s.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 12 }}>
                {cc.s.map((s2) => (
                  <button key={s2} onClick={() => setSub(sub === s2 ? '' : s2)} style={{ background: sub === s2 ? `${P.ac}18` : P.cd, border: `1px solid ${sub === s2 ? P.ac : P.bd}`, color: sub === s2 ? P.ac : P.sb, padding: '6px 11px', borderRadius: 9, cursor: 'pointer', fontSize: 11 }}>
                    {s2}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Nota */}
          <div style={quickFieldStyle}>
            <Lbl>Nota</Lbl>
            <input type="text" placeholder="Ej: Sueldo, Super, Alquiler..." value={desc} onChange={(e) => setDesc(e.target.value)} style={{ background: 'transparent', border: 'none', color: P.tx, fontSize: 13, fontWeight: 600, width: '100%', padding: 0, outline: 'none' }} />
          </div>

          {/* Campos rápidos */}
          <div style={{ display: 'grid', gridTemplateColumns: isG ? '1fr 1fr' : '1fr', gap: 10 }}>
            <div style={{ ...quickFieldStyle, position: 'relative', cursor: 'pointer' }} onClick={() => dateInputRef.current?.showPicker?.() || dateInputRef.current?.click()}>
              <Lbl>Fecha</Lbl>
              <div style={{ fontSize: 13, fontWeight: 600, color: P.tx }}>{dateLabel}</div>
              <input
                ref={dateInputRef}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
              />
            </div>
            {isG && (
              <div style={quickFieldStyle}>
                <Lbl>Medio</Lbl>
                <select
                  value={pay}
                  onChange={(e) => { setPay(e.target.value); if (e.target.value !== 'credito') setCuotas(1); }}
                  style={{ background: 'transparent', border: 'none', color: P.tx, fontSize: 13, fontWeight: 600, width: '100%', padding: 0, outline: 'none' }}
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="credito">Crédito</option>
                </select>
              </div>
            )}
          </div>

          {/* Opciones */}
          <div style={{ background: P.bg, border: `1px solid ${P.bd}`, borderRadius: 18, padding: '6px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: P.tx }}>🔄 {type === 'ingreso' ? 'Ingreso' : type === 'ahorro' ? 'Ahorro' : 'Gasto'} recurrente</span>
              <Switch on={recurring} onClick={() => setRecurring(!recurring)} />
            </div>
            {recurring && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${P.bd}`, padding: '12px 0' }}>
                {isG && (
                  <div>
                    <Lbl>Tipo</Lbl>
                    <div style={{ display: 'flex', background: P.cd, borderRadius: 12, padding: 3, border: `1px solid ${P.bd}` }}>
                      {[[false, '🔄 Recurrente'], [true, '💳 Suscripción']].map(([v, l]) => (
                        <button key={String(v)} onClick={() => setSusc(v)} style={{ flex: 1, background: susc === v ? P.ac : 'transparent', color: susc === v ? '#fff' : P.sb, border: 'none', padding: '9px', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{l}</button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <Lbl>¿Cada cuánto?</Lbl>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {[['mensual', 'Mensual'], ['semanal', 'Semanal'], ['quincenal', 'Quincenal'], ['anual', 'Anual']].map(([id, l]) => (
                      <button key={id} onClick={() => setFreq(id)} style={{ background: freq === id ? P.ac : P.cd, border: `1px solid ${freq === id ? P.ac : P.bd}`, color: freq === id ? '#fff' : P.tx, padding: '6px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>{l}</button>
                    ))}
                  </div>
                </div>
                {freq === 'mensual' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="number" min="1" max="31" placeholder="Día venc." value={dueDay} onChange={(e) => setDueDay(e.target.value)} style={{ ...iS, background: P.cd, width: 120 }} />
                    <span style={{ fontSize: 11, color: P.sb }}>de cada mes (opcional)</span>
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderTop: `1px solid ${P.bd}` }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: P.tx }}>📅 Programado / pendiente</span>
              <Switch on={programado} onClick={() => setProgramado(!programado)} color={P.am} />
            </div>
            {programado && (
              <div style={{ fontSize: 11, color: P.sb, background: P.am + '14', borderRadius: 10, padding: '8px 11px', marginBottom: 12 }}>
                📅 Queda <b>pendiente</b> y no baja el presupuesto hasta que lo marques como pagado.
              </div>
            )}
          </div>

          {/* Más opciones toggle */}
          <button type="button" onClick={() => setShowMore((v) => !v)} style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', color: P.ac, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '2px 0' }}>
            {showMore ? '▴ Menos opciones' : '▾ Más opciones (cuotas, tarjeta, espacio)'}
          </button>

          {showMore && (
            <>
              {isG && pay === 'credito' && (
                <div>
                  <Lbl>Cuotas</Lbl>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {[1, 2, 3, 6, 12, 18].map((c) => (
                      <button key={c} onClick={() => setCuotas(c)} style={{ background: cuotas === c ? P.ac : P.c2, border: `1px solid ${cuotas === c ? P.ac : P.bd}`, color: cuotas === c ? '#fff' : P.tx, padding: '7px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        {c === 1 ? '1 pago' : `${c}x`}
                      </button>
                    ))}
                  </div>
                  {cuotas > 1 && amt && <div style={{ marginTop: 5, fontSize: 11, color: P.ac, background: P.ab, padding: '4px 8px', borderRadius: 8 }}>{cuotas} cuotas de {fmt(Math.ceil(Number(amt) / cuotas), curSel)}</div>}
                </div>
              )}
              {isG && pay === 'credito' && (
                <div>
                  <Lbl>Tarjeta de crédito</Lbl>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {savedCards.map((c) => {
                      const on = !addingCard && card === c.name;
                      return (
                        <button key={c.id || c.name} onClick={() => { setCard(c.name); setCardDue(''); setCardNet(''); setAddingCard(false); }} style={{ background: on ? P.ac : P.cd, border: `1px solid ${on ? P.ac : P.bd}`, color: on ? '#fff' : P.tx, padding: '8px 14px', borderRadius: 11, cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                          💳 {c.name}
                        </button>
                      );
                    })}
                    <button onClick={() => { setAddingCard(true); setCard(''); setCardDue(''); setCardNet(''); }} style={{ background: addingCard ? `${P.ac}18` : 'transparent', border: `1px dashed ${P.ac}`, color: P.ac, padding: '8px 14px', borderRadius: 11, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                      + Nueva
                    </button>
                  </div>
                  {addingCard && (
                    <input placeholder="Nombre de la tarjeta" value={card} onChange={(e) => setCard(e.target.value)} style={{ ...iS, background: P.cd, marginTop: 8 }} />
                  )}
                  {(() => {
                    const sel = savedCards.find((c) => c.name === card);
                    if (!addingCard && card && sel && !sel.cierre) {
                      return <div style={{ marginTop: 8, fontSize: 11, color: P.am, fontWeight: 600 }}>⚠️ Sin fecha de cierre para esta tarjeta. Configurala en ⚙️ Config.</div>;
                    }
                    return null;
                  })()}
                </div>
              )}

              {/* Scope */}
              <div style={{ background: P.bg, borderRadius: 14, padding: 12, border: `1px solid ${P.bd}` }}>
                <Lbl>Guardar en</Lbl>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  <button onClick={() => setScope('personal')} style={{ background: scope === 'personal' ? P.ac : P.cd, border: `1px solid ${scope === 'personal' ? P.ac : P.bd}`, color: scope === 'personal' ? '#fff' : P.tx, padding: '6px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>👤 Personal</button>
                  {myGroups.map((g) => (
                    <button key={g.id} onClick={() => setScope(g.id)} style={{ background: scope === g.id ? P.pu : P.cd, border: `1px solid ${scope === g.id ? P.pu : P.bd}`, color: scope === g.id ? '#fff' : P.tx, padding: '6px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>👥 {g.name}</button>
                  ))}
                </div>
              </div>
              {scope !== 'personal' && (
                <div>
                  <Lbl>{type === 'ingreso' ? '¿A quién ingresó?' : '¿Quién pagó?'}</Lbl>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {Array.from(new Set([userName, ...((myGroups.find((g) => g.id === scope) || {}).memberNames || []), ...knownMembers].filter(Boolean))).map((nm) => (
                      <button key={nm} onClick={() => setMember(nm)} style={{ background: member === nm ? P.pu : P.c2, border: `1px solid ${member === nm ? P.pu : P.bd}`, color: member === nm ? '#fff' : P.tx, padding: '6px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>{nm}</button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Save / Cancel / Delete */}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {mode === 'edit' && !confirmDel && (
              <button onClick={() => setConfirmDel(true)} style={{ background: P.rb, border: `1px solid ${P.rd}20`, color: P.rd, padding: '12px', borderRadius: 14, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>🗑️</button>
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
                    dueDay: recurring && freq === 'mensual' && dueDay ? Number(dueDay) : undefined,
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
                    susc: isG && recurring && susc ? true : undefined,
                    scope: isGroupScope ? 'grupo' : 'personal',
                    groupId: isGroupScope ? scope : undefined,
                    member: isGroupScope ? member || userName : undefined,
                  };
                  if (isG && pay === 'credito' && card && onAddCard && !savedCards.some((c) => c.name === card)) {
                    onAddCard(card);
                  }
                  onSave(txData);
                }}
                style={{
                  flex: 1,
                  background: type === 'ingreso' ? P.gn : type === 'ahorro' ? P.ac : P.rd,
                  border: 'none',
                  color: '#fff',
                  padding: '16px',
                  borderRadius: 18,
                  cursor: 'pointer',
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                {mode === 'edit' ? 'Actualizar' : `Guardar ${type}`}
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
