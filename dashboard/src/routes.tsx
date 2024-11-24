import { createBrowserRouter } from "react-router-dom";
import Layout from "./pages/Layout";
import ErrorPage from "./pages/ErrorPage";
import { TaskPage } from "./pages/TaskPage";
import App from "./App";
import TaskDetail from "./components/TaskDetail";
import Dashboard from "./components/Dashboard";
import ForgotPassword from "./components/ForgotPassword";
import Login from "./components/Login";
import Register from "./components/Register";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Login /> },
      { path: "/dashboard", element: <Dashboard /> },
      { path: "/tasks", element: <TaskPage /> },
      { path: "/tasks/:taskId", element: <TaskDetail /> },
      { path: "/forgot-password", element: <ForgotPassword /> },
      { path: "/register", element: <Register /> },
    ],
  },
]);

export default router;
