import React from 'react';
import { Helmet } from 'react-helmet-async';

interface PageMetaProps {
  title: string;
  description: string;
  path: string;
  locale?: string;
  alternateLocale?: string;
  noindex?: boolean;
}

const SITE = 'https://pilloto.com';

const PageMeta: React.FC<PageMetaProps> = ({
  title,
  description,
  path,
  locale = 'en',
  alternateLocale = 'es',
  noindex,
}) => {
  const canonical = `${SITE}${path}`;
  const fullTitle = title.includes('Pilloto') ? title : `${title} | Pilloto`;

  return (
    <Helmet>
      <html lang={locale} />
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />

      {/* Open Graph */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Pilloto" />
      <meta property="og:locale" content={locale === 'es' ? 'es_DO' : 'en_US'} />
      <meta property="og:locale:alternate" content={alternateLocale === 'es' ? 'es_DO' : 'en_US'} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />

      {/* Alternate languages */}
      <link rel="alternate" hrefLang={locale} href={canonical} />
      <link rel="alternate" hrefLang={alternateLocale} href={canonical} />
      <link rel="alternate" hrefLang="x-default" href={canonical} />

      {noindex && <meta name="robots" content="noindex, nofollow" />}
    </Helmet>
  );
};

export default PageMeta;
