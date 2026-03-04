# Production Deployment Guide

This guide walks through deploying the app with:

- Frontend (React): Vercel
- Backend (Node.js/Express): Render
- GitHub account and a repository for this monorepo.

## 0) Prepare GitHub Repository (Monorepo)

- Frontend builds on Vercel and calls the backend via `REACT_APP_API_URL`.
  This project is a monorepo with `frontend/` and `backend/` folders.
- Backend runs on Render, connects to Atlas via `MONGODB_URI`, and enables CORS for Vercel domains.

1. Create a new GitHub repository (private recommended).
2. Initialize Git locally and push:

- Auth uses JWT; cookies are configured for cross-site in production.

```zsh
# From repo root (pilloto-pms)
 git init
 git branch -M main

# Add a GitHub remote (replace with your URL)
 git remote add origin git@github.com:<your-org>/<your-repo>.git
## Prerequisites
# Ensure secrets/build artefacts are ignored
 echo "# Global\n.DS_Store\n*.env\n.env\n" > .gitignore
 echo "# Backend\nbackend/node_modules\nbackend/dist\nbackend/.env\nbackend/uploads\n" >> .gitignore
 echo "# Frontend\nfrontend/node_modules\nfrontend/build\nfrontend/.env\n" >> .gitignore

 git add .
 git commit -m "Initial commit: frontend + backend monorepo"
 git push -u origin main
```

- MongoDB Atlas cluster + database user.

3. Confirm the repo contains both `frontend` and `backend` directories.

- Vercel account + project.
  Notes:
- Real secrets must not be committed; use the provided `.env.example` files.
- If you already have a remote, update it with `git remote set-url origin <new-url>`.
- Render account + service.

## 1) MongoDB Atlas

Create a new Web Service from the GitHub repository (monorepo).
Root Directory: `backend`

- Create a cluster and database user with password.
- Allow network access (IP allow list or VPC peering).
- Get the connection string:
  `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/pilloto_pms?retryWrites=true&w=majority`

## 2) Backend on Render

- Create a new Web Service from the `backend` folder.
- Environment:
  - `NODE_ENV=production`
  - `PORT=<render_port or leave default>`
  - `MONGODB_URI=<atlas_connection_string>`
  - `JWT_SECRET=<strong_random>`
  - `SESSION_SECRET=<strong_random>`
  - `UPLOADS_DIR=/uploads` (matches your Render Disk mount path)
    Enable CI/CD:
- Connect Render service to your GitHub repo and enable auto-deploy on `main` (or create a staging service for a `staging` branch).
- On each push, Render will rebuild and redeploy.
  - `JWT_EXPIRES_IN=7d`
  - `FRONTEND_URL=https://your-app.vercel.app`
  - Or `CORS_ORIGINS=https://your-app.vercel.app,https://your-app-git-branch-user.vercel.app`
- Build Command: `npm run build`
- Start Command: `npm start`
- Node Version: leave default or set to latest LTS.
- Trust Proxy: Enabled for accurate client IP behind Render’s proxy.
- Verify health endpoint: `https://<service>.onrender.com/api/health`

### Persistent Media Storage (Render Disks)

- Add a Disk in the Render service and set the Mount Path to `/uploads`.
- Set `UPLOADS_DIR=/uploads` in the service environment. The backend reads/writes uploads from this path and serves them via `/uploads/*`.
- Files stored under `/uploads` persist across restarts and deployments. App-local paths (e.g., `dist/uploads`) are ephemeral and will be wiped on deploy.
- Existing media records use URLs like `/uploads/image.png`; these resolve against your backend origin, e.g., `https://<service>.onrender.com/uploads/image.png`.

### Notes

Import the GitHub repository and select `frontend` as Root Directory (monorepo).

- CORS: The backend supports multiple origins via `CORS_ORIGINS`.
- Cookies: In production, `sameSite=none` and `secure=true` allow cross-site cookies.
- Secrets: Do not commit real secrets; set in Render environment.

## 3) Frontend on Vercel

Enable CI/CD via GitHub:

- Log in to Vercel with your GitHub account.
- Import the repo; Vercel will create a project for `frontend/`.
- For every branch/PR, Vercel creates a Preview URL; include these in `CORS_ORIGINS` on Render for API access.
- Import the `frontend` folder as a project.
- Environment Variables:
  - `REACT_APP_API_URL=https://<render_service>.onrender.com/api`

Connectivity checks:

```zsh
# Replace URL with your Render endpoint
curl -i https://<service>.onrender.com/api/health

# Test CORS preflight
curl -i -X OPTIONS \
  -H "Origin: https://<your-app>.vercel.app" \
  -H "Access-Control-Request-Method: GET" \
  https://<service>.onrender.com/api/rooms
```

## 4) Verify End-to-End

- Open Vercel URL and login; confirm JWT auth works.

## Environment Matrix

## 5) Optional Enhancements

- Frontend (Vercel):
  - `REACT_APP_API_URL=https://<render_service>.onrender.com/api`
- Backend (Render):
  - `NODE_ENV=production`
  - `MONGODB_URI=<atlas_connection_string>`
  - `JWT_SECRET`, `SESSION_SECRET`, `JWT_EXPIRES_IN=7d`
  - `FRONTEND_URL` or `CORS_ORIGINS` (comma-separated, include Preview URLs)

## Detailed Atlas Setup

1. Create Project and Cluster (M0/M10 per your needs).
2. Database Access: Add User (SCRAM) with `readWrite` on your DB.
3. Network Access: Add IPs (start with `0.0.0.0/0` while testing, then restrict to Render egress IPs if applicable).
4. Get connection string (SRV) and set it as `MONGODB_URI` on Render.

- Add preview domain management to `CORS_ORIGINS`.

## Common Pitfalls and Fixes

- CORS errors: Add Vercel Preview URL(s) to `CORS_ORIGINS`.
- Cookies not sent: Production requires HTTPS; backend sets `sameSite=none`, `secure=true`. Verify requests include `withCredentials: true` (already set in `frontend/src/services/api.ts`).
- 401 on public pages: The axios interceptor is configured to avoid forced logout for public endpoints.
- Timezone filters: Revenue uses local date parsing to avoid UTC off-by-one.
- Use a secrets manager (Vercel/Render integrations, Azure Key Vault).

## Branch Strategy

- `main`: Production releases → auto-deploy to Render and Vercel.
- Feature branches/PRs: Preview deployments on Vercel → add preview URL to `CORS_ORIGINS` to test API calls. Optionally, create a **staging Render service** tied to `staging` branch.
- Configure custom domains on Vercel and Render.

## Optional: Custom Domains

- Vercel: Add custom domain and alias to the project; SSL auto-managed.
- Render: Add custom domain and configure DNS; set `FRONTEND_URL`/`CORS_ORIGINS` to use the new domain.

## 6) Local vs Production Environment

- Backend `.env.example` and frontend `.env.example` are included.
- For local dev, use `FRONTEND_URL=http://localhost:3000` and `MONGODB_URI=mongodb://127.0.0.1:27017/pilloto_pms`.

## Troubleshooting

- **CORS blocked**: Ensure Vercel URL is in `CORS_ORIGINS`.
- **Cookies missing**: Production requires HTTPS; `sameSite=none` and `secure=true`.
- **JWT invalid**: Keep `JWT_SECRET` consistent across instances; rotating logs out users.
- **DB auth failed**: Verify Atlas user and network access.

```sh
# Quick build checks
pushd backend && npm run build && popd
pushd frontend && npm run build && popd
```
