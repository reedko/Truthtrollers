import { createBrowserRouter } from "react-router-dom";
import Layout from "./pages/Layout";
import ErrorPage from "./pages/ErrorPage";
import { TaskPage } from "./pages/TaskPage";
import TaskDetail from "./pages/TaskDetail";
import Dashboard from "./components/Dashboard";
import ForgotPassword from "./components/ForgotPassword";
import Login from "./components/Login";
import Register from "./components/Register";
import { RouterProvider } from "react-router-dom";
import TestCardPage from "./pages/TestCardPage";
import WorkspacePage from "./pages/WorkspacePage";
import MoleculeMapPage from "./pages/MoleculeMapPage";
import DiscussionPage from "./pages/DiscussionPage";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Login /> },
      { path: "/dashboard", element: <Dashboard /> },
      { path: "/tasks", element: <TaskPage /> }, // TaskPage pulls data from the store
      { path: "/tasks/:taskId", element: <TaskDetail /> }, // TaskDetail also uses the store
      { path: "/forgot-password", element: <ForgotPassword /> },
      { path: "/register", element: <Register /> },
      { path: "/test-card", element: <TestCardPage /> },
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
