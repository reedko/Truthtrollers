// routes.tsx
import { RouterProvider } from "react-router-dom";
import { createBrowserRouter } from "react-router-dom";
import VisionLayout from "./layout/VisionLayout";
import ErrorPage from "./pages/ErrorPage";
import { TaskPage } from "./pages/TaskPage";

import VisionDashboard from "./components/Dashboard";
import UserDashboard from "./components/UserDashboard";
import RatingEvaluation from "./components/RatingEvaluation";
import ForgotPassword from "./components/ForgotPassword";
import ResetPassword from "./components/ResetPassword";
import Login from "./components/Login";
import Register from "./components/Register";
import WorkspacePage from "./pages/WorkspacePage";
import MoleculeMapPage from "./pages/MoleculeMapPage";
import QuadrantGridPage from "./pages/QuadrantGridPage";
import DiscussionPage from "./pages/DiscussionPage";
import ChatPage from "./pages/ChatPage";
import ProtectedRoute from "./components/ProtectedRoute";
import AccountSettingsPage from "./pages/AccountSettingsPage";
import LogoutPage from "./pages/LogoutPage";
import UserSelectionPage from "./pages/UserSelectionPage";
import GamePreview from "./pages/GamePage";
import TrueFalseGame from "./components/TrueFalseGame";
import ExtensionDownloadPage from "./pages/ExtensionDownloadPage"; // ✅ NEW
import GameSpacePage from "./pages/GameSpacePage";
import LevelPage from "./pages/LevelPage";
import TextPadPage from "./pages/TextPadPage";
import EmailTesterPage from "./pages/EmailTesterPage";

const router = createBrowserRouter([
  {
    path: "/",
    element: <VisionLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Login /> },

      { path: "/login", element: <Login /> },
      { path: "/forgot-password", element: <ForgotPassword /> },
      { path: "/reset-password", element: <ResetPassword /> },
      { path: "/register", element: <Register /> },

      // 🔒 Protected Routes
      {
        path: "/dashboard",
        element: (
          <ProtectedRoute>
            <UserDashboard />
          </ProtectedRoute>
        ),
      },
      {
        path: "/user-dashboard",
        element: (
          <ProtectedRoute>
            <UserDashboard />
          </ProtectedRoute>
        ),
      },
      {
        path: "/vision-dashboard",
        element: (
          <ProtectedRoute>
            <VisionDashboard />
          </ProtectedRoute>
        ),
      },
      {
        path: "/evaluate-ratings",
        element: (
          <ProtectedRoute>
            <RatingEvaluation />
          </ProtectedRoute>
        ),
      },
      {
        path: "/tasks",
        element: (
          <ProtectedRoute>
            <TaskPage />
          </ProtectedRoute>
        ),
      },

      {
        path: "/workspace",
        element: (
          <ProtectedRoute>
            <WorkspacePage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/workspace/:contentId",
        element: (
          <ProtectedRoute>
            <WorkspacePage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/gamespace",
        element: (
          <ProtectedRoute>
            <GameSpacePage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/level",
        element: (
          <ProtectedRoute>
            <LevelPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/molecule",
        element: (
          <ProtectedRoute>
            <MoleculeMapPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/quadrantgrid",
        element: (
          <ProtectedRoute>
            <QuadrantGridPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/discussion/:contentId",
        element: (
          <ProtectedRoute>
            <DiscussionPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/account",
        element: (
          <ProtectedRoute>
            <AccountSettingsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/select-user",
        element: (
          <ProtectedRoute>
            <UserSelectionPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/game",
        element: (
          <ProtectedRoute>
            <GamePreview />
          </ProtectedRoute>
        ),
      },
      {
        path: "/game/truefalse",
        element: (
          <ProtectedRoute>
            <TrueFalseGame />
          </ProtectedRoute>
        ),
      },
      {
        path: "/extension", // ✅ NEW
        element: (
          <ProtectedRoute>
            <ExtensionDownloadPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/textpad",
        element: (
          <ProtectedRoute>
            <TextPadPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/chat",
        element: (
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/emailtest",
        element: (
          <ProtectedRoute>
            <EmailTesterPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "/logout",
        element: <LogoutPage />,
      },
    ],
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
