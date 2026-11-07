import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import {
  PROFILE_SKILL_LEVEL_LABELS,
  PROFILE_WORK_MODE_LABELS,
  SEARCH_CONTRACT_TYPES,
  type CvExtractionPreview,
  type ExtractionStatus,
  type ProfileAnswers,
  type ProfileData,
  type ProfileEducation,
  type ProfileExperience,
  type ProfileLanguage,
  type ProfilePersonal,
  type ProfilePreferences,
  type ProfileProject,
  type ProfileResponse,
  type ProfileSkill,
  type ProfileSkillLevel,
  type ProfileWorkMode,
  type QuotedText,
  type SearchContractType,
} from "../api/types";
import { CONTRACT_TYPE_LABELS, formatDateTime } from "../lib/format";
import { errorMessage, useFetch } from "../lib/useFetch";

const PERSONAL_FIELDS: Array<keyof ProfilePersonal> = [
  "fullName",
  "email",
  "phone",
  "location",
  "linkedinUrl",
  "githubUrl",
  "portfolioUrl",
  "summary",
];

const WORK_MODES: ProfileWorkMode[] = ["remote", "hybrid", "onsite"];

function emptyProfile(): ProfileData {
  return {
    personal: {
      fullName: null,
      email: null,
      phone: null,
      location: null,
      linkedinUrl: null,
      githubUrl: null,
      portfolioUrl: null,
      summary: null,
    },
    experiences: [],
    education: [],
    skills: [],
    languages: [],
    projects: [],
    inferred: [],
  };
}

function emptyPreferences(): ProfilePreferences {
  return {
    desiredRoles: [],
    workModes: [],
    locations: [],
    salaryExpectation: null,
    contractTypes: [],
  };
}

function updateAt<T>(items: T[], index: number, patch: Partial<T>): T[] {
  return items.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

function cleanPersonal(personal: ProfilePersonal): ProfilePersonal {
  const result = { ...personal };
  for (const field of PERSONAL_FIELDS) {
    const item = result[field];
    if (!item || item.value.trim() === "") {
      result[field] = null;
    } else {
      result[field] = { value: item.value.trim(), sourceQuote: item.sourceQuote.trim() };
    }
  }
  return result;
}

function cleanProfile(profile: ProfileData): ProfileData {
  return {
    personal: cleanPersonal(profile.personal),
    experiences: profile.experiences
      .filter((item) => item.role.trim() !== "")
      .map((item) => ({
        ...item,
        role: item.role.trim(),
        company: item.company?.trim() || null,
        start: item.start?.trim() || null,
        end: item.current ? null : item.end?.trim() || null,
        highlights: item.highlights.map((h) => h.trim()).filter((h) => h !== ""),
        sourceQuote: item.sourceQuote.trim(),
      })),
    education: profile.education
      .filter((item) => item.degree.trim() !== "" || item.institution.trim() !== "")
      .map((item) => ({
        ...item,
        degree: item.degree.trim(),
        institution: item.institution.trim(),
        year: item.year?.trim() || null,
        sourceQuote: item.sourceQuote.trim(),
      })),
    skills: profile.skills
      .filter((item) => item.name.trim() !== "")
      .map((item) => ({ ...item, name: item.name.trim(), sourceQuote: item.sourceQuote.trim() })),
    languages: profile.languages
      .filter((item) => item.name.trim() !== "")
      .map((item) => ({
        ...item,
        name: item.name.trim(),
        level: item.level?.trim() || null,
        sourceQuote: item.sourceQuote.trim(),
      })),
    projects: profile.projects
      .filter((item) => item.name.trim() !== "")
      .map((item) => ({
        ...item,
        name: item.name.trim(),
        url: item.url?.trim() || null,
        description: item.description?.trim() || null,
        sourceQuote: item.sourceQuote.trim(),
      })),
    inferred: profile.inferred,
  };
}

function cleanPreferences(preferences: ProfilePreferences): ProfilePreferences {
  return {
    desiredRoles: preferences.desiredRoles.map((item) => item.trim()).filter((item) => item !== ""),
    workModes: preferences.workModes,
    locations: preferences.locations.map((item) => item.trim()).filter((item) => item !== ""),
    salaryExpectation: preferences.salaryExpectation?.trim() || null,
    contractTypes: preferences.contractTypes,
  };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Não foi possível ler o arquivo selecionado."));
        return;
      }
      const comma = reader.result.indexOf(",");
      resolve(comma >= 0 ? reader.result.slice(comma + 1) : reader.result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

export default function ProfilePage() {
  const profileState = useFetch<ProfileResponse>("/profile");
  const aiStatus = useFetch<ExtractionStatus>("/extractions/status");

  const [profile, setProfile] = useState<ProfileData>(emptyProfile);
  const [preferences, setPreferences] = useState<ProfilePreferences>(emptyPreferences);
  const [answers, setAnswers] = useState<Array<{ key: string; value: string }>>([]);
  const [rawCvText, setRawCvText] = useState<string | null>(null);
  const [preview, setPreview] = useState<CvExtractionPreview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profileState.data) return;
    setProfile(profileState.data.profile);
    setPreferences(profileState.data.preferences);
    setAnswers(Object.entries(profileState.data.answers).map(([key, value]) => ({ key, value })));
    setRawCvText(profileState.data.rawCvText);
    setPreview(null);
  }, [profileState.data]);

  async function run(fn: () => Promise<string>, opts: { reload?: boolean } = {}) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await fn());
      if (opts.reload !== false) profileState.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function importCv() {
    if (!file) {
      setError("Escolha um arquivo PDF, DOCX ou TXT antes de extrair.");
      return;
    }
    void run(
      async () => {
        const contentBase64 = await readFileAsBase64(file);
        const result = await api.post<CvExtractionPreview>("/profile/cv", {
          fileName: file.name,
          contentBase64,
        });
        setPreview(result);
        setProfile(result.profile);
        setRawCvText(result.rawText);
        return `Prévia gerada a partir de ${result.meta.fileName}. Revise os dados e confirme para salvar.`;
      },
      { reload: false },
    );
  }

  function confirmCv() {
    if (!rawCvText) {
      setError("Importe um currículo antes de confirmar.");
      return;
    }
    const pending = profile.inferred.filter((item) => !item.confirmed);
    if (pending.length > 0) {
      setError("Confirme ou remova os itens inferidos pela IA antes de salvar o perfil.");
      return;
    }
    void run(async () => {
      await api.post<ProfileResponse>("/profile/cv/confirm", {
        rawCvText,
        profile: cleanProfile(profile),
        preferences: cleanPreferences(preferences),
        answers: answersToObject(),
      });
      setPreview(null);
      return "Perfil confirmado e salvo.";
    });
  }

  function saveProfile() {
    void run(async () => {
      await api.put<ProfileResponse>("/profile", {
        profile: cleanProfile(profile),
        preferences: cleanPreferences(preferences),
        answers: answersToObject(),
      });
      return "Perfil salvo.";
    });
  }

  function answersToObject(): ProfileAnswers {
    const result: ProfileAnswers = {};
    for (const answer of answers) {
      const key = answer.key.trim();
      if (key !== "") result[key] = answer.value;
    }
    return result;
  }

  function setPersonal(field: keyof ProfilePersonal, value: string) {
    setProfile((current) => ({
      ...current,
      personal: {
        ...current.personal,
        [field]:
          value === "" ? null : { value, sourceQuote: current.personal[field]?.sourceQuote ?? "" },
      },
    }));
  }

  function updateExperience(index: number, patch: Partial<ProfileExperience>) {
    setProfile((current) => ({
      ...current,
      experiences: updateAt(current.experiences, index, patch),
    }));
  }

  function addExperience() {
    setProfile((current) => ({
      ...current,
      experiences: [
        ...current.experiences,
        {
          role: "",
          company: null,
          start: null,
          end: null,
          current: false,
          highlights: [],
          sourceQuote: "",
        },
      ],
    }));
  }

  function updateEducation(index: number, patch: Partial<ProfileEducation>) {
    setProfile((current) => ({
      ...current,
      education: updateAt(current.education, index, patch),
    }));
  }

  function addEducation() {
    setProfile((current) => ({
      ...current,
      education: [
        ...current.education,
        { degree: "", institution: "", year: null, sourceQuote: "" },
      ],
    }));
  }

  function updateSkill(index: number, patch: Partial<ProfileSkill>) {
    setProfile((current) => ({
      ...current,
      skills: updateAt(current.skills, index, patch),
    }));
  }

  function addSkill() {
    setProfile((current) => ({
      ...current,
      skills: [...current.skills, { name: "", level: null, sourceQuote: "" }],
    }));
  }

  function updateLanguage(index: number, patch: Partial<ProfileLanguage>) {
    setProfile((current) => ({
      ...current,
      languages: updateAt(current.languages, index, patch),
    }));
  }

  function addLanguage() {
    setProfile((current) => ({
      ...current,
      languages: [...current.languages, { name: "", level: null, sourceQuote: "" }],
    }));
  }

  function updateProject(index: number, patch: Partial<ProfileProject>) {
    setProfile((current) => ({
      ...current,
      projects: updateAt(current.projects, index, patch),
    }));
  }

  function addProject() {
    setProfile((current) => ({
      ...current,
      projects: [...current.projects, { name: "", url: null, description: null, sourceQuote: "" }],
    }));
  }

  function toggleWorkMode(mode: ProfileWorkMode) {
    setPreferences((current) => ({
      ...current,
      workModes: current.workModes.includes(mode)
        ? current.workModes.filter((item) => item !== mode)
        : [...current.workModes, mode],
    }));
  }

  function toggleContractType(type: SearchContractType) {
    setPreferences((current) => ({
      ...current,
      contractTypes: current.contractTypes.includes(type)
        ? current.contractTypes.filter((item) => item !== type)
        : [...current.contractTypes, type],
    }));
  }

  const aiEnabled = aiStatus.data?.enabled ?? false;
  const loading = profileState.loading && !profileState.data;
  const pendingInferred = profile.inferred.filter((item) => !item.confirmed).length;

  return (
    <div>
      <h1>Perfil profissional</h1>
      <p className="muted">
        Importe seu currículo (PDF, DOCX ou TXT), revise o que a IA extraiu e confirme. A IA não
        inventa dados: todo item precisa de um trecho do CV. O arquivo original não é armazenado —
        apenas o texto extraído fica no banco local.
      </p>

      {message && <div className="alert alert-ok">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {profileState.error && (
        <div className="alert alert-error">
          Falha ao carregar o perfil: {profileState.error.message}
        </div>
      )}
      {aiStatus.error && (
        <div className="alert alert-error">Falha ao verificar a IA: {aiStatus.error.message}</div>
      )}

      {loading ? (
        <p className="muted">Carregando perfil…</p>
      ) : (
        <>
          <section className="panel">
            <h2>Importar currículo</h2>
            <p className="muted small">
              Formatos aceitos: PDF, DOCX e TXT (até 5 MB). PDFs digitalizados sem texto precisam de
              OCR antes da importação.
            </p>
            {aiStatus.data && !aiEnabled && (
              <div className="alert alert-error">
                A IA não está configurada. Defina <code>AI_API_KEY</code> no arquivo{" "}
                <code>.env</code> e reinicie o backend para importar currículos. Você ainda pode
                preencher o perfil manualmente abaixo.
              </div>
            )}
            <label>
              Arquivo do currículo
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <button onClick={importCv} disabled={busy || !file || !aiEnabled}>
              {busy ? "Processando…" : "Extrair com IA"}
            </button>
            {preview && (
              <p className="muted small">
                Prévia de <strong>{preview.meta.fileName}</strong> (
                {preview.meta.format.toUpperCase()}, {preview.meta.contentLength} caracteres
                extraídos, modelo {preview.meta.model}). Nada foi salvo ainda.
              </p>
            )}
            {rawCvText && (
              <details>
                <summary>Ver texto extraído do CV</summary>
                <pre className="cv-text">{rawCvText}</pre>
              </details>
            )}
          </section>

          {preview && preview.warnings.length > 0 && (
            <section className="panel">
              <h2>Pontos de atenção da extração</h2>
              <ul>
                {preview.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
              <p className="muted small">
                {preview.discarded} item(ns) sem citação foram descartados. Corrija ou complete os
                dados abaixo antes de confirmar.
              </p>
            </section>
          )}

          <section className="panel">
            <h2>Dados pessoais</h2>
            <div className="profile-grid">
              <QuotedField
                label="Nome completo"
                value={profile.personal.fullName}
                onChange={(value) => setPersonal("fullName", value)}
              />
              <QuotedField
                label="E-mail"
                value={profile.personal.email}
                onChange={(value) => setPersonal("email", value)}
              />
              <QuotedField
                label="Telefone"
                value={profile.personal.phone}
                onChange={(value) => setPersonal("phone", value)}
              />
              <QuotedField
                label="Localização"
                value={profile.personal.location}
                onChange={(value) => setPersonal("location", value)}
              />
              <QuotedField
                label="LinkedIn"
                value={profile.personal.linkedinUrl}
                onChange={(value) => setPersonal("linkedinUrl", value)}
                placeholder="https://linkedin.com/in/…"
              />
              <QuotedField
                label="GitHub"
                value={profile.personal.githubUrl}
                onChange={(value) => setPersonal("githubUrl", value)}
                placeholder="https://github.com/…"
              />
              <QuotedField
                label="Portfólio"
                value={profile.personal.portfolioUrl}
                onChange={(value) => setPersonal("portfolioUrl", value)}
                placeholder="https://…"
              />
            </div>
            <QuotedField
              label="Resumo profissional"
              value={profile.personal.summary}
              onChange={(value) => setPersonal("summary", value)}
              multiline
            />
          </section>

          <section className="panel">
            <h2>Experiências profissionais</h2>
            {profile.experiences.length === 0 && (
              <p className="muted">Nenhuma experiência adicionada.</p>
            )}
            {profile.experiences.map((experience, index) => (
              <ItemCard
                key={index}
                title={experience.role || `Experiência ${index + 1}`}
                onRemove={() =>
                  setProfile((current) => ({
                    ...current,
                    experiences: current.experiences.filter((_, i) => i !== index),
                  }))
                }
              >
                <div className="profile-grid">
                  <label>
                    Cargo
                    <input
                      value={experience.role}
                      onChange={(e) => updateExperience(index, { role: e.target.value })}
                    />
                  </label>
                  <label>
                    Empresa
                    <input
                      value={experience.company ?? ""}
                      onChange={(e) => updateExperience(index, { company: e.target.value || null })}
                    />
                  </label>
                  <label>
                    Início (AAAA-MM)
                    <input
                      value={experience.start ?? ""}
                      onChange={(e) => updateExperience(index, { start: e.target.value || null })}
                    />
                  </label>
                  <label>
                    Fim (AAAA-MM)
                    <input
                      value={experience.end ?? ""}
                      disabled={experience.current}
                      onChange={(e) => updateExperience(index, { end: e.target.value || null })}
                    />
                  </label>
                </div>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={experience.current}
                    onChange={(e) =>
                      updateExperience(index, {
                        current: e.target.checked,
                        end: e.target.checked ? null : experience.end,
                      })
                    }
                  />
                  Vínculo atual
                </label>
                <label>
                  Destaques (um por linha)
                  <textarea
                    value={experience.highlights.join("\n")}
                    onChange={(e) =>
                      updateExperience(index, { highlights: e.target.value.split("\n") })
                    }
                  />
                </label>
                <SourceQuote quote={experience.sourceQuote} />
              </ItemCard>
            ))}
            <button type="button" onClick={addExperience}>
              Adicionar experiência
            </button>
          </section>

          <section className="panel">
            <h2>Formação acadêmica</h2>
            {profile.education.length === 0 && (
              <p className="muted">Nenhuma formação adicionada.</p>
            )}
            {profile.education.map((education, index) => (
              <ItemCard
                key={index}
                title={education.degree || education.institution || `Formação ${index + 1}`}
                onRemove={() =>
                  setProfile((current) => ({
                    ...current,
                    education: current.education.filter((_, i) => i !== index),
                  }))
                }
              >
                <div className="profile-grid">
                  <label>
                    Curso
                    <input
                      value={education.degree}
                      onChange={(e) => updateEducation(index, { degree: e.target.value })}
                    />
                  </label>
                  <label>
                    Instituição
                    <input
                      value={education.institution}
                      onChange={(e) => updateEducation(index, { institution: e.target.value })}
                    />
                  </label>
                  <label>
                    Ano/conclusão
                    <input
                      value={education.year ?? ""}
                      onChange={(e) => updateEducation(index, { year: e.target.value || null })}
                    />
                  </label>
                </div>
                <SourceQuote quote={education.sourceQuote} />
              </ItemCard>
            ))}
            <button type="button" onClick={addEducation}>
              Adicionar formação
            </button>
          </section>

          <section className="panel">
            <h2>Habilidades e tecnologias</h2>
            {profile.skills.length === 0 && <p className="muted">Nenhuma habilidade adicionada.</p>}
            {profile.skills.map((skill, index) => (
              <ItemCard
                key={index}
                title={skill.name || `Habilidade ${index + 1}`}
                onRemove={() =>
                  setProfile((current) => ({
                    ...current,
                    skills: current.skills.filter((_, i) => i !== index),
                  }))
                }
              >
                <div className="profile-grid">
                  <label>
                    Nome
                    <input
                      value={skill.name}
                      onChange={(e) => updateSkill(index, { name: e.target.value })}
                    />
                  </label>
                  <label>
                    Nível declarado no CV
                    <select
                      value={skill.level ?? ""}
                      onChange={(e) =>
                        updateSkill(index, {
                          level:
                            e.target.value === "" ? null : (e.target.value as ProfileSkillLevel),
                        })
                      }
                    >
                      <option value="">Não informado</option>
                      {(["beginner", "intermediate", "advanced"] as ProfileSkillLevel[]).map(
                        (level) => (
                          <option key={level} value={level}>
                            {PROFILE_SKILL_LEVEL_LABELS[level]}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
                <SourceQuote quote={skill.sourceQuote} />
              </ItemCard>
            ))}
            <button type="button" onClick={addSkill}>
              Adicionar habilidade
            </button>
          </section>

          <section className="panel">
            <h2>Idiomas</h2>
            {profile.languages.length === 0 && <p className="muted">Nenhum idioma adicionado.</p>}
            {profile.languages.map((language, index) => (
              <ItemCard
                key={index}
                title={language.name || `Idioma ${index + 1}`}
                onRemove={() =>
                  setProfile((current) => ({
                    ...current,
                    languages: current.languages.filter((_, i) => i !== index),
                  }))
                }
              >
                <div className="profile-grid">
                  <label>
                    Idioma
                    <input
                      value={language.name}
                      onChange={(e) => updateLanguage(index, { name: e.target.value })}
                    />
                  </label>
                  <label>
                    Nível
                    <input
                      value={language.level ?? ""}
                      onChange={(e) => updateLanguage(index, { level: e.target.value || null })}
                    />
                  </label>
                </div>
                <SourceQuote quote={language.sourceQuote} />
              </ItemCard>
            ))}
            <button type="button" onClick={addLanguage}>
              Adicionar idioma
            </button>
          </section>

          <section className="panel">
            <h2>Projetos e portfólio</h2>
            {profile.projects.length === 0 && <p className="muted">Nenhum projeto adicionado.</p>}
            {profile.projects.map((project, index) => (
              <ItemCard
                key={index}
                title={project.name || `Projeto ${index + 1}`}
                onRemove={() =>
                  setProfile((current) => ({
                    ...current,
                    projects: current.projects.filter((_, i) => i !== index),
                  }))
                }
              >
                <div className="profile-grid">
                  <label>
                    Nome
                    <input
                      value={project.name}
                      onChange={(e) => updateProject(index, { name: e.target.value })}
                    />
                  </label>
                  <label>
                    URL
                    <input
                      value={project.url ?? ""}
                      onChange={(e) => updateProject(index, { url: e.target.value || null })}
                    />
                  </label>
                </div>
                <label>
                  Descrição
                  <textarea
                    value={project.description ?? ""}
                    onChange={(e) => updateProject(index, { description: e.target.value || null })}
                  />
                </label>
                <SourceQuote quote={project.sourceQuote} />
              </ItemCard>
            ))}
            <button type="button" onClick={addProject}>
              Adicionar projeto
            </button>
          </section>

          {profile.inferred.length > 0 && (
            <section className="panel">
              <h2>Itens inferidos pela IA</h2>
              <p className="muted small">
                Estes itens não estão escritos literalmente no CV. Confirme cada um ou remova antes
                de salvar. {pendingInferred > 0 && `${pendingInferred} pendente(s).`}
              </p>
              {profile.inferred.map((item, index) => (
                <ItemCard
                  key={index}
                  title={item.field}
                  onRemove={() =>
                    setProfile((current) => ({
                      ...current,
                      inferred: current.inferred.filter((_, i) => i !== index),
                    }))
                  }
                >
                  <p>
                    <strong>{item.value}</strong>
                  </p>
                  <p className="muted small">Motivo: {item.reason}</p>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={item.confirmed}
                      onChange={(e) => {
                        const confirmed = e.target.checked;
                        setProfile((current) => ({
                          ...current,
                          inferred: current.inferred.map((currentItem, i) =>
                            i === index ? { ...currentItem, confirmed } : currentItem,
                          ),
                        }));
                      }}
                    />
                    Confirmo este item
                  </label>
                </ItemCard>
              ))}
            </section>
          )}

          <section className="panel">
            <h2>Preferências profissionais</h2>
            <label>
              Cargos desejados (um por linha)
              <textarea
                value={preferences.desiredRoles.join("\n")}
                onChange={(e) =>
                  setPreferences((current) => ({
                    ...current,
                    desiredRoles: e.target.value.split("\n"),
                  }))
                }
              />
            </label>
            <label>
              Localidades desejadas (uma por linha)
              <textarea
                value={preferences.locations.join("\n")}
                onChange={(e) =>
                  setPreferences((current) => ({
                    ...current,
                    locations: e.target.value.split("\n"),
                  }))
                }
              />
            </label>
            <label>
              Pretensão salarial (opcional)
              <input
                value={preferences.salaryExpectation ?? ""}
                onChange={(e) =>
                  setPreferences((current) => ({
                    ...current,
                    salaryExpectation: e.target.value || null,
                  }))
                }
                placeholder="Ex.: R$ 4.000/mês"
              />
            </label>
            <fieldset className="profile-fieldset">
              <legend>Modalidades desejadas</legend>
              <div className="preference-options">
                {WORK_MODES.map((mode) => (
                  <label key={mode} className="checkbox">
                    <input
                      type="checkbox"
                      checked={preferences.workModes.includes(mode)}
                      onChange={() => toggleWorkMode(mode)}
                    />
                    {PROFILE_WORK_MODE_LABELS[mode]}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="profile-fieldset">
              <legend>Tipos de contrato desejados</legend>
              <div className="preference-options">
                {SEARCH_CONTRACT_TYPES.map((type) => (
                  <label key={type} className="checkbox">
                    <input
                      type="checkbox"
                      checked={preferences.contractTypes.includes(type)}
                      onChange={() => toggleContractType(type)}
                    />
                    {CONTRACT_TYPE_LABELS[type]}
                  </label>
                ))}
              </div>
            </fieldset>
          </section>

          <section className="panel">
            <h2>Respostas padrão para formulários</h2>
            <p className="muted small">
              Pares chave/valor usados futuramente em candidaturas (ex.: “Autorização de trabalho” →
              “Sim”). Nada é enviado automaticamente.
            </p>
            {answers.length === 0 && <p className="muted">Nenhuma resposta cadastrada.</p>}
            {answers.map((answer, index) => (
              <div className="form-row answer-row" key={index}>
                <label>
                  Pergunta
                  <input
                    value={answer.key}
                    onChange={(e) =>
                      setAnswers((current) => updateAt(current, index, { key: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Resposta
                  <input
                    value={answer.value}
                    onChange={(e) =>
                      setAnswers((current) => updateAt(current, index, { value: e.target.value }))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="link"
                  onClick={() => setAnswers((current) => current.filter((_, i) => i !== index))}
                >
                  Remover
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setAnswers((current) => [...current, { key: "", value: "" }])}
            >
              Adicionar resposta
            </button>
          </section>

          <div className="profile-actions">
            {preview ? (
              <>
                <button onClick={confirmCv} disabled={busy || pendingInferred > 0}>
                  Confirmar importação do CV
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setPreview(null);
                    profileState.reload();
                  }}
                >
                  Descartar prévia
                </button>
              </>
            ) : (
              <button onClick={saveProfile} disabled={busy}>
                Salvar perfil
              </button>
            )}
            {profileState.data && profileState.data.hasProfile && (
              <span className="muted small">
                Versão {profileState.data.version} · atualizado em{" "}
                {formatDateTime(profileState.data.updatedAt)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function QuotedField({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: QuotedText | null;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <label>
      {label}
      {multiline ? (
        <textarea
          value={value?.value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          value={value?.value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
      <SourceQuote quote={value?.sourceQuote} />
    </label>
  );
}

function SourceQuote({ quote }: { quote?: string | null }) {
  if (!quote || quote.trim() === "") return null;
  return <span className="muted small source-quote">Fonte no CV: “{quote}”</span>;
}

function ItemCard({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="profile-item">
      <div className="profile-item-header">
        <strong>{title}</strong>
        <button type="button" className="link" onClick={onRemove}>
          Remover
        </button>
      </div>
      {children}
    </div>
  );
}
