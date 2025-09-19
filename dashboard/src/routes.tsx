// routes.tsx
import { RouterProvider } from "react-router-dom";
import { createBrowserRouter } from "react-router-dom";
import VisionLayout from "./layout/VisionLayout";
import ErrorPage from "./pages/ErrorPage";
import { TaskPage } from "./pages/TaskPage";

import VisionDashboard from "./components/Dashboard";
import ForgotPassword from "./components/ForgotPassword";
import Login from "./components/Login";
import Register from "./components/Register";
import WorkspacePage from "./pages/WorkspacePage";
import MoleculeMapPage from "./pages/MoleculeMapPage";
import DiscussionPage from "./pages/DiscussionPage";
import ProtectedRoute from "./components/ProtectedRoute";
import AccountSettingsPage from "./pages/AccountSettingsPage";
import LogoutPage from "./pages/LogoutPage";
import UserSelectionPage from "./pages/UserSelectionPage";
import GamePreview from "./pages/GamePage";
import TrueFalseGame from "./components/TrueFalseGame";
import ExtensionDownloadPage from "./pages/ExtensionDownloadPage"; // ✅ NEW

const router = createBrowserRouter([
  {
    path: "/",
    element: <VisionLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Login /> },

      { path: "/login", element: <Login /> },
      { path: "/forgot-password", element: <ForgotPassword /> },
      { path: "/register", element: <Register /> },

      // 🔒 Protected Routes
      {
        path: "/dashboard",
        element: (
          <ProtectedRoute>
            <VisionDashboard />
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
        path: "/molecule",
        element: (
          <ProtectedRoute>
            <MoleculeMapPage />
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
        path: "/logout",
        element: <LogoutPage />,
      },
    ],
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
