import { signOut } from 'firebase/auth';
import { useAuth } from '../auth/AuthProvider';
import useStore from '../../stores/useStore';
import { useData } from '../../hooks/useData';
import styles from './TopBar.module.css';

export function TopBar() {
  const auth = useAuth();
  const user = useStore((state) => state.user);
  const serverStatus = useStore((state) => state.serverStatus);
  const { handleIssues, isLoading } = useData();

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <div className={styles.topBar}>
      <div className={styles.topBarLeft}>
        <a href="/" className={styles.logoLink}>
          <div className={styles.logo}>clerky</div>
        </a>
        <div className={styles.serverStatus}>
          {serverStatus === 'live' ? 'Server: Live' : 'Server: Down'}
        </div>
      </div>

      <div className={styles.topBarCenter}>
        <button className={styles.navBtn}>
          <span className={isLoading.test ? styles.spinner : ''} />
          <span>Test</span>
        </button>
        <button className={styles.navBtn}>Prompts</button>
        <button className={styles.navBtn}>Guidelines</button>
        <button className={styles.navBtn}>
          <span className={styles.recordSymbol} />Record
        </button>
        <button 
          className={styles.navBtn}
          onClick={() => handleIssues()}
          disabled={isLoading.issues}
        >
          <span className={isLoading.issues ? styles.spinner : ''} />
          <span>Process</span>
        </button>
        <button className={styles.navBtn}>
          <span className={isLoading.note ? styles.spinner : ''} />
          <span>Note</span>
        </button>
        <button className={styles.navBtn}>X-check</button>
        <button className={styles.navBtn}>Dev</button>
      </div>

      <div className={styles.rightContent}>
        <div className={styles.userInfo}>
          <span>User:</span>
          <span className={styles.userName}>{user?.displayName}</span>
        </div>
        <button 
          className={styles.signOutBtn}
          onClick={handleSignOut}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
} 