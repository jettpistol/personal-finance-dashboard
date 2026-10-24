import type { CategoryId } from './categories'

export interface Rule {
  category: CategoryId
  /**
   * Whole words or phrases, matched against the normalised merchant (see normalizeText).
   * "UBER" matches "PAYU*AR*UBER" and "UBER TRIP" but not "SUPERBERTA".
   */
  words?: string[]
  /**
   * Substrings matched against the merchant with spaces removed. Only for names the
   * processors glue together ("MERPAGO*BURGERKING") or truncate ("SPORTCLU"); keep them distinctive.
   */
  contains?: string[]
}

/**
 * Default rules for a typical Argentine household. First match wins, so brand-specific
 * rules come before generic ones (UBER EATS is delivery, UBER is transport).
 * Anything that does not match stays unclassified on purpose.
 */
export const DEFAULT_RULES: Rule[] = [
  { category: 'delivery', words: ['RAPPI', 'PEDIDOSYA', 'PEDIDOS YA', 'UBER EATS', 'GLOVO', 'IFOOD'], contains: ['PEDIDOSYA'] },

  // Brand-specific rules that would otherwise be caught by generic ones below.
  { category: 'subscriptions', words: ['AMAZON PRIME', 'PRIME VIDEO', 'PRIMEVIDEO', 'GOOGLE ONE', 'GOOGLE STORAGE', 'APPLE COM BILL'] },
  { category: 'entertainment', words: ['MOVISTAR ARENA'] },

  {
    category: 'subscriptions',
    words: [
      'NETFLIX', 'HBO MAX', 'HBOMAX', 'DISNEY', 'DISNEY PLUS', 'SPOTIFY', 'YOUTUBE', 'ITUNES', 'ICLOUD', 'PARAMOUNT',
      'STAR PLUS', 'STARPLUS', 'CRUNCHYROLL', 'DEEZER', 'TWITCH', 'DAZN', 'PATREON', 'CHATGPT', 'OPENAI', 'ANTHROPIC',
      'CLAUDE AI', 'LINKEDIN', 'GITHUB', 'NOTION', 'DROPBOX', 'CANVA', 'ADOBE', 'MICROSOFT', 'DUOLINGO', 'AUDIBLE',
    ],
    contains: ['CRUNCHYRO', 'YOUTUBE'],
  },

  {
    category: 'groceries',
    words: [
      'COTO', 'CARREFOUR', 'JUMBO', 'DISCO', 'VEA', 'CHANGOMAS', 'CHANGO MAS', 'WALMART', 'LA ANONIMA', 'MAKRO', 'DIARCO',
      'SUPERMERCADOS DIA', 'DIA ARGENTINA', 'SUPER', 'SUPERMERCADO', 'SUPERMERCADOS', 'HIPERMERCADO', 'MAYORISTA',
      'VERDULERIA', 'FRUTERIA', 'FRUTA', 'CARNICERIA', 'PANADERIA', 'FIAMBRERIA', 'DIETETICA', 'ALMACEN', 'GRANJA',
      'POLLERIA', 'PESCADERIA', 'KIOSCO', 'KIOSKO', 'MAXIKIOSCO', 'DESPENSA',
    ],
    contains: ['VERDULERIA', 'FRUTERIA', 'CARNICERIA', 'PANADERIA', 'KIOSCO', 'KIOSKO'],
  },

  {
    category: 'transport',
    words: [
      'UBER', 'CABIFY', 'DIDI', 'INDRIVE', 'IN DRIVE', 'SUBE', 'SUBTE', 'EMOVA', 'METROVIAS', 'TRENES ARGENTINOS', 'TREN',
      'FLECHABUS', 'FLECHA BUS', 'ANDESMAR', 'VIA BARILOCHE', 'CHEVALLIER', 'PLUSMAR', 'ESTACIONAMIENTO', 'PARKING',
      'PEAJE', 'AUTOPISTAS', 'AUSOL', 'AUSA', 'TELEPASE', 'TELEPEAJE', 'TAXI', 'RADIOTAXI', 'REMIS', 'REMISES', 'COLECTIVO',
    ],
  },
  {
    category: 'fuel',
    words: ['YPF', 'SHELL', 'AXION', 'PUMA ENERGY', 'PUMA ENERGIA', 'ESTACION DE SERVICIO', 'COMBUSTIBLE', 'GNC'],
  },
  {
    category: 'travel',
    words: [
      'AEROLINEAS', 'FLYBONDI', 'JETSMART', 'JET SMART', 'LATAM', 'BOOKING', 'AIRBNB', 'DESPEGAR', 'ALMUNDO', 'EXPEDIA',
      'AMERICAN AIRLINES', 'AVIANCA', 'HOTEL', 'HOSTEL', 'HOTELES', 'BUQUEBUS', 'COLONIA EXPRESS',
    ],
  },
  {
    category: 'telecom',
    words: [
      'CLARO', 'MOVISTAR', 'TELECENTRO', 'FIBERTEL', 'CABLEVISION', 'TELECOM', 'IPLAN', 'DIRECTV', 'TUENTI', 'PERSONAL FLOW',
      'TELEFONICA', 'NEXTEL',
    ],
  },
  {
    category: 'utilities',
    words: ['EDENOR', 'EDESUR', 'METROGAS', 'NATURGY', 'AYSA', 'CAMUZZI', 'ECOGAS', 'EPEC', 'EDEMSA', 'ABSA', 'EDELAP'],
  },
  { category: 'housing', words: ['EXPENSAS', 'ALQUILER', 'CONSORCIO', 'INMOBILIARIA'] },

  // Insurance before health: "GALICIA SEGUROS" must not fall into a generic health rule.
  { category: 'insurance', words: ['SEGUROS', 'SEGURO', 'ZURICH', 'MAPFRE', 'ALLIANZ', 'FEDERACION PATRONAL', 'LA SEGUNDA'] },
  {
    category: 'health',
    words: [
      'FARMACITY', 'FARMACIA', 'FARMACIAS', 'DR AHORRO', 'SIMPLICITY', 'SWISS MEDICAL', 'OSDE', 'MEDICUS', 'GALENO', 'OMINT',
      'MEDIFE', 'PREVENCION SALUD', 'HOSPITAL', 'SANATORIO', 'CLINICA', 'LABORATORIO', 'ODONTOLOGIA', 'OPTICA',
    ],
  },
  {
    category: 'fitness',
    words: ['MEGATLON', 'SPORTCLUB', 'SPORT CLUB', 'SMARTFIT', 'SMART FIT', 'GIMNASIO', 'CROSSFIT', 'FITNESS', 'PILATES', 'GYMPASS', 'WELLHUB'],
    contains: ['SPORTCLU'],
  },
  {
    category: 'entertainment',
    words: [
      'CINE', 'CINEMA', 'HOYTS', 'CINEMARK', 'SHOWCASE', 'TICKETEK', 'ALLACCESS', 'ALL ACCESS', 'EVENTBRITE', 'TEATRO',
      'ENTRADAS', 'PLATEANET', 'STEAM', 'PLAYSTATION', 'XBOX', 'NINTENDO', 'BOWLING',
    ],
    contains: ['TUENTRADA'],
  },
  {
    category: 'dining',
    words: [
      'MCDONALDS', 'MC DONALDS', 'MCDONALD', 'BURGER KING', 'STARBUCKS', 'HAVANNA', 'FREDDO', 'GRIDO', 'MOSTAZA', 'SUBWAY',
      'KFC', 'WENDYS', 'PIZZERIA', 'PIZZA', 'RESTAURANT', 'RESTAURANTE', 'RESTO', 'PARRILLA', 'HELADERIA', 'CAFETERIA',
      'CAFE', 'CERVECERIA', 'DUNKIN', 'TIM HORTONS',
    ],
    contains: ['BURGERKING'],
  },
  { category: 'education', words: ['UDEMY', 'COURSERA', 'PLATZI', 'UNIVERSIDAD', 'COLEGIO', 'ESCUELA', 'INSTITUTO', 'CURSO', 'CURSOS', 'IDIOMAS', 'CAMBRIDGE', 'BRITISH COUNCIL'] },
  {
    category: 'clothing',
    words: [
      'SOLO DEPORTES', 'SOLO URBANO', 'DEXTER', 'NETSHOES', 'DECATHLON', 'ZARA', 'ADIDAS', 'NIKE', 'TOPPER', 'DAFITI',
      'GRIMOLDI', 'KOSIUKO', 'INDUMENTARIA', 'ZAPATERIA',
    ],
  },
  {
    category: 'home',
    words: ['EASY ARGENTINA', 'SODIMAC', 'FERRETERIA', 'PINTURERIA', 'CORRALON', 'HOME CENTER', 'MUEBLES', 'COLCHONES', 'BAZAR'],
    contains: ['CENCOSUDEASY', 'FERRETERIA', 'PINTURERIA'],
  },
  { category: 'electronics', words: ['FRAVEGA', 'MUSIMUNDO', 'GARBARINO', 'COMPUMUNDO'] },
  { category: 'pets', words: ['PET SHOP', 'VETERINARIA', 'VETERINARIO', 'MASCOTAS'], contains: ['PETSHOP'] },
  { category: 'personal_care', words: ['PELUQUERIA', 'BARBERIA', 'PERFUMERIA', 'ESTETICA', 'MANICURA', 'DEPILACION'] },
  { category: 'government_taxes', words: ['ARBA', 'AFIP', 'ARCA', 'AGIP', 'RENTAS', 'MONOTRIBUTO', 'IMPUESTOS', 'ABL', 'PATENTE', 'PATENTES', 'MUNICIPALIDAD'] },

  // Most generic last: marketplaces can sell anything.
  { category: 'shopping', words: ['MERCADOLIBRE', 'MERCADO LIBRE', 'MELI', 'AMAZON', 'ALIEXPRESS', 'TEMU', 'SHEIN', 'FALABELLA'] },
]
