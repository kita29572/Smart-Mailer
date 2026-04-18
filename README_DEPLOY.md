# Deployment Guide

This application is designed to be deployed on various platforms.

## 1. Netlify (Recommended for Static + Functions)
- Connect your GitHub repository to Netlify.
- Netlify will automatically detect the `netlify.toml` file.
- Build Settings:
  - Build Command: `npm run build`
  - Publish Directory: `dist`
  - Functions Directory: `netlify/functions`
- The API will be available at `/api/*` (proxied to Netlify Functions).

## 2. Vercel
- Connect your GitHub repository to Vercel.
- Vercel will detect the Vite project.
- For the API to work, you may need to add a `vercel.json` or move the API to the `api/` directory. (Currently optimized for Netlify).

## 3. Standard Node.js Server (Cloud Run, Heroku, VPS)
- Run `npm run build` to build the frontend.
- Start the server using `npm start` (which runs `node server.ts` or similar).
- Ensure `NODE_ENV=production` is set.

## Troubleshooting

### 1. Netlify "Failed to prepare repo" or "fatal: unknown index entry format"
If you see an error like `fatal: unknown index entry format` during the "preparing repo" stage on Netlify, it means the Netlify build cache is corrupted.
**Solution:**
1. Go to your Netlify Dashboard.
2. Select your Site.
3. Go to **Deploys**.
4. Click the **Trigger deploy** dropdown button.
5. Select **Clear cache and deploy site**.
This will force Netlify to re-clone the repository and fix the git index error.

### 2. Manual Upload (Drag & Drop)
If you are uploading a ZIP file manually to Netlify:
- **DO NOT** include the `.git` folder in your ZIP file.
- Only include the project files and folders (src, public, package.json, etc.).
- Netlify will handle the build automatically if `netlify.toml` is present.
