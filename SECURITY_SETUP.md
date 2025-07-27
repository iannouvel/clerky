# Security Setup Guide

## Firebase API Key Security

### ⚠️ IMPORTANT: API Key Exposure Alert

Your Firebase API key was recently exposed in a public GitHub repository. Here's how to secure it:

### Immediate Actions Required:

1. **Regenerate API Key (URGENT)**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Navigate to "APIs & Services" > "Credentials"
   - Find the compromised key and click "Regenerate key"
   - This invalidates the exposed key immediately

2. **Update Your Local Files**
   - Replace `YOUR_NEW_API_KEY_HERE` in `modules/firebase-core.js` with your new API key
   - Update `firebase-init.js` with the new key
   - Update `dist/firebase-init.js` with the new key

3. **Add API Key Restrictions**
   - In Google Cloud Console, edit your API key
   - Add restrictions:
     - HTTP referrers (your domain)
     - API restrictions (only Firebase APIs)
     - Application restrictions

### Secure Configuration Setup:

1. **Environment Variables (Recommended)**
   ```bash
   # Create a .env file (already in .gitignore)
   FIREBASE_API_KEY=your_new_api_key_here
   ```

2. **Template File**
   - Use `modules/firebase-core.template.js` as a reference
   - Never commit actual API keys to the repository

### Files to Update:
- `modules/firebase-core.js` - Replace API key
- `firebase-init.js` - Replace API key  
- `dist/firebase-init.js` - Replace API key

### Prevention:
- ✅ Firebase config files are now in `.gitignore`
- ✅ Template file created for reference
- ✅ Environment variable setup ready
- ⚠️ Remember to never commit API keys to public repositories

### Next Steps:
1. Regenerate the API key immediately
2. Update all local files with the new key
3. Add API key restrictions in Google Cloud Console
4. Test your application with the new key
5. Consider using environment variables for production

### Support:
If you need help with any of these steps, refer to:
- [Google Cloud API Key Security](https://cloud.google.com/docs/authentication/api-keys)
- [Firebase Security Rules](https://firebase.google.com/docs/rules) 