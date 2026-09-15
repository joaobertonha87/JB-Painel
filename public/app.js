const state = { items: [], classes: [], view: "home", appTarget: "", classTarget: null, classMode: "particular" };
const appNames = ["JB Play", "JB Tactics", "JB Torneios"];
const weekdayNames = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const classModes = {
  particular: { label: "Particular", capacity: 4, duration: 60, durationLabel: "1 hora" },
  school: { label: "Escolinha", capacity: 6, duration: 35, durationLabel: "35 minutos" },
};
const dialogCopy = {
  agenda: ["AGENDA", "Novo compromisso", "Adicione uma aula, tarefa ou lembrete."],
  student: ["ALUNOS", "Novo aluno", "Cadastre o aluno e o nível atual."],
  content: ["CONTEÚDO", "Nova ideia", "Guarde uma ideia para post, Story ou Reel."],
  class: ["TURMAS", "Nova turma", "Escolha o dia, horário e os alunos desta modalidade."],
  app: ["APLICATIVO", "Configurar atalho", "Cole o endereço para abrir pelo painel."],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function localDate() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function dateValue(value) {
  return value ? String(value).slice(0, 10) : "";
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" })
    .format(new Date(`${dateValue(value)}T12:00:00`)).replace(".", "");
}

function formatEndTime(time, duration) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  const total = (hours * 60 + minutes + duration) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function showError(message) {
  const element = $("#error");
  element.textContent = message;
  element.classList.remove("hidden");
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (response.status === 401) {
    location.replace("/");
    throw new Error("Sessão expirada.");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

async function load() {
  try {
    const [itemData, classData] = await Promise.all([api("/api/items"), api("/api/classes")]);
    state.items = itemData.items || [];
    state.classes = classData.classes || [];
    $("#error").classList.add("hidden");
    render();
  } catch (error) {
    showError(error.message);
  }
}

function setView(view) {
  state.view = view;
  $$(".page").forEach((page) => page.classList.toggle("active", page.id === `${view}-page`));
  $$(".top-nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function empty(title, text) {
  return `<div class="empty-state"><b>${title}</b><p>${text}</p></div>`;
}

function record(item) {
  const icon = item.category === "agenda" ? "i-calendar" : item.category === "student" ? "i-user" : "i-spark";
  const when = [formatDate(item.date), item.time].filter(Boolean).join(" • ");
  const studentMode = item.category === "student" ? (classModes[item.studentType] || classModes.particular).label : "";
  const isNote = item.category === "content";
  return `<article class="record${isNote ? " content-note" : ""}" ${isNote ? `data-open-note="${item.id}" role="button" tabindex="0" aria-label="Abrir e editar ${escapeHtml(item.title)}"` : ""}>
    <i class="record-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><use href="#${icon}"/></svg></i>
    <div class="record-copy"><strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.details || "Sem observações")}</span>
      ${isNote ? `<small class="note-hint">TOQUE PARA ABRIR E EDITAR</small>` : ""}
      ${studentMode ? `<small class="student-mode">${studentMode}</small>` : ""}
      ${when ? `<small>${escapeHtml(when)}</small>` : ""}
    </div>
    <div class="record-actions">
      ${item.category !== "student" ? `<button data-done="${item.id}" aria-label="Concluir"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><use href="#i-check"/></svg></button>` : ""}
      <button class="delete" data-delete="${item.id}" aria-label="Excluir"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><use href="#i-trash"/></svg></button>
    </div>
  </article>`;
}

function classCard(group) {
  const students = Array.isArray(group.students) ? group.students : [];
  const mode = classModes[group.classType] || classModes.particular;
  const capacity = Number(group.capacity) || mode.capacity;
  const available = Math.max(0, capacity - students.length);
  const endTime = formatEndTime(group.time, mode.duration);
  const chips = students.map((student) => `<span class="student-chip">${escapeHtml(student.name)}</span>`).join("");
  const vacancies = available ? `<span class="student-chip vacant">${available} ${available === 1 ? "vaga" : "vagas"}</span>` : "";
  return `<article class="class-card">
    <div class="class-card-head">
      <div class="class-time"><strong>${escapeHtml(group.time)}</strong><small>até ${endTime}</small></div>
      <div class="class-card-copy"><strong>${weekdayNames[Number(group.weekday)]}</strong><small>${mode.label} • ${mode.durationLabel}</small></div>
      <span class="class-occupancy">${students.length}/${capacity}</span>
    </div>
    <div class="class-students">${chips || ""}${vacancies || `<span class="student-chip vacant">Turma completa</span>`}</div>
    <div class="class-footer">
      <span class="vacancy ${available ? "" : "full"}">${available ? `${available} ${available === 1 ? "vaga disponível" : "vagas disponíveis"}` : "Turma completa"}</span>
      <div class="class-actions">
        <button data-edit-class="${group.id}" aria-label="Editar turma"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><use href="#i-edit"/></svg></button>
        <button class="delete" data-delete-class="${group.id}" aria-label="Excluir turma"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><use href="#i-trash"/></svg></button>
      </div>
    </div>
  </article>`;
}

function updateClassSelectionCount() {
  const checked = $$("#class-student-options input:checked");
  const classType = $("#class-type").value || state.classMode;
  const capacity = (classModes[classType] || classModes.particular).capacity;
  $("#class-selection-count").textContent = `${checked.length} de ${capacity} selecionados`;
}

function renderStudentPicker(selectedIds = [], classType = state.classMode) {
  const selected = new Set(selectedIds.map(Number));
  const students = state.items.filter((item) => item.category === "student" && (item.studentType || "particular") === classType)
    .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
  $("#class-student-options").innerHTML = students.length ? students.map((student) => `
    <label class="student-option">
      <input type="checkbox" name="classStudent" value="${student.id}" ${selected.has(Number(student.id)) ? "checked" : ""}>
      <span>${escapeHtml(student.title)}</span>
    </label>`).join("") : `<p class="picker-empty">Cadastre alunos da modalidade ${(classModes[classType] || classModes.particular).label} para adicioná-los aqui.</p>`;
  updateClassSelectionCount();
}

function updateClassModeNote(classType) {
  const mode = classModes[classType] || classModes.particular;
  const startTime = $("#class-time").value || "18:00";
  $("#class-mode-note").innerHTML = `<div><strong>${mode.label}</strong><span>${mode.durationLabel} • até ${mode.capacity} alunos</span></div><b>${startTime}–${formatEndTime(startTime, mode.duration)}</b>`;
}

function render() {
  const agenda = state.items.filter((item) => item.category === "agenda" && item.status !== "done");
  const students = state.items.filter((item) => item.category === "student");
  const contents = state.items.filter((item) => item.category === "content" && item.status !== "done");
  const todayAgenda = agenda.filter((item) => !item.date || dateValue(item.date) === localDate());

  $("#today-count").textContent = todayAgenda.length;
  $("#student-count").textContent = students.length;
  $("#content-count").textContent = contents.length;
  const visibleClasses = state.classes.filter((group) => (group.classType || "particular") === state.classMode);
  const activeMode = classModes[state.classMode];
  $("#class-count").textContent = visibleClasses.length;
  $("#vacancy-count").textContent = visibleClasses.reduce((total, group) => total + Math.max(0, (Number(group.capacity) || activeMode.capacity) - (group.students?.length || 0)), 0);
  $("#new-class-button").textContent = `＋ Nova turma ${activeMode.label.toLowerCase()}`;
  $$(".class-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.classMode === state.classMode));
  $("#today-list").innerHTML = todayAgenda.length ? todayAgenda.slice(0, 3).map((item) => `
    <article class="today-item">
      <div class="time"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><use href="#i-clock"/></svg><span>${escapeHtml(item.time || "--:--")}</span></div>
      <div class="item-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.details || "Compromisso pessoal")}</span></div>
      <button class="done" data-done="${item.id}" aria-label="Concluir"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><use href="#i-check"/></svg></button>
    </article>`).join("") : `<button class="empty-today" data-create="agenda"><strong>Seu dia está livre</strong><span>Toque para adicionar algo</span></button>`;

  $("#agenda-list").innerHTML = agenda.length ? agenda.map(record).join("") : empty("Sua agenda está livre", "Adicione o primeiro compromisso para organizar o dia.");
  $("#student-list").innerHTML = students.length ? students.map(record).join("") : empty("Nenhum aluno cadastrado", "Cadastre seus alunos e registre o nível de cada um.");
  $("#content-list").innerHTML = contents.length ? contents.map(record).join("") : empty("Caixa de ideias vazia", "Anote aqui seu próximo Reel, Story ou publicação.");
  $("#class-list").innerHTML = visibleClasses.length ? visibleClasses.map(classCard).join("") : empty(`Nenhuma turma de ${activeMode.label.toLowerCase()}`, `Crie a primeira turma e selecione até ${activeMode.capacity} alunos.`);

  $("#apps-list").innerHTML = appNames.map((name, index) => {
    const saved = state.items.find((item) => item.category === "app" && item.title === name);
    const initials = name.replace("JB ", "").slice(0, 2).toUpperCase();
    return `<article class="app-card">
      <i class="app-logo">${initials}</i>
      <div><strong>${name}</strong><small>${saved?.url ? "Atalho configurado" : "Adicione o link do aplicativo"}</small></div>
      ${saved?.url ? `<span class="app-actions"><button data-configure-app="${index}" aria-label="Editar link"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><use href="#i-edit"/></svg></button><a href="${escapeHtml(saved.url)}" target="_blank" rel="noreferrer" aria-label="Abrir ${name}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><use href="#i-arrow"/></svg></a></span>`
        : `<button data-configure-app="${index}">Configurar</button>`}
    </article>`;
  }).join("");
}

function openDialog(category, appTarget = "") {
  const form = $("#entry-form");
  form.reset();
  state.appTarget = appTarget;
  state.classTarget = category === "class" && appTarget ? Number(appTarget) : null;
  $("#category").value = category;
  $("#item-id").value = "";
  $("#dialog-kicker").textContent = dialogCopy[category][0];
  $("#dialog-title").textContent = dialogCopy[category][1];
  $("#dialog-description").textContent = dialogCopy[category][2];
  $("#title-label").classList.toggle("hidden", category === "app" || category === "class");
  $("#details-label").classList.toggle("hidden", category === "app" || category === "class");
  $("#date-row").classList.toggle("hidden", category === "student" || category === "app" || category === "class");
  $("#student-type-row").classList.toggle("hidden", category !== "student");
  $("#class-schedule-row").classList.toggle("hidden", category !== "class");
  $("#class-students-row").classList.toggle("hidden", category !== "class");
  $("#class-mode-note").classList.toggle("hidden", category !== "class");
  $("#reminder-row").classList.toggle("hidden", category !== "agenda");
  $("#url-row").classList.toggle("hidden", category !== "app");
  $("#title").required = category !== "app" && category !== "class";
  $("#url").required = category === "app";
  $("#class-time").required = category === "class";
  $("#entry-dialog").classList.toggle("note-dialog", category === "content");
  $("#entry-form").classList.toggle("note-mode", category === "content");
  $("#details-label-text").textContent = category === "content" ? "Anotação" : "Detalhes";
  $("#details").rows = category === "content" ? 12 : 3;
  $("#details").placeholder = category === "content" ? "Escreva todos os detalhes, roteiro, legenda, referências e próximos passos..." : "";
  $("#note-save-status").classList.toggle("hidden", category !== "content");
  $("#note-save-status").textContent = appTarget ? "Alterações salvas automaticamente enquanto você escreve." : "A ideia ficará salva online depois do primeiro toque em Salvar ideia.";
  $("#date").value = category === "agenda" ? localDate() : "";
  if (category === "student") {
    $("#student-type-particular").checked = true;
  }
  if (category === "app") {
    const existing = state.items.find((item) => item.category === "app" && item.title === appTarget);
    $("#item-id").value = existing?.id || "";
    $("#url").value = existing?.url || "";
    $("#dialog-title").textContent = appTarget;
  }
  if (category === "content" && appTarget) {
    const existing = state.items.find((item) => item.category === "content" && Number(item.id) === Number(appTarget));
    if (existing) {
      $("#item-id").value = existing.id;
      $("#title").value = existing.title || "";
      $("#details").value = existing.details || "";
      $("#dialog-title").textContent = "Editar ideia";
      $("#dialog-description").textContent = "Use como um bloco de anotações. Você pode ler e alterar o texto completo.";
      $("#save").textContent = "Salvar alterações";
    }
  } else if (category === "content") {
    $("#save").textContent = "Salvar ideia";
  } else {
    $("#save").textContent = "Salvar";
  }
  if (category === "class") {
    const existing = state.classes.find((group) => Number(group.id) === state.classTarget);
    const classType = existing?.classType || state.classMode;
    const mode = classModes[classType] || classModes.particular;
    $("#item-id").value = existing?.id || "";
    $("#class-type").value = classType;
    $("#weekday").value = existing?.weekday ?? "1";
    $("#class-time").value = existing?.time || "18:00";
    updateClassModeNote(classType);
    renderStudentPicker(existing?.students?.map((student) => student.id) || [], classType);
    $("#dialog-title").textContent = existing ? `Editar turma ${mode.label.toLowerCase()}` : `Nova turma ${mode.label.toLowerCase()}`;
  }
  $("#entry-dialog").showModal();
}

document.addEventListener("click", async (event) => {
  const note = event.target.closest("[data-open-note]");
  if (note && !event.target.closest(".record-actions")) {
    openDialog("content", note.dataset.openNote);
    return;
  }
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.view) setView(button.dataset.view);
  if (button.dataset.classMode) {
    state.classMode = button.dataset.classMode;
    render();
  }
  if (button.dataset.create) openDialog(button.dataset.create);
  if (button.dataset.configureApp !== undefined) openDialog("app", appNames[Number(button.dataset.configureApp)]);
  if (button.dataset.editClass) openDialog("class", button.dataset.editClass);
  if (button.dataset.deleteClass) {
    if (!confirm("Excluir esta turma? Os alunos cadastrados serão mantidos.")) return;
    try {
      await api(`/api/classes/${button.dataset.deleteClass}`, { method: "DELETE" });
      await load();
    } catch (error) { showError(error.message); }
  }
  if (button.dataset.done) {
    try {
      await api(`/api/items/${button.dataset.done}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
      await load();
    } catch (error) { showError(error.message); }
  }
  if (button.dataset.delete) {
    if (!confirm("Excluir este registro?")) return;
    try {
      await api(`/api/items/${button.dataset.delete}`, { method: "DELETE" });
      await load();
    } catch (error) { showError(error.message); }
  }
});

document.addEventListener("keydown", (event) => {
  const note = event.target.closest?.("[data-open-note]");
  if (note && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openDialog("content", note.dataset.openNote);
  }
});

let noteSaveTimer;
async function autosaveOpenNote() {
  const category = $("#category").value;
  const id = $("#item-id").value;
  if (category !== "content" || !id) return;
  const title = $("#title").value.trim();
  const details = $("#details").value;
  if (!title) {
    $("#note-save-status").textContent = "Digite um título para salvar automaticamente.";
    return;
  }
  clearTimeout(noteSaveTimer);
  $("#note-save-status").textContent = "Salvando alterações online...";
  noteSaveTimer = setTimeout(async () => {
    try {
      const data = await api(`/api/items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, details }),
      });
      state.items = state.items.map((item) => Number(item.id) === Number(id) ? data.item : item);
      $("#note-save-status").textContent = "Salvo online ✓";
    } catch (error) {
      $("#note-save-status").textContent = "Não foi possível salvar automaticamente.";
      showError(error.message);
    }
  }, 700);
}

$("#title").addEventListener("input", autosaveOpenNote);
$("#details").addEventListener("input", autosaveOpenNote);

$(".dialog-close").addEventListener("click", () => $("#entry-dialog").close());
$("#class-student-options").addEventListener("change", (event) => {
  if (!event.target.matches('input[type="checkbox"]')) return;
  const checked = $$("#class-student-options input:checked");
  const capacity = (classModes[$("#class-type").value] || classModes.particular).capacity;
  if (checked.length > capacity) {
    event.target.checked = false;
    showError(`Esta modalidade permite no máximo ${capacity} alunos.`);
  }
  updateClassSelectionCount();
});
$("#class-time").addEventListener("input", () => updateClassModeNote($("#class-type").value));
$("#error").addEventListener("click", load);
$("#logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.replace("/");
});

$("#entry-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearTimeout(noteSaveTimer);
  const submit = event.submitter;
  submit.disabled = true;
  submit.textContent = "Salvando...";
  const form = new FormData(event.currentTarget);
  const category = form.get("category");
  const id = form.get("itemId");
  if (category === "class") {
    const body = {
      classType: form.get("classType"),
      weekday: Number(form.get("weekday")),
      time: form.get("classTime"),
      studentIds: form.getAll("classStudent").map(Number),
    };
    try {
      await api(id ? `/api/classes/${id}` : "/api/classes", {
        method: id ? "PATCH" : "POST", body: JSON.stringify(body),
      });
      $("#entry-dialog").close();
      await load();
    } catch (error) { showError(error.message); }
    finally { submit.disabled = false; submit.textContent = "Salvar"; }
    return;
  }
  const body = category === "app" ? {
    category, title: state.appTarget, url: form.get("url"),
  } : {
    category, title: form.get("title"), details: form.get("details"),
    date: form.get("date") || null, time: form.get("time") || null,
    reminderMinutes: form.get("reminderMinutes") ? Number(form.get("reminderMinutes")) : null,
    studentType: category === "student" ? form.get("studentType") : null,
  };
  try {
    await api(id ? `/api/items/${id}` : "/api/items", {
      method: id ? "PATCH" : "POST", body: JSON.stringify(body),
    });
    $("#entry-dialog").close();
    await load();
  } catch (error) { showError(error.message); }
  finally {
    submit.disabled = false;
    submit.textContent = category === "content" ? (id ? "Salvar alterações" : "Salvar ideia") : "Salvar";
  }
});

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

$("#enable-notifications").addEventListener("click", async () => {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Este navegador não oferece notificações.");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Permissão de notificações não concedida.");
    const { publicKey } = await api("/api/push/key");
    if (!publicKey) throw new Error("Configure as chaves VAPID no Render primeiro.");
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await api("/api/push/subscribe", { method: "POST", body: JSON.stringify(subscription) });
    $("#enable-notifications").querySelector("strong").textContent = "Lembretes ativados";
    $("#enable-notifications").querySelector("span").textContent = "Seu iPhone está pronto para receber avisos.";
  } catch (error) { showError(error.message); }
});

const hour = new Date().getHours();
$("#greeting").textContent = `${hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite"} 👋`;
const fullDate = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
$("#today-label").textContent = fullDate.charAt(0).toUpperCase() + fullDate.slice(1);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
load();
