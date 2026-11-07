import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import Jobs from "./pages/Jobs";
import NewJobAssisted from "./pages/NewJobAssisted";
import Executions from "./pages/Executions";
import JobDetail from "./pages/JobDetail";
import Applications from "./pages/Applications";
import ApplicationDetail from "./pages/ApplicationDetail";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/vagas", element: <Jobs /> },
      { path: "/vagas/nova", element: <NewJobAssisted /> },
      { path: "/vagas/:id", element: <JobDetail /> },
      { path: "/execucoes", element: <Executions /> },
      { path: "/candidaturas", element: <Applications /> },
      { path: "/candidaturas/:id", element: <ApplicationDetail /> },
      { path: "/perfil", element: <ProfilePage /> },
      { path: "/configuracoes", element: <SettingsPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
