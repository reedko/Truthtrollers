import { createBrowserRouter } from "react-router-dom";
import Layout from "./pages/Layout";
import ErrorPage from "./pages/ErrorPage";
import { TaskPage } from "./pages/TaskPage";
import TaskDetail from "./pages/TaskDetail";
import VisionDashboard from "./components/Dashboard";
import ForgotPassword from "./components/ForgotPassword";
import Login from "./components/Login";
import Register from "./components/Register";
import { RouterProvider } from "react-router-dom";
import TestCardPage from "./pages/TestCardPage";
import WorkspacePage from "./pages/WorkspacePage";
import MoleculeMapPage from "./pages/MoleculeMapPage";
import DiscussionPage from "./pages/DiscussionPage";
import VisionLayout from "./layout/VisionLayout";

const router = createBrowserRouter([
  {
    path: "/",
    element: <VisionLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Login /> },
      { path: "/dashboard", element: <VisionDashboard /> },
      { path: "/tasks", element: <TaskPage /> }, // TaskPage pulls data from the store
      { path: "/tasks/:taskId", element: <TaskDetail /> }, // TaskDetail also uses the store
      { path: "/forgot-password", element: <ForgotPassword /> },
      { path: "/register", element: <Register /> },
      { path: "/test-card", element: <TestCardPage /> },
      { path: "/workspace", element: <WorkspacePage /> },
      { path: "/molecule", element: <MoleculeMapPage /> },
      { path: "/discussion", element: <DiscussionPage /> },
      { path: "/workspace/:taskId", element: <WorkspacePage /> },
      { path: "/molecule/:taskId", element: <MoleculeMapPage /> },
      { path: "/discussion/:taskId", element: <DiscussionPage /> },
    ],
  },
]);

const AppRouter = () => {
  return <RouterProvider router={router} />;
};

export default AppRouter;
