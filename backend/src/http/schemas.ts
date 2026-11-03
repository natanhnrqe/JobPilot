import { z } from "zod";
import { paginationQuery } from "./middleware/http.js";

export const WORK_MODES = ["remote", "hybrid", "onsite", "unknown"] as const;
export const CONTRACT_TYPES = [
  "internship",
  "junior",
  "mid",
  "senior",
  "freelance",
  "unknown",
] as const;
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
    sort: z.enum(["discovered_at", "title", "company", "status", "created_at"]).optional(),
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
