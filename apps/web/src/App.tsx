import { Navigate, Route, Routes } from "react-router-dom";
import { authClient } from "./lib/auth";
import { AuthPage } from "./pages/Auth";
import { OnboardingPage } from "./pages/Onboarding";
import { ShellPage } from "./pages/Shell";
import { WelcomePage } from "./pages/Welcome";

export function App() {
  const session = authClient.useSession();
  if (session.isPending) {
    return <div className="grid h-full place-items-center text-[#6C6C70]">Loading…</div>;
  }
  const user = session.data?.user;
  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/app" replace /> : <WelcomePage />} />
      <Route
        path="/sign-in"
        element={user ? <Navigate to="/app" replace /> : <AuthPage mode="in" />}
      />
      <Route
        path="/sign-up"
        element={user ? <Navigate to="/onboarding" replace /> : <AuthPage mode="up" />}
      />
      <Route
        path="/onboarding"
        element={user ? <OnboardingPage /> : <Navigate to="/sign-in" replace />}
      />
      <Route path="/app" element={user ? <ShellPage /> : <Navigate to="/sign-in" replace />} />
      <Route
        path="/app/:botId"
        element={user ? <ShellPage /> : <Navigate to="/sign-in" replace />}
      />
    </Routes>
  );
}
