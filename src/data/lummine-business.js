import { normalizeText } from '../lib/text.js';

export const STORE_LINKS = {
  home: 'https://lummine.com/',
  indumentaria: 'https://lummine.com/indumentaria/',
  packs: 'https://lummine.com/packs/',
  contacto: 'https://lummine.com/contacto/',
  politicaEnvio: 'https://lummine.com/politica-de-envio/',
  politicaDevolucion: 'https://lummine.com/politica-de-devolucion/'
};

export const PRODUCT_CATALOG = [
  {
    slug: 'bodys-modeladores',
    name: '3x1 en Bodys Modeladores',
    category: 'Indumentaria',
    url: 'https://lummine.com/productos/3x1-en-bodys-modeladores-boob-tape-de-regalo/',
    shortDescription: 'Pack de bodys modeladores con talles M/L y XL/XXL.',
    keywords: ['body', 'bodys', 'modelador', 'reductor', 'boob tape'],
    notes: [
      'Producto orientado a modelar y contener.',
      'Consultar talle antes de cerrar compra si la clienta tiene dudas.'
    ]
  },
  {
    slug: 'short-faja-reductor',
    name: 'Promo 3x1 | Short Faja Reductor con Varillas',
    category: 'Indumentaria',
    url: 'https://lummine.com/productos/promo-3x1-short-faja-reductor-con-varillas-c9n24/',
    shortDescription: 'Short faja reductor con varillas, disponible en colores negro, beige y avellana.',
    keywords: ['short', 'faja', 'reductor', 'varillas', 'beige', 'avellana', 'negro'],
    notes: [
      'Conviene pedir talle y color antes de responder con seguridad.',
      'Es una consulta típica de modelado/reducción.'
    ]
  },
  {
    slug: 'corpino-bretel-ancho',
    name: 'Pack 3x1 | Corpiño Segunda Piel Bretel Ancho',
    category: 'Packs',
    url: 'https://lummine.com/productos/pack-3x1-corpino-segunda-piel-bretel-ancho/',
    shortDescription: 'Corpiño segunda piel bretel ancho en varios talles.',
    keywords: ['corpiño', 'corpino', 'segunda piel', 'bretel ancho', 'talle 1', 'talle 2', 'talle 3', 'talle 4'],
    notes: [
      'Ideal para consultas de comodidad y uso diario.',
      'Si preguntan por talle, pedir referencia de uso actual.'
    ]
  },
  {
    slug: 'conjunto-confort-morley',
    name: 'Pack 2x1 | Conjunto Confort Morley',
    category: 'Packs',
    url: 'https://lummine.com/productos/pack-2x1-conjunto-confort-morely-v4p5h/',
    shortDescription: 'Conjunto confort Morley en pack 2x1.',
    keywords: ['conjunto', 'confort', 'morley', 'pack'],
    notes: [
      'Consulta típica de comodidad y uso diario.',
      'Conviene confirmar talle antes de derivar a compra.'
    ]
  }
];

export const PAYMENT_RULES = {
  general: [
    'No mencionar promociones ni transferencia en todos los mensajes.',
    'Solo hablar de pagos si el cliente pregunta por pagos, precios, promociones o está cerca de comprar.',
    'No inventar medios de pago que no estén configurados.',
    'Si la clienta está lista para comprar, guiarla de forma simple y natural.'
  ],
  publicInfo: [
    'En la tienda se comunica 15% OFF por transferencia.',
    'En productos visibles se muestran cuotas sin interés.',
    'No forzar la promo en respuestas donde no suma.'
  ],
  transfer: {
    enabled: true,
    alias: process.env.TRANSFER_ALIAS || 'TU_ALIAS_REAL',
    cbu: process.env.TRANSFER_CBU || 'TU_CBU_REAL',
    holder: process.env.TRANSFER_HOLDER || 'TITULAR_REAL',
    bank: process.env.TRANSFER_BANK || 'BANCO_REAL',
    extraInstructions: process.env.TRANSFER_EXTRA || 'Una vez realizada la transferencia, enviar comprobante por este medio para validarlo.'
  }
};

export const POLICY_SUMMARY = {
  shipping: [
    'Se realizan envíos a todo el país.',
    'La política pública menciona Correo Argentino.',
    'El tiempo estimado informado es de hasta 8 días hábiles desde la confirmación del pago.',
    'Si preguntan por seguimiento, se puede derivar a seguimiento con código.'
  ],
  returns: [
    'No se aceptan devoluciones por higiene salvo error de empaquetado, defecto o daño comprobado.',
    'Los inconvenientes deben reportarse dentro de las 48 horas posteriores a la recepción.',
    'Si hay error de envío o daño, corresponde revisión y resolución.'
  ]
};

export function findRelevantProducts(text = '', limit = 3) {
  const query = normalizeText(text);

  return PRODUCT_CATALOG.map((product) => {
    const haystack = normalizeText([
      product.name,
      product.category,
      product.shortDescription,
      ...(product.keywords || [])
    ].join(' '));

    let score = 0;

    for (const keyword of product.keywords || []) {
      if (query.includes(normalizeText(keyword))) score += 3;
    }

    if (query.includes(normalizeText(product.name))) score += 5;

    for (const token of query.split(/\s+/)) {
      if (token && haystack.includes(token)) score += 1;
    }

    return { product, score };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.product);
}

export function detectBusinessIntent(text = '') {
  const q = normalizeText(text);

  if (/(pedido|orden|seguimiento|codigo de seguimiento|código de seguimiento|despachado|demora)/.test(q)) return 'order_status';
  if (/(transferencia|alias|cbu|banco|comprobante|pago)/.test(q)) return 'payment';
  if (/(envio|enviar|correo|llega|demora)/.test(q)) return 'shipping';
  if (/(cambio|devolucion|devolución|reclamo|defecto|dañado|danado)/.test(q)) return 'returns';
  if (/(talle|medida|medidas)/.test(q)) return 'size_help';
  if (/(stock|disponible|queda|color|colores)/.test(q)) return 'stock_check';
  if (/(body|bodies|faja|short|corpi|bombacha|musculosa|calza|conjunto|morley)/.test(q)) return 'product';
  return 'general';
}

export function buildRelevantBusinessData(userText = '') {
  const intent = detectBusinessIntent(userText);
  const products = findRelevantProducts(userText, 3);

  return {
    intent,
    links: STORE_LINKS,
    products,
    paymentRules: PAYMENT_RULES,
    policySummary: POLICY_SUMMARY
  };
}