# Deployment Workflow

This project uses **automated deployment via GitHub Actions**. Changes pushed to the `main` branch are automatically built and deployed to the live site at `clerkyai.health`.

// turbo-all

## Deployment Steps

1. **Make your changes** to source files (styles.css, script.js, index.html, etc.)

2. **Commit changes**:
   ```bash
   git add .
   git commit -m "Your commit message"
   ```

3. **Push to GitHub**:
   // turbo
   ```bash
   git -c core.askPass= push
   ```

4. **Monitor deployment**:
   - GitHub Actions will automatically:
     - Run `npm run build` (creating the `dist/` folder on the server)
     - Deploy the `dist/` folder to GitHub Pages (`gh-pages` branch)
     - Update `clerkyai.health`
   - Check deployment status at: https://github.com/iannouvel/clerky/actions

## Important Notes

- **`dist/` Folder**: The `dist/` folder is now **ignored by Git**. You do not need to commit it. It is generated automatically during the build process on the server.
- **Local Testing**: You can still run `npm run build` locally to test, but the generated `dist/` files will not be tracked by Git.

## Automatic Versioning

The deployment workflow **automatically increments the version** based on your commit message:

- **Default (patch)**: `7.28.0 → 7.28.1`
- **Minor**: Include `[minor]` in commit message → `7.28.0 → 7.29.0`
- **Major**: Include `[major]` in commit message → `7.28.0 → 8.0.0`

Examples:
```bash
git commit -m "Fix bug in clinical sync"                    # patch: 7.28.0 → 7.28.1
git commit -m "Add new feature [minor]"                     # minor: 7.28.0 → 7.29.0
git commit -m "Breaking API change [major]"                 # major: 7.28.0 → 8.0.0
git push
```

The version in `package.json` is automatically updated and committed during deployment.

## Troubleshooting

- **Cache issues**: Users may need to hard refresh (Ctrl+F5) to see updates
- **Deployment failed**: Check GitHub Actions logs
- **DNS issues**: Verify CNAME is in `dist/` folder (build.js copies it automatically)
