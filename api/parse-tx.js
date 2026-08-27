// Vercel serverless function: interpreta un texto libre ("gasté 5000 en el
// super", "cobré 30000 de Falfer") y devuelve un movimiento estructurado
// usando la API de Claude. Requiere la env var ANTHROPIC_API_KEY en Vercel.

const TOOL = {
  name: 'registrar_movimiento',
  description: 'Registra un movimiento financiero interpretado del texto del usuario.',
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['gasto', 'ingreso', 'ahorro'] },
      cat: { type: 'string', description: 'Nombre exacto de una de las categorías disponibles.' },
      sub: { type: 'string', description: 'Subcategoría exacta si aplica, o vacío.' },
      amt: { type: 'number', description: 'Monto, siempre positivo.' },
      cur: { type: 'string', enum: ['ARS', 'USD'] },
      desc: { type: 'string', description: 'Descripción corta (ej: nombre del cliente, comercio, motivo).' },
      pay: { type: 'string', enum: ['efectivo', 'transferencia', 'credito'], description: 'Solo si type=gasto y se menciona o se puede inferir el medio de pago; si no, transferencia.' },
      confidence: { type: 'string', enum: ['alta', 'media', 'baja'], description: 'Qué tan seguro estás de la categoría elegida.' },
    },
    required: ['type', 'cat', 'amt', 'cur', 'desc', 'confidence'],
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en Vercel.' });
    return;
  }
  try {
    const { text, categories, cards, clients, today, defaultCur } = req.body || {};
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Falta el texto a interpretar.' });
      return;
    }

    const catList = Object.entries(categories || {})
      .map(([type, cats]) => {
        const lines = (cats || [])
          .map((c) => `  - ${c.n}${c.s && c.s.length ? ' (' + c.s.join(', ') + ')' : ''}`)
          .join('\n');
        return `${type}:\n${lines}`;
      })
      .join('\n');

    const system = `Sos un asistente que interpreta mensajes cortos en español rioplatense sobre movimientos de plata (gastos, ingresos, ahorros) y los convierte en un registro estructurado para una app de finanzas personales.

Fecha de hoy: ${today || 'desconocida'}. Moneda por defecto si no se aclara: ${defaultCur || 'ARS'}.

Categorías disponibles (usá el nombre EXACTO de la lista, elegí la que mejor calce; si no calza ninguna bien, usá "Otros" o la más genérica del tipo):
${catList || 'sin categorías cargadas'}

Tarjetas conocidas: ${(cards || []).join(', ') || 'ninguna'}
Clientes conocidos (para ingresos de trabajo): ${(clients || []).join(', ') || 'ninguno'}

Reglas:
- Si dice "gasté", "pagué", "compré" → type=gasto.
- Si dice "cobré", "me pagaron", "ingresó", "entró" → type=ingreso.
- Si dice "ahorré", "aparté", "puse en el fondo" → type=ahorro.
- Si el texto menciona un cliente conocido, usá cat="Trabajo", sub="Clientes" y poné el nombre del cliente en desc.
- Nunca inventes un monto: si no hay un número claro, elegí el monto más razonable mencionado.
- Siempre llamá a la herramienta registrar_movimiento con tu mejor interpretación.`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system,
        messages: [{ role: 'user', content: text }],
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'registrar_movimiento' },
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      res.status(502).json({ error: 'Error de la API de Claude: ' + errText });
      return;
    }

    const data = await r.json();
    const toolUse = (data.content || []).find((b) => b.type === 'tool_use');
    if (!toolUse) {
      res.status(502).json({ error: 'No se pudo interpretar el mensaje.' });
      return;
    }
    res.status(200).json({ result: toolUse.input });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Error interpretando el mensaje.' });
  }
}
