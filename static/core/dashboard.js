let sessionUser;

function showPanel(name) {
  document.querySelectorAll(".app-section").forEach(p => p.classList.toggle("active", p.dataset.panel === name));
  document.querySelectorAll(".side-link[data-section]").forEach(b => b.classList.toggle("active", b.dataset.section === name));
  document.querySelector(".sidebar")?.classList.remove("open");
  if (name === "chat") loadMessages();
}

document.querySelectorAll(".side-link[data-section]").forEach(button => button.addEventListener("click", () => showPanel(button.dataset.section)));
document.querySelector(".jump-profile")?.addEventListener("click", () => showPanel("profile"));
document.querySelector(".mobile-menu")?.addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));

function fillProfile(user) {
  const form = document.getElementById("profile-form");
  form.elements.name.value = user.name;
  form.elements.bio.value = user.bio || "";
  form.elements.theme.value = user.theme;
  form.elements.accent.value = user.accent;
  form.elements.density.value = user.density;
  document.getElementById("user-first-name").textContent = user.name.split(" ")[0];
  document.getElementById("avatar").textContent = user.name.split(/\s+/).slice(0,2).map(part => part[0]).join("").toUpperCase();
  const completed = 55 + (user.bio ? 30 : 0) + (user.name.length > 4 ? 15 : 0);
  document.getElementById("profile-progress").textContent = `${completed}%`;
  document.getElementById("profile-progress-bar").style.width = `${completed}%`;
}

async function loadMessages() {
  const box = document.getElementById("messages");
  try {
    const { messages } = await FormSpace.api("/api/messages");
    document.getElementById("message-count").textContent = messages.length;
    box.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "Диалог пока пуст. Напишите первое сообщение."; box.append(empty); return;
    }
    messages.forEach(item => {
      const article = document.createElement("article"); article.className = `message ${item.senderRole === "user" ? "mine" : ""}`;
      const text = document.createElement("p"); text.textContent = item.body;
      const time = document.createElement("time"); time.dateTime = item.createdAt; time.textContent = FormSpace.formatDate(item.createdAt, true);
      article.append(text, time); box.append(article);
    });
    box.scrollTop = box.scrollHeight;
  } catch (error) { box.textContent = error.message; }
}

document.getElementById("profile-form").addEventListener("submit", async event => {
  event.preventDefault(); const form = event.currentTarget; const status = form.querySelector(".form-status");
  try {
    const payload = Object.fromEntries(new FormData(form));
    const { user } = await FormSpace.api("/api/profile", { method:"PATCH", body:JSON.stringify(payload) });
    sessionUser = user; FormSpace.applyPreferences(user); fillProfile(user);
    status.className = "form-status success"; status.textContent = "Настройки сохранены.";
  } catch (error) { status.className = "form-status"; status.textContent = error.message; }
});

document.getElementById("message-form").addEventListener("submit", async event => {
  event.preventDefault(); const form = event.currentTarget; const field = form.elements.message;
  try { await FormSpace.api("/api/messages", { method:"POST", body:JSON.stringify({ message:field.value }) }); field.value=""; await loadMessages(); }
  catch (error) { alert(error.message); }
});

document.querySelector(".logout-button").addEventListener("click", async () => {
  try { await FormSpace.api("/api/logout", { method:"POST", body:"{}" }); } finally { location.href="/"; }
});

function registerWebMCP() {
  if (!document.modelContext?.registerTool) return;
  document.modelContext.registerTool({
    name:"send_feedback_message", title:"Отправить сообщение куратору",
    description:"Отправляет сообщение текущего пользователя в чат обратной связи FormSpace.",
    inputSchema:{type:"object",properties:{message:{type:"string",minLength:1,maxLength:2000}},required:["message"],additionalProperties:false},
    annotations:{readOnlyHint:false,untrustedContentHint:false},
    async execute(input){ if(!input || typeof input.message!=="string" || !input.message.trim()) throw new Error("Текст сообщения обязателен"); const result=await FormSpace.api("/api/messages",{method:"POST",body:JSON.stringify({message:input.message})}); await loadMessages(); return {id:result.id,status:"sent"}; }
  });
  document.modelContext.registerTool({
    name:"update_interface_preferences", title:"Настроить интерфейс",
    description:"Меняет тему, акцентный цвет или плотность интерфейса текущего пользователя.",
    inputSchema:{type:"object",properties:{theme:{enum:["dark","light"]},accent:{enum:["violet","cyan","amber"]},density:{enum:["comfortable","compact"]}},additionalProperties:false},
    annotations:{readOnlyHint:false,untrustedContentHint:false},
    async execute(input){ const payload={...sessionUser,...input}; const {user}=await FormSpace.api("/api/profile",{method:"PATCH",body:JSON.stringify(payload)}); sessionUser=user; FormSpace.applyPreferences(user); fillProfile(user); return {theme:user.theme,accent:user.accent,density:user.density}; }
  });
}

(async () => {
  try {
    sessionUser = await FormSpace.loadSession();
    if (!sessionUser) return location.replace("/login");
    if (sessionUser.role === "admin") return location.replace("/admin");
    fillProfile(sessionUser); await loadMessages(); registerWebMCP();
  } catch { location.replace("/login"); }
})();
