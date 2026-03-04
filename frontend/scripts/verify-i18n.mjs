import i18next from 'i18next';
import enTranslations from '../src/locales/en/translation.json' assert { type: 'json' };
import esTranslations from '../src/locales/es/translation.json' assert { type: 'json' };

async function verify(lang) {
  await i18next.init({
    resources: {
      en: { translation: enTranslations },
      es: { translation: esTranslations },
    },
    lng: lang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
  const keys = [
    'schedule.cards.adults',
    'schedule.cards.children',
    'schedule.cards.infants',
    'reservationSummary.labels.guest',
  ];
  console.log(`\nLanguage: ${lang}`);
  for (const k of keys) {
    console.log(`${k} => ${i18next.t(k)}`);
  }
}

(async () => {
  await verify('en');
  await verify('es');
})();
