Guidelines:

1. Provide robust, reliable, secure and mobile friendly booking engine for final customers to book rooms

- It should be served in a public path under each tenant subdomain (eg.: hotel1.pilloto.com/booking)
- This means that paths [tenant slug].pilloto.com/booking should require login
- It should be tenant branded
- Tenants with the right plan should be able to config their customer-facing booking page (among other things, the logo, landing page image, text, contact, etc.)
- The booking engine will not display like all the rooms of a tenant, instead it will display the room types that have rooms available for that date range. It makes it easier to calculate prices because room prices are attached to the room types. And in the booking process, when the user chooses the stay, the system will assign a room of that type automatically.

2. The booking engine feature should be available only on the Pro plan and higher
3. Generate a comprehensive Privacy Policy and Terms of Service for the customer booking service
4. All tenant booking page should point to these terms in the footer
5. When a user is inside a tenants booking page, all links should be routed inside the public tenants booking path. Example: if the user clicks the privacy policy on the Hotel 1 booking page, it should take him to hotel1.pilloto.com/booking/privacy. If the customer clicks the Hotel 1 logo or name, it should take him to the booking home (hotel1.pilloto.com/booking)
6. This feature should include a code snippet system so the tenants can include the booking engine in their own web pages. Suggestion: 2 code snippets, one for the dates selection and guests distribution, and the other one to display the rooms and services available for those dates.
7. Security constraints should be defined (rate limiting, bot protection, input validation, tenant isolation guarantees)
8. SEO performance. SSR vs SPA decision, page load requirements and mobile first constraints
9. Pilloto terms of use should be updated to include terms for the booking engine. This should include responsibility splitting between Pilloto and the tenant
10. Add a step to the customer booking flow:
    Before the final step of the flow (when the user confirms booking), send an email to the customer with a 4 digits code to make sure it’s a valid email and legit reservation, the user should enter that code and then confirm reservation.

Requirements

- Public customer booking must live at tenant-local /booking routes under each tenant subdomain, without login, and all in-booking navigation must stay inside that path.
- Phase 1 is reserve now, pay at property, with a mandatory 4-digit email verification step before final confirmation.
- Public scope includes room bookings by available room type and standalone services that are both active and marked online-bookable in Service.ts:1.
- The feature is Pro+ only, so plan entitlements need to be extended in plans.ts:1.
- Tenant branding/config needs a dedicated booking settings surface built on the existing tenant/settings foundation in Tenant.ts:1, AppSettings.ts:1, and Settings.tsx.
- Legal work includes booking-specific customer Privacy Policy and Terms, tenant-local footer links, and a Pilloto terms update defining the Pilloto versus tenant responsibility split. The current authenticated acceptance pattern already exists in privacy.ts:1, but guest booking still needs its own acceptance/versioning flow.
- SEO recommendation is to serve public booking/legal pages through an SSR-capable public surface rather than keep them purely inside the current SPA rooted in App.tsx:1, while reusing metadata patterns from PageMeta.tsx:1.

Plan

1. Lock the architecture: /booking public surface, room-type-first inventory, standalone online-bookable services, pay-at-property checkout, email verification, and SSR-capable public delivery.
2. Add booking-engine entitlements to Pro/Enterprise in plans.ts:1.
3. Add booking configuration, legal versioning, and widget origin settings on top of Tenant.ts:1 and AppSettings.ts:1.
4. Add guest verification and guest legal acceptance persistence, separate from the authenticated staff acceptance flow in privacy.ts:136.
5. Build tenant-scoped public booking APIs for config, room-type availability, public quotes, and online-bookable services by extending reservations.ts:308, rooms.ts, pricing.ts, services.ts:1, and servicePrices.ts:1.
6. Harden tenant isolation around public queries using tenantContext.ts:1 and enforce Pro+ gating before publication.
7. Build the public booking UI and tenant-local legal pages by extending App.tsx:1, TenantContext.tsx:1, Footer.tsx:169, PrivacyPolicyPage.tsx:1, and TermsOfServicePage.tsx:1.
8. Build the two embed snippets on top of the public APIs with origin allowlists, branding, and source attribution.
9. Finish security, analytics, mobile/performance, and end-to-end verification before release.

All work should be done following best practices and quality standards. This includes writing clean, maintainable code, implementing proper error handling, and ensuring that the booking engine is secure against common vulnerabilities.
