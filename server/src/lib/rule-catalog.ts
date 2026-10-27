// A bank of suggested rules for life in Buenos Aires: the stores, apps and services that most
// often show up on Argentine card and bank statements. Nothing here is applied on its own; the
// Reglas page lets you browse it and add the ones you want to the profile in use.
//
// Patterns are case-insensitive regular expressions written to catch the usual ways a merchant
// appears on statements (e.g. "MERPAGO*PEDIDOSYA", "DLO*PEDIDOS YA"). Categories are names from
// the default category list, as "Main > Sub"; a missing category leaves the rule without one.

export type CatalogRule = {
  id: string;
  section: string;
  name: string;
  pattern: string;
  category: string | null;
  merchant: string;
  tags: string[];
};

type Row = [id: string, name: string, pattern: string, category: string | null, tags: string[]];

const SECTIONS: [section: string, rows: Row[]][] = [
  [
    'Supermercados',
    [
      ['coto', 'Coto', '\\bcoto\\b', 'Supermercado > Almacén', ['super']],
      ['carrefour', 'Carrefour', 'carrefour', 'Supermercado > Almacén', ['super']],
      ['dia', 'Día', '\\bsupermercados? dia\\b|\\bdia (tienda|argentina)\\b', 'Supermercado > Almacén', ['super']],
      ['jumbo', 'Jumbo', '\\bjumbo\\b', 'Supermercado > Almacén', ['super']],
      ['disco', 'Disco', '\\bdisco\\b', 'Supermercado > Almacén', ['super']],
      ['vea', 'Vea', '\\bvea\\b', 'Supermercado > Almacén', ['super']],
      ['changomas', 'ChangoMâs', 'chango ?m[aâ]s|walmart', 'Supermercado > Almacén', ['super']],
      ['laanonima', 'La Anónima', 'la an[oó]nima', 'Supermercado > Almacén', ['super']],
      ['makro', 'Makro', '\\bmakro\\b', 'Supermercado > Almacén', ['super', 'mayorista']],
      ['diarco', 'Diarco', '\\bdiarco\\b', 'Supermercado > Almacén', ['super', 'mayorista']],
      ['maxiconsumo', 'Maxiconsumo', 'maxiconsumo', 'Supermercado > Almacén', ['super', 'mayorista']],
      ['vital', 'Vital', 'supermayorista vital|\\bvital\\b', 'Supermercado > Almacén', ['super', 'mayorista']],
      ['josimar', 'Josimar', 'josimar', 'Supermercado > Almacén', ['super']],
      ['carniceria', 'Carnicería', 'carnicer[ií]a', 'Supermercado > Carnicería', ['super']],
      ['verduleria', 'Verdulería', 'verduler[ií]a|fruter[ií]a', 'Supermercado > Verdulería', ['super']],
    ],
  ],
  [
    'Delivery y comida rápida',
    [
      ['pedidosya', 'PedidosYa', 'pedidos ?ya', 'Salidas > Delivery', ['delivery']],
      ['rappi', 'Rappi', '\\brappi', 'Salidas > Delivery', ['delivery']],
      ['mcdonalds', "McDonald's", 'mc ?donald|arcos dorados', 'Salidas > Restaurantes', ['comida rápida']],
      ['burgerking', 'Burger King', 'burger king', 'Salidas > Restaurantes', ['comida rápida']],
      ['mostaza', 'Mostaza', '\\bmostaza\\b', 'Salidas > Restaurantes', ['comida rápida']],
      ['kfc', 'KFC', '\\bkfc\\b', 'Salidas > Restaurantes', ['comida rápida']],
      ['starbucks', 'Starbucks', 'starbucks', 'Salidas > Bares', ['café']],
      ['cafemartinez', 'Café Martínez', 'caf[eé] mart[ií]nez', 'Salidas > Bares', ['café']],
      ['havanna', 'Havanna', 'havanna', 'Salidas > Bares', ['café']],
      ['tienda-cafe', 'Tienda de Café', 'tienda de caf[eé]', 'Salidas > Bares', ['café']],
      ['grido', 'Grido', '\\bgrido\\b', 'Salidas > Restaurantes', ['helado']],
      ['freddo', 'Freddo', '\\bfreddo\\b', 'Salidas > Restaurantes', ['helado']],
      ['rapanui', 'Rapanui', 'rapa ?nui', 'Salidas > Restaurantes', ['helado']],
      ['guerrin', 'Pizzería Güerrín', 'g[uü]err[ií]n', 'Salidas > Restaurantes', ['pizza']],
    ],
  ],
  [
    'Transporte y auto',
    [
      ['sube', 'Carga SUBE', '\\bsube\\b', 'Transporte > Transporte público', []],
      ['uber', 'Uber', '\\buber\\b(?! ?eats)', 'Transporte > Taxi y apps', ['apps de viaje']],
      ['cabify', 'Cabify', 'cabify', 'Transporte > Taxi y apps', ['apps de viaje']],
      ['didi', 'DiDi', '\\bdidi\\b', 'Transporte > Taxi y apps', ['apps de viaje']],
      ['ypf', 'YPF', '\\bypf\\b', 'Transporte', ['auto', 'nafta']],
      ['shell', 'Shell', '\\bshell\\b', 'Transporte', ['auto', 'nafta']],
      ['axion', 'Axion', '\\baxion\\b', 'Transporte', ['auto', 'nafta']],
      ['puma', 'Puma Energy', 'puma energy', 'Transporte', ['auto', 'nafta']],
      ['ausa', 'AUSA / peajes', '\\bausa\\b|autopistas urbanas|peaje', 'Transporte', ['auto', 'peaje']],
      ['telepase', 'TelePASE', 'tele ?pase', 'Transporte', ['auto', 'peaje']],
      ['estacionamiento', 'Estacionamiento', 'estacionamiento|parking|playa de estac', 'Transporte', ['auto']],
      ['ecobici', 'EcoBici', 'ecobici|ba ecobici', 'Transporte > Bicicleta', []],
      ['vtv', 'VTV', '\\bvtv\\b', 'Transporte', ['auto']],
      ['patente', 'Patente (ARBA / AGIP)', 'patente|automotor', 'Impuestos y comisiones > Impuestos', ['auto', 'impuestos']],
    ],
  ],
  [
    'Servicios del hogar',
    [
      ['edenor', 'Edenor', 'edenor', 'Servicios > Luz', ['servicios']],
      ['edesur', 'Edesur', 'edesur', 'Servicios > Luz', ['servicios']],
      ['metrogas', 'Metrogas', 'metrogas', 'Servicios > Gas', ['servicios']],
      ['naturgy', 'Naturgy', 'naturgy|gas natural ban', 'Servicios > Gas', ['servicios']],
      ['aysa', 'AySA', '\\baysa\\b|agua y saneamientos', 'Servicios > Agua', ['servicios']],
      ['telecentro', 'Telecentro', 'telecentro', 'Servicios > Internet', ['servicios']],
      ['personal-flow', 'Personal / Flow / Fibertel', 'fibertel|\\bflow\\b|telecom|personal flow', 'Servicios > Internet', ['servicios']],
      ['movistar', 'Movistar', 'movistar|telef[oó]nica', 'Servicios > Celular', ['servicios']],
      ['claro', 'Claro', '\\bclaro\\b|amx argentina', 'Servicios > Celular', ['servicios']],
      ['personal-cel', 'Personal (celular)', '\\bpersonal\\b(?! flow)', 'Servicios > Celular', ['servicios']],
      ['directv', 'DirecTV', 'directv', 'Suscripciones > Streaming', ['servicios']],
      ['expensas', 'Expensas', 'expensas|consorcio|administraci[oó]n de consorcio', 'Vivienda > Expensas', ['hogar']],
      ['abl', 'ABL (AGIP)', '\\babl\\b|agip', 'Impuestos y comisiones > Impuestos', ['hogar', 'impuestos']],
    ],
  ],
  [
    'Suscripciones',
    [
      ['netflix', 'Netflix', 'netflix', 'Suscripciones > Streaming', ['suscripción']],
      ['spotify', 'Spotify', 'spotify', 'Suscripciones > Streaming', ['suscripción']],
      ['disney', 'Disney+', 'disney', 'Suscripciones > Streaming', ['suscripción']],
      ['max', 'Max (HBO)', '\\bhbo\\b|\\bmax\\.com|hbo ?max', 'Suscripciones > Streaming', ['suscripción']],
      ['prime', 'Amazon Prime Video', 'prime ?video|amazon prime|amzn', 'Suscripciones > Streaming', ['suscripción']],
      ['paramount', 'Paramount+', 'paramount', 'Suscripciones > Streaming', ['suscripción']],
      ['youtube', 'YouTube Premium', 'youtube', 'Suscripciones > Streaming', ['suscripción']],
      ['apple', 'Apple (iCloud, Music, apps)', 'apple\\.com|itunes|\\bapple\\b', 'Suscripciones > Software', ['suscripción']],
      ['google', 'Google (One, Play)', 'google ?(one|play|\\*)|google storage', 'Suscripciones > Software', ['suscripción']],
      ['microsoft', 'Microsoft 365 / Xbox', 'microsoft|xbox|msft', 'Suscripciones > Software', ['suscripción']],
      ['openai', 'ChatGPT', 'openai|chatgpt', 'Suscripciones > Software', ['suscripción']],
      ['steam', 'Steam', '\\bsteam', 'Suscripciones > Software', ['juegos']],
      ['playstation', 'PlayStation', 'playstation|\\bpsn\\b|sony interactive', 'Suscripciones > Software', ['juegos']],
    ],
  ],
  [
    'Salud',
    [
      ['osde', 'OSDE', '\\bosde\\b', 'Salud > Prepaga', ['salud']],
      ['swiss', 'Swiss Medical', 'swiss medical', 'Salud > Prepaga', ['salud']],
      ['galeno', 'Galeno', 'galeno', 'Salud > Prepaga', ['salud']],
      ['medicus', 'Medicus', 'medicus', 'Salud > Prepaga', ['salud']],
      ['omint', 'Omint', '\\bomint\\b', 'Salud > Prepaga', ['salud']],
      ['farmacity', 'Farmacity', 'farmacity', 'Salud > Farmacia', ['salud']],
      ['drahorro', 'Dr. Ahorro', 'dr\\.? ?ahorro', 'Salud > Farmacia', ['salud']],
      ['farmacia', 'Farmacia', 'farmacia', 'Salud > Farmacia', ['salud']],
      ['sportclub', 'SportClub', 'sport ?club', 'Suscripciones > Gimnasio', ['deporte']],
      ['megatlon', 'Megatlon', 'megatlon', 'Suscripciones > Gimnasio', ['deporte']],
      ['smartfit', 'Smart Fit', 'smart ?fit', 'Suscripciones > Gimnasio', ['deporte']],
    ],
  ],
  [
    'Compras',
    [
      ['mercadolibre', 'Mercado Libre', 'mercado ?libre|merpago\\*ml|meli\\b', 'Compras', ['online']],
      ['fravega', 'Frávega', 'fr[aá]vega', 'Compras > Tecnología', ['electro']],
      ['musimundo', 'Musimundo', 'musimundo', 'Compras > Tecnología', ['electro']],
      ['megatone', 'Megatone', 'megatone', 'Compras > Tecnología', ['electro']],
      ['naldo', 'Naldo', '\\bnaldo\\b', 'Compras > Tecnología', ['electro']],
      ['oncity', 'OnCity', 'on ?city', 'Compras > Tecnología', ['electro', 'online']],
      ['zara', 'Zara', '\\bzara\\b', 'Compras > Ropa', ['ropa']],
      ['nike', 'Nike', '\\bnike\\b', 'Compras > Ropa', ['ropa', 'deporte']],
      ['adidas', 'Adidas', 'adidas', 'Compras > Ropa', ['ropa', 'deporte']],
      ['dexter', 'Dexter', '\\bdexter\\b', 'Compras > Ropa', ['ropa', 'deporte']],
      ['grimoldi', 'Grimoldi', 'grimoldi', 'Compras > Ropa', ['ropa']],
      ['mimo', 'Mimo & Co', '\\bmimo\\b', 'Compras > Ropa', ['ropa', 'chicos']],
      ['sodimac', 'Sodimac', 'sodimac', 'Compras > Hogar', ['hogar']],
      ['easy', 'Easy', '\\beasy\\b', 'Compras > Hogar', ['hogar']],
      ['blaisten', 'Blaisten', 'blaisten', 'Compras > Hogar', ['hogar']],
      ['ikea', 'Muebles (Ikea, Mercado de Muebles)', 'ikea|muebler[ií]a', 'Compras > Hogar', ['hogar']],
      ['puppis', 'Puppis', 'puppis', 'Otros gastos > Varios', ['mascotas']],
      ['veterinaria', 'Veterinaria', 'veterinari', 'Otros gastos > Varios', ['mascotas']],
      ['yenny', 'Yenny / El Ateneo', 'yenny|el ateneo|cuspide', 'Educación > Libros', ['libros']],
    ],
  ],
  [
    'Salidas y entretenimiento',
    [
      ['cinemark', 'Cinemark Hoyts', 'cinemark|hoyts', 'Salidas > Cine y eventos', ['cine']],
      ['cinepolis', 'Cinépolis', 'cin[eé]polis', 'Salidas > Cine y eventos', ['cine']],
      ['showcase', 'Showcase', 'showcase', 'Salidas > Cine y eventos', ['cine']],
      ['ticketek', 'Ticketek', 'ticketek', 'Salidas > Cine y eventos', ['recitales']],
      ['allaccess', 'All Access / Passline', 'all ?access|passline|tuentrada|enigma tickets', 'Salidas > Cine y eventos', ['recitales']],
      ['temple', 'Temple Bar', 'temple', 'Salidas > Bares', ['bar']],
    ],
  ],
  [
    'Viajes',
    [
      ['aerolineas', 'Aerolíneas Argentinas', 'aerol[ií]neas argentinas|\\baerolineas\\b', 'Viajes > Pasajes', ['viaje']],
      ['flybondi', 'Flybondi', 'flybondi', 'Viajes > Pasajes', ['viaje']],
      ['jetsmart', 'JetSMART', 'jet ?smart', 'Viajes > Pasajes', ['viaje']],
      ['buquebus', 'Buquebus', 'buquebus|colonia express', 'Viajes > Pasajes', ['viaje']],
      ['despegar', 'Despegar', 'despegar', 'Viajes', ['viaje']],
      ['airbnb', 'Airbnb', 'airbnb', 'Viajes > Alojamiento', ['viaje']],
      ['booking', 'Booking', 'booking', 'Viajes > Alojamiento', ['viaje']],
      ['plataforma10', 'Micros (Plataforma 10)', 'plataforma ?10|central de pasajes', 'Viajes > Pasajes', ['viaje', 'micro']],
    ],
  ],
  [
    'Impuestos y comisiones',
    [
      ['impdebcred', 'Impuesto a los débitos y créditos', 'imp\\.? ?(deb|cred)|ley 25\\.?413|impuesto al cheque', 'Impuestos y comisiones > Impuestos', ['impuestos']],
      ['percepcion', 'Percepción en compras en dólares', 'percep|rg ?5617|rg ?4815|impuesto pa[ií]s', 'Impuestos y comisiones > Impuestos', ['impuestos', 'dólares']],
      ['iibb', 'Ingresos Brutos (ARBA / AGIP)', 'ingresos brutos|\\biibb\\b|arba', 'Impuestos y comisiones > Impuestos', ['impuestos']],
      ['monotributo', 'Monotributo (ARCA)', 'monotributo|\\barca\\b|\\bafip\\b', 'Impuestos y comisiones > Impuestos', ['impuestos', 'trabajo']],
      ['mantenimiento', 'Mantenimiento de cuenta', 'mantenimiento de cuenta|comisi[oó]n mant|cargo mensual', 'Impuestos y comisiones > Comisiones bancarias', ['banco']],
      ['interesestarjeta', 'Intereses de la tarjeta', 'intereses (financ|punit)|int\\.? financ', 'Impuestos y comisiones > Intereses de tarjeta', ['banco']],
      ['iva', 'IVA en servicios digitales', '\\biva\\b.*(servicio|digital)', 'Impuestos y comisiones > Impuestos', ['impuestos']],
    ],
  ],
  [
    'Ingresos',
    [
      ['sueldo', 'Sueldo / haberes', 'haberes|sueldo|remuneraci[oó]n|acreditaci[oó]n de sueldo', 'Sueldo', []],
      ['rendimientos', 'Rendimientos (cuenta remunerada, FCI)', 'rendimiento|intereses ganados|fci', 'Inversiones > Intereses', ['inversiones']],
      ['reintegro', 'Reintegros y devoluciones', 'reintegro|devoluci[oó]n|cashback', 'Reintegros', []],
      ['ventaml', 'Ventas en Mercado Libre', 'venta.*mercado ?libre|liquidaci[oó]n.*mercado', 'Otros ingresos > Ventas', ['ventas']],
    ],
  ],
];

// Generic patterns (a kind of shop, a tax) set the category but not a merchant name.
const GENERIC = new Set(['carniceria', 'verduleria', 'estacionamiento', 'patente', 'expensas', 'abl', 'ausa', 'farmacia', 'veterinaria', 'ikea', 'plataforma10', 'impdebcred', 'percepcion', 'iibb', 'monotributo', 'mantenimiento', 'interesestarjeta', 'iva', 'sueldo', 'rendimientos', 'reintegro', 'ventaml']);

export const RULE_CATALOG: CatalogRule[] = SECTIONS.flatMap(([section, rows]) =>
  rows.map(([id, name, pattern, category, tags]) => ({ id, section, name, pattern, category, merchant: GENERIC.has(id) ? '' : name.replace(/ \(.*\)$/, ''), tags })),
);
