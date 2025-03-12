import { createContext, useContext, useEffect } from 'react';
import { auth } from '../../firebase-init';
import { onAuthStateChanged } from 'firebase/auth';
import useStore from '../../stores/useStore';

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const { setUser } = useStore();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUser({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          token: user.accessToken,
        });
      } else {
        setUser(null);
      }
    });

    return () => unsubscribe();
  }, [setUser]);

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
} 