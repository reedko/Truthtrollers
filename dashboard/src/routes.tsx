// routes.tsx
import { RouterProvider } from "react-router-dom";
import { createBrowserRouter } from "react-router-dom";
import VisionLayout from "./layout/VisionLayout";
import ErrorPage from "./pages/ErrorPage";
import { TaskPage } from "./pages/TaskPage";
import TaskDetail from "./pages/TaskDetail";
import VisionDashboard from "./components/Dashboard";
import ForgotPassword from "./components/ForgotPassword";
import Login from "./components/Login";
import Register from "./components/Register";
import WorkspacePage from "./pages/WorkspacePage";
import MoleculeMapPage from "./pages/MoleculeMapPage";
import DiscussionPage from "./pages/DiscussionPage";
import ProtectedRoute from "./components/ProtectedRoute";

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
        path: "/tasks/:taskId",
        element: (
          <ProtectedRoute>
            <TaskDetail />
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
        path: "/discussion",
        element: (
          <ProtectedRoute>
            <DiscussionPage />
          </ProtectedRoute>
        ),
      },
    ],
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
