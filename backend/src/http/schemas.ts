import { z } from "zod";
import { paginationQuery } from "./middleware/http.js";
import { CONTRACT_TYPES as BASE_CONTRACT_TYPES } from "../domain/contractType.js";
import { PROFILE_WORK_MODES, SKILL_LEVELS } from "../domain/profile.js";

export const WORK_MODES = ["remote", "hybrid", "onsite", "unknown"] as const;
export const CONTRACT_TYPES = [...BASE_CONTRACT_TYPES, "unknown"] as const;
export const JOB_STATUSES_API = ["new", "prioritized", "discarded", "closed"] as const;
export const APPLICATION_STATUSES_API = [
  "preparing",
  "sent",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
] as const;

/** Campo opcional: string vazia vira undefined (o usuário não informou). */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? undefined : v))
    .optional()
    .nullable();

export const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v === "" ? undefined : v))
  .refine((v) => v === undefined || /^https?:\/\//i.test(v), {
    message: "A URL deve começar com http:// ou https://",
  })
  .optional()
  .nullable();

export const optionalIsoDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .refine((v) => v === undefined || !Number.isNaN(new Date(v).getTime()), {
    message: "Data inválida (use ISO 8601, ex.: 2026-11-03)",
  })
  .optional();

export const createJobSchema = z.object({
  title: z.string().trim().min(1, "O título é obrigatório.").max(300),
  company: optionalText(200),
  location: optionalText(200),
  workMode: z.enum(WORK_MODES).optional(),
  contractType: z.enum(CONTRACT_TYPES).optional(),
  salaryText: optionalText(200),
  descriptionText: optionalText(20000),
  sourceUrl: optionalUrl,
  /** Data de publicação informada pela fonte (nunca a data atual — ver migração 002). */
  postedAt: optionalIsoDate.nullable(),
  discoveredAt: optionalIsoDate,
});

export const updateJobSchema = createJobSchema.partial().extend({
  status: z.enum(JOB_STATUSES_API).optional(),
});

export const updateApplicationSchema = z
  .object({
    status: z.enum(APPLICATION_STATUSES_API).optional(),
    appliedAt: z.union([z.string(), z.null()]).optional(),
  })
  .refine((data) => data.status !== undefined || data.appliedAt !== undefined, {
    message: "Informe ao menos um campo (status ou appliedAt).",
  });

export const createNoteSchema = z.object({
  body: z.string().trim().min(1, "A nota não pode ser vazia.").max(5000),
  applicationId: z.coerce.number().int().positive().optional(),
});

export const updateNoteSchema = z.object({
  body: z.string().trim().min(1, "A nota não pode ser vazia.").max(5000),
});

export const settingsSchema = z
  .object({
    displayName: z.string().trim().max(100).optional(),
    timezone: z.string().trim().max(60).optional(),
  })
  .refine((d) => d.displayName !== undefined || d.timezone !== undefined, {
    message: "Informe ao menos uma configuração.",
  });

export const preferencesSchema = z
  .object({
    /** Vazio = não filtra por tipo de contrato. */
    contractTypes: z.array(z.enum(BASE_CONTRACT_TYPES)).max(BASE_CONTRACT_TYPES.length).optional(),
    includeUnknownContractType: z.boolean().optional(),
  })
  .refine(
    (data) => data.contractTypes !== undefined || data.includeUnknownContractType !== undefined,
    { message: "Informe ao menos uma preferência." },
  );

const quotedTextSchema = z.object({
  value: z.string().trim().min(1).max(2000),
  /** Trecho do CV que comprova o valor; vazio em dados editados manualmente. */
  sourceQuote: z.string().trim().max(2000).default(""),
});

const personalFieldSchema = quotedTextSchema.nullable();

/** Perfil revisado pelo usuário (mesmo formato devolvido por POST /profile/cv). */
export const profileDataSchema = z.object({
  personal: z.object({
    fullName: personalFieldSchema,
    email: personalFieldSchema,
    phone: personalFieldSchema,
    location: personalFieldSchema,
    linkedinUrl: personalFieldSchema,
    githubUrl: personalFieldSchema,
    portfolioUrl: personalFieldSchema,
    summary: personalFieldSchema,
  }),
  experiences: z
    .array(
      z.object({
        role: z.string().trim().min(1).max(200),
        company: z.string().trim().max(200).nullable(),
        start: z.string().trim().max(20).nullable(),
        end: z.string().trim().max(20).nullable(),
        current: z.boolean(),
        highlights: z.array(z.string().trim().max(1000)).max(20),
        sourceQuote: z.string().trim().max(2000).default(""),
      }),
    )
    .max(50),
  education: z
    .array(
      z.object({
        degree: z.string().trim().max(200),
        institution: z.string().trim().max(200),
        year: z.string().trim().max(40).nullable(),
        sourceQuote: z.string().trim().max(2000).default(""),
      }),
    )
    .max(50),
  skills: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        level: z.enum(SKILL_LEVELS).nullable(),
        sourceQuote: z.string().trim().max(2000).default(""),
      }),
    )
    .max(100),
  languages: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        level: z.string().trim().max(100).nullable(),
        sourceQuote: z.string().trim().max(2000).default(""),
      }),
    )
    .max(30),
  projects: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        url: z.string().trim().max(2000).nullable(),
        description: z.string().trim().max(2000).nullable(),
        sourceQuote: z.string().trim().max(2000).default(""),
      }),
    )
    .max(50),
  inferred: z
    .array(
      z.object({
        field: z.string().trim().min(1).max(100),
        value: z.string().trim().min(1).max(300),
        reason: z.string().trim().min(1).max(500),
        confirmed: z.boolean(),
      }),
    )
    .max(50),
});

export const profilePreferencesSchema = z.object({
  desiredRoles: z.array(z.string().trim().min(1).max(100)).max(20),
  workModes: z.array(z.enum(PROFILE_WORK_MODES)).max(PROFILE_WORK_MODES.length),
  locations: z.array(z.string().trim().min(1).max(100)).max(20),
  salaryExpectation: z.string().trim().max(200).nullable(),
  contractTypes: z.array(z.enum(BASE_CONTRACT_TYPES)).max(BASE_CONTRACT_TYPES.length),
});

export const profileAnswersSchema = z.record(
  z.string().min(1).max(100),
  z.string().trim().max(2000),
);

export const cvUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  /** Conteúdo do arquivo em base64 (limite de 5 MB validado após decodificar). */
  contentBase64: z.string().min(1).max(8_000_000),
});

export const confirmProfileSchema = z.object({
  rawCvText: z.string().trim().min(1).max(200_000),
  profile: profileDataSchema,
  preferences: profilePreferencesSchema.optional(),
  answers: profileAnswersSchema.optional(),
});

export const updateProfileSchema = z
  .object({
    profile: profileDataSchema.optional(),
    preferences: profilePreferencesSchema.optional(),
    answers: profileAnswersSchema.optional(),
  })
  .refine(
    (data) =>
      data.profile !== undefined || data.preferences !== undefined || data.answers !== undefined,
    { message: "Informe ao menos uma parte do perfil para salvar." },
  );

export const restoreSchema = z.object({
  fileName: z.string().trim().min(1),
  confirm: z.literal(true, {
    message: 'A restauração exige {"confirm": true}.',
  }),
});

export const listJobsQuery = z
  .object({
    status: z.enum(JOB_STATUSES_API).optional(),
    workMode: z.enum(WORK_MODES).optional(),
    contractType: z.enum(CONTRACT_TYPES).optional(),
    q: z.string().trim().max(200).optional(),
    includeDeleted: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    sort: z
      .enum(["discovered_at", "title", "company", "status", "created_at", "priority", "score"])
      .optional(),
  })
  .merge(paginationQuery);

export const listApplicationsQuery = z
  .object({
    status: z.enum(APPLICATION_STATUSES_API).optional(),
    q: z.string().trim().max(200).optional(),
    includeDeleted: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
  })
  .merge(paginationQuery);
