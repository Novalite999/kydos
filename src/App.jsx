import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import ScrollToTop from './components/ScrollToTop';
import Layout from '@/components/Layout';
import Board from '@/pages/Board';
import ExternalMarket from '@/pages/ExternalMarket';
import Forum from '@/pages/Forum';
import Thread from '@/pages/Thread';
import Profile from '@/pages/Profile';
import Notifications from '@/pages/Notifications';
import Releases from '@/pages/Releases';
import Login from '@/pages/Login';
import AdminAstra from '@/pages/AdminAstra';
import AdminLaunch from '@/pages/AdminLaunch';
import SolanaLaunch from '@/pages/SolanaLaunch';
import SolanaMarket from '@/pages/SolanaMarket';
import LegacyChartRedirect from '@/components/solana/LegacyChartRedirect';
import { SolanaWalletProvider } from '@/lib/SolanaWalletContext';


export default function App() {
  return <SolanaWalletProvider><AuthProvider><QueryClientProvider client={queryClientInstance}><Router><ScrollToTop/><Routes>
    <Route element={<Layout/>}>
      <Route path="/" element={<Board/>}/>
      <Route path="/markets/solana/:mint" element={<ExternalMarket/>}/>
      <Route path="/launch" element={<SolanaLaunch/>}/>
      <Route path="/solana/:mint" element={<SolanaMarket/>}/>
      <Route path="/chart" element={<Navigate to="/solana/GTBxUiw6wJdmmkCGZgRHLyYxqu1vG4KtRpeox6yDpump" replace/>}/>
      <Route path="/chart/:mint" element={<LegacyChartRedirect/>}/>
      <Route path="/forum" element={<Forum/>}/><Route path="/post/:id" element={<Thread/>}/>
      <Route path="/notifications" element={<Notifications/>}/><Route path="/releases" element={<Releases/>}/>
      <Route path="/profile" element={<Profile/>}/><Route path="/profile/:userId" element={<Profile/>}/>
    </Route>
    <Route path="/login" element={<Login/>}/>
    {/* Email accounts were replaced by wallet sign-in; old links land on the sign-in page. */}
    {['/register', '/forgot-password', '/reset-password', '/oauth/consent'].map(path => <Route key={path} path={path} element={<Navigate to="/login" replace/>}/>)}
    <Route element={<ProtectedRoute />}>
      <Route element={<Layout/>}>
        <Route path="/admin/astra" element={<AdminAstra/>}/><Route path="/admin/launch" element={<AdminLaunch/>}/>
      </Route>
    </Route>
    <Route path="*" element={<PageNotFound/>}/>
  </Routes></Router><Toaster/><SonnerToaster position="top-center"/></QueryClientProvider></AuthProvider></SolanaWalletProvider>;
}