import React, { useEffect, useState } from 'react';
import {
  Box, Container, Grid, Typography, Link, List, ListItemButton,
  ListItemText, Chip, Breadcrumbs,
} from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { useTranslation } from 'react-i18next';
import MarketingLayout from './MarketingLayout';

const BRAND = '#1A3C34';

interface Section {
  id: string;
  title: string;
}

interface LegalPageLayoutProps {
  children: React.ReactNode;
  title: string;
  effectiveDate: string;
  sections: Section[];
}

const LegalPageLayout: React.FC<LegalPageLayoutProps> = ({
  children,
  title,
  effectiveDate,
  sections,
}) => {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState('');

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.find(e => e.isIntersecting);
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0.1 },
    );
    sections.forEach(s => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  return (
    <MarketingLayout>
      {/* Header */}
      <Box sx={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E5E7EB', py: 5 }}>
        <Container maxWidth="lg">
          <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} sx={{ mb: 2 }}>
            <Link href="/" underline="hover" color="text.secondary" variant="body2">
              {t('legal.breadcrumb.home')}
            </Link>
            <Link href="/legal" underline="hover" color="text.secondary" variant="body2">
              {t('legal.breadcrumb.legal')}
            </Link>
            <Typography variant="body2" color="text.primary">{title}</Typography>
          </Breadcrumbs>
          <Typography variant="h3" fontWeight={800} color="#0F172A">{title}</Typography>
          <Chip
            label={`${t('legal.effectiveDate')}: ${effectiveDate}`}
            size="small"
            sx={{ mt: 2, backgroundColor: 'white', border: '1px solid #E5E7EB' }}
          />
        </Container>
      </Box>

      {/* Body */}
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 8 } }}>
        <Grid container spacing={6}>
          {/* Sidebar TOC — desktop only */}
          <Grid item xs={12} md={3} sx={{ display: { xs: 'none', md: 'block' } }}>
            <Box sx={{ position: 'sticky', top: 80 }}>
              <Typography variant="overline" fontWeight={700} color="text.secondary"
                sx={{ letterSpacing: 1.5, mb: 1, display: 'block' }}>
                {t('legal.tableOfContents')}
              </Typography>
              <List dense disablePadding>
                {sections.map(s => (
                  <ListItemButton
                    key={s.id}
                    component="a"
                    href={`#${s.id}`}
                    selected={activeSection === s.id}
                    sx={{
                      borderLeft: '2px solid',
                      borderColor: activeSection === s.id ? BRAND : 'transparent',
                      py: 0.5,
                      pl: 2,
                      '&.Mui-selected': { backgroundColor: 'transparent', color: BRAND },
                      '&:hover': { backgroundColor: 'rgba(26,60,52,0.04)' },
                    }}
                  >
                    <ListItemText
                      primary={s.title}
                      primaryTypographyProps={{
                        variant: 'body2',
                        fontWeight: activeSection === s.id ? 600 : 400,
                        color: activeSection === s.id ? BRAND : 'text.secondary',
                      }}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Box>
          </Grid>

          {/* Content */}
          <Grid item xs={12} md={9}>
            <Box sx={{
              '& h4': { fontWeight: 700, color: '#0F172A', mt: 5, mb: 2 },
              '& p': { color: '#475569', lineHeight: 1.8, mb: 2 },
              '& ul, & ol': { color: '#475569', pl: 3, mb: 2 },
              '& li': { mb: 0.5, lineHeight: 1.7 },
              '& a': { color: BRAND, textDecoration: 'underline' },
            }}>
              {children}
            </Box>
          </Grid>
        </Grid>
      </Container>
    </MarketingLayout>
  );
};

export default LegalPageLayout;
