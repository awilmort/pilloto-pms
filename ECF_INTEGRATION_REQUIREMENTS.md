# Pilloto PMS — Citrus e-CF Integration Requirements & Development Plan

> **Source**: Citrus e-CF API v1 — https://test.ecf.citrus.com.do/docs.html  
> **Last Updated**: May 16, 2026  
> **Scope**: Full integration of electronic fiscal invoices (e-CF) compliant with DGII (Dominican Republic)

---

## Table of Contents

1. [Overview & Goals](#1-overview--goals)
2. [System Architecture](#2-system-architecture)
3. [API Reference Summary](#3-api-reference-summary)
4. [Data Model Requirements](#4-data-model-requirements)
5. [Phase 0 — Manual Setup (User Actions Required)](#phase-0--manual-setup-user-actions-required)
6. [Phase 1 — Foundation: Infrastructure & Configuration](#phase-1--foundation-infrastructure--configuration)
7. [Phase 2 — Core Invoice Generation](#phase-2--core-invoice-generation)
8. [Phase 3 — Credit & Debit Notes](#phase-3--credit--debit-notes)
9. [Phase 4 — Invoice Management UI](#phase-4--invoice-management-ui)
10. [Phase 5 — Advanced & Operational Features](#phase-5--advanced--operational-features)
11. [Cross-Cutting Concerns](#cross-cutting-concerns)
12. [Testing Strategy](#testing-strategy)

---

## 1. Overview & Goals

### What is e-CF?

Comprobantes Fiscales Electrónicos (e-CF) is the Dominican Republic's mandatory electronic invoicing system governed by **DGII** (Dirección General de Impuestos Internos). All registered taxpayers must issue e-CFs for their commercial transactions.

**Citrus e-CF** is a certified third-party provider that handles the technical implementation of e-CFs: digitally signing documents, communicating with DGII, managing sequences (e-NCF), and providing an intermediary API.

### Pilloto's Role

Pilloto acts as a **multi-tenant intermediary**: hotels and B&Bs use Pilloto to issue e-CFs without leaving the PMS. Citrus e-CF is the underlying engine. Each tenant (hotel) has their own Citrus account and digital certificate, but all operations flow through Pilloto's backend.

### Primary Goals

1. Enable on-demand e-CF generation at the point of payment, with a prominent and easy-to-use interface — staff ask the guest whether they want a fiscal invoice, then issue it in the same workflow without leaving Pilloto.
2. Allow manual e-CF generation and re-sending.
3. Provide a full invoice management module (search, status, download, email).
4. Enable credit notes (nota de crédito) on refunds/reversals.
5. Give tenants access to all operational Citrus e-CF features from within Pilloto.

---

## 2. System Architecture

```
┌──────────────────────────────────┐
│           Pilloto Frontend        │
│  (React/TS — per-tenant context)  │
└────────────────┬─────────────────┘
                 │ HTTPS
┌────────────────▼─────────────────┐
│           Pilloto Backend         │
│  (Node.js/Express/TS)             │
│                                   │
│  ┌────────────────────────────┐   │
│  │  ECF Routes (/api/ecf/*)   │   │
│  └──────────┬─────────────────┘   │
│             │                     │
│  ┌──────────▼─────────────────┐   │
│  │  CitrusEcfService          │   │
│  │  (HTTP client + mapping)   │   │
│  └──────────┬─────────────────┘   │
│             │                     │
│  ┌──────────▼─────────────────┐   │
│  │  ElectronicInvoice Model   │   │
│  │  CitrusConfig (in Tenant)  │   │
│  └────────────────────────────┘   │
└────────────────┬─────────────────┘
                 │ HTTPS (Bearer token, per-tenant)
┌────────────────▼─────────────────┐
│        Citrus e-CF API            │
│  (test.ecf.citrus.com.do)         │
└────────────────┬─────────────────┘
                 │
┌────────────────▼─────────────────┐
│             DGII                  │
│  (Dominican Tax Authority)        │
└───────────────────────────────────┘
```

### Key Architectural Decisions

- **Per-tenant token isolation**: Each tenant stores their own encrypted Citrus API token. Pilloto never shares tokens across tenants.
- **Token encryption**: API tokens are encrypted at rest using AES-256-GCM before storage in MongoDB.
- **Async invoice processing**: Citrus may return HTTP 202 (pending), requiring a polling/retry mechanism to confirm final DGII status.
- **Contingency awareness**: If Citrus/DGII is unreachable, invoices are marked `contingencia` and auto-resolved within 72h.
- **Multi-environment**: Each tenant configures their own DGII environment (Simulación → Pruebas → Certificación → Producción). Pilloto routes to the correct Citrus environment per tenant.

---

## 3. API Reference Summary

### Base URL (per environment)

Citrus manages environment selection server-side per-account; the API base URL is the same for all environments. The active environment is set per-account via the Citrus admin portal.

**Base URL**: `https://test.ecf.citrus.com.do` (test) / production URL provided after certification.

### Authentication

All requests require: `Authorization: <token>` header.  
Token is generated in the Citrus admin portal and stored per-tenant in Pilloto.

### Invoice Endpoints

| Type    | Description (DGII)        | Route                                | Relevant for Hotels                       |
| ------- | ------------------------- | ------------------------------------ | ----------------------------------------- |
| **E31** | Factura de Crédito Fiscal | `POST /api/v1/Facturas`              | B2B — corporate clients with RNC          |
| **E32** | Factura de Consumo        | `POST /api/v1/FacturaConsumo`        | B2C — individual guests (most common)     |
| **E33** | Nota de Débito            | `POST /api/v1/NotaDebito`            | Late fees, interest charges               |
| **E34** | Nota de Crédito           | `POST /api/v1/NotaCredito`           | Refunds, cancellations, corrections       |
| **E41** | Comprobante de Compras    | `POST /api/v1/Compras`               | Vendor purchases (non-contrib. suppliers) |
| **E43** | Gastos Menores            | `POST /api/v1/GastoMenor`            | Minor expense reimbursements              |
| **E44** | Regímenes Especiales      | `POST /api/v1/Facturas` (TipoeCF=44) | Tax-exempt entities                       |
| **E45** | Gubernamental             | `POST /api/v1/Facturas` (TipoeCF=45) | Government sales                          |
| **E46** | Exportaciones             | `POST /api/v1/Exportaciones`         | Foreign sales                             |
| **E47** | Pagos al Exterior         | `POST /api/v1/PagosExterior`         | Foreign-entity payments                   |

### Utility Endpoints

| Action                        | Route                                                            |
| ----------------------------- | ---------------------------------------------------------------- |
| Check ENCF status             | `GET /api/v1/transacciones/{encf}/consultarEstadoENCF`           |
| Check e-CF state (by TrackId) | `GET /api/v1/estado-ecf/{TrackId}`                               |
| Get TrackId history           | `GET /api/v1/track-id/{encf}`                                    |
| Download XML                  | `GET /api/v1/transacciones/{transaccionId}/xml`                  |
| Print representation (PDF)    | `GET /api/v1/facturas/{encf}/representacionImpresa` (E31)        |
| Print representation (PDF)    | `GET /api/v1/factura-consumo/{encf}/representacionImpresa` (E32) |
| Email representation          | `GET /api/v1/facturas/{encf}/representacionImpresa/email`        |
| Received invoices             | `GET /api/v1/ComprobanteElectronico`                             |
| Sequence annulment            | `POST /api/v1/AnulacionSecuencia`                                |
| Commercial approval           | `POST /api/v1/AprobacionComercial`                               |
| Billing directory             | `GET /api/v1/Directorio`                                         |

### Invoice Response Object

```json
{
  "TransaccionId": 1,
  "eNCF": "E320000000001",
  "FechaVencimientoSecuencia": null,
  "TrackId": "a0fcb358-c703-463d-a316-6e0d08c20260",
  "Estatus": "Terminada",
  "EstadoeCF": "Aceptado",
  "Mensaje": "",
  "UrlCodigoQr": null,
  "CodigoSeguridad": null,
  "SecuenciaUtilizada": false,
  "FechaFirmaDigital": null,
  "Url": null
}
```

### e-CF States (EstadoeCF)

| State                  | Meaning                                                  |
| ---------------------- | -------------------------------------------------------- |
| `Aceptado`             | Fully valid, legally binding                             |
| `Aceptado Condicional` | Accepted with observations — must be corrected in future |
| `Rechazado`            | Invalid — must issue a new e-CF                          |
| `En Proceso`           | Submitted to DGII, awaiting response — poll status       |
| `Emitido Contingencia` | Issued offline, will auto-send within 72h                |

### DGII Environments (configured per tenant in Citrus portal)

| Environment     | Description                                           |
| --------------- | ----------------------------------------------------- |
| `Simulación`    | No DGII contact — safe for dev/testing                |
| `Pruebas`       | Communicates with DGII test environment               |
| `Certificación` | DGII certification tests — required before going live |
| `Producción`    | Live — legally binding invoices                       |

---

## 4. Data Model Requirements

### 4.1 New Model: `ElectronicInvoice`

Stores every e-CF issued through Pilloto.

```typescript
interface IElectronicInvoice {
  // Pilloto references
  tenantId: ObjectId; // multi-tenancy
  folioId?: ObjectId; // linked folio (if generated from payment)
  paymentId?: ObjectId; // linked payment (if generated from payment screen)
  reservationId?: ObjectId; // denormalized for quick queries

  // Invoice identity
  tipo:
    | "E31"
    | "E32"
    | "E33"
    | "E34"
    | "E41"
    | "E43"
    | "E44"
    | "E45"
    | "E46"
    | "E47";
  eNCF: string; // assigned sequence e.g. "E320000000001"
  transaccionId: number; // Citrus internal ID
  trackId: string; // DGII tracking UUID
  numeroFacturaInterna?: string; // Pilloto's internal folio/payment ref

  // Status
  estadoECF:
    | "Aceptado"
    | "Aceptado Condicional"
    | "Rechazado"
    | "En Proceso"
    | "Emitido Contingencia"
    | "Pendiente";
  estatus: string; // Citrus transaction status ("Terminada", etc.)
  mensaje?: string; // Error/info message from Citrus/DGII

  // Financial summary (denormalized for reports)
  totalFactura: number;
  totalImpuestos: number;
  currency: string; // 'DOP' | 'USD' | etc.

  // Buyer info (denormalized)
  buyerRnc?: string;
  buyerName?: string;
  buyerEmail?: string;

  // Reference (for credit/debit notes)
  originalENCF?: string; // eNCF being modified
  codigoModificacion?: string; // '1'=Anulación, '2'=Corrección, etc.

  // Citrus response data
  urlCodigoQr?: string;
  codigoSeguridad?: string;
  fechaFirmaDigital?: Date;
  fechaVencimientoSecuencia?: Date;
  xmlUrl?: string;

  // Metadata
  generatedBy: ObjectId; // User who triggered generation
  generationSource: "payment_screen" | "manual" | "credit_note" | "debit_note";
  issuedAt: Date; // Invoice emission date
  lastStatusCheck?: Date; // For polling En Proceso invoices
  retryCount: number; // Polling retry counter

  createdAt: Date;
  updatedAt: Date;
}
```

### 4.2 Tenant Model Extension: `ecfConfig`

Add to the existing `ITenant` model settings (or as a dedicated encrypted sub-document):

```typescript
interface ITenantEcfConfig {
  citrusToken: string; // AES-256-GCM encrypted token
  rnc: string; // Tenant's Dominican Tax ID (RNC/Cédula)
  razonSocial: string; // Legal business name
  nombreComercial?: string; // Trade name
  ambiente: "Simulacion" | "Pruebas" | "Certificacion" | "Produccion";
  isActive: boolean; // Toggle e-CF feature per tenant
  sucursal?: string; // Branch name (if applicable)
  citrusBaseUrl: string; // API base URL (test vs production)
}
```

### 4.3 Guest Model Extension

Add fiscal identification fields to `IGuest`:

```typescript
interface IGuestFiscalInfo {
  rnc?: string; // RNC (9 digits) for companies
  cedula?: string; // Cédula (11 digits) for individuals
  tipoId?: "RNC" | "Cedula" | "Pasaporte" | "Otro";
  razonSocial?: string; // Legal name if company
}
```

### 4.4 Company Model Extension

Add to `ICompany`:

```typescript
rnc?: string;        // Company RNC for B2B invoicing (E31)
razonSocial?: string;
```

---

## Phase 0 — Manual Setup (User Actions Required)

> **This phase contains ONLY steps you must do yourself, outside of any AI development session. No code is written here.**

These steps must be completed before any development work can be fully tested or deployed to production.

---

### Step 0.1 — Register as Electronic Issuer with DGII

**What**: You must officially register as an "Emisor Electrónico" with DGII.

**How**:

1. Log in to the **DGII Oficina Virtual (OFV)**: https://ofv.dgii.gov.do/
2. Navigate to the section **"Facturación" → "Comprobantes Fiscales Electrónicos (e-CF)"**
3. Submit the request to become an authorized Electronic Issuer.
4. DGII will assign you authorized **sequence ranges (e-NCF)** per invoice type (E31, E32, E34, etc.).
5. Keep your sequence authorization documents — you will need them.

**Note**: Each tenant (hotel) must register independently, under their own RNC.

---

### Step 0.2 — Obtain a Digital Certificate (Firma Electrónica)

**What**: A qualified digital certificate issued by a DGII-authorized Certification Authority (CA), used to digitally sign e-CFs.

**Authorized CAs in Dominican Republic** (verify current list with DGII):

- **INDOTEL** – https://www.indotel.gob.do
- **Certidatos** – certidatos.com.do
- **Digicard** – (verify current status)

**How**:

1. Contact an authorized CA with your company/hotel's documentation (RNC, Cédula del representante, Carta de intención, etc.).
2. Complete their identity verification process (may require in-person).
3. Receive a `.p12` or `.pfx` certificate file and its **passphrase**.
4. Store these securely — this certificate is your legal digital signature.

**Important**: This certificate has an expiry date. You must renew it before it expires.

---

### Step 0.3 — Create Your Account in Citrus e-CF

**What**: Register as a client of Citrus e-CF (the API provider intermediary).

**How**:

1. Contact Citrus: **soporte@citrus.com.do** or http://www.citrus.com.do/soporte
2. Request account creation for the specific tenant/hotel.
3. Citrus will provide access to their admin portal.

**Note**: Each hotel (tenant) needs their own Citrus account. If you plan to aggregate billing at the platform level (Pilloto paying for access on behalf of tenants), discuss this with Citrus.

---

### Step 0.4 — Upload Certificate and Configure Citrus Portal

**What**: Configure the digital certificate inside the Citrus admin portal so it can sign your e-CFs.

**How** (in order):

1. Log in to https://test.ecf.citrus.com.do/ (test) or the production portal.
2. Go to **Settings → Company → Comprobantes Electrónicos**.
3. **Upload the digital certificate** (`.p12`/`.pfx` file from Step 0.2).
4. **Enter the certificate passphrase**.
5. **Select the working environment**: Start with `Simulación`, then move to `Pruebas`.
6. Save and verify the certificate loaded correctly.

---

### Step 0.5 — Generate Your API Token

**What**: Generate the Bearer token that Pilloto will use to call the Citrus API on your behalf.

**How**:

1. In the Citrus admin portal, go to **Settings → Authorization**.
2. Click **"Generar Nuevo Token"**.
3. Optionally set an expiry date.
4. Click generate, then **copy the token immediately** (it may not be shown again).
5. Store it securely — you will enter it in Pilloto's tenant settings in Phase 1.

**Important**: If this token expires or is revoked, all e-CF generation stops for that tenant. Set up a reminder to renew it.

---

### Step 0.6 — Complete DGII Certification Tests (Ambiente Certificación)

**What**: DGII requires you to pass a series of certification tests before you can issue live invoices. This is done in Citrus's `Certificación` environment.

**How**:

1. Switch the Citrus portal environment to **"Certificación"**.
2. DGII will assign you a specific set of test scenarios to submit (invoice types, tax scenarios, credit notes, etc.).
3. Submit all required test e-CFs via Pilloto (using Phase 1/2 features) or directly via the Citrus portal / Postman.
4. DGII reviews and approves each test.
5. Once **all tests are approved**, DGII authorizes you to switch to **Producción**.

**Timeline**: This process can take days to weeks. Plan accordingly.

---

### Step 0.7 — Switch to Production

**What**: Final go-live.

**How**:

1. Configure the Citrus portal environment to **"Producción"**.
2. Update the tenant's `citrusBaseUrl` in Pilloto to the production URL (provided by Citrus).
3. Regenerate (if needed) a new production API token.
4. Update the token in Pilloto's tenant settings.
5. Issue a test invoice in production to confirm everything works end-to-end.

---

### Step 0.8 — Plan for Ongoing Compliance

- **Monitor certificate expiry** — renew before expiration or all e-CFs will stop.
- **Monitor sequence expiry** — e-NCF sequences have expiry dates; request new ranges from DGII before they expire.
- **Contingency procedure** — know how to notify DGII via OFV if your system goes down.
- **Sequence annulment** — unused sequences must be annulled via the API before their expiry date.

---

## Phase 1 — Foundation: Infrastructure & Configuration

> **AI Development Session Scope**: ~1 session  
> **Goal**: Backend infrastructure, data models, encryption utilities, API client, and tenant configuration UI. No actual invoice generation yet.

### Backend Tasks

#### 1.1 — Encryption Utility

Create `backend/src/utils/encryption.ts`:

- `encrypt(plaintext: string): string` — AES-256-GCM, returns Base64 bundle (iv + authTag + ciphertext)
- `decrypt(encrypted: string): string` — reverse
- Use `process.env.ECF_ENCRYPTION_KEY` (32-byte hex in `.env`)

Security: Tokens must NEVER be logged, returned to the frontend, or stored in plain text.

#### 1.2 — New Model: `ElectronicInvoice`

Create `backend/src/models/ElectronicInvoice.ts` per specification in Section 4.1.  
Apply `tenantPlugin` for multi-tenant isolation.  
Add indexes on: `tenantId`, `eNCF`, `trackId`, `folioId`, `paymentId`, `estadoECF`, `issuedAt`.

#### 1.3 — Tenant Model: Add `ecfConfig`

Extend `backend/src/models/Tenant.ts` to include the `ecfConfig` sub-document (see Section 4.2).  
The `citrusToken` field must always be stored encrypted. Add validation to ensure `rnc` is 9 or 11 digits.

#### 1.4 — Guest & Company Models: Fiscal Fields

Add `rnc`, `cedula`, `tipoId`, `razonSocial` fields to:

- `backend/src/models/Guest.ts`
- `backend/src/models/Company.ts`

#### 1.5 — Citrus e-CF HTTP Client (Service)

Create `backend/src/services/citrusEcf.ts`:

- Accepts a `tenant` object to extract (decrypt) token and base URL.
- `generateFactura(tenant, payload)` → calls `POST /api/v1/Facturas`
- `generateFacturaConsumo(tenant, payload)` → calls `POST /api/v1/FacturaConsumo`
- `generateNotaCredito(tenant, payload)` → calls `POST /api/v1/NotaCredito`
- `generateNotaDebito(tenant, payload)` → calls `POST /api/v1/NotaDebito`
- `consultarEstado(tenant, encf)` → calls `GET /api/v1/transacciones/{encf}/consultarEstadoENCF`
- `consultarEstadoECF(tenant, trackId)` → calls `GET /api/v1/estado-ecf/{TrackId}`
- `getXML(tenant, transaccionId)` → calls `GET /api/v1/transacciones/{transaccionId}/xml`
- `getRepresentacionImpresa(tenant, encf, tipo)` → routes to correct `/representacionImpresa` by type
- `sendRepresentacionImprsa(tenant, encf, tipo)` → routes to correct `/representacionImpresa/email` by type
- `getTrackId(tenant, encf)` → calls `GET /api/v1/track-id/{encf}`
- `getComprobantesRecibidos(tenant, filters)` → calls `GET /api/v1/ComprobanteElectronico`
- `anularSecuencias(tenant, payload)` → calls `POST /api/v1/AnulacionSecuencia`
- `aprobacionComercial(tenant, payload)` → calls `POST /api/v1/AprobacionComercial`
- `getDirectorio(tenant)` → calls `GET /api/v1/Directorio`
- Handles 200, 202, 400, 401 responses uniformly. Throws typed errors that map to HTTP status codes.
- Logs all request/response pairs (excluding token) with `tenantId` and `eNCF` for auditability.

#### 1.6 — ECF Configuration Routes

Create `backend/src/routes/ecf.ts`:

- `PUT /api/ecf/config` — save/update tenant's Citrus configuration (token, RNC, environment, etc.)
- `GET /api/ecf/config` — return config **without** the decrypted token (show `*****` or a `hasToken: true` boolean)
- `DELETE /api/ecf/config/token` — revoke/clear token
- `POST /api/ecf/config/test` — validate token by calling a lightweight Citrus endpoint (e.g. GET directorio)

All routes protected by `auth` middleware. Tenant context from `tenantContext` middleware.

#### 1.7 — Environment Variables

Add to `.env` and document in `.env.example`:

```
ECF_ENCRYPTION_KEY=<32-byte hex string>
```

---

### Frontend Tasks

#### 1.8 — Tenant Settings: e-CF Configuration Section

Add a new "Facturación Electrónica" section to the tenant settings page:

- Fields: RNC, Razón Social, Nombre Comercial, Sucursal (optional), Ambiente (dropdown), API Token (password input, masked).
- "Guardar" saves token + config to backend (token is never returned after save — show "Token configurado ✓" or "Sin token").
- "Probar Conexión" calls `POST /api/ecf/config/test` and shows green/red indicator.
- "Revocar Token" calls `DELETE /api/ecf/config/token`.

#### 1.9 — Guest Form: Fiscal Fields

Add optional fiscal info fields to guest create/edit form:

- Type selector: RNC / Cédula / Pasaporte / Otro
- ID number field with format validation (RNC = 9 digits, Cédula = 11 digits)
- Razón Social (for companies)

#### 1.10 — Company Form: Fiscal Fields

Add RNC and Razón Social to company create/edit form.

---

## Phase 2 — Core Invoice Generation

> **AI Development Session Scope**: ~2 sessions  
> **Prerequisites**: Phase 0 (token configured), Phase 1 complete  
> **Goal**: On-demand e-CF generation (E31 and E32) initiated by staff at the point of payment or from the folio view. Async status resolution.

### Session 2A — Payload Mapping & Backend Endpoints

#### 2.1 — Folio → e-CF Payload Mapper

Create `backend/src/utils/ecfMapper.ts`:

**`mapToFacturaConsumo(folio, charges, payments, guest, tenant): CitrusE32Payload`**

- Determines `TipoeCF` = '32' (B2C — guest without RNC, or no RNC provided)
- Maps charges → `DetalleBienesOServicios` array:
  - `Nombre`: charge description
  - `Cantidad`: 1
  - `PrecioUnitario`: charge amount net
  - `DescuentoMonto`: any discounts
  - `TasaITBIS`: 18 (default) or 0 (for tax-exempt charges)
- Calculates `totalFactura` and `totalImpuestos` from charges
- Maps `TipoPago` from Pilloto payment method: cash=1, card=3, transfer=4, credit=2
- `NumeroFacturaInterna` = folio internal number or reservation code
- `Comprador` section: guest name, RNC/cédula if available

**`mapToFacturaCreditoFiscal(folio, charges, payments, guest/company, tenant): CitrusE31Payload`**

- `TipoeCF` = '31' (B2B — buyer has provided RNC)
- Same structure as E32 but adds:
  - `Comprador.RNCComprador` (required)
  - `Comprador.RazonSocialComprador`
  - `TipoIngresos` = '01' (ingresos por operaciones)

**Validation rules**:

- If guest has RNC → use E31. Otherwise → E32.
- If total = 0, block generation with an explicit error.
- If folio has no charges, block with an explicit error.
- If tenant has no `ecfConfig` or no token, throw a descriptive error.

#### 2.2 — Invoice Generation Endpoint

`POST /api/ecf/invoices` — Generate e-CF from a folio/payment:

- Body: `{ folioId, paymentId?, tipoECF?, buyerRnc?, buyerName?, buyerEmail? }`
- Resolves folio, charges, payments, guest data
- Selects E31 vs E32 based on buyer RNC
- Calls `citrusEcf.generateFactura()` or `citrusEcf.generateFacturaConsumo()`
- On success (200): stores `ElectronicInvoice` with status `Aceptado`
- On accepted (202): stores with status `En Proceso`, schedules poll (see 2.3)
- On error (400/401): returns descriptive error to frontend; does NOT store a failed record
- Returns the created `ElectronicInvoice` document

`GET /api/ecf/invoices` — List all invoices for tenant (with filters):

- Query params: `folioId`, `paymentId`, `estadoECF`, `tipo`, `fechaInicio`, `fechaFin`, `eNCF`, `buyerRnc`
- Returns paginated `ElectronicInvoice` list

`GET /api/ecf/invoices/:id` — Get single invoice detail

`POST /api/ecf/invoices/:id/refresh-status` — Re-check status with Citrus for `En Proceso` invoices

#### 2.3 — Async Status Polling

For invoices with `estadoECF: 'En Proceso'`:

- Implement a retry mechanism: poll `consultarEstado` up to 10 times at intervals (5s, 10s, 30s, 1m, 5m...).
- On final status resolve, update `ElectronicInvoice.estadoECF` and `estadoECF = 'Aceptado'/'Rechazado'/'Aceptado Condicional'`.
- Use a background job (simple `setTimeout`-based or a lightweight queue — do NOT add a heavy job queue library for this; a simple in-process retry loop is sufficient at this scale).
- Expose `GET /api/ecf/invoices/pending` — lists all `En Proceso` invoices for manual re-check from UI.

### Session 2B — Frontend Payment Integration

#### 2.4 — Payment Processing: Invoice Generation Action

The e-CF is **never generated automatically**. Staff must explicitly initiate it. The UX follows Dominican business practice: the cashier asks the guest whether they want a fiscal invoice ("¿Desea comprobante fiscal?"), then acts accordingly.

**After a payment is saved as `completed`**, the payment row/card in the folio view displays a prominent **"Emitir Comprobante"** button (visible only when the tenant has an active e-CF config). This button is always accessible — not hidden behind a checkbox or buried in a menu.

**Invoice generation flow** (triggered by the button):

1. A focused modal opens showing the folio total and a question: **"¿Qué tipo de comprobante desea emitir?"**
2. Staff selects one of:
   - **Consumo (E32)** — for individual guests / no RNC (the default pre-selected option)
   - **Crédito Fiscal (E31)** — for companies / guests with RNC
   - **Sin comprobante** — dismisses the modal without generating anything
3. If E31 is selected: show RNC + Razón Social fields (pre-filled from guest/company if available).
4. If E32 is selected: optionally capture guest name and email for the PDF; RNC is optional.
5. Confirm button submits the generation request.
6. On success: show e-CF number (`eNCF`) and status badge inline. Offer buttons: **"Ver Comprobante"**, **"Enviar por Email"**.
7. On failure: show a clear, actionable error message. Allow retry or dismiss — the payment is never affected by an invoice failure.

**Accessibility rules**:

- The **"Emitir Comprobante"** button must be clearly visible in the payment row at all times — not just on hover.
- If an invoice already exists for a payment, show the `eNCF` and status badge instead of the button.
- The modal must be completable in ≤ 3 clicks for the most common case (E32, no RNC).
- Invoice failure never blocks, cancels, or holds the payment.

#### 2.5 — Invoice Status Badge Component

Reusable `<EcfStatusBadge status={estadoECF} />` component:

- `Aceptado` → green
- `Aceptado Condicional` → yellow/amber (with tooltip explaining observation)
- `Rechazado` → red
- `En Proceso` → blue/spinning
- `Emitido Contingencia` → orange
- `Pendiente` → gray

#### 2.6 — Folio View: Invoice Section

In the folio/payment detail view, add an "Invoices" section showing:

- List of e-CFs issued for this folio
- Each row: `eNCF`, `tipo`, `totalFactura`, `issuedAt`, status badge, actions menu
- Actions: View PDF, Send Email, Download XML, Refresh Status

---

## Phase 3 — Credit & Debit Notes

> **AI Development Session Scope**: ~1 session  
> **Prerequisites**: Phase 2 complete  
> **Goal**: E34 (Credit Notes) for refunds/cancellations. E33 (Debit Notes) for late fees.

#### 3.1 — Mapper: `mapToNotaCredito`

`backend/src/utils/ecfMapper.ts` — add:

**`mapToNotaCredito(originalInvoice, reason, details, tenant): CitrusE34Payload`**:

- `InformacionReferencia.NCFModificado` = `originalInvoice.eNCF`
- `InformacionReferencia.CodigoModificacion`:
  - `'1'` = Anulación (full cancellation)
  - `'2'` = Corrección de Precio / Error
  - `'3'` = Devolución
  - `'4'` = Descuentos / Bonificaciones
  - `'5'` = Otros
- `InformacionReferencia.RazonModificacion`: free text reason

#### 3.2 — Mapper: `mapToNotaDebito`

**`mapToNotaDebito(originalInvoice, charges, reason, tenant): CitrusE33Payload`**:

- For recovering late fees, additional charges billed after original invoice
- Links to original `eNCF` via `InformacionReferencia`

#### 3.3 — Backend Endpoints

`POST /api/ecf/credit-notes` — Create E34:

- Body: `{ originalEcfId, codigoModificacion, razonModificacion, items?, totalAmount }`
- Validates original invoice exists, is `Aceptado`, and belongs to this tenant
- Calls `citrusEcf.generateNotaCredito()`
- Creates new `ElectronicInvoice` with `tipo: 'E34'`, links `originalENCF`

`POST /api/ecf/debit-notes` — Create E33:

- Body: `{ originalEcfId, reason, items, totalAmount }`

#### 3.4 — Frontend Integration

- On reversed/refunded payment: if the original payment had an associated `Aceptado` invoice, show a prominent **"Emitir Nota de Crédito"** button in the reversal confirmation UI — not automatic, but one clear action away.
- Offer **"Nota de Crédito"** option in the invoice actions menu for any `Aceptado` invoice.
- Manual debit note creation from invoice actions menu.
- Form: shows original invoice info, reason selector, amount breakdown.

---

## Phase 4 — Invoice Management UI

> **AI Development Session Scope**: ~2 sessions  
> **Prerequisites**: Phase 2 + 3 complete  
> **Goal**: Full invoice management module usable by hotel staff.

### Session 4A — Invoice List & Search

#### 4.1 — Electronic Invoices Page

New route: `/invoices/electronic` (or accessible from the main nav under "Facturación"):

**Filters panel**:

- Date range (issuedAt)
- e-CF type (E31, E32, E33, E34, etc.)
- Status (Aceptado, Rechazado, En Proceso, etc.)
- Guest RNC / buyer name
- e-NCF number search
- Amount range

**Table columns**:

- e-NCF number
- Type badge (E31, E32, etc.)
- Date
- Guest / Buyer
- Total Amount
- ITBIS Amount
- Status badge
- Actions

**Summary bar** (above table):

- Count, Total invoiced, Total ITBIS for current filter

**Bulk actions**:

- Export to CSV (for accounting)
- Refresh status on all `En Proceso` invoices

#### 4.2 — Invoice Detail Drawer/Page

Clicking an invoice opens a detail view:

- Full invoice info: eNCF, TrackId, type, dates, buyer info
- Status timeline (issued → DGII response → final state)
- Charge line items
- Tax breakdown
- QR code (from `UrlCodigoQr` if available)
- Security code

**Actions**:

- **Ver Representación Impresa** — opens PDF in new tab (calls `/representacionImpresa`)
- **Enviar por Email** — sends to guest email (calls `/representacionImpresa/email`), with email override input
- **Descargar XML** — downloads raw XML (calls `/xml`)
- **Verificar Estado** — re-polls Citrus for current DGII status
- **Emitir Nota de Crédito** — for Aceptado invoices (links to Phase 3 flow)

### Session 4B — Reporting & Operational Tools

#### 4.3 — Monthly Tax Report

Page section or exportable report:

- Group by month: total invoiced, total ITBIS 18%, ITBIS 16%, ITBIS 0%, exempt
- Breakdown by invoice type
- CSV/Excel export compatible with DGII IT-1 form inputs

#### 4.4 — Sequence Management View

Show (read-only, from Citrus portal data or local inference):

- Types with available sequence ranges
- Expiry dates for sequences
- Alert when sequences are near expiry (< 30 days or < 5% remaining)
- Button to trigger sequence annulment (`POST /api/ecf/sequences/annul`)

#### 4.5 — Pending / Failed Invoice Queue

Dedicated view for:

- `En Proceso` invoices waiting for DGII confirmation
- `Rechazado` invoices needing action
- Contingency invoices pending auto-submission
- Bulk "Refresh All" button

---

## Phase 5 — Advanced & Operational Features

> **AI Development Session Scope**: ~2-3 sessions  
> **Prerequisites**: Phases 1-4 complete  
> **Goal**: Complete parity with all Citrus e-CF features; operational completeness.

#### 5.1 — Received Invoices (Comprobantes Recibidos)

For tenants who receive e-CFs from suppliers:

- `GET /api/ecf/received-invoices` — proxies `GET /api/v1/ComprobanteElectronico` with filters
- Frontend page: Received Invoices, with same filter/table pattern as Phase 4
- Commercial Approval workflow: `POST /api/ecf/commercial-approval`
  - Approve or reject received invoices from known e-CF billers
  - UI: button in received invoice row to mark "Aprobado Comercialmente" or "Rechazado"

#### 5.2 — Other Invoice Types

Add full support for less-common types (using Phase 2's framework):

- **E41 (Compras)** — purchases from non-registered contributors; for hotel supplier payments
- **E43 (Gastos Menores)** — petty cash and minor expense reports
- **E44 / E45** — special regime and government customers (low frequency but required)
- **E46 / E47** — exports and foreign payments (relevant for international bookings)

Each type needs: mapper, backend endpoint, frontend form.

#### 5.3 — Contingency Mode UX

- Detect when Citrus is unreachable (network error on API calls).
- Show a system-wide banner: "Modo Contingencia Activo — Los comprobantes se emitirán cuando se restaure la conexión."
- Invoices created offline get `estadoECF: 'Emitido Contingencia'`.
- Auto-resolve when connectivity restored (background polling).
- Link in UI to DGII OFV to manually notify contingency.

#### 5.4 — Electronic Billers Directory

- `GET /api/ecf/directory` — returns DGII-registered electronic billers
- Useful when issuing E31 invoices to verify if the buyer is an electronic biller
- Cache directory for 24h (stale-while-revalidate)
- Used in buyer RNC lookup UX

#### 5.5 — Notification & Alerts

- Email notification to tenant admin when:
  - An invoice is Rechazado (requires action)
  - Certificate approaching expiry (< 30 days)
  - Sequences approaching expiry
  - API token about to expire (if expiry date was set)
- In-app notification center items for the above

#### 5.6 — Audit Log Integration

- Integrate e-CF actions into the existing `AuditRun` model:
  - Invoice generation (who, when, amount, eNCF)
  - Credit note issuance
  - Status changes
  - Config updates (token rotations)

---

## Cross-Cutting Concerns

### Security

- **Token storage**: AES-256-GCM encryption at rest. Key in environment variable, NOT in code or DB.
- **Token in transit**: HTTPS only. Token never appears in frontend (not in API responses, not in logs).
- **Input validation**: All RNC/cédula inputs validated against DGII format rules (9 or 11 digits, Luhn-like check digit).
- **Tenant isolation**: All ECF models use `tenantPlugin`. A token belonging to Tenant A can never be used with Tenant B's data.
- **Rate limiting**: Apply rate limiting to `/api/ecf/*` routes to prevent accidental or malicious invoice flooding.
- **Authorization**: Only users with `ecf:write` permission can generate invoices. All staff can `ecf:read`.

### Error Handling

| Scenario         | Behavior                                                                           |
| ---------------- | ---------------------------------------------------------------------------------- |
| Citrus API 400   | Return validation error detail to frontend; do NOT create ElectronicInvoice record |
| Citrus API 401   | Alert tenant admin: token invalid/expired. Block further attempts.                 |
| Citrus API 202   | Create record with `En Proceso`, start polling loop                                |
| Network timeout  | Retry 3x with exponential backoff; if all fail, emit as `Emitido Contingencia`     |
| DGII `Rechazado` | Update status, flag for review, notify admin                                       |

### Idempotency

- Before generating an invoice, check `ElectronicInvoice` collection for existing record linked to `paymentId` with status `Aceptado` or `En Proceso`.
- If one exists, return existing invoice instead of creating a duplicate.
- Include this check in the generation endpoint.

### Multi-tenant Isolation

- Each tenant's Citrus account is independent; Pilloto never mixes tokens.
- Super-admin (platform-level) can see e-CF config status per tenant (but never the raw token).
- If a tenant's e-CF is `isActive: false`, all generation endpoints return a clear "Feature not configured" error.

---

## Testing Strategy

### Phase 0 Testing (Manual)

- Use Citrus `Simulación` environment to confirm token works.
- Use Postman collection (downloadable from Citrus docs) to manually test all endpoints before development.

### Phase 1 Testing

- Unit tests for `encryption.ts` (round-trip encrypt/decrypt).
- Unit tests for ECF configuration save/retrieve (token should come back masked).
- Integration test: `POST /api/ecf/config/test` returns success with valid token.

### Phase 2 Testing

- Unit tests for `ecfMapper.ts` — all charge/tax/payment combinations:
  - ITBIS 18%, ITBIS 0%, exempt
  - Multiple charges in one folio
  - Discounts applied
  - Cash vs card vs transfer payment mapping
- Integration test: full flow from payment → E32 generation in Citrus `Simulación` environment.
- Test idempotency: re-submitting same `paymentId` returns existing invoice.
- Test 202 polling loop with a mock that returns `En Proceso` then `Aceptado`.

### Phase 3 Testing

- Unit test: credit note mapper produces correct `CodigoModificacion` for each cancellation type.
- Integration: full flow — issue E32 → reverse payment → generate E34.

### Phase 4 Testing

- UI tests: invoice list renders, filters work, status badges display correctly.
- Test PDF/email/XML endpoints return expected content types.

### Phase 5 Testing

- Test contingency scenario by pointing `citrusBaseUrl` to an unreachable URL.
- Confirm `Emitido Contingencia` status is stored correctly.

---

## Quick Reference: How to Start Each Development Session

When opening a new session with the AI agent, use this prompt pattern:

> "I'm working on the Pilloto PMS e-CF integration. Refer to `ECF_INTEGRATION_REQUIREMENTS.md`. Please implement **Phase X** in full, including all backend and frontend tasks listed."

### SESSION CHECKLIST (copy per session):

- [ ] Read `ECF_INTEGRATION_REQUIREMENTS.md` at the start
- [ ] Confirm which Phase is being worked
- [ ] Run `tsc --noEmit` in both `backend/` and `frontend/` before starting (baseline)
- [ ] Implement all tasks in the Phase
- [ ] Run `tsc --noEmit` in both `backend/` and `frontend/` after (must be zero errors)
- [ ] Mark Phase tasks as completed in this document

---

## Phase Completion Tracker

| Phase                           | Status         | Notes                  |
| ------------------------------- | -------------- | ---------------------- |
| Phase 0 — Manual Setup          | ⬜ Not started | User actions only      |
| Phase 1 — Foundation            | ⬜ Not started |                        |
| Phase 2 — Core Generation       | ⬜ Not started | Requires Phase 0 token |
| Phase 3 — Credit/Debit Notes    | ⬜ Not started |                        |
| Phase 4 — Invoice Management UI | ⬜ Not started |                        |
| Phase 5 — Advanced Features     | ⬜ Not started |                        |

---

_Document maintained in: `ECF_INTEGRATION_REQUIREMENTS.md` at the root of `pilloto-pms`._
