let activeUserId = null;
let users = [];

function showPanel(name) {
  document.querySelectorAll(".app-section").forEach(p => p.classList.toggle("active", p.dataset.panel === name));
  document.querySelectorAll(".side-link[data-section]").forEach(b => b.classList.toggle("active", b.dataset.section === name));
  document.querySelector(".sidebar")?.classList.remove("open");
  if (name === "analytics") loadAnalytics();
  if (name === "users" || name === "support") loadUsers();
}
document.querySelectorAll(".side-link[data-section]").forEach(button => button.addEventListener("click", () => showPanel(button.dataset.section)));
document.querySelector(".mobile-menu")?.addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));

async function loadAnalytics() {
  const data = await FormSpace.api("/api/admin/analytics");
  document.getElementById("stat-views").textContent = data.totals.views;
  document.getElementById("stat-visitors").textContent = data.totals.visitors;
  document.getElementById("stat-unread").textContent = data.unreadMessages;
  const max = Math.max(...data.daily.map(d => d.views), 1);
  const chart = document.getElementById("visits-chart"); chart.replaceChildren();
  data.daily.forEach(day => {
    const col=document.createElement("div"); col.className="bar-column";
    const value=document.createElement("strong"); value.textContent=day.views;
    const bar=document.createElement("i"); bar.style.height=`${Math.max(2,day.views/max*82)}%`;
    const label=document.createElement("span"); label.textContent=new Intl.DateTimeFormat("ru-RU",{weekday:"short"}).format(new Date(`${day.day}T12:00:00`));
    col.append(value,bar,label); chart.append(col);
  });
  const pages=document.getElementById("popular-pages"); pages.replaceChildren(); const pageMax=Math.max(...data.pages.map(p=>p.views),1);
  data.pages.forEach(page=>{const row=document.createElement("div");row.className="page-bar";const head=document.createElement("header");const name=document.createElement("span");name.textContent=page.pathname;const count=document.createElement("strong");count.textContent=page.views;head.append(name,count);const track=document.createElement("div");const fill=document.createElement("i");fill.style.width=`${page.views/pageMax*100}%`;track.append(fill);row.append(head,track);pages.append(row)});
}

async function loadUsers() {
  const data = await FormSpace.api("/api/admin/users"); users=data.users;
  document.getElementById("stat-users").textContent = users.filter(u=>u.role==="user").length;
  const tbody=document.getElementById("users-table"); tbody.replaceChildren();
  users.forEach(user=>{const tr=document.createElement("tr"); const identity=document.createElement("td");const strong=document.createElement("strong");strong.textContent=user.name;const email=document.createElement("small");email.textContent=user.email;identity.append(strong,email);const role=document.createElement("td");const badge=document.createElement("span");badge.className="role-badge";badge.textContent=user.role==="admin"?"Администратор":"Пользователь";role.append(badge);const messages=document.createElement("td");messages.textContent=user.messageCount;const date=document.createElement("td");date.textContent=FormSpace.formatDate(user.createdAt);tr.append(identity,role,messages,date);tbody.append(tr)});
  renderConversationList();
}

function renderConversationList(){
  const list=document.getElementById("conversation-list");list.replaceChildren();
  users.filter(u=>u.role==="user").forEach(user=>{const button=document.createElement("button");button.className=`conversation-item ${activeUserId===user.id?"active":""}`;const block=document.createElement("span");const name=document.createElement("strong");name.textContent=user.name;const email=document.createElement("small");email.textContent=user.email;block.append(name,email);button.append(block);if(user.unreadCount){const unread=document.createElement("span");unread.className="unread-badge";unread.textContent=user.unreadCount;button.append(unread)}button.addEventListener("click",()=>openConversation(user));list.append(button)});
}

async function openConversation(user){
  activeUserId=user.id;renderConversationList();document.querySelector("#chat-user strong").textContent=user.name;
  const form=document.getElementById("admin-message-form");form.querySelector("textarea").disabled=false;form.querySelector("button").disabled=false;
  const {messages}=await FormSpace.api(`/api/messages?userId=${user.id}`);const box=document.getElementById("admin-messages");box.replaceChildren();
  if(!messages.length){const empty=document.createElement("p");empty.className="empty-state";empty.textContent="Сообщений пока нет.";box.append(empty);return}
  messages.forEach(item=>{const article=document.createElement("article");article.className=`message ${item.senderRole==="admin"?"mine":""}`;const text=document.createElement("p");text.textContent=item.body;const time=document.createElement("time");time.textContent=FormSpace.formatDate(item.createdAt,true);article.append(text,time);box.append(article)});box.scrollTop=box.scrollHeight;
}

document.getElementById("admin-message-form").addEventListener("submit",async event=>{event.preventDefault();if(!activeUserId)return;const field=document.getElementById("admin-message-input");try{await FormSpace.api("/api/messages",{method:"POST",body:JSON.stringify({userId:activeUserId,message:field.value})});field.value="";const user=users.find(u=>u.id===activeUserId);await openConversation(user)}catch(error){alert(error.message)}});
document.querySelector(".logout-button").addEventListener("click",async()=>{try{await FormSpace.api("/api/logout",{method:"POST",body:"{}"})}finally{location.href="/"}});

(async()=>{try{const user=await FormSpace.loadSession();if(!user)return location.replace("/login");if(user.role!=="admin")return location.replace("/cabinet");await Promise.all([loadAnalytics(),loadUsers()])}catch{location.replace("/login")}})();
