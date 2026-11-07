/** Tipos dos contratos da API (espelham o backend; a fonte de verdade é a Seção 4 da especificação). */

export type JobStatus = "new" | "prioritized" | "discarded" | "closed";
export type ApplicationStatus =
  "preparing" | "sent" | "interview" | "offer" | "rejected" | "withdrawn";
export type WorkMode = "remote" | "hybrid" | "onsite" | "unknown";
export type ContractType = "internship" | "junior" | "mid" | "senior" | "freelance" | "unknown";

/** Tipos que o usuário pode escolher nas preferências de busca (sem "unknown"). */
export const SEARCH_CONTRACT_TYPES = [
  "internship",
  "junior",
  "mid",
  "senior",
  "freelance",
] as const;
export type SearchContractType = (typeof SEARCH_CONTRACT_TYPES)[number];

/** GET/PUT /preferences — filtros aplicados na próxima coleta. */
export interface SearchPreferences {
  contractTypes: SearchContractType[];
  includeUnknownContractType: boolean;
  updatedAt: string;
}

export interface Job {
  id: number;
  title: string;
  company: string | null;
  location: string | null;
  workMode: WorkMode;
  contractType: ContractType;
  /** source = a fonte informou; title = inferido do título; user = usuário. */
  contractTypeSource: "source" | "title" | "user" | "unknown";
  salaryText: string | null;
  descriptionText: string | null;
  sourceUrl: string | null;
  /** Data de publicação informada pela fonte (null quando não disponível). */
  postedAt: string | null;
  /** Fonte de onde a vaga veio (null = cadastro manual ou assistido). */
  sourceId: number | null;
  /** Identificador estável na fonte, quando a fonte fornece um. */
  externalId: string | null;
  discoveredAt: string;
  status: JobStatus;
  statusChangedAt: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: number;
  jobId: number;
  applicationId: number | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: number;
  jobId: number | null;
  applicationId: number | null;
  type: string;
  actor: string;
  from: string | null;
  to: string | null;
  message: string | null;
  createdAt: string;
}

export interface Application {
  id: number;
  jobId: number;
  status: ApplicationStatus;
  statusChangedAt: string;
  appliedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobDetail extends Job {
  application: Application | null;
  notes: Note[];
  events: Event[];
}

export interface ApplicationListItem extends Application {
  jobTitle: string;
  company: string | null;
  jobStatus: string;
}

export interface ApplicationDetail extends Application {
  job: {
    id: number;
    title: string;
    company: string | null;
    status: string;
    workMode: string;
    contractType: string;
    sourceUrl: string | null;
  };
  notes: Note[];
  events: Event[];
}

export interface Dashboard {
  jobs: { total: number; deleted: number; byStatus: Record<string, number> };
  applications: { total: number; byStatus: Record<string, number> };
  activity: Array<Event & { jobTitle: string | null; company: string | null }>;
}

export interface BackupItem {
  fileName: string;
  sizeBytes: number;
  kind: string;
  createdAt: string;
  existsOnDisk: boolean;
}

export interface RestoreResult {
  restored: true;
  preRestoreBackup: string;
  jobs: number;
  applications: number;
  notes: number;
  events: number;
}

export interface Settings {
  displayName: string;
  timezone: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** GET /extractions/status — se a IA está configurada no backend. */
export interface ExtractionStatus {
  enabled: boolean;
  model: string | null;
  provider: string | null;
}

/** Rascunho devolvido pela extração: campos não identificados vêm null. */
export interface JobDraft {
  title: string | null;
  company: string | null;
  location: string | null;
  workMode: "remote" | "hybrid" | "onsite" | null;
  contractType: "internship" | "junior" | "mid" | "senior" | "freelance" | null;
  salaryText: string | null;
  postedAt: string | null;
  sourceUrl: string | null;
  descriptionText: string | null;
}

export interface DuplicateCandidate {
  id: number;
  title: string;
  company: string | null;
  status: string;
  sourceUrl: string | null;
  reason: "url" | "empresa+titulo";
}

/** POST /extractions/from-text | from-url — prévia, NÃO persiste. */
export interface ExtractionResult {
  draft: JobDraft;
  confidence: "high" | "medium" | "low";
  extractionNotes: string[];
  warnings: string[];
  possibleDuplicates: DuplicateCandidate[];
  meta: {
    provider: string;
    model: string;
    contentSource: "texto" | "url";
    contentLength: number;
  };
}

/** GET /runs — uma execução de coleta (search_runs). */
export interface ExecutionRun {
  id: number;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  discoveredCount: number;
  newCount: number;
  updatedCount: number;
  duplicateCount: number;
  errorCount: number;
  summary: string | null;
}

/** GET /runs/:id — log de uma execução (execution_logs). */
export interface ExecutionLog {
  id: number;
  level: string;
  step: string | null;
  message: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

/** Resumo gravado pela coleta em data/last-run.json (campos conhecidos; pode evoluir). */
export interface LastRunSummary {
  runId?: number;
  status?: string;
  trigger?: string;
  startedAt?: string;
  finishedAt?: string;
  discovered?: number;
  created?: number;
  updated?: number;
  duplicate?: number;
  errors?: number;
  summary?: string;
  [key: string]: unknown;
}

/** GET /runs */
export interface ExecutionsResponse {
  runs: ExecutionRun[];
  lastRun: LastRunSummary | null;
}

/** GET /runs/:id */
export interface ExecutionDetail {
  run: ExecutionRun;
  logs: ExecutionLog[];
}

/** GET /sources */
export interface SourceInfo {
  id: number;
  key: string;
  name: string;
  kind: string;
  enabled: boolean;
  supportState: string;
  verifiedAt: string | null;
  updatedAt: string;
}

/** Perfil profissional — texto extraído do CV + trecho que o comprova. */
export interface QuotedText {
  value: string;
  sourceQuote: string;
}

export type ProfileWorkMode = "remote" | "hybrid" | "onsite";
export type ProfileSkillLevel = "beginner" | "intermediate" | "advanced";

export interface ProfilePersonal {
  fullName: QuotedText | null;
  email: QuotedText | null;
  phone: QuotedText | null;
  location: QuotedText | null;
  linkedinUrl: QuotedText | null;
  githubUrl: QuotedText | null;
  portfolioUrl: QuotedText | null;
  summary: QuotedText | null;
}

export interface ProfileExperience {
  role: string;
  company: string | null;
  start: string | null;
  end: string | null;
  current: boolean;
  highlights: string[];
  sourceQuote: string;
}

export interface ProfileEducation {
  degree: string;
  institution: string;
  year: string | null;
  sourceQuote: string;
}

export interface ProfileSkill {
  name: string;
  level: ProfileSkillLevel | null;
  sourceQuote: string;
}

export interface ProfileLanguage {
  name: string;
  level: string | null;
  sourceQuote: string;
}

export interface ProfileProject {
  name: string;
  url: string | null;
  description: string | null;
  sourceQuote: string;
}

export interface InferredItem {
  field: string;
  value: string;
  reason: string;
  confirmed: boolean;
}

export interface ProfileData {
  personal: ProfilePersonal;
  experiences: ProfileExperience[];
  education: ProfileEducation[];
  skills: ProfileSkill[];
  languages: ProfileLanguage[];
  projects: ProfileProject[];
  inferred: InferredItem[];
}

export interface ProfilePreferences {
  desiredRoles: string[];
  workModes: ProfileWorkMode[];
  locations: string[];
  salaryExpectation: string | null;
  contractTypes: SearchContractType[];
}

export type ProfileAnswers = Record<string, string>;

/** GET/PUT /profile — perfil salvo (a versão 0 indica que nada foi salvo). */
export interface ProfileResponse {
  version: number;
  rawCvText: string | null;
  profile: ProfileData;
  preferences: ProfilePreferences;
  answers: ProfileAnswers;
  hasProfile: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/** POST /profile/cv — prévia, NÃO persiste. */
export interface CvExtractionPreview {
  profile: ProfileData;
  rawText: string;
  warnings: string[];
  discarded: number;
  meta: {
    provider: string;
    model: string;
    fileName: string;
    format: "pdf" | "docx" | "txt";
    contentLength: number;
  };
}

export const PROFILE_WORK_MODE_LABELS: Record<ProfileWorkMode, string> = {
  remote: "Remoto",
  hybrid: "Híbrido",
  onsite: "Presencial",
};

export const PROFILE_SKILL_LEVEL_LABELS: Record<ProfileSkillLevel, string> = {
  beginner: "Básico",
  intermediate: "Intermediário",
  advanced: "Avançado",
};

/** Transições permitidas — espelho das máquinas de estado do backend (validação final é sempre no servidor). */
export const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  new: ["prioritized", "discarded", "closed"],
  prioritized: ["discarded", "closed", "new"],
  discarded: ["new", "closed"],
  closed: ["new"],
};

export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  preparing: ["sent", "withdrawn"],
  sent: ["interview", "offer", "rejected", "withdrawn"],
  interview: ["offer", "rejected", "withdrawn"],
  offer: ["withdrawn"],
  rejected: [],
  withdrawn: ["preparing"],
};
