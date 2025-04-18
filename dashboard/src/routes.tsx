import { RouterProvider } from "react-router-dom";

// routes.tsx
import { createBrowserRouter } from "react-router-dom";
import VisionLayout from "./layout/VisionLayout";
import ErrorPage from "./pages/ErrorPage";
import { TaskPage } from "./pages/TaskPage";
import TaskDetail from "./pages/TaskDetail";
import VisionDashboard from "./components/Dashboard";
import ForgotPassword from "./components/ForgotPassword";
import Login from "./components/Login";
import Register from "./components/Register";
import TestCardPage from "./pages/TestCardPage";
import WorkspacePage from "./pages/WorkspacePage";
import MoleculeMapPage from "./pages/MoleculeMapPage";
import DiscussionPage from "./pages/DiscussionPage";

const router = createBrowserRouter([
  {
    path: "/",
    element: <VisionLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Login /> },
      { path: "/dashboard", element: <VisionDashboard /> },
      { path: "/tasks", element: <TaskPage /> },
      { path: "/tasks/:taskId", element: <TaskDetail /> },
      { path: "/forgot-password", element: <ForgotPassword /> },
      { path: "/register", element: <Register /> },
      { path: "/test-card", element: <TestCardPage /> },
      { path: "/workspace", element: <WorkspacePage /> }, // ← no param
      { path: "/molecule", element: <MoleculeMapPage /> },
      { path: "/discussion", element: <DiscussionPage /> },
    ],
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
