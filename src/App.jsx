// @ts-nocheck
import { useState, useEffect, useMemo, useCallback } from 'react';
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
};
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
function Nil({ t, icon }) {
  return (
    <div
      style={{
        color: P.sb,
        fontSize: 13,
        textAlign: 'center',
        padding: '30px 16px',
      }}
    >
      {icon && <div style={{ fontSize: 24, marginBottom: 6 }}>{icon}</div>}
      {t}
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
      alert('No se pudo iniciar sesión: ' + (e?.code || e?.message || e));
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

  if (!user) return <LoginScreen onLogin={login} />;

  return <MainApp user={user} onLogout={logout} />;
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
    defScope: 'personal',
    efund: { expenses: {}, saved: 0 },
  });
  const [myGroups, setMyGroups] = useState([]); // [{id, name, members}]
  const [groupTx, setGroupTx] = useState({}); // {groupId: [tx]}
  const [dataLoaded, setDataLoaded] = useState(false);

  const [tab, setTab] = useState('home');
  const [modal, setModal] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [month, setMonth] = useState(mk(new Date()));
  const [cur, setCur] = useState('ARS');
  const [fabOpen, setFabOpen] = useState(false);
  const [viewScope, setViewScope] = useState('personal');
  const [mob, setMob] = useState(window.innerWidth < 680);
  const [joinCode, setJoinCode] = useState('');

  useEffect(() => {
    const h = () => setMob(window.innerWidth < 680);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

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
    } catch (e) {
      console.error('addTx error:', e);
      alert('No se pudo guardar: ' + (e?.code || e?.message || e));
    }
  };

  const updateTxFn = async (t) => {
    if (t.scope === 'grupo' && t.groupId) {
      await updateDoc(doc(db, 'groups', t.groupId, 'transactions', t.id), t);
    } else {
      await updateDoc(doc(db, 'users', user.uid, 'transactions', t.id), t);
    }
    setModal(null);
    setEditItem(null);
  };

  const delTxFn = async (t) => {
    if (t.scope === 'grupo' && t.groupId) {
      await deleteDoc(doc(db, 'groups', t.groupId, 'transactions', t.id));
    } else {
      await deleteDoc(doc(db, 'users', user.uid, 'transactions', t.id));
    }
    setModal(null);
    setEditItem(null);
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
        alert('Grupo no encontrado. Verificá el código.');
        return;
      }
      await updateDoc(ref, {
        memberIds: arrayUnion(user.uid),
        memberNames: arrayUnion(user.displayName || user.email),
      });
      alert(`✅ Te uniste al grupo "${snap.data().name}"`);
    } catch {
      alert('Error al unirse al grupo.');
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

  const mtx = activeTx.filter((t) => mk(t.date) === month && t.cur === cur);
  const totIn = mtx
    .filter((t) => t.type === 'ingreso')
    .reduce((s, t) => s + t.amt, 0);
  const totOut = mtx
    .filter((t) => t.type === 'gasto')
    .reduce((s, t) => s + t.amt, 0);
  const bal = totIn - totOut;
  const byCat = useMemo(() => {
    const m = {};
    mtx
      .filter((t) => t.type === 'gasto')
      .forEach((t) => {
        m[t.cat] = (m[t.cat] || 0) + t.amt;
      });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [mtx]);

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

  const openEdit = (t) => {
    setEditItem(t);
    setModal('edit');
  };
  const openAdd = (type) => {
    setEditItem({ type });
    setModal('add');
    setFabOpen(false);
  };

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
          {user.photoURL && (
            <img
              src={user.photoURL}
              alt=""
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                cursor: 'pointer',
              }}
              onClick={onLogout}
              title="Cerrar sesión"
            />
          )}
          {!user.photoURL && (
            <button
              onClick={onLogout}
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: P.ab,
                border: `1px solid ${P.bd}`,
                fontSize: 11,
                fontWeight: 700,
                color: P.ac,
                cursor: 'pointer',
              }}
              title="Cerrar sesión"
            >
              {user.displayName?.[0] || 'U'}
            </button>
          )}
        </div>
      </header>

      {/* Scope bar */}
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
            gap: 6,
            overflowX: 'auto',
            maxWidth: 800,
            margin: '0 auto',
          }}
        >
          <button
            onClick={() => setViewScope('personal')}
            style={{
              background: viewScope === 'personal' ? P.ac : P.c2,
              border: `1px solid ${viewScope === 'personal' ? P.ac : P.bd}`,
              color: viewScope === 'personal' ? '#fff' : P.tx,
              padding: '6px 14px',
              borderRadius: 10,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            👤 Personal
          </button>
          {myGroups.map((g) => (
            <button
              key={g.id}
              onClick={() => setViewScope(g.id)}
              style={{
                background: viewScope === g.id ? P.pu : P.c2,
                border: `1px solid ${viewScope === g.id ? P.pu : P.bd}`,
                color: viewScope === g.id ? '#fff' : P.tx,
                padding: '6px 14px',
                borderRadius: 10,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              👥 {g.name}
            </button>
          ))}
          <button
            onClick={async () => {
              const name = prompt('Nombre del grupo:');
              if (name?.trim()) await createGroup(name.trim());
            }}
            style={{
              background: 'transparent',
              border: `1px dashed ${P.bd}`,
              color: P.sb,
              padding: '6px 12px',
              borderRadius: 10,
              cursor: 'pointer',
              fontSize: 12,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            + Crear grupo
          </button>
        </div>
        {/* Join group + share code */}
        {viewScope !== 'personal' && (
          <div
            style={{
              maxWidth: 800,
              margin: '6px auto 0',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10,
              color: P.sb,
            }}
          >
            <span>Código para invitar:</span>
            <code
              style={{
                background: P.c2,
                padding: '2px 8px',
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 600,
                color: P.tx,
                cursor: 'pointer',
              }}
              onClick={() => {
                navigator.clipboard?.writeText(viewScope);
                alert('Código copiado!');
              }}
            >
              {viewScope}
            </code>
            <span>(tocá para copiar)</span>
          </div>
        )}
        {viewScope === 'personal' && (
          <div
            style={{
              maxWidth: 800,
              margin: '6px auto 0',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <input
              placeholder="Código de grupo para unirte"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              style={{
                background: P.c2,
                border: `1px solid ${P.bd}`,
                borderRadius: 8,
                padding: '4px 8px',
                fontSize: 10,
                color: P.tx,
                flex: 1,
                maxWidth: 200,
              }}
            />
            {joinCode && (
              <button
                onClick={() => {
                  joinGroup(joinCode);
                  setJoinCode('');
                }}
                style={{
                  background: P.pu,
                  border: 'none',
                  color: '#fff',
                  padding: '4px 10px',
                  borderRadius: 8,
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Unirme
              </button>
            )}
          </div>
        )}
      </div>

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
          </div>
        )}
        {tab === 'home' && (
          <HomeTab
            mob={mob}
            cur={cur}
            totIn={totIn}
            totOut={totOut}
            bal={bal}
            byCat={byCat}
            mtx={mtx}
            budgets={settings.budgets || {}}
            onEdit={openEdit}
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
            mtx={mtx}
            budgets={settings.budgets || {}}
            saveBudgets={(b) => saveSettings({ budgets: b })}
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
        />
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
  bal,
  byCat,
  mtx,
  budgets,
  onEdit,
}) {
  const maxC = byCat.length ? byCat[0][1] : 1;
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
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: mob ? 8 : 10,
        }}
      >
        <Box style={{ padding: mob ? 12 : 16 }}>
          <Lbl>Ingresos</Lbl>
          <div
            style={{ fontSize: mob ? 17 : 22, fontWeight: 700, color: P.gn }}
          >
            {mob ? fmtS(totIn, cur) : fmt(totIn, cur)}
          </div>
        </Box>
        <Box style={{ padding: mob ? 12 : 16 }}>
          <Lbl>Gastos</Lbl>
          <div
            style={{ fontSize: mob ? 17 : 22, fontWeight: 700, color: P.rd }}
          >
            {mob ? fmtS(totOut, cur) : fmt(totOut, cur)}
          </div>
        </Box>
      </div>
      <Box
        style={{ background: `linear-gradient(135deg,${P.ac}06,${P.gn}06)` }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <Lbl>Balance</Lbl>
            <div
              style={{
                fontSize: mob ? 22 : 28,
                fontWeight: 700,
                color: bal >= 0 ? P.gn : P.rd,
              }}
            >
              {mob ? fmtS(bal, cur) : fmt(bal, cur)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <Lbl>Gastado</Lbl>
            <div style={{ fontSize: 14, fontWeight: 600, color: P.sb }}>
              {totIn > 0 ? Math.round((totOut / totIn) * 100) : 0}%
            </div>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <Bar
            pct={totIn > 0 ? (totOut / totIn) * 100 : 0}
            color={totOut / totIn > 0.8 ? P.rd : P.ac}
          />
        </div>
      </Box>
      <Box>
        <Lbl>Gastos por categoría</Lbl>
        {byCat.length === 0 ? (
          <Nil t="No hay gastos" icon="📭" />
        ) : (
          byCat.map(([cat, amt], i) => {
            const cd = CATS.gasto.find((c) => c.n === cat);
            const bp = budgets[cat];
            const lim = bp ? totIn * (bp / 100) : 0;
            const pct = lim ? (amt / lim) * 100 : (amt / maxC) * 100;
            return (
              <div key={cat} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 3,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 500 }}>
                    {cd?.i} {cat}
                    {bp ? (
                      <span
                        style={{
                          fontSize: 9,
                          color: P.sb,
                          background: P.c2,
                          borderRadius: 4,
                          padding: '1px 4px',
                          marginLeft: 3,
                        }}
                      >
                        {bp}%
                      </span>
                    ) : (
                      ''
                    )}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: P.rd }}>
                    {mob ? fmtS(amt, cur) : fmt(amt, cur)}
                  </span>
                </div>
                <Bar
                  pct={Math.min(pct, 100)}
                  color={
                    lim && pct >= 100
                      ? P.rd
                      : lim && pct >= 80
                      ? P.am
                      : pal[i % pal.length]
                  }
                />
              </div>
            );
          })
        )}
      </Box>
      <Box>
        <Lbl>Últimos movimientos</Lbl>
        {mtx.length === 0 ? (
          <Nil t="Agregá tu primer movimiento con el botón +" icon="✨" />
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
              />
            ))
        )}
      </Box>
    </div>
  );
}

function TxRow({ t, cur, mob, onClick }) {
  const cd = [...CATS.gasto, ...CATS.ingreso].find((c) => c.n === t.cat);
  const isIn = t.type === 'ingreso';
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
            background: isIn ? P.gb : P.rb,
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
            {t.desc || t.sub || t.cat}
          </div>
          <div style={{ fontSize: 10, color: P.sb }}>
            {t.cat}
            {t.createdByName ? ` · ${t.createdByName}` : ''} ·{' '}
            {new Date(t.date).toLocaleDateString('es-AR', {
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
          color: isIn ? P.gn : P.rd,
          flexShrink: 0,
        }}
      >
        {isIn ? '+' : '−'}
        {mob ? fmtS(t.amt, cur) : fmt(t.amt, cur)}
      </span>
    </div>
  );
}

/* ── INSIGHTS ── */
function InsightsTab({
  mob,
  cur,
  activeTx,
  month,
  byCat,
  totIn,
  totOut,
  mtx,
  budgets,
  saveBudgets,
}) {
  const total = byCat.reduce((s, [, a]) => s + a, 0);
  const [bCat, setBCat] = useState('');
  const [bPct, setBPct] = useState('');
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

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: mob ? 10 : 14 }}
    >
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
                  style={{
                    flex: 1,
                    background: P.gn,
                    borderRadius: '3px 3px 0 0',
                    height: `${Math.max(3, (t.inc / maxT) * 100)}%`,
                    opacity: 0.45,
                  }}
                />
                <div
                  style={{
                    flex: 1,
                    background: P.rd,
                    borderRadius: '3px 3px 0 0',
                    height: `${Math.max(3, (t.exp / maxT) * 100)}%`,
                    opacity: 0.45,
                  }}
                />
              </div>
              <span style={{ fontSize: 9, color: P.sb }}>{t.l}</span>
            </div>
          ))}
        </div>
      </Box>
      <Box>
        <Lbl>Distribución</Lbl>
        {byCat.length === 0 ? (
          <Nil t="Sin datos" icon="📊" />
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
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [gn, setGn] = useState('');
  const [gt, setGt] = useState('');
  const [gi, setGi] = useState('🎯');
  const [addAmt, setAddAmt] = useState({});
  const [showEF, setShowEF] = useState(false);
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
          <Nil t="Creá tu primera meta" icon="🎯" />
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
}) {
  const [type, setType] = useState(initial?.type || 'gasto');
  const cats = CATS[type] || CATS.gasto;
  const [cat, setCat] = useState(initial?.cat || cats[0].n);
  const [sub, setSub] = useState(initial?.sub || '');
  const [amt, setAmt] = useState(initial?.amt?.toString() || '');
  const [desc, setDesc] = useState(initial?.desc || '');
  const [date, setDate] = useState(initial?.date?.slice(0, 10) || td());
  const [recurring, setRecurring] = useState(initial?.recurring || false);
  const [pay, setPay] = useState(initial?.pay || 'debito');
  const [cuotas, setCuotas] = useState(initial?.cuotas || 1);
  const isG = type === 'gasto';

  // Scope: personal or a group
  const initScope =
    initial?.groupId ||
    (viewScope !== 'personal'
      ? viewScope
      : defScope === 'grupo' && myGroups.length > 0
      ? myGroups[0].id
      : 'personal');
  const [scope, setScope] = useState(initScope);
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
            ['ingreso', '📈 Ingreso'],
            ['gasto', '📉 Gasto'],
          ].map(([id, l]) => (
            <button
              key={id}
              onClick={() => {
                setType(id);
                setCat(CATS[id][0].n);
                setSub('');
              }}
              style={{
                flex: 1,
                background:
                  type === id
                    ? id === 'ingreso'
                      ? P.gn
                      : P.rd
                    : 'transparent',
                border: 'none',
                color: type === id ? '#fff' : P.sb,
                padding: '9px',
                borderRadius: 10,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {l}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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

          {/* 2. Amount */}
          <div>
            <Lbl>Monto ({cur})</Lbl>
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
          <div>
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
                  {cuotas} cuotas de {fmt(Math.ceil(Number(amt) / cuotas), cur)}
                </div>
              )}
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
          </div>

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

          {/* Save */}
          <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
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
                    alert('Ingresá un monto mayor a 0.');
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
                    cur,
                    recurring,
                    pay: isG ? pay : undefined,
                    cuotas: isG && pay === 'credito' ? cuotas : undefined,
                    scope: isGroupScope ? 'grupo' : 'personal',
                    groupId: isGroupScope ? scope : undefined,
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
        </div>
      </div>
    </div>
  );
}
