import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout.jsx';
import { Alert, Button, Loading } from './components/ui.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { firebaseConfigured } from './lib/firebase.js';
import Audit from './pages/admin/Audit.jsx';
import People from './pages/admin/People.jsx';
import Settings from './pages/admin/Settings.jsx';
import AuthAction from './pages/auth/AuthAction.jsx';
import ChangePassword from './pages/auth/ChangePassword.jsx';
import ForgotPassword from './pages/auth/ForgotPassword.jsx';
import Login from './pages/auth/Login.jsx';
import VerifyEmail from './pages/auth/VerifyEmail.jsx';
import DecisionDetail from './pages/DecisionDetail.jsx';
import DecisionNew from './pages/DecisionNew.jsx';
import Decisions from './pages/Decisions.jsx';
import DevMailbox from './pages/DevMailbox.jsx';
import Display from './pages/Display.jsx';
import Home from './pages/Home.jsx';
import HrOverview from './pages/HrOverview.jsx';
import Inbox from './pages/Inbox.jsx';
import Meetings from './pages/Meetings.jsx';
import MyProfile from './pages/MyProfile.jsx';
import Notifications from './pages/Notifications.jsx';
import DecisionPrompts from './pages/platform/DecisionPrompts.jsx';
import OrgRequests from './pages/platform/OrgRequests.jsx';
import ContactUs from './pages/auth/ContactUs.jsx';
import Evaluation from './pages/platform/Evaluation.jsx';
import Orgs from './pages/platform/Orgs.jsx';
import PlatformRules from './pages/platform/PlatformRules.jsx';
import Reviews from './pages/Reviews.jsx';
import RuleLibrary from './pages/RuleLibrary.jsx';
import BulkSend from './pages/BulkSend.jsx';
import SendTask from './pages/SendTask.jsx';
import Sent from './pages/Sent.jsx';
import TaskDetail from './pages/TaskDetail.jsx';
import Team from './pages/Team.jsx';
import TeamProfile from './pages/TeamProfile.jsx';

function SetupNeeded() {
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <h1>Firebase is not set up yet</h1>
        <p>Add the Firebase web app values (VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID) to the .env file in the project folder, then restart the app.</p>
      </div>
    </div>
  );
}

function Gate() {
  const { status, user, org, isPlatformAdmin, error, refresh, signOut } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <div className="content"><Loading label="Signing you in" /></div>;
  if (status === 'signedOut') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (status === 'unverified') return <Navigate to="/verify-email" replace />;
  if (status === 'error')
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <Alert tone="danger" title="We could not load your account">
            <p>{error}</p>
          </Alert>
          <div className="actions">
            <Button onClick={refresh}>Try again</Button>
            <Button variant="secondary" onClick={signOut}>Sign out</Button>
          </div>
        </div>
      </div>
    );
  // A temporary password from an admin must be replaced before anything else.
  if (user?.mustChangePassword) return location.pathname === '/change-password' ? <Outlet /> : <Navigate to="/change-password" replace />;
  if (!org && !isPlatformAdmin)
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <Alert tone="warning" title="Your account is not linked to a company">
            <p>Please ask your company admin or SimpliAccess to finish setting up your account.</p>
          </Alert>
          <div className="actions">
            <Button variant="secondary" onClick={signOut}>Sign out</Button>
          </div>
        </div>
      </div>
    );
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

function PublicOnly({ children }) {
  const { status } = useAuth();
  if (status === 'ready') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  if (!firebaseConfigured) return <SetupNeeded />;
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/contact" element={<ContactUs />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/auth/action" element={<AuthAction />} />
      <Route path="/dev/mailbox-public" element={<DevMailbox standalone />} />
      <Route element={<Gate />}>
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/" element={<Home />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/send" element={<SendTask />} />
        <Route path="/send/bulk" element={<BulkSend />} />
        <Route path="/sent" element={<Sent />} />
        <Route path="/profile" element={<MyProfile />} />
        <Route path="/team" element={<Team />} />
        <Route path="/team/:employeeId" element={<TeamProfile />} />
        <Route path="/rules" element={<RuleLibrary />} />
        <Route path="/decisions" element={<Decisions />} />
        <Route path="/decisions/new" element={<DecisionNew />} />
        <Route path="/decisions/:id" element={<DecisionDetail />} />
        <Route path="/reviews" element={<Reviews />} />
        <Route path="/meetings" element={<Meetings />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/hr" element={<HrOverview />} />
        <Route path="/admin/people" element={<People />} />
        <Route path="/admin/settings" element={<Settings />} />
        <Route path="/admin/audit" element={<Audit />} />
        <Route path="/platform" element={<Orgs />} />
        <Route path="/platform/rules" element={<PlatformRules />} />
        <Route path="/platform/decision-prompts" element={<DecisionPrompts />} />
        <Route path="/platform/requests" element={<OrgRequests />} />
        <Route path="/platform/evaluation" element={<Evaluation />} />
        <Route path="/settings/display" element={<Display />} />
        <Route path="/dev/mailbox" element={<DevMailbox />} />
        <Route path="*" element={<div><h1 id="page-title" tabIndex={-1}>Page not found</h1><p>That page does not exist.</p></div>} />
      </Route>
    </Routes>
  );
}
