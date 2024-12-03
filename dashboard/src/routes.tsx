import { createBrowserRouter } from "react-router-dom";
import { useState } from "react";
import Layout from "./pages/Layout";
import ErrorPage from "./pages/ErrorPage";
import { TaskPage } from "./pages/TaskPage";
import TaskDetail from "./pages/TaskDetail";
import Dashboard from "./components/Dashboard";
import ForgotPassword from "./components/ForgotPassword";
import Login from "./components/Login";
import Register from "./components/Register";
import { RouterProvider } from "react-router-dom";
const RouterWithState = () => {
  const [taskUsers, setTaskUsers] = useState<{ [taskId: number]: string[] }>(
    {}
  );

  const router = createBrowserRouter([
    {
      path: "/",
      element: <Layout />,
      errorElement: <ErrorPage />,
      children: [
        { index: true, element: <Login /> },
        { path: "/dashboard", element: <Dashboard /> },
        {
          path: "/tasks",
          element: (
            <TaskPage taskUsers={taskUsers} setTaskUsers={setTaskUsers} />
          ),
        },
        {
          path: "/tasks/:taskId",
          element: (
            <TaskDetail taskUsers={taskUsers} setTaskUsers={setTaskUsers} />
          ),
        },
        { path: "/forgot-password", element: <ForgotPassword /> },
        { path: "/register", element: <Register /> },
      ],
    },
  ]);

  return <RouterProvider router={router} />;
};

export default RouterWithState;
