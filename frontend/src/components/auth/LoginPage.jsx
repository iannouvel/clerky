import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { useAuth } from './AuthProvider';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const auth = useAuth();
  const provider = new GoogleAuthProvider();

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Error signing in with Google:', error);
    }
  };

  return (
    <div className={styles.landingPage}>
      <h1>clerky</h1>
      <button
        className={styles.googleSignInBtn}
        onClick={handleGoogleSignIn}
      >
        Sign in with Google
      </button>
    </div>
  );
} 