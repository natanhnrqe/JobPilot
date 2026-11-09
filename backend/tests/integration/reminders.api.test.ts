import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { makeTestServer, type AppServer } from "../helpers.js";

let server: AppServer;
let cleanup: () => void;

beforeAll(() => {
  const created = makeTestServer();
  server = created.server;
  cleanup = created.cleanup;
});

afterAll(() => cleanup());

const DAY_MS = 24 * 60 * 60 * 1000;

async function createApplication(title: string, company?: string) {
  const job = await request(server.app)
    .post("/api/v1/jobs")
    .send({ title, ...(company ? { company } : {}) });
  const app = await request(server.app).post(`/api/v1/jobs/${job.body.id}/application`);
  return { jobId: job.body.id as number, appId: app.body.id as number };
}

describe("Lembretes de acompanhamento (Fase 5.1)", () => {
  it("agenda follow-up pendente e devolve o lembrete", async () => {
    const { appId } = await createApplication("Vaga Lembrete", "Empresa Lembrete");
    const dueAt = new Date(Date.now() + 7 * DAY_MS).toISOString();

    const res = await request(server.app)
      .post(`/api/v1/applications/${appId}/follow-up`)
      .send({ dueAt, message: "Perguntar sobre o processo" });

    expect(res.status).toBe(201);
    expect(res.body.applicationId).toBe(appId);
    expect(res.body.kind).toBe("follow_up");
    expect(res.body.status).toBe("pending");
    expect(res.body.message).toBe("Perguntar sobre o processo");
    expect(res.body.dueAt).toBe(dueAt);
  });

  it("detalhe da candidatura inclui lembretes e evento de criação", async () => {
    const { appId } = await createApplication("Vaga com Histórico");
    const dueAt = new Date(Date.now() + DAY_MS).toISOString();
    const created = await request(server.app)
      .post(`/api/v1/applications/${appId}/follow-up`)
      .send({ dueAt });

    const detail = await request(server.app).get(`/api/v1/applications/${appId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.reminders).toHaveLength(1);
    expect(detail.body.reminders[0].id).toBe(created.body.id);
    expect(
      detail.body.events.some((e: { type: string }) => e.type === "application.reminder_created"),
    ).toBe(true);
  });

  it("conclui o lembrete e registra evento (idempotente)", async () => {
    const { appId } = await createApplication("Vaga Concluída");
    const dueAt = new Date(Date.now() + DAY_MS).toISOString();
    const created = await request(server.app)
      .post(`/api/v1/applications/${appId}/follow-up`)
      .send({ dueAt });

    const done = await request(server.app).post(
      `/api/v1/applications/${appId}/reminders/${created.body.id}/complete`,
    );
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("done");

    // segunda chamada não duplica evento nem falha
    const again = await request(server.app).post(
      `/api/v1/applications/${appId}/reminders/${created.body.id}/complete`,
    );
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("done");

    const detail = await request(server.app).get(`/api/v1/applications/${appId}`);
    const completedEvents = detail.body.events.filter(
      (e: { type: string }) => e.type === "application.reminder_completed",
    );
    expect(completedEvents).toHaveLength(1);
  });

  it("recusa concluir lembrete de outra candidatura (404)", async () => {
    const first = await createApplication("Vaga A");
    const second = await createApplication("Vaga B");
    const dueAt = new Date(Date.now() + DAY_MS).toISOString();
    const created = await request(server.app)
      .post(`/api/v1/applications/${first.appId}/follow-up`)
      .send({ dueAt });

    const res = await request(server.app).post(
      `/api/v1/applications/${second.appId}/reminders/${created.body.id}/complete`,
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("valida dueAt ausente ou inválido (400)", async () => {
    const { appId } = await createApplication("Vaga Validação");

    const missing = await request(server.app)
      .post(`/api/v1/applications/${appId}/follow-up`)
      .send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("VALIDATION_ERROR");

    const invalid = await request(server.app)
      .post(`/api/v1/applications/${appId}/follow-up`)
      .send({ dueAt: "não é data" });
    expect(invalid.status).toBe(400);
  });

  it("aceita data YYYY-MM-DD e normaliza para ISO", async () => {
    const { appId } = await createApplication("Vaga Data Curta");
    const res = await request(server.app)
      .post(`/api/v1/applications/${appId}/follow-up`)
      .send({ dueAt: "2027-01-15" });

    expect(res.status).toBe(201);
    // Fim do dia local escolhido (independente do fuso da máquina de teste).
    expect(new Date(res.body.dueAt).getTime()).toBe(new Date("2027-01-15T23:59:59.999").getTime());
  });

  it("dashboard destaca pendências vencidas e ignora concluídas", async () => {
    const { appId, jobId } = await createApplication("Vaga Dashboard", "Empresa Dash");
    const past = new Date(Date.now() - 2 * DAY_MS).toISOString();
    const future = new Date(Date.now() + 3 * DAY_MS).toISOString();

    const overdue = await request(server.app)
      .post(`/api/v1/applications/${appId}/follow-up`)
      .send({ dueAt: past, message: "Cobrar retorno" });
    await request(server.app)
      .post(`/api/v1/applications/${appId}/follow-up`)
      .send({ dueAt: future });
    const completed = await request(server.app)
      .post(`/api/v1/applications/${appId}/follow-up`)
      .send({ dueAt: past });
    await request(server.app).post(
      `/api/v1/applications/${appId}/reminders/${completed.body.id}/complete`,
    );

    const dash = await request(server.app).get("/api/v1/dashboard");
    expect(dash.status).toBe(200);
    expect(dash.body.reminders.overdue).toBeGreaterThanOrEqual(1);
    expect(dash.body.reminders.pending).toBeGreaterThanOrEqual(2);

    const item = dash.body.reminders.items.find((r: { id: number }) => r.id === overdue.body.id);
    expect(item).toBeTruthy();
    expect(item.overdue).toBe(true);
    expect(item.jobId).toBe(jobId);
    expect(item.jobTitle).toBe("Vaga Dashboard");
    expect(item.company).toBe("Empresa Dash");
    expect(item.applicationStatus).toBe("preparing");
  });

  it("não lista pendências de candidatura excluída", async () => {
    const { appId } = await createApplication("Vaga Excluída");
    const dueAt = new Date(Date.now() + DAY_MS).toISOString();
    const created = await request(server.app)
      .post(`/api/v1/applications/${appId}/follow-up`)
      .send({ dueAt });

    await request(server.app).delete(`/api/v1/applications/${appId}`);

    const dash = await request(server.app).get("/api/v1/dashboard");
    expect(dash.body.reminders.items.some((r: { id: number }) => r.id === created.body.id)).toBe(
      false,
    );
  });
});
