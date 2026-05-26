import React, { lazy, Suspense } from "react";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import VisionLayout from "./layout/VisionLayout";
import ErrorPage from "./pages/ErrorPage";
import ProtectedRoute from "./components/ProtectedRoute";
import { useTokenRefresh } from "./hooks/useTokenRefresh";

const LandingPage        = lazy(() => import("./pages/LandingPage"));
const Login              = lazy(() => import("./components/Login"));
const Register           = lazy(() => import("./components/Register"));
const ForgotPassword     = lazy(() => import("./components/ForgotPassword"));
const ResetPassword      = lazy(() => import("./components/ResetPassword"));
const AboutPage          = lazy(() => import("./pages/AboutPage"));
const VerifyRecordPage   = lazy(() => import("./pages/VerifyRecordPage"));
const UserDashboard      = lazy(() => import("./components/UserDashboard"));
const VisionDashboard    = lazy(() => import("./components/Dashboard"));
const RatingEvaluation   = lazy(() => import("./components/RatingEvaluation"));
const TaskPage           = lazy(() => import("./pages/TaskPage").then(m => ({ default: m.TaskPage })));
const SearchResultsPage  = lazy(() => import("./pages/SearchResultsPage"));
const CredibilityPage    = lazy(() => import("./pages/CredibilityPage"));
const WorkspacePage      = lazy(() => import("./pages/WorkspacePage"));
const GameSpacePage      = lazy(() => import("./pages/GameSpacePage"));
const LevelPage          = lazy(() => import("./pages/LevelPage"));
const MoleculeMapPage    = lazy(() => import("./pages/MoleculeMapPage"));
const KnowGraphPage      = lazy(() => import("./pages/KnowGraphPage"));
const NewKnowGraphPage   = lazy(() => import("./pages/NewKnowGraphPage"));
const QuadrantGridPage   = lazy(() => import("./pages/QuadrantGridPage"));
const DiscussionPage     = lazy(() => import("./pages/DiscussionPage"));
const ClaimDuelPage      = lazy(() => import("./pages/ClaimDuelPage"));
const CaseFocusPage      = lazy(() => import("./pages/CaseFocusPage").then(m => ({ default: m.CaseFocusPage })));
const ChatPage           = lazy(() => import("./pages/ChatPage"));
const TextPadPage        = lazy(() => import("./pages/TextPadPage"));
const AccountSettingsPage = lazy(() => import("./pages/AccountSettingsPage"));
const UserSelectionPage  = lazy(() => import("./pages/UserSelectionPage"));
const GamePreview        = lazy(() => import("./pages/GamePage"));
const TrueFalseGame      = lazy(() => import("./components/TrueFalseGame"));
const TrueFalseGamePage  = lazy(() => import("./pages/TrueFalseGamePage"));
const ExtensionDownloadPage = lazy(() => import("./pages/ExtensionDownloadPage"));
const SocialMediaPage    = lazy(() => import("./pages/SocialMediaPage"));
const SocialAdminPanel   = lazy(() => import("./pages/SocialAdminPanel"));
const TTLiveFeedPage     = lazy(() => import("./pages/TTLiveFeedPage"));
const TTLiveThreadPage   = lazy(() => import("./pages/TTLiveThreadPage"));
const EmailTesterPage    = lazy(() => import("./pages/EmailTesterPage"));
const TutorialGalleryPage = lazy(() => import("./pages/TutorialGalleryPage"));
const AdminPanelPage     = lazy(() => import("./pages/AdminPanelPage"));
const SourceQualityPage  = lazy(() => import("./pages/SourceQualityPage"));
const RatingEvaluationPage = lazy(() => import("./pages/RatingEvaluationPage"));
const LogoutPage         = lazy(() => import("./pages/LogoutPage"));

const PageLoader = () => (
  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "80vh" }}>
    <div style={{ color: "#4fd1c5", fontSize: "1.2rem" }}>Loading…</div>
  </div>
);

const router = createBrowserRouter([
  { path: "/",               element: <LandingPage />,     errorElement: <ErrorPage /> },
  { path: "/login",          element: <Login /> },
  { path: "/forgot-password", element: <ForgotPassword /> },
  { path: "/reset-password", element: <ResetPassword /> },
  { path: "/register",       element: <Register /> },
  { path: "/about",          element: <AboutPage /> },
  { path: "/verify",         element: <VerifyRecordPage /> },
  {
    path: "/",
    element: <VisionLayout />,
    errorElement: <ErrorPage />,
    children: [
      { path: "dashboard",        element: <ProtectedRoute><UserDashboard /></ProtectedRoute> },
      { path: "user-dashboard",   element: <ProtectedRoute><UserDashboard /></ProtectedRoute> },
      { path: "vision-dashboard", element: <ProtectedRoute><VisionDashboard /></ProtectedRoute> },
      { path: "rating-history",   element: <ProtectedRoute><RatingEvaluation /></ProtectedRoute> },
      { path: "tasks",            element: <ProtectedRoute><TaskPage /></ProtectedRoute> },
      { path: "search",           element: <ProtectedRoute><SearchResultsPage /></ProtectedRoute> },
      { path: "credibility",      element: <ProtectedRoute><CredibilityPage /></ProtectedRoute> },
      { path: "claim-duel",       element: <ProtectedRoute><ClaimDuelPage /></ProtectedRoute> },
      { path: "claim-duel/:taskId", element: <ProtectedRoute><ClaimDuelPage /></ProtectedRoute> },
      { path: "casefocus",        element: <ProtectedRoute><CaseFocusPage /></ProtectedRoute> },
      { path: "casefocus/:taskId", element: <ProtectedRoute><CaseFocusPage /></ProtectedRoute> },
      { path: "workspace",        element: <ProtectedRoute><WorkspacePage /></ProtectedRoute> },
      { path: "workspace/:contentId", element: <ProtectedRoute><WorkspacePage /></ProtectedRoute> },
      { path: "gamespace",        element: <ProtectedRoute><GameSpacePage /></ProtectedRoute> },
      { path: "level",            element: <ProtectedRoute><LevelPage /></ProtectedRoute> },
      { path: "molecule",         element: <ProtectedRoute><MoleculeMapPage /></ProtectedRoute> },
      { path: "knowgraph",        element: <ProtectedRoute><KnowGraphPage /></ProtectedRoute> },
      { path: "newknowgraph",     element: <ProtectedRoute><NewKnowGraphPage /></ProtectedRoute> },
      { path: "social-media",     element: <ProtectedRoute><SocialMediaPage /></ProtectedRoute> },
      { path: "admin/social",     element: <ProtectedRoute><SocialAdminPanel /></ProtectedRoute> },
      { path: "ttlive",           element: <ProtectedRoute><TTLiveFeedPage /></ProtectedRoute> },
      { path: "ttlive/thread/:threadId", element: <ProtectedRoute><TTLiveThreadPage /></ProtectedRoute> },
      { path: "quadrantgrid",     element: <ProtectedRoute><QuadrantGridPage /></ProtectedRoute> },
      { path: "discussion/:contentId", element: <ProtectedRoute><DiscussionPage /></ProtectedRoute> },
      { path: "account",          element: <ProtectedRoute><AccountSettingsPage /></ProtectedRoute> },
      { path: "select-user",      element: <ProtectedRoute><UserSelectionPage /></ProtectedRoute> },
      { path: "game",             element: <ProtectedRoute><GamePreview /></ProtectedRoute> },
      { path: "game/truefalse",   element: <ProtectedRoute><TrueFalseGame /></ProtectedRoute> },
      { path: "truefalse",        element: <ProtectedRoute><TrueFalseGamePage /></ProtectedRoute> },
      { path: "extension",        element: <ProtectedRoute><ExtensionDownloadPage /></ProtectedRoute> },
      { path: "textpad",          element: <ProtectedRoute><TextPadPage /></ProtectedRoute> },
      { path: "chat",             element: <ProtectedRoute><ChatPage /></ProtectedRoute> },
      { path: "emailtest",        element: <ProtectedRoute><EmailTesterPage /></ProtectedRoute> },
      { path: "tutorials",        element: <ProtectedRoute><TutorialGalleryPage /></ProtectedRoute> },
      { path: "admin",            element: <ProtectedRoute><AdminPanelPage /></ProtectedRoute> },
      { path: "source-quality/:contentId", element: <ProtectedRoute><SourceQualityPage /></ProtectedRoute> },
      { path: "evaluate-ratings", element: <ProtectedRoute><RatingEvaluationPage /></ProtectedRoute> },
      { path: "logout",           element: <LogoutPage /> },
    ],
  },
]);

export default function AppRouter() {
  useTokenRefresh();
  return (
    <Suspense fallback={<PageLoader />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
