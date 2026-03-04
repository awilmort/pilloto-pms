# Pilloto - Full Stack Web Application

A comprehensive web application for Pilloto, an eco-friendly hotel and aqua park featuring customer reservations, media galleries, and admin management.

## 🌟 Features

### Customer Features

- **Homepage** with photo carousel and resort information
- **Room Browsing** with filtering and availability checking
- **Reservation System** with booking management
- **User Authentication** with registration and login
- **Media Gallery** showcasing facilities and activities
- **Contact Form** for inquiries and support
  """

# Pilloto - PMS (Property Management System)

This repository contains the Pilloto PMS: a TypeScript-based backend API and a React + TypeScript frontend used for reservations, media management, admin dashboards, and other hotel/aquapark operations.

## Quick Overview

- Backend: Node.js + Express + TypeScript (API, auth, data models, scripts)
- Frontend: React + TypeScript (admin and customer UI)
- Database: MongoDB (via Mongoose)
- Uploads: local `backend/uploads/` used for media in development

## Repository Layout

```
pilloto-pms/
├── backend/                 # Node/Express API (TypeScript)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/          # API route definitions
│   │   ├── models/          # Mongoose models
│   │   ├── middleware/      # Auth & validation middleware
│   │   ├── utils/           # Helpers (email, jwt, pricing, media sync)
│   │   └── scripts/         # Seed scripts and utilities
│   └── uploads/             # Local file upload directory (dev)
├── frontend/                # React frontend (TypeScript)
│   ├── package.json
│   ├── tsconfig.json
│   ├── public/
│   └── src/
│       ├── components/      # Reusable UI components
│       ├── pages/           # Page-level components
│       ├── services/        # API client (`services/api.ts`)
│       ├── contexts/        # Auth & settings contexts
│       └── utils/           # Client utilities (pricing, i18n)
└── README.md                # This file
```

## Getting Started (Development)

Prereqs: `node` (v16+), `npm` or `pnpm`, and a running MongoDB (local or Atlas).

1. Clone and enter repo:

```bash
git clone <repo-url>
cd pilloto-pms
```

2. Backend (API)

```bash
cd backend
npm install

# copy or create .env (use .env.example if present)
# configure MONGODB_URI, JWT_SECRET, PORT, FRONTEND_URL, etc.

# seed DB with sample data (optional)
npm run seed

# start dev server (watch)
npm run dev
```

Default backend entry: `src/index.ts`.

3. Frontend (client)

```bash
cd frontend
npm install
npm start
```

Frontend dev server runs at `http://localhost:3000` by default and expects the API under the `REACT_APP_API_URL` env var (e.g. `http://localhost:5000/api`).

## Useful Scripts

- Backend (from `backend/`):
  - `npm run dev` — start dev server with hot reload
  - `npm run build` — build production server bundle
  - `npm start` — run production server
  - `npm run seed` — run seed scripts in `src/scripts/`

- Frontend (from `frontend/`):
  - `npm start` — start dev server
  - `npm run build` — build static production assets
  - `npm test` — run tests

## Seeds & Uploads

- Seed scripts are located in `backend/src/scripts/` and can populate default accounts and demo data.
- Uploaded media (development) are stored in `backend/uploads/`. In production, use cloud storage and update media sync utilities accordingly.

## Environment Variables

- Backend example variables (set in `backend/.env`):
  - `PORT` — backend port (e.g. `5000`)
  - `MONGODB_URI` — MongoDB connection string
  - `JWT_SECRET` — authentication secret
  - `FRONTEND_URL` — allowed CORS/origin

- Frontend example variables (set in `frontend/.env`):
  - `REACT_APP_API_URL` — API base URL (e.g. `http://localhost:5000/api`)

## Deployment Notes

- Build both apps (`npm run build`) and deploy the backend to your host (Heroku, AWS, DigitalOcean, etc.) and frontend to static hosting (Vercel, Netlify, S3).
- Replace local uploads with cloud storage and update configuration for production.

## Contributing

Follow the normal Git flow: create a branch, open a PR, and include a clear description and tests where applicable.

## Support

Create an issue in the repository for bugs or questions.

---

Pilloto — concise PMS for bookings and media management

"""
PORT=5000
