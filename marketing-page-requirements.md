Plan
Build a legal, trust, privacy, SEO, and anti-abuse expansion for pilloto.com as one coordinated project, not just a pair of policy pages. The current public site has the core marketing shell, but the biggest blockers are broken legal links, missing trust/compliance content, thin SEO metadata, and no public explanation of how Pilloto prevents platform and email abuse.

This is a requirements plan, not legal advice. For Dominican Republic and cross-border privacy obligations, I recommend final counsel review before publication.

What The Plan Assumes

Dominican Republic is the baseline jurisdiction for Pilloto.
The site may be visited by users in the EU/UK and U.S. states with privacy-right expectations.
Pilloto should publish only claims that are enforceable in product code or operations.
Privacy architecture should distinguish between:
Pilloto as controller for its own website/marketing/contact data
Pilloto as processor/service provider for hotel guest data handled on behalf of tenants
Current Gaps I Used As Inputs

The footer already links to privacy and terms, but those pages do not exist as real routes yet in Footer.tsx:167 and Footer.tsx:176.
The marketing app currently only exposes the contact page plus the landing page fallback in App.tsx:110.
The public HTML metadata is still generic in index.html:11.
The public site has a basic robots file, but no visible sitemap strategy in robots.txt.
There are some real backend abuse controls already, but they are not comprehensive enough to be the full basis for public anti-abuse claims, especially around contact form hardening and tenant-governance enforcement in auth.ts:545, validation.ts:200, platform.ts:69, and provisionTenant.ts.
Plan: Pilloto Marketing Compliance Expansion
Create a public legal and trust layer for pilloto.com that covers privacy, terms, cookies, security, accessibility, anti-abuse, and SEO. The recommended approach is to fix the information architecture first, then publish the legal/trust pages, then align product enforcement and public claims.

Steps

Phase 1: Define the public legal/trust information architecture.
Create a dedicated Legal & Trust Center for pilloto.com with the minimum required public surface:
Privacy Policy
Terms of Service
Cookie Policy / Cookie Notice
Acceptable Use Policy
Security / Trust page
Accessibility statement
Company / Contact / Legal entity details

Phase 1: Build a jurisdiction requirements matrix.
Use a layered model:
Dominican Republic baseline for personal-data notice and rights disclosures
GDPR/UK-style notice structure as the strongest practical international baseline
U.S. state privacy overlays only where relevant to tracking, sale/sharing concepts, or rights requests
This matrix should define what is mandatory now versus what is future-state or requires legal counsel.

Phase 1: Inventory all public-site data collection and disclosures.
Document every public processing point:
Contact form
Language preference
Cookies/analytics
Security logs
Demo or sales inquiry flows
Support/compliance contact paths
Any future newsletter or remarketing stack
Also document the public-facing explanation of Pilloto’s transactional email role and controller/processor split.

Phase 2: Draft requirements for each public page.
The privacy page should require:
Controller identity and contact details
Categories of personal data collected
Sources of data
Processing purposes
Legal bases where applicable
Sharing/recipient categories
International transfers
Retention rules or criteria
Security summary
Rights by region
Complaint / regulator path
Children/minors statement
Policy change/versioning section

The terms page should require:

Eligibility
Service scope
Billing and payments summary
Account responsibilities
Customer obligations
Suspension/termination rights
Prohibited uses
IP and license terms
Disclaimers and liability limits
Governing law and notice of updates
Product-facing terms, not only website-use terms
Incorporation by reference of the Acceptable Use Policy and Privacy Policy where applicable
Clear statement of which terms apply to website visitors versus paying hotel customers
Acceptance/versioning rules for enforceable terms

The cookie page should require:
Cookie categories
Purposes
Providers/third parties
Lifespan or persistence model
Consent logic
Preference management
Global Privacy Control / Do Not Track position if applicable
The acceptable-use page should require:

No bulk unsolicited email
No purchased/rented/scraped contacts
No marketing misuse of transactional channels
No fake reservations
No credential abuse
No malware, scraping, fraud, or misuse of guest data
Clear enforcement and suspension language
The security/trust page should require:

High-level security controls
Access-control approach
Encryption statements at a safe level
Backup/recovery summary
Incident-report contact
Abuse-report path
Optional later expansion into subprocessor list, DPA, and trust-center assets

Phase 2: Contract package and acceptance-flow requirements.
Define the contractual layer behind the public legal pages:
Subscription Agreement / Master Service Agreement for hotel customers
Order Form or pricing acceptance mechanism
Data Processing Agreement for guest/customer data processed on behalf of hotel tenants
Optional future Service Level Agreement and subprocessor disclosures
Define the product acceptance flow requirements:
Clickwrap acceptance for enforceable terms and policies
Versioned acceptance records
Tenant-level acceptance timestamp
User-level acceptance timestamp where applicable
Acceptance provenance sufficient for audit purposes
Re-acceptance flow when terms or policies change materially
Clear distinction between public legal notices and enforceable customer agreements

Phase 2: Expand the marketing content so the site looks production-ready.
Add high-value sections/pages beyond legal minimum:
FAQ
Why Pilloto
Customer stories/testimonials
Onboarding / implementation page
Integrations / OTA overview
Trust badges and security commitments
Status / reliability references
Feature deep-dives
Resources or insights section for SEO
Clear explanation that outbound guest/staff emails are system-triggered only

Phase 3: Add technical SEO and discoverability requirements.
Implement:
Route-level titles/descriptions
Open Graph / Twitter metadata
Canonicals
Structured data
Sitemap strategy
Robots update
Better alt text and heading hierarchy
Internal linking between marketing, legal, and trust pages
EN/ES metadata and language-aware indexing strategy

Phase 3: Decide the tracking and consent model before adding growth tooling.
Define what Pilloto will and will not run on the marketing site:
Analytics
Session recording
Chat widgets
Ad pixels
Retargeting
Then implement only the consent system that matches the actual tools in use.

Phase 4: Enforce anti-abuse claims in code and operations.
If the public site says Pilloto prevents product/email abuse, the platform should enforce it through:
Terms/policy acceptance records during tenant onboarding
Tenant review/suspension metadata
Audit logs for tenant lifecycle actions
Stronger contact-form validation and CAPTCHA
Duplicate-submission controls
Clear permission boundaries around outbound email triggers
Operational workflow for abuse reports and tenant suspension
Privacy-rights intake handling for access/correction/deletion requests

Phase 4: Add privacy operations support.
Support the published policies with real operational paths:
Privacy request form or mailbox
Identity verification workflow
Retention/deletion policy map
Escalation/appeal path where needed
Clear public explanation of when Pilloto acts for itself versus for hotel customers

Phase 5: Validate and publish.
Before launch:
verify every legal URL resolves directly
verify every form links to applicable notices
verify English and Spanish consistency
verify SEO metadata and crawlability
verify accessibility basics
run a policy-to-implementation review so no public statement exceeds actual practice

Relevant files
App.tsx:110
LandingPage.tsx
ContactPage.tsx
Footer.tsx:167
index.html:11
robots.txt
translation.json
translation.json
auth.ts:545
validation.ts:200
platform.ts:69
provisionTenant.ts
Tenant.ts
email.ts

Key Requirement Decisions
Dominican Republic should be treated as the publishing baseline, but the privacy policy should be structured to satisfy GDPR-style transparency expectations because that gives you a cleaner international foundation.
Pilloto should explicitly separate website/marketing privacy from hotel guest-data processing on behalf of tenants.
Cookie/tracking disclosures must reflect the actual deployed stack exactly; no “generic” cookie copy.
Public anti-abuse claims should be backed by code, admin workflows, and auditability.
A lightweight public trust page now is better than overstating certifications or controls you do not yet maintain.

What Should Probably Be Added To The Marketing Site:
Legal & Trust Center
FAQ
Security / Trust page
Why Pilloto page
Customer stories or testimonials
Implementation / onboarding page
Integrations / OTA content
Status / reliability reference
Resources section for SEO
Stronger company/contact/legal identity block
Accessibility statement
Cookie preferences experience if non-essential tracking is introduced

SEO Requirements:
Better homepage title/description than the current generic base metadata
Per-page metadata for all legal/trust pages
Canonical links
Schema.org for Organization and SoftwareApplication
FAQ schema where applicable
Sitemap generation and robots reference
Better internal linking
Spanish/English discoverability strategy
Content plan around hospitality PMS, hotel PMS, resort PMS, booking calendar, folio billing, OTA sync, and Caribbean hospitality positioning

Privacy-Law Direction For The Document
The requirements document should be written around these buckets:

Dominican Republic baseline
GDPR/UK transparency and rights model
U.S. state notice/rights overlays only if your marketing stack or customer base makes them relevant
Cookie/consent requirements based on actual tracking behavior
Cross-border transfer language if data or vendors are outside the visitor’s jurisdiction
Rights intake and response workflow
For benchmarks, I used the structure patterns visible in hospitality SaaS privacy programs like Mews and Cloudbeds: long-form privacy notice, regional rights sections, cookie notice, trust/security references, and strong public contact/legal routing.

Recommended Execution Order

Fix the legal/trust information architecture and routes.
Publish real privacy, terms, cookie, and security/trust pages.
Wire footer/header/legal-center navigation.
Add privacy notice links to every public form and consent surface.
Expand content and SEO.
Add code-backed enforcement for anti-abuse and rights handling.
Run legal/content/SEO/accessibility validation before launch.
If you want, the next step can be one of these:

I turn this into a full implementation-ready requirements document with page-by-page content outlines and acceptance criteria.
I produce the exact page inventory and route map you should add to the marketing site.
I refine the anti-abuse enforcement section into concrete backend requirements tied to the existing platform code.
