/**
 * Portais de candidatura (Fase 4 — candidatura assistida).
 *
 * Decisão registrada em 2026-11: os portais-alvo (Gupy, LinkedIn, Indeed e
 * Glassdoor) têm condições de uso que **não permitem** bots/automação de
 * candidatura. Por isso todos são tratados como `manualOnly`: o JobPilot
 * organiza os dados e abre a vaga, mas **nunca envia nada** — o clique em
 * enviar (e o CAPTCHA/login) fica sempre com a pessoa usuária.
 *
 * A detecção é apenas informativa (a partir da URL da vaga) para exibir o
 * portal e o aviso correto na interface.
 */

export interface PortalInfo {
  key: string;
  label: string;
  /** true quando o envio precisa ser feito manualmente pela pessoa usuária. */
  manualOnly: boolean;
  /** Explicação curta exibida na UI. */
  note: string;
}

export const UNKNOWN_PORTAL: PortalInfo = {
  key: "other",
  label: "Outro portal",
  manualOnly: true,
  note: "O JobPilot não envia candidaturas: revise os dados, abra a vaga e clique em enviar você mesmo.",
};

const MANUAL_NOTE =
  "O JobPilot não envia candidaturas: revise os dados, abra a vaga e clique em enviar você mesmo.";

interface PortalDefinition extends PortalInfo {
  /** Domínios do portal (o match aceita subdomínios, ex.: portal.gupy.io). */
  hosts: string[];
}

const PORTALS: PortalDefinition[] = [
  {
    key: "gupy",
    label: "Gupy",
    manualOnly: true,
    note: MANUAL_NOTE,
    hosts: ["gupy.io"],
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    manualOnly: true,
    note: "O contrato de uso do LinkedIn proíbe bots/automação; o JobPilot apenas abre a vaga.",
    hosts: ["linkedin.com"],
  },
  {
    key: "indeed",
    label: "Indeed",
    manualOnly: true,
    note: "O Indeed proíbe automatizar o processo de candidatura; o JobPilot apenas abre a vaga.",
    hosts: ["indeed.com", "indeed.com.br"],
  },
  {
    key: "glassdoor",
    label: "Glassdoor",
    manualOnly: true,
    note: "O Glassdoor proíbe agentes automatizados; o JobPilot apenas abre a vaga.",
    hosts: ["glassdoor.com", "glassdoor.com.br"],
  },
  {
    key: "greenhouse",
    label: "Greenhouse",
    manualOnly: true,
    note: MANUAL_NOTE,
    hosts: ["greenhouse.io"],
  },
  {
    key: "lever",
    label: "Lever",
    manualOnly: true,
    note: MANUAL_NOTE,
    hosts: ["lever.co"],
  },
  {
    key: "ashby",
    label: "Ashby",
    manualOnly: true,
    note: MANUAL_NOTE,
    hosts: ["ashbyhq.com"],
  },
  {
    key: "remotive",
    label: "Remotive",
    manualOnly: true,
    note: MANUAL_NOTE,
    hosts: ["remotive.com"],
  },
  {
    key: "remoteok",
    label: "Remote OK",
    manualOnly: true,
    note: MANUAL_NOTE,
    hosts: ["remoteok.com"],
  },
];

/** Identifica o portal a partir da URL da vaga (sem rede). */
export function detectPortal(url: string | null | undefined): PortalInfo {
  const host = hostnameOf(url);
  if (!host) return UNKNOWN_PORTAL;

  for (const portal of PORTALS) {
    if (portal.hosts.some((known) => host === known || host.endsWith(`.${known}`))) {
      return {
        key: portal.key,
        label: portal.label,
        manualOnly: portal.manualOnly,
        note: portal.note,
      };
    }
  }
  return UNKNOWN_PORTAL;
}

function hostnameOf(url: string | null | undefined): string | null {
  const text = url?.trim();
  if (!text) return null;
  try {
    return new URL(text).hostname.toLowerCase();
  } catch {
    return null;
  }
}
