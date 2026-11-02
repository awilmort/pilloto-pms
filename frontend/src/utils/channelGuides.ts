/**
 * Connect-a-channel guides (CHANNEX_ARCHITECTURE.md §8.4; plan Phase 8.2): what the hotelier
 * does in each OTA, as data. The wizard renders any entry; adding an OTA = adding an entry
 * here and offering it (platform console → Channel Manager → OTAs offered to tenants). Codes
 * without an entry get the generic guide.
 *
 * Written from the plan's pilot checklists (11.3 C–F) and the provider's mapping guides.
 * The OTA extranets list Pilloto's connectivity provider by its own name, so the authorize
 * steps must say what to search for (`{{provider}}`); nothing else names it.
 *
 * Screenshot slots (`screenshots`) are filled during the pilot onboarding (plan 11.3): put the
 * images in `public/channel-guides/` and list their paths here.
 *
 * Placeholders: {{name}} (OTA), {{currency}} (property currency), {{provider}}.
 */

export type Lang = 'es' | 'en';
export type Localized = Record<Lang, string>;

export interface ChannelGuide {
  code: string;
  name: string;
  summary: Localized;
  /** The OTA account is logged into inside the connect step (OAuth, user/password): no authorize step */
  loginInConnectStep?: boolean;
  /** The OTA's login may refuse to load in a frame: offer "Open in new window" in the connect step */
  openInNewWindow?: boolean;
  /** The OTA approves the connection itself, which can take hours */
  approvalWait?: boolean;
  /** Step 1: things to check in the OTA before connecting (all must be ticked) */
  checklist: { id: string; text: Localized }[];
  /** Step 2: numbered extranet instructions and where the property id is */
  authorize?: { steps: Localized[]; propertyId?: Localized };
  /** Step 3: what to do in the connection screen */
  connect: Localized[];
  /** Step 3 side panel: OTA-specific mapping tips (after the common rules) */
  tips?: Localized[];
  /** Step 4: what to check once active */
  afterActivation?: Localized[];
  /** Detailed external guide (generic entry) */
  docsUrl?: string;
  screenshots?: { authorize?: string[]; connect?: string[] };
}

/** How the OTA extranets list Pilloto's connectivity provider */
export const CONNECTIVITY_PROVIDER = 'Channex';

export const CHANNEL_WIZARD_STEPS = ['before', 'authorize', 'connect', 'verify', 'done'] as const;
export type ChannelWizardStep = typeof CHANNEL_WIZARD_STEPS[number];

const ical = (where: Localized): { id: string; text: Localized } => ({
  id: 'ical',
  text: {
    es: `Quité todos los calendarios iCal (importar y exportar) entre {{name}} y otras OTAs o calendarios. ${where.es} Un iCal que quede activo sobrescribe lo que envía Pilloto.`,
    en: `I removed every iCal calendar (import and export) between {{name}} and other OTAs or calendars. ${where.en} A leftover iCal overwrites what Pilloto sends.`,
  },
});
const otherManager = (where: Localized): { id: string; text: Localized } => ({
  id: 'otherManager',
  text: { es: `No hay otro channel manager conectado a {{name}}. ${where.es}`, en: `No other channel manager is connected to {{name}}. ${where.en}` },
});
const currency = {
  id: 'currency',
  text: { es: 'La moneda de mi propiedad en {{name}} es la misma que en Pilloto ({{currency}}).', en: 'My property’s currency in {{name}} is the same as in Pilloto ({{currency}}).' },
};
const policies = {
  id: 'policies',
  text: {
    es: 'Configuré en {{name}} los impuestos (ITBIS 18 %, 10 % de servicio), las políticas de cancelación y las de niños. Los impuestos están incluidos o no igual que en Pilloto.',
    en: 'I set up taxes (ITBIS 18%, 10% service charge), cancellation and child policies in {{name}}. Taxes are included or not exactly as in Pilloto.',
  },
};
const noPullDuplicates: Localized = {
  es: 'No uses «Pull future reservations» (traer reservas futuras) si esas reservas ya están en Pilloto: se duplicarían.',
  en: 'Do not use “Pull future reservations” if those reservations are already in Pilloto: they would be duplicated.',
};

export const CHANNEL_GUIDES: Record<string, ChannelGuide> = {
  BDC: {
    code: 'BDC',
    name: 'Booking.com',
    summary: { es: 'Hoteles y alojamientos de todo el mundo. Reservas, cambios y cancelaciones llegan solos a Pilloto.', en: 'Hotels and stays worldwide. Bookings, changes and cancellations arrive in Pilloto on their own.' },
    approvalWait: true,
    checklist: [
      ical({ es: 'En la extranet: Tarifas y disponibilidad → Sincronizar calendarios → eliminar.', en: 'In the extranet: Rates & Availability → Sync calendars → remove.' }),
      otherManager({ es: 'En la extranet: Cuenta → Proveedor de conectividad.', en: 'In the extranet: Account → Connectivity provider.' }),
      currency,
      policies,
    ],
    authorize: {
      steps: [
        { es: 'Entra a la extranet de Booking.com (https://account.booking.com). Te pedirá la verificación en dos pasos.', en: 'Log in to the Booking.com extranet (https://account.booking.com). It asks for two-step verification.' },
        { es: 'Ve a Cuenta → Proveedor de conectividad.', en: 'Go to Account → Connectivity provider.' },
        { es: 'Pulsa Buscar y escribe la palabra completa «{{provider}}» (el proveedor de conectividad de Pilloto). Elige «{{provider}}.io» y pulsa Siguiente.', en: 'Press Search and type the full word “{{provider}}” (Pilloto’s connectivity provider). Choose “{{provider}}.io” and press Next.' },
        { es: 'Acepta el acuerdo de servicio XML.', en: 'Accept the XML Service Agreement.' },
      ],
      propertyId: { es: 'Anota el ID del alojamiento (Hotel ID): aparece arriba en la extranet, junto al nombre de tu propiedad. Lo necesitas en el paso siguiente.', en: 'Write down the property ID (Hotel ID): it is at the top of the extranet, next to your property’s name. You need it in the next step.' },
    },
    connect: [
      { es: 'Pulsa «Create» (Crear) y elige Booking.com.', en: 'Press “Create” and choose Booking.com.' },
      { es: 'Escribe un título (por ejemplo «Booking.com») y el Hotel ID. Pulsa «Test connection» (Probar conexión).', en: 'Enter a title (e.g. “Booking.com”) and the Hotel ID. Press “Test connection”.' },
      { es: 'Mapea cada habitación y cada tarifa de Booking.com, incluidas las tarifas derivadas antiguas que se puedan mapear.', en: 'Map every Booking.com room and rate, including old derived rates that can be mapped.' },
      { es: 'Elige la tarifa principal para el precio por ocupación y pulsa «Save» (Guardar).', en: 'Choose the primary rate for occupancy-based pricing and press “Save”.' },
      { es: 'Cuando Booking.com acepte la conexión, pulsa «Actions» → «Activate» (Activar).', en: 'Once Booking.com accepts the connection, press “Actions” → “Activate”.' },
    ],
    tips: [
      { es: 'Booking.com puede tardar desde unos minutos hasta un día en aceptar la conexión. Puedes cerrar el asistente y seguir luego desde la tarjeta del canal.', en: 'Booking.com can take from a few minutes to a day to accept the connection. You can close the wizard and continue later from the channel card.' },
      noPullDuplicates,
    ],
    afterActivation: [
      { es: 'Revisa en la extranet la estancia mínima y otros ajustes de las tarifas derivadas: Booking.com puede cambiarlos al conectar.', en: 'Review the minimum stay and other settings of derived rates in the extranet: Booking.com may change them on connection.' },
    ],
    screenshots: { authorize: [], connect: [] },
  },
  EXP: {
    code: 'EXP',
    name: 'Expedia',
    summary: { es: 'Expedia, Hotels.com y sus marcas. Incluye reservas pagadas a Expedia (Expedia Collect).', en: 'Expedia, Hotels.com and their brands. Includes bookings paid to Expedia (Expedia Collect).' },
    approvalWait: true,
    checklist: [
      ical({ es: 'Si usas calendarios externos, quítalos en Partner Central.', en: 'If you use external calendars, remove them in Partner Central.' }),
      otherManager({ es: 'En Partner Central: Habitaciones y tarifas → Configuración de conectividad.', en: 'In Partner Central: Rooms and rates → Connectivity settings.' }),
      currency,
      policies,
      { id: 'totalType', text: { es: 'Sé qué «Booking Total Type» usaré. Recomendamos «Total Amount» (importe total con impuestos), así el total de la reserva en Pilloto es lo que paga el huésped.', en: 'I know which “Booking Total Type” I will use. We recommend “Total Amount” (total with taxes), so the booking total in Pilloto is what the guest pays.' } },
    ],
    authorize: {
      steps: [
        { es: 'Entra a Expedia Partner Central (te pedirá la verificación en dos pasos).', en: 'Log in to Expedia Partner Central (it asks for two-step verification).' },
        { es: 'Ve a Habitaciones y tarifas → Configuración de conectividad (Connectivity Settings).', en: 'Go to Rooms and rates → Connectivity Settings.' },
        { es: 'Elige «{{provider}}» como proveedor de disponibilidad y tarifas y también para recibir las reservas.', en: 'Choose “{{provider}}” as the provider for availability and rates and also for booking retrieval.' },
      ],
      propertyId: { es: 'Anota el ID de propiedad de Expedia: aparece arriba en Partner Central.', en: 'Write down the Expedia property ID: it is shown at the top of Partner Central.' },
    },
    connect: [
      { es: 'Pulsa «Create» (Crear) y elige Expedia.', en: 'Press “Create” and choose Expedia.' },
      { es: 'Escribe un título, el ID de propiedad de Expedia, «Min Stay Type»: Arrival y el «Booking Total Type» que elegiste. Pulsa «Test connection».', en: 'Enter a title, the Expedia property ID, “Min Stay Type”: Arrival and the “Booking Total Type” you chose. Press “Test connection”.' },
      { es: 'Mapea cada habitación y tarifa de Expedia y pulsa «Save».', en: 'Map every Expedia room and rate and press “Save”.' },
      { es: 'Pulsa «Activate» (Activar). Expedia recibe entonces todos tus precios y disponibilidad.', en: 'Press “Activate”. Expedia then receives all your prices and availability.' },
    ],
    tips: [noPullDuplicates],
    screenshots: { authorize: [], connect: [] },
  },
  ABB: {
    code: 'ABB',
    name: 'Airbnb',
    summary: { es: 'Casas, villas y alojamientos únicos. Te conectas con tu cuenta de anfitrión de Airbnb.', en: 'Homes, villas and unique stays. You connect with your Airbnb host account.' },
    loginInConnectStep: true,
    openInNewWindow: true,
    checklist: [
      ical({ es: 'En Airbnb: Calendario → Disponibilidad → Conectar calendarios → eliminar.', en: 'In Airbnb: Calendar → Availability → Connect calendars → remove.' }),
      otherManager({ es: 'En Airbnb: Cuenta → Privacidad / aplicaciones conectadas.', en: 'In Airbnb: Account → Privacy / connected apps.' }),
      { id: 'availability', text: { es: 'En cada anuncio, la disponibilidad no está en «No disponible por defecto». Recomendamos activar la Reserva inmediata.', en: 'In each listing, availability is not “Unavailable by default”. We recommend turning Instant Book on.' } },
      currency,
      policies,
    ],
    connect: [
      { es: 'Pulsa «Create» (Crear), elige Airbnb y escribe un título.', en: 'Press “Create”, choose Airbnb and enter a title.' },
      { es: 'Pulsa «Connect to Airbnb»: inicia sesión con tu cuenta de anfitrión y aprueba la conexión. Si la página de Airbnb no carga aquí, usa «Abrir en una ventana nueva». También puedes usar «Copy link» y enviar el enlace al anfitrión.', en: 'Press “Connect to Airbnb”: log in with your host account and approve the connection. If Airbnb’s page does not load here, use “Open in new window”. You can also use “Copy link” and send the link to the host.' },
      { es: 'En «Mapping», asigna cada anuncio a su tipo de habitación y plan de tarifa, y pulsa «Save».', en: 'In “Mapping”, assign each listing to its room type and rate plan and press “Save”.' },
      { es: 'En «Listing» revisa los ajustes de precio (huéspedes incluidos, precio por huésped extra, limpieza, descuentos semanales o mensuales, depósito) y de disponibilidad (antelación, aviso, preparación, noches mínimas y máximas por defecto).', en: 'In “Listing”, review price settings (guests included, extra guest price, cleaning fee, weekly or monthly discounts, deposit) and availability settings (booking window, notice, preparation time, default min and max nights).' },
      { es: 'Publica o activa el canal.', en: 'Publish or activate the channel.' },
    ],
    tips: [
      { es: 'Airbnb recibe el precio de la ocupación que pongas en «huéspedes incluidos».', en: 'Airbnb receives the price of the occupancy you set as “guests included”.' },
      { es: 'Pilloto envía cada noche la estancia mínima por llegada y sobrescribe los valores por noche de Airbnb.', en: 'Pilloto sends the arrival-based minimum stay and overwrites Airbnb’s per-night values daily.' },
    ],
    screenshots: { connect: [] },
  },
  VRB: {
    code: 'VRB',
    name: 'Vrbo',
    summary: { es: 'Casas y apartamentos vacacionales. Te conectas con el usuario y la contraseña de Vrbo.', en: 'Vacation homes and apartments. You connect with your Vrbo username and password.' },
    loginInConnectStep: true,
    checklist: [
      { id: 'notApi', text: { es: 'Mi cuenta de Vrbo es normal (no está conectada por API a otro sistema). Si lo está, pide a soporte de Vrbo: «Por favor desconecten mi cuenta de mi channel manager actual, manejaré la extranet manualmente».', en: 'My Vrbo account is a normal one (not API-connected to another system). If it is, ask Vrbo support: “Please disconnect my account from my current channel manager, I will control the extranet manually”.' } },
      ical({ es: 'En Vrbo: Calendario → Importar/Exportar → eliminar.', en: 'In Vrbo: Calendar → Import/Export → remove.' }),
      { id: 'currency', text: { es: 'Mi moneda en Vrbo es la misma que en Pilloto ({{currency}}). Vrbo acepta USD, CAD, EUR, AUD, NZD, JPY, SGD, BRL, MXN y GBP.', en: 'My Vrbo currency is the same as in Pilloto ({{currency}}). Vrbo accepts USD, CAD, EUR, AUD, NZD, JPY, SGD, BRL, MXN and GBP.' } },
      policies,
    ],
    connect: [
      { es: 'Pulsa «Create» (Crear) y elige Vrbo.', en: 'Press “Create” and choose Vrbo.' },
      { es: 'Escribe tu usuario y contraseña de Vrbo y pulsa «Authenticate». Escribe el código que Vrbo te envía por SMS.', en: 'Enter your Vrbo username and password and press “Authenticate”. Enter the code Vrbo sends you by SMS.' },
      { es: 'Pulsa «Test connection», mapea cada anuncio y pulsa «Activate».', en: 'Press “Test connection”, map every listing and press “Activate”.' },
    ],
    tips: [
      { es: 'Si más adelante cambias la contraseña de Vrbo, el canal se desconecta y tendrás que volver a autenticarlo aquí.', en: 'If you later change your Vrbo password, the channel disconnects and you will have to authenticate it here again.' },
    ],
    screenshots: { connect: [] },
  },
};

/** Names for codes without their own guide (the platform may offer more OTAs) */
const OTHER_NAMES: Record<string, string> = {
  AGO: 'Agoda', DDC: 'Despegar', CTP: 'Trip.com', HBD: 'Hotelbeds', GHA: 'Google Hotel Ads', HWL: 'Hostelworld',
};

function genericGuide(code: string): ChannelGuide {
  return {
    code,
    name: OTHER_NAMES[code] ?? code,
    summary: { es: 'Conecta {{name}} siguiendo los pasos de su extranet.', en: 'Connect {{name}} following the steps of its extranet.' },
    approvalWait: true,
    checklist: [
      ical({ es: 'Revisa la sección de calendarios de la extranet.', en: 'Check the calendars section of the extranet.' }),
      otherManager({ es: 'Revisa la sección de conectividad de la extranet.', en: 'Check the connectivity section of the extranet.' }),
      currency,
      policies,
    ],
    authorize: {
      steps: [
        { es: 'Entra a la extranet de {{name}}.', en: 'Log in to the {{name}} extranet.' },
        { es: 'Busca la opción de proveedor de conectividad o channel manager y solicita la conexión con «{{provider}}» (el proveedor de conectividad de Pilloto).', en: 'Find the connectivity provider or channel manager option and request the connection with “{{provider}}” (Pilloto’s connectivity provider).' },
      ],
      propertyId: { es: 'Anota el ID de tu propiedad en {{name}}: lo necesitas en el paso siguiente.', en: 'Write down your property ID in {{name}}: you need it in the next step.' },
    },
    connect: [
      { es: 'Pulsa «Create» (Crear) y elige {{name}}.', en: 'Press “Create” and choose {{name}}.' },
      { es: 'Completa los datos que pide (ID de propiedad u otros) y pulsa «Test connection».', en: 'Fill in what it asks for (property ID or other) and press “Test connection”.' },
      { es: 'Mapea cada habitación y tarifa, guarda y pulsa «Activate».', en: 'Map every room and rate, save and press “Activate”.' },
    ],
    docsUrl: 'https://docs.channex.io/channel-mapping-guides',
  };
}

export function guideFor(code: string): ChannelGuide {
  return CHANNEL_GUIDES[code] ?? genericGuide(code);
}

/** OTAs the platform console suggests when choosing what to offer (any 3-letter code is accepted) */
export function channelCatalog(): { code: string; name: string; guided: boolean }[] {
  return [
    ...Object.values(CHANNEL_GUIDES).map((g) => ({ code: g.code, name: g.name, guided: true })),
    ...Object.entries(OTHER_NAMES).filter(([code]) => !CHANNEL_GUIDES[code]).map(([code, name]) => ({ code, name, guided: false })),
  ];
}

/** The steps this OTA shows (login-inside OTAs skip "authorize"), 1-based numbers as saved. */
export function stepsFor(guide: ChannelGuide): { key: ChannelWizardStep; number: number }[] {
  return CHANNEL_WIZARD_STEPS
    .map((key, i) => ({ key, number: i + 1 }))
    .filter((s) => !(s.key === 'authorize' && (guide.loginInConnectStep || !guide.authorize)));
}

/** Next / previous saved step number, skipping steps this OTA does not show. */
export function nextStep(guide: ChannelGuide, current: number, delta: 1 | -1): number {
  const numbers = stepsFor(guide).map((s) => s.number);
  if (delta > 0) return numbers.find((n) => n > current) ?? numbers[numbers.length - 1];
  return [...numbers].reverse().find((n) => n < current) ?? numbers[0];
}

export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);
}

export const localized = (l: Localized, lang: Lang, vars: Record<string, string> = {}) => fill(l[lang], vars);
