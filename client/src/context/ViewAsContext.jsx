import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

const STORAGE = 'kap.viewAs';

/** Read outside React too - the axios interceptor needs it on every request. */
export const getViewAs = () => {
  try {
    return localStorage.getItem(STORAGE) || '';
  } catch {
    return '';
  }
};

const ViewAsContext = createContext(null);

/**
 * Lets an admin look at the dashboard as one particular user. The choice is
 * sent as a header on every request rather than threaded through each page's
 * query, so a page cannot forget to honour it.
 */
export function ViewAsProvider({ children }) {
  const { user, loading } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [users, setUsers] = useState([]);
  const [viewAs, setViewAsState] = useState(() => getViewAs());

  useEffect(() => {
    // Until auth resolves nobody looks like an admin, and clearing on that
    // guess wiped the stored choice on every single reload.
    if (loading) return;

    if (!isAdmin) {
      // A non-admin can never be in this mode; drop any stale value
      if (getViewAs()) localStorage.removeItem(STORAGE);
      setViewAsState('');
      return;
    }
    api
      .get('/users')
      .then(({ data }) => setUsers(data.items || []))
      .catch(() => {});
  }, [isAdmin, loading]);

  /**
   * Every page holds its own fetched state, so a reload is the honest way to
   * make the whole app answer as someone else. This is a rare admin action.
   */
  const setViewAs = useCallback((id) => {
    if (id) localStorage.setItem(STORAGE, id);
    else localStorage.removeItem(STORAGE);
    setViewAsState(id || '');
    window.location.reload();
  }, []);

  const value = useMemo(() => {
    const target = users.find((u) => String(u._id) === String(viewAs)) || null;
    return { isAdmin, users, viewAs, setViewAs, target };
  }, [isAdmin, users, viewAs, setViewAs]);

  return <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>;
}

export const useViewAs = () => {
  const ctx = useContext(ViewAsContext);
  if (!ctx) throw new Error('useViewAs must be used inside ViewAsProvider');
  return ctx;
};
