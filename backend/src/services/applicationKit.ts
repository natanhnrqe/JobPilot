import { NotFoundError } from "../domain/errors.js";
import { hasUsableProfile, type AnalysisGap } from "../domain/analysis.js";
import { detectPortal, type PortalInfo } from "../domain/portals.js";
import { getJobRow } from "../repositories/jobs.js";
import { listAnalyses } from "../repositories/analyses.js";
import { getProfile } from "../repositories/profile.js";
import type { ServiceContext } from "./context.js";

/**
 * Kit de candidatura assistida (Fase 4, fatia 1).
 *
 * Reúne, para uma vaga, o que a pessoa precisa para se candidatar
 * manualmente: dados de contato do perfil, respostas padrão salvas, resumo da
 * última análise e uma checklist do que está pronto/faltando.
 *
 * Regra central: o JobPilot **não inventa** nada. Só devolve o que já está
 * salvo no perfil e na vaga — campos ausentes aparecem como pendência.
 * Nenhuma chamada de IA é feita aqui (portanto não consome orçamento).
 */

export type ChecklistStatus = "ok" | "warn" | "missing";

export interface ChecklistItem {
  id: string;
  label: string;
  status: ChecklistStatus;
  hint: string;
}

export interface KitFit {
  version: number;
  score: number;
  recommendApply: boolean;
  confidence: string;
  summary: string;
  gaps: AnalysisGap[];
  missingRequired: string[];
  unknowns: string[];
  createdAt: string;
}

export interface ApplicationKit {
  job: {
    id: number;
    title: string;
    company: string | null;
    location: string | null;
    workMode: string;
    contractType: string;
    salaryText: string | null;
    sourceUrl: string | null;
    status: string;
    descriptionLength: number;
  };
  portal: PortalInfo;
  profile: {
    hasProfile: boolean;
    usable: boolean;
    personal: {
      fullName: string | null;
      email: string | null;
      phone: string | null;
      location: string | null;
      linkedinUrl: string | null;
      githubUrl: string | null;
      portfolioUrl: string | null;
    };
    summary: string | null;
    skills: string[];
    languages: string[];
    experiences: Array<{ role: string; company: string | null; current: boolean }>;
  };
  answers: Array<{ key: string; value: string }>;
  fit: KitFit | null;
  checklist: ChecklistItem[];
}

const MIN_DESCRIPTION_CHARS = 30;

export function buildApplicationKit(ctx: ServiceContext, jobId: number): ApplicationKit {
  const db = ctx.holder.get();
  const job = getJobRow(db, jobId);
  if (!job) throw new NotFoundError(`Vaga ${jobId} não encontrada.`);

  const stored = getProfile(db);
  const usable = stored.hasProfile && hasUsableProfile(stored.profile);

  const latest = listAnalyses(db, jobId, 1)[0];
  const fit: KitFit | null = latest
    ? {
        version: latest.version,
        score: latest.score,
        recommendApply: latest.recommend_apply === 1,
        confidence: latest.confidence,
        summary: latest.summary,
        gaps: safeParse<AnalysisGap>(latest.gaps_json),
        missingRequired: missingRequired(latest.requirements_json),
        unknowns: safeParse<string>(latest.unknowns_json),
        createdAt: latest.created_at,
      }
    : null;

  const personal = stored.profile.personal;
  const profile = {
    hasProfile: stored.hasProfile,
    usable,
    personal: {
      fullName: valueOrNull(personal.fullName),
      email: valueOrNull(personal.email),
      phone: valueOrNull(personal.phone),
      location: valueOrNull(personal.location),
      linkedinUrl: valueOrNull(personal.linkedinUrl),
      githubUrl: valueOrNull(personal.githubUrl),
      portfolioUrl: valueOrNull(personal.portfolioUrl),
    },
    summary: valueOrNull(personal.summary),
    skills: stored.profile.skills.map((skill) => skill.name),
    languages: stored.profile.languages.map((language) => language.name),
    experiences: stored.profile.experiences.slice(0, 20).map((exp) => ({
      role: exp.role,
      company: exp.company,
      current: exp.current,
    })),
  };

  const portal = detectPortal(job.source_url);
  const descriptionLength = job.description_text?.trim().length ?? 0;

  return {
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      workMode: job.work_mode,
      contractType: job.contract_type,
      salaryText: job.salary_text,
      sourceUrl: job.source_url,
      status: job.status,
      descriptionLength,
    },
    portal,
    profile,
    answers: Object.entries(stored.answers).map(([key, value]) => ({ key, value })),
    fit,
    checklist: buildChecklist({
      hasProfile: stored.hasProfile,
      usable,
      hasContact: Boolean(personal.email || personal.phone),
      hasLink: Boolean(personal.linkedinUrl || personal.githubUrl || personal.portfolioUrl),
      hasSourceUrl: Boolean(job.source_url),
      descriptionLength,
      hasAnalysis: fit !== null,
      jobStatus: job.status,
    }),
  };
}

interface ChecklistInput {
  hasProfile: boolean;
  usable: boolean;
  hasContact: boolean;
  hasLink: boolean;
  hasSourceUrl: boolean;
  descriptionLength: number;
  hasAnalysis: boolean;
  jobStatus: string;
}

function buildChecklist(input: ChecklistInput): ChecklistItem[] {
  const items: ChecklistItem[] = [
    {
      id: "profile",
      label: "Perfil profissional preenchido",
      status: input.usable ? "ok" : input.hasProfile ? "warn" : "missing",
      hint: input.usable
        ? "Há experiências, formação, habilidades ou resumo salvos."
        : "Importe o currículo ou preencha o perfil em Perfil.",
    },
    {
      id: "contact",
      label: "E-mail ou telefone para contato",
      status: input.hasContact ? "ok" : "missing",
      hint: "Os formulários costumam exigir um contato direto.",
    },
    {
      id: "links",
      label: "LinkedIn ou portfólio",
      status: input.hasLink ? "ok" : "warn",
      hint: "Opcional, mas ajuda o recrutador a conhecer seu trabalho.",
    },
    {
      id: "sourceUrl",
      label: "Link da vaga",
      status: input.hasSourceUrl ? "ok" : "missing",
      hint: "Sem o link não dá para abrir a página de candidatura.",
    },
    {
      id: "description",
      label: "Descrição da vaga",
      status:
        input.descriptionLength >= MIN_DESCRIPTION_CHARS
          ? "ok"
          : input.descriptionLength > 0
            ? "warn"
            : "missing",
      hint: "Repare nos requisitos obrigatórios antes de enviar.",
    },
    {
      id: "analysis",
      label: "Análise de compatibilidade",
      status: input.hasAnalysis ? "ok" : "warn",
      hint: "Rode a análise para revisar requisitos, lacunas e a sugestão.",
    },
    {
      id: "jobStatus",
      label: "Vaga aberta para candidatura",
      status: input.jobStatus === "discarded" || input.jobStatus === "closed" ? "warn" : "ok",
      hint: "Vagas descartadas ou encerradas não deveriam receber candidatura.",
    },
  ];
  return items;
}

function valueOrNull(field: { value: string } | null): string | null {
  const value = field?.value?.trim();
  return value ? value : null;
}

function safeParse<T>(raw: string): T[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** Requisitos obrigatórios que o perfil não atende (`match === "missing"`). */
function missingRequired(requirementsJson: string): string[] {
  const requirements = safeParse<{ text?: unknown; kind?: unknown; match?: unknown }>(
    requirementsJson,
  );
  return requirements
    .filter((item) => item.kind === "required" && item.match === "missing")
    .map((item) => (typeof item.text === "string" ? item.text : ""))
    .filter((text) => text !== "");
}
