window.FormSpace = {
  csrf: null,
  user: null,
  async api(url, options = {}) {
    if (options.method && options.method !== "GET" && !this.csrf) {
      const sessionResponse = await fetch("/api/me", { headers: { "Accept": "application/json" } });
      const sessionData = await sessionResponse.json();
      this.csrf = sessionData.csrfToken;
      this.user = sessionData.user;
    }
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (this.csrf && options.method && options.method !== "GET") headers["X-CSRFToken"] = this.csrf;
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Не удалось выполнить запрос");
    return data;
  },
  applyPreferences(user) {
    if (!user) return;
    document.body.classList.toggle("theme-light", user.theme === "light");
    document.body.classList.remove("accent-cyan", "accent-amber", "density-compact");
    if (user.accent === "cyan") document.body.classList.add("accent-cyan");
    if (user.accent === "amber") document.body.classList.add("accent-amber");
    if (user.density === "compact") document.body.classList.add("density-compact");
  },
  async loadSession() {
    const data = await this.api("/api/me");
    this.user = data.user;
    this.csrf = data.csrfToken;
    this.applyPreferences(data.user);
    return data.user;
  },
  formatDate(value, withTime = false) {
    const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
    return new Intl.DateTimeFormat("ru-RU", withTime ? { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" } : { day:"2-digit", month:"short", year:"numeric" }).format(new Date(normalized));
  }
};

document.querySelector(".nav-toggle")?.addEventListener("click", (event) => {
  const nav = document.querySelector(".main-nav");
  const open = nav.classList.toggle("open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
});

document.getElementById("year")?.replaceChildren(String(new Date().getFullYear()));

if (document.body.dataset.page === "home") {
  FormSpace.loadSession().then(user => {
    const authLink = document.querySelector(".auth-link");
    if (user && authLink) {
      authLink.textContent = user.role === "admin" ? "Админ-панель" : "Личный кабинет";
      authLink.href = user.role === "admin" ? "/admin" : "/cabinet";
    }
  }).catch(() => {});
}

FormSpace.api("/api/visit", {
  method: "POST",
  body: JSON.stringify({ pathname: location.pathname, referrer: document.referrer })
}).catch(() => {});

const canvas = document.getElementById("scene-canvas");
if (canvas) {
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const vertices = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
  const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  function rotate([x,y,z], ax, ay) {
    const y1 = y*Math.cos(ax)-z*Math.sin(ax), z1 = y*Math.sin(ax)+z*Math.cos(ax);
    return [x*Math.cos(ay)+z1*Math.sin(ay), y1, -x*Math.sin(ay)+z1*Math.cos(ay)];
  }
  function draw(t = 0) {
    const size = canvas.width, time = reduced ? .8 : t*.00035;
    ctx.clearRect(0,0,size,size); ctx.save(); ctx.translate(size/2,size/2);
    const points = vertices.map(v => { const [x,y,z]=rotate(v,time*.7,time); const s=1180/(z+6); return [x*s,y*s,z]; });
    ctx.lineWidth=2; ctx.strokeStyle=getComputedStyle(document.body).getPropertyValue("--accent"); ctx.globalAlpha=.85;
    edges.forEach(([a,b])=>{ctx.beginPath();ctx.moveTo(points[a][0],points[a][1]);ctx.lineTo(points[b][0],points[b][1]);ctx.stroke()});
    ctx.globalAlpha=.18; for(let i=0;i<10;i++){ctx.beginPath();ctx.arc(0,0,80+i*22,0,Math.PI*2);ctx.stroke()}
    ctx.restore(); if (!reduced) requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
