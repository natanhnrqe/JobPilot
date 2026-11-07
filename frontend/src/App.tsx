import { Link, NavLink, Outlet } from "react-router-dom";
import { useFetch } from "./lib/useFetch";
import type { Settings } from "./api/types";
import { setTimezone } from "./lib/format";

/** Layout principal + carregamento das configurações (fuso horário) antes de exibir conteúdo. */
export default function App() {
  const { data: settings, error, loading } = useFetch<Settings>("/settings");

  if (settings) setTimezone(settings.timezone);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          JobPilot
        </Link>
        <nav>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/vagas">Vagas</NavLink>
          <NavLink to="/candidaturas">Candidaturas</NavLink>
          <NavLink to="/perfil">Perfil</NavLink>
          <NavLink to="/execucoes">Execuções</NavLink>
          <NavLink to="/configuracoes">Configurações</NavLink>
        </nav>
        {settings && <span className="user-name">{settings.displayName}</span>}
      </header>

      <main className="content">
        {error && (
          <div className="alert alert-error">
            Falha ao carregar configurações: {error.message}. Verifique se o backend está em
            execução.
          </div>
        )}
        {loading && !settings ? <p className="muted">Carregando…</p> : <Outlet />}
      </main>

      <footer className="footer">
        JobPilot Marco 1 — aplicação local. Banco e backups ficam em <code>data/</code>.
      </footer>
    </div>
  );
}
