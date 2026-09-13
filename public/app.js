const state = { items: [], view: "home", appTarget: "" };
const appNames = ["JB Play", "BT Tracker", "JB Drills", "JB Tactics"];
const dialogCopy = {
  agenda: ["AGENDA", "Novo compromisso", "Adicione uma aula, tarefa ou lembrete."],
  student: ["ALUNOS", "Novo aluno", "Cadastre o aluno e o nível atual."],
  content: ["CONTEÚDO", "Nova ideia", "Guarde uma ideia para post, Story ou Reel."],
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
    const data = await api("/api/items");
    state.items = data.items || [];
    $("#error").classList.add("hidden");
    render();
  } catch (error) {
    showError(error.message);
  }
}

function setView(view) {
  state.view = view;
  $$(".page").forEach((page) => page.classList.toggle("active", page.id === `${view}-page`));
  $$(".bottom-nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function empty(title, text) {
  return `<div class="empty-state"><b>${title}</b><p>${text}</p></div>`;
}

function record(item) {
  const icon = item.category === "agenda" ? "▣" : item.category === "student" ? "♙" : "✦";
  const when = [formatDate(item.date), item.time].filter(Boolean).join(" • ");
  return `<article class="record">
    <i class="record-icon">${icon}</i>
    <div class="record-copy"><strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.details || "Sem observações")}</span>
      ${when ? `<small>${escapeHtml(when)}</small>` : ""}
    </div>
    <div class="record-actions">
      ${item.category !== "student" ? `<button data-done="${item.id}" aria-label="Concluir">✓</button>` : ""}
      <button class="delete" data-delete="${item.id}" aria-label="Excluir">⌫</button>
    </div>
  </article>`;
}

function render() {
  const agenda = state.items.filter((item) => item.category === "agenda" && item.status !== "done");
  const students = state.items.filter((item) => item.category === "student");
  const contents = state.items.filter((item) => item.category === "content" && item.status !== "done");
  const todayAgenda = agenda.filter((item) => !item.date || dateValue(item.date) === localDate());

  $("#today-count").textContent = todayAgenda.length;
  $("#student-count").textContent = students.length;
  $("#content-count").textContent = contents.length;
  $("#today-list").innerHTML = todayAgenda.length ? todayAgenda.slice(0, 3).map((item) => `
    <article class="today-item">
      <div class="time">◷<span>${escapeHtml(item.time || "--:--")}</span></div>
      <div class="item-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.details || "Compromisso pessoal")}</span></div>
      <button class="done" data-done="${item.id}" aria-label="Concluir">✓</button>
    </article>`).join("") : `<button class="empty-today" data-create="agenda"><strong>Seu dia está livre</strong><span>Toque para adicionar algo</span></button>`;

  $("#agenda-list").innerHTML = agenda.length ? agenda.map(record).join("") : empty("Sua agenda está livre", "Adicione o primeiro compromisso para organizar o dia.");
  $("#student-list").innerHTML = students.length ? students.map(record).join("") : empty("Nenhum aluno cadastrado", "Cadastre seus alunos e registre o nível de cada um.");
  $("#content-list").innerHTML = contents.length ? contents.map(record).join("") : empty("Caixa de ideias vazia", "Anote aqui seu próximo Reel, Story ou publicação.");

  $("#apps-list").innerHTML = appNames.map((name, index) => {
    const saved = state.items.find((item) => item.category === "app" && item.title === name);
    const initials = name.replace("JB ", "").slice(0, 2).toUpperCase();
    return `<article class="app-card">
      <i class="app-logo">${initials}</i>
      <div><strong>${name}</strong><small>${saved?.url ? "Atalho configurado" : "Adicione o link do aplicativo"}</small></div>
      ${saved?.url ? `<span class="app-actions"><button data-configure-app="${index}" aria-label="Editar link">✎</button><a href="${escapeHtml(saved.url)}" target="_blank" rel="noreferrer" aria-label="Abrir ${name}">↗</a></span>`
        : `<button data-configure-app="${index}">Configurar</button>`}
    </article>`;
  }).join("");
}

function openDialog(category, appTarget = "") {
  const form = $("#entry-form");
  form.reset();
  state.appTarget = appTarget;
  $("#category").value = category;
  $("#item-id").value = "";
  $("#dialog-kicker").textContent = dialogCopy[category][0];
  $("#dialog-title").textContent = dialogCopy[category][1];
  $("#dialog-description").textContent = dialogCopy[category][2];
  $("#title-label").classList.toggle("hidden", category === "app");
  $("#details-label").classList.toggle("hidden", category === "app");
  $("#date-row").classList.toggle("hidden", category === "student" || category === "app");
  $("#reminder-row").classList.toggle("hidden", category !== "agenda");
  $("#url-row").classList.toggle("hidden", category !== "app");
  $("#title").required = category !== "app";
  $("#url").required = category === "app";
  $("#date").value = category === "agenda" ? localDate() : "";
  if (category === "app") {
    const existing = state.items.find((item) => item.category === "app" && item.title === appTarget);
    $("#item-id").value = existing?.id || "";
    $("#url").value = existing?.url || "";
    $("#dialog-title").textContent = appTarget;
  }
  $("#entry-dialog").showModal();
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.view) setView(button.dataset.view);
  if (button.dataset.create) openDialog(button.dataset.create);
  if (button.dataset.configureApp !== undefined) openDialog("app", appNames[Number(button.dataset.configureApp)]);
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

$(".dialog-close").addEventListener("click", () => $("#entry-dialog").close());
$("#error").addEventListener("click", load);
$("#logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.replace("/");
});

$("#entry-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  submit.textContent = "Salvando...";
  const form = new FormData(event.currentTarget);
  const category = form.get("category");
  const id = form.get("itemId");
  const body = category === "app" ? {
    category, title: state.appTarget, url: form.get("url"),
  } : {
    category, title: form.get("title"), details: form.get("details"),
    date: form.get("date") || null, time: form.get("time") || null,
    reminderMinutes: form.get("reminderMinutes") ? Number(form.get("reminderMinutes")) : null,
  };
  try {
    await api(id ? `/api/items/${id}` : "/api/items", {
      method: id ? "PATCH" : "POST", body: JSON.stringify(body),
    });
    $("#entry-dialog").close();
    await load();
  } catch (error) { showError(error.message); }
  finally { submit.disabled = false; submit.textContent = "Salvar"; }
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
