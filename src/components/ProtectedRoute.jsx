import { Link, Outlet, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

const DefaultFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin"></div>
  </div>
);

// Admin pages: the signed-in wallet must be listed in ADMIN_WALLETS on the server.
export default function ProtectedRoute({ fallback = <DefaultFallback />, unauthenticatedElement }) {
  const { isAuthenticated, isAdmin, isLoadingAuth } = useAuth();
  const location = useLocation();
  if (isLoadingAuth) return fallback;
  if (!isAuthenticated) return unauthenticatedElement || <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  if (!isAdmin) {
    return <div className="mx-auto max-w-md px-5 py-20 text-center">
      <h1 className="font-display text-2xl font-bold">Admins only</h1>
      <p className="mt-2 text-sm text-muted-foreground">This wallet is not on the admin list. Add it to ADMIN_WALLETS in the server settings to get access.</p>
      <Link to="/" className="mt-6 inline-block text-primary underline">Back to markets</Link>
    </div>;
  }
  return <Outlet />;
}
